import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';

dotenv.config();

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

export const initQdrant = async () => {
  try {
    // Check if collection already exists
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === 'docs');

    if (!exists) {
      await qdrant.createCollection('docs', {
        vectors: {
          size: 384, // match your embedding size
          distance: 'Cosine',
        },
      });
      console.log('✅ Qdrant collection "docs" created');
    } else {
      console.log('⚙️ Qdrant collection "docs" already exists, skipping creation');
    }
  } catch (err) {
    console.error('❌ Qdrant initialization error:', err.message);
  }
};
