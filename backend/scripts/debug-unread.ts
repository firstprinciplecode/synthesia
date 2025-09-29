import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '../.env') });
import { eq } from 'drizzle-orm';
import { db, users, actors, roomMembers, messages, roomReads } from '../src/db/index.js';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: tsx scripts/debug-unread.ts <user-email>');
    process.exit(1);
  }

  const userRows = await db.select().from(users).where(eq(users.email, email));
  if (!userRows.length) {
    console.error('No user found for', email);
    process.exit(1);
  }
  const user = userRows[0];
  console.log('User:', { id: user.id, email: user.email, name: user.name });

  const actorRows = await db.select().from(actors).where(eq(actors.ownerUserId as any, user.id as any));
  console.log('Actors:', actorRows.map(a => ({ id: a.id, type: a.type, updatedAt: a.updatedAt })));

  for (const actor of actorRows) {
    const memberships = await db.select().from(roomMembers).where(eq(roomMembers.actorId as any, actor.id as any));
    if (!memberships.length) continue;
    console.log(`\nActor ${actor.id} participates in rooms:`);
    for (const member of memberships) {
      const roomId = member.roomId as string;
      console.log(`- Room ${roomId}`);
      const msgs = await db.select({ id: messages.id, authorId: messages.authorId, createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.conversationId as any, roomId as any));
      console.log(`  Messages: ${msgs.length}`);
      const reads = await db.select().from(roomReads).where(eq(roomReads.roomId, roomId));
      console.log('  Reads:', reads.map(r => ({ actorId: r.actorId, lastReadMessageId: r.lastReadMessageId, lastReadAt: r.lastReadAt })));
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
