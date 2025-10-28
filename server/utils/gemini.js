import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export async function generateAnswer(context, question) {
  const prompt = `
  You are a helpful assistant. Use **only** the following context to answer the question.
  If the context does not contain the answer, say "I don't know".

  --- CONTEXT ---
  ${context}
  --- END CONTEXT ---

  Question: ${question}
  Answer:`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}