#!/usr/bin/env node
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
// Import TS embedding service via tsx runtime
import { embeddingService } from '../src/memory/embedding-service.ts';

async function main() {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX_NAME || 'superagent';
  const dimEnv = process.env.PINECONE_DIMENSION;
  const dimension = dimEnv ? Math.max(8, parseInt(dimEnv, 10) || 0) : 1536;
  if (!apiKey) {
    console.error('PINECONE_API_KEY missing');
    process.exit(1);
  }
  const pc = new Pinecone({ apiKey });
  console.log('Pinecone client ok');

  try {
    const list = await pc.listIndexes();
    console.log('Indexes:', list?.indexes?.map?.(x => x.name || x) || list);
  } catch (e) {
    console.warn('listIndexes failed (older SDKs may not support):', e?.message || e);
  }

  const index = pc.index(indexName);
  console.log('Using index:', indexName);

  const probeText = 'diagnostic probe text for pinecone';
  const vec = await embeddingService.generateEmbedding(probeText);
  console.log('Probe vector dimension:', vec.length, '(expected', dimension, ')');

  try {
    await index.upsert([{ id: 'diag-1', values: vec, metadata: { content: probeText } }]);
    console.log('Upsert ok');
  } catch (e) {
    console.error('Upsert failed:', e?.message || e);
    process.exit(1);
  }

  try {
    const q = await index.query({ vector: vec, topK: 1, includeMetadata: true });
    const match = q?.matches?.[0];
    console.log('Query ok; top match id:', match?.id, 'score:', match?.score, 'content:', match?.metadata?.content);
  } catch (e) {
    console.error('Query failed:', e?.message || e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Diagnostics crashed:', e?.stack || e);
  process.exit(1);
});
