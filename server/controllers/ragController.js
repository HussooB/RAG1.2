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

// --- Safe batched ingest for plain text ---
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

// --- Safe batched ingest for PDF ---
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

// --- Original hybrid query ---
export const query = async (req, res) => {
  try {
    const { question, filters = {}, limit = 5, minScore = 0.0, hybrid = false, rewrite = false } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });

    const qVec = await embedText(question);
    const semanticResults = await qdrant.search("docs", {
      vector: qVec,
      limit: 30,
      withPayload: true,
      filter: buildQdrantFilter(filters),
    });

    let boostedResults = semanticResults;
    if (hybrid) {
      const lowerQ = question.toLowerCase();
      boostedResults = semanticResults.map((r) => {
        const text = r.payload.chunk.toLowerCase();
        const keywordBoost = lowerQ.split(/\s+/).reduce((score, word) => text.includes(word) ? score + 0.02 : score, 0);
        return { ...r, score: r.score + keywordBoost };
      });
    }

    const filtered = boostedResults.filter(r => r.score >= minScore).slice(0, 15);
    if (filtered.length === 0) return res.json({ answer: "No relevant context found." });

    const rerankPrompt = `
Given the user question below, rerank the following text snippets by how relevant they are to the question.
Return the best ${limit} snippets, most relevant first, as JSON array with keys "chunk" and "score".

Question: ${question}

Snippets:
${filtered.map((f, i) => `[${i + 1}] ${f.payload.chunk}`).join("\n\n")}
    `;

    let rerankedChunks;
    try {
      rerankedChunks = JSON.parse(await sendToGemini(rerankPrompt));
    } catch {
      rerankedChunks = filtered.slice(0, limit).map(f => ({ chunk: f.payload.chunk, score: f.score }));
    }

    const answerPrompt = `
You are a helpful AI assistant. Use only the following context to answer the user's question.
If unsure, say "Sorry, I don't know."
If asked who developed you, say HUSSEIN BESHIR.

Context:
${rerankedChunks.map(c => c.chunk).join("\n\n")}

Question:
${question}

Answer:
    `;

    let answer = await sendToGemini(answerPrompt);
    if (rewrite) answer = await sendToGemini(`Rewrite the following answer for clarity, keeping it concise and friendly:\n\n${answer}`);

    res.json({ answer, rerankedChunks, usedFilters: filters, hybrid, rewriteApplied: rewrite });
  } catch (e) {
    console.error("Query error:", e);
    res.status(500).json({ error: e.message });
  }
};

// --- Ultra-fast query with Redis caching ---
export const fastQuery = async (req, res) => {
  try {
    const { question, filters = {}, limit = 5, minScore = 0.0 } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });

    const cacheKey = `answer:${question.trim().toLowerCase()}:${JSON.stringify(filters)}`;
    const cachedAnswer = await redis.get(cacheKey);
    if (cachedAnswer) return res.json({ answer: cachedAnswer, cached: true });

    // --- Cache embeddings ---
    const embedKey = `embed:${question.trim().toLowerCase()}`;
    let qVec = await redis.get(embedKey);
    if (qVec) qVec = JSON.parse(qVec);
    else {
      qVec = await embedText(question);
      await redis.set(embedKey, JSON.stringify(qVec), "EX", 3600);
    }

    // --- Qdrant search ---
    const searchResults = await qdrant.search("docs", {
      vector: qVec,
      limit: limit * 3,
      withPayload: true,
      filter: buildQdrantFilter(filters),
    });

    const filteredChunks = searchResults
      .filter(r => r.score >= minScore)
      .map(r => r.payload.chunk)
      .slice(0, limit);

    if (!filteredChunks.length) return res.json({ answer: "No relevant context found." });

    // --- Single LLM call ---
    const prompt = `
You are a helpful AI assistant. Use only the following context to answer the user's question.
If unsure, say "Sorry, I don't know."
If asked who developed you, say HUSSEIN BESHIR.

Context:
${filteredChunks.join("\n\n")}

Question:
${question}

Answer:
    `;

    const answer = await sendToGemini(prompt);

    // --- Cache the answer ---
    await redis.set(cacheKey, answer, "EX", 3600);

    res.json({ answer, cached: false, usedFilters: filters });
  } catch (e) {
    console.error("Fast query error:", e);
    res.status(500).json({ error: e.message });
  }
};
