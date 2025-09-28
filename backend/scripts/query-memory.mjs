#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load env
import 'dotenv/config';
// Import TS modules via tsx runtime
import { memoryService } from '../src/memory/memory-service.ts';
import { db } from '../src/db/index.ts';
import { conversationSummaries } from '../src/db/schema.ts';
import { eq, and, desc } from 'drizzle-orm';

const roomId = process.env.ROOM_ID;
const userId = process.env.USER_ID;
const query = process.env.QUERY || 'SpaceX';
if (!roomId || !userId) {
  console.error('Usage: ROOM_ID=... USER_ID=... [QUERY=...] node backend/scripts/query-memory.mjs');
  process.exit(1);
}

(async () => {
  try {
    const hits = await memoryService.searchLongTermByUser(userId, query, 5, { roomId, messageType: 'conversation' });
    console.log('Pinecone hits:', hits.length);
    for (const h of hits) {
      console.log('- content:', (h.content || '').slice(0, 160).replace(/\s+/g, ' '));
    }

    const rows = await db.select()
      .from(conversationSummaries)
      .where(and(eq(conversationSummaries.agentId, roomId), eq(conversationSummaries.conversationId, roomId)))
      .orderBy(desc(conversationSummaries.createdAt));
    console.log('\nSummaries:', rows.length);
    for (const s of rows.slice(0, 3)) {
      console.log('- level', s.level, 'createdAt', s.createdAt);
      console.log(String(s.summary || '').slice(0, 240).replace(/\s+/g, ' '));
      console.log('');
    }
  } catch (e) {
    console.error('Query failed:', e?.message || e);
    process.exit(1);
  }
})();
