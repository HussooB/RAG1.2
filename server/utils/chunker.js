/**
 * Approximate token count: 1 token ≈ 4 chars
 * Simple, fast, Node.js friendly
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
 * Optimized sentence + token-aware chunking
 * Packs sentences close to maxTokens while keeping overlap
 * 
 * @param {string} text - full text
 * @param {number} maxTokens - max tokens per chunk (approximate)
 * @param {number} overlapTokens - tokens to overlap between chunks
 * @returns {string[]} - array of text chunks
 */
export function chunkText(text, maxTokens = 200, overlapTokens = 30) {
  const sentences = splitSentences(text);
  const chunks = [];

  let currentChunk = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = approximateTokens(sentence);

    // If adding this sentence exceeds maxTokens, finalize current chunk
    if (currentTokens + sentenceTokens > maxTokens) {
      // Save chunk
      chunks.push(currentChunk.join(' '));

      // Keep overlap sentences for next chunk
      let overlapSentenceTokens = 0;
      const overlapChunk = [];

      // Walk backwards to pack overlapTokens
      for (let i = currentChunk.length - 1; i >= 0; i--) {
        const t = approximateTokens(currentChunk[i]);
        if (overlapSentenceTokens + t <= overlapTokens) {
          overlapChunk.unshift(currentChunk[i]);
          overlapSentenceTokens += t;
        } else {
          break;
        }
      }

      currentChunk = [...overlapChunk];
      currentTokens = overlapSentenceTokens;
    }

    currentChunk.push(sentence);
    currentTokens += sentenceTokens;
  }

  // Push last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks;
}
