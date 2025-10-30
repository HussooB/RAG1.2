/**
 * Approximate token count: 1 token ≈ 4 chars
 */
function approximateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into sentences using punctuation as delimiter
 */
function splitSentences(text) {
  return text.split(/(?<=[.?!])\s+/).filter(Boolean);
}

/**
 * Further split long sentences into sub-sentences if they exceed maxTokens
 */
function splitLongSentence(sentence, maxTokens) {
  const tokens = approximateTokens(sentence);
  if (tokens <= maxTokens) return [sentence];

  // Simple split by comma or semicolon
  const parts = sentence.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  // If still too long, fallback to character split
  const chunks = [];
  let buffer = "";
  for (const part of parts) {
    if (approximateTokens(buffer + " " + part) > maxTokens) {
      if (buffer) chunks.push(buffer);
      buffer = part;
    } else {
      buffer += buffer ? " " + part : part;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

/**
 * Optimized sentence + token-aware chunking with overlap
 */
export function chunkText(text, maxTokens = 200, overlapTokens = 30) {
  const sentences = splitSentences(text);
  const chunks = [];

  let currentChunk = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const subSentences = splitLongSentence(sentence, maxTokens);

    for (const sub of subSentences) {
      const sentenceTokens = approximateTokens(sub);

      // finalize chunk if exceeding maxTokens
      if (currentTokens + sentenceTokens > maxTokens) {
        // save chunk
        chunks.push(currentChunk.join(' '));

        // keep overlap for next chunk
        let overlapSentenceTokens = 0;
        const overlapChunk = [];
        for (let i = currentChunk.length - 1; i >= 0; i--) {
          const t = approximateTokens(currentChunk[i]);
          if (overlapSentenceTokens + t <= overlapTokens) {
            overlapChunk.unshift(currentChunk[i]);
            overlapSentenceTokens += t;
          } else break;
        }

        currentChunk = [...overlapChunk];
        currentTokens = overlapSentenceTokens;
      }

      currentChunk.push(sub);
      currentTokens += sentenceTokens;
    }
  }

  // push last chunk
  if (currentChunk.length > 0) chunks.push(currentChunk.join(' '));

  return chunks;
}
