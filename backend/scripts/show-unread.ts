import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, roomReads } from '../src/db/index.js';
import { WebSocketServer } from '../src/websocket/server.js';

async function main() {
  const roomId = process.argv[2];
  if (!roomId) {
    console.error('Usage: tsx scripts/show-unread.ts <room-id>');
    process.exit(1);
  }
  const server = new WebSocketServer();
  try {
    const counts = await (server as any).computeUnreadCounts(roomId);
    console.log('Unread counts for room', roomId);
    for (const [actorId, count] of counts.entries()) {
      console.log('  ', actorId, count);
    }
  } catch (err) {
    console.error('Failed to compute unread counts', err);
  }
  try {
    const reads = await db.select().from(roomReads).where(eq(roomReads.roomId, roomId));
    console.log('room_reads rows:', reads);
  } catch (err) {
    console.error('Failed to load room_reads', err);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
