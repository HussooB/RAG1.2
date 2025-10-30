import { embedText } from "../utils/embedder.js";
import { chunkText } from "../utils/chunker.js";
import { GoogleGenAI } from "@google/genai";
import { qdrant } from "../config/qdrantClient.js";
import { redis } from "../config/redisClient.js";
import { v4 as uuidv4 } from "uuid";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const ai = new GoogleGenAI({});

// --- Gemini helper ---
async function sendToGemini(prompt) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
    });
    return response.text;
  } catch (err) {
    console.error("Gemini API Error:", err);
    return "Failed to generate an answer from Gemini.";
  }
}

// --- Helper: build Qdrant filter dynamically ---
function buildQdrantFilter(filters = {}) {
  const must = Object.entries(filters).map(([key, value]) => ({
    key,
    match: { value },
  }));
  return must.length > 0 ? { must } : undefined;
}

// --- Text ingestion ---
export const ingestText = async (req, res) => {
  try {
    const { text, filename = "user_text.txt", ...extraPayload } = req.body;
    if (!text) return res.status(400).json({ error: "Text required" });

    const chunks = chunkText(text).filter(Boolean);
    const points = [];

    for (const [i, chunk] of chunks.entries()) {
      const embedding = await embedText(chunk);
      if (!Array.isArray(embedding) || embedding.length === 0) continue;

      points.push({
        id: uuidv4(),
        vector: embedding,
        payload: { chunk, filename, chunkIndex: i, ...extraPayload },
      });
    }

    if (points.length > 0) await qdrant.upsert("docs", { points });
    res.json({ message: `${points.length} chunks stored in Qdrant` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

// --- PDF ingestion ---
export const ingestPDF = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "PDF file required" });

    const pdfData = new Uint8Array(req.file.buffer);
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;

    let text = "";
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(" ") + "\n";
    }

    const filename = req.body.filename || req.file.originalname;
    const chunks = chunkText(text).filter(Boolean);
    const points = [];

    for (const [i, chunk] of chunks.entries()) {
      const embedding = await embedText(chunk);
      if (!Array.isArray(embedding) || embedding.length === 0) continue;

      points.push({
        id: uuidv4(),
        vector: embedding,
        payload: { chunk, filename, chunkIndex: i },
      });
    }

    if (points.length > 0) await qdrant.upsert("docs", { points });
    res.json({ message: `${points.length} chunks stored in Qdrant` });
  } catch (e) {
    console.error("PDF ingestion error:", e);
    res.status(500).json({ error: e.message });
  }
};

// --- Query with greeting, hybrid detection, and fallback ---
export const query = async (req, res) => {
  try {
    const { question, filters = {}, limit = 5, minScore = 0.0 } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });

    const lowerQ = question.trim().toLowerCase();

    // --- Greeting detection (even inside longer sentences) ---
    const greetKeywords = [
      "hi", "hello", "hey", "yo", "what’s up", "sup",
      "good morning", "good afternoon", "good evening",
      "how are you", "how’s it going", "greetings"
    ];
    const hasGreeting = greetKeywords.some((kw) => lowerQ.includes(kw));

    // --- Handle pure or follow-up greetings ---
    if (hasGreeting && lowerQ.split(" ").length <= 6) {
      const greetingPrompt = `
You are the official CSEC-ASTU Info Assistant.
The user greeted or casually addressed you with: "${question}".
Respond warmly and confidently, showing friendly energy.
Sound institutional — like a proud club representative — but approachable.
End by inviting them naturally to ask about CSEC-ASTU, its divisions, or events.

Example style:
"Hey there yourself! 👋 I’m the CSEC-ASTU Info Assistant — proud to represent the club. What would you like to explore about us today?"

Now respond:
      `;
      const greetingAnswer = await sendToGemini(greetingPrompt);
      return res.json({
        answer: greetingAnswer,
        greeting: true,
      });
    }

    // --- Redis cache check ---
    const cacheKey = `answer:${lowerQ}:${JSON.stringify(filters)}`;
    const cached = await redis.get(cacheKey);
    if (cached) return res.json({ answer: cached, cached: true });

    // --- Embed (cached if possible) ---
    const embedKey = `embed:${lowerQ}`;
    let qVec = await redis.get(embedKey);
    if (qVec) qVec = JSON.parse(qVec);
    else {
      qVec = await embedText(question);
      await redis.set(embedKey, JSON.stringify(qVec), "EX", 3600);
    }

    // --- Qdrant search ---
    const results = await qdrant.search("docs", {
      vector: qVec,
      limit: limit * 3,
      withPayload: true,
      filter: buildQdrantFilter(filters),
    });

    const filtered = results
      .filter((r) => r.score >= minScore)
      .map((r) => r.payload.chunk)
      .slice(0, limit);

    // --- No context fallback ---
    if (!filtered.length) {
      const fallbackPrompt = `
You are the official CSEC-ASTU Info Assistant.
The user asked: "${question}".
You found no matching context in your database.
Still respond naturally, with warmth, confidence, and institutional pride.
Never say “no context” or “not found.”
Encourage curiosity and keep the tone friendly.

Examples:
- "Hmm, that’s an interesting one! I don’t have exact info right now, but I can share something about CSEC-ASTU’s divisions or our events."
- "Not sure about that yet — but let’s talk about how CSEC-ASTU helps students grow!"

Now respond:
      `;
      const fallbackAnswer = await sendToGemini(fallbackPrompt);
      return res.json({ answer: fallbackAnswer, noContext: true });
    }

    // --- Main Gemini Answer ---
    const prompt = `
You are the official CSEC-ASTU Info Assistant.
Use ONLY the context provided below to answer accurately and clearly.
Keep a friendly and proud tone — like a human club representative.
If unsure, guide the user politely instead of guessing.
If asked who developed you, say: "HUSSEIN BESHIR."

Context:
${filtered.join("\n\n")}

Question:
${question}

Answer:
    `;

    const answer = await sendToGemini(prompt);
    await redis.set(cacheKey, answer, "EX", 3600);

    res.json({ answer, cached: false });
  } catch (e) {
    console.error("Query error:", e);
    res.status(500).json({ error: e.message });
  }
};
