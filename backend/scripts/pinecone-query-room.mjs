#!/usr/bin/env node
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';

const roomId = process.env.ROOM_ID;
const queryText = process.env.QUERY || 'SpaceX';
const topK = Number(process.env.TOPK || 5);
if (!roomId) {
  console.error('Usage: ROOM_ID=... [QUERY=SpaceX] [TOPK=5] node backend/scripts/pinecone-query-room.mjs');
  process.exit(1);
}

function embed(text) {
  const dim = process.env.PINECONE_DIMENSION ? Math.max(8, parseInt(process.env.PINECONE_DIMENSION, 10) || 0) : 1536;
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin((seed + i * 97) % 1000) * Math.cos((seed ^ i * 193) % 1000);
  return v;
}

(async () => {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX_NAME || 'superagent';
  if (!apiKey) { console.error('PINECONE_API_KEY missing'); process.exit(1); }
  const pc = new Pinecone({ apiKey });
  const index = pc.index(indexName);
  const vector = embed(queryText);
  const filter = { conversationId: roomId, messageType: 'conversation' };
  const res = await index.query({ vector, topK, filter, includeMetadata: true });
  const matches = res?.matches || [];
  console.log(`Matches: ${matches.length}`);
  for (const m of matches) {
    const content = (m?.metadata?.content || '').toString();
    console.log('-', m.id, m.score?.toFixed?.(4), content.slice(0, 240).replace(/\s+/g, ' '));
  }
})().catch((e) => { console.error('Query failed:', e?.message || e); process.exit(1); });


