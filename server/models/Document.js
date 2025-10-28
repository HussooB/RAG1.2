import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  chunk: { type: String, required: true },
  metadata: { type: Object, default: {} },
  qdrantId: { type: String }, // store Qdrant vector ID for hybrid search
}, {
  timestamps: true,
  collection: 'RAG'
});

export default mongoose.model('Document', documentSchema);
