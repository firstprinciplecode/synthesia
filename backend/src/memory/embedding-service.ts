// Minimal fallback embedding service to unblock runtime when external embedding
// providers are not configured. Produces a deterministic numeric vector so
// Pinecone upserts won't crash the app due to missing module imports.
// Note: If the vector dimension doesn't match your Pinecone index, the upsert
// will fail, but upstream callers already catch and log errors gracefully.

export const embeddingService = {
  async generateEmbedding(text: string): Promise<number[]> {
    const dimEnv = process.env.PINECONE_DIMENSION;
    const dimension = dimEnv ? Math.max(8, parseInt(dimEnv, 10) || 0) : 1536;

    // Deterministic seed from input text
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
    }

    const vector: number[] = new Array(dimension);
    for (let i = 0; i < dimension; i++) {
      const v = Math.sin((seed + i * 97) % 1000) * Math.cos((seed ^ i * 193) % 1000);
      vector[i] = v;
    }
    return vector;
  },
};

export default embeddingService;


