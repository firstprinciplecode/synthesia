import { config } from 'dotenv';
import { join } from 'path';

// Load env from project root and local
config({ path: join(process.cwd(), '../.env') });
config();

import { db, users, actors, relationships, closeDbPool } from '../src/db/index.ts';

function normalizeString(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

async function main(): Promise<void> {
  const emailA = process.argv[2] || 'thomas@firstprinciple.co';
  const emailB = process.argv[3] || 'thomas.petersen@gmail.com';

  console.log('Checking connections between:', { emailA, emailB });

  const [userRows, actorRows, relRows] = await Promise.all([
    db.select().from(users),
    db.select().from(actors),
    db.select().from(relationships)
  ]);

  const userA = (userRows as any[]).find((u) => normalizeString(u.email) === normalizeString(emailA));
  const userB = (userRows as any[]).find((u) => normalizeString(u.email) === normalizeString(emailB));

  if (!userA || !userB) {
    console.log('Users found?', { hasUserA: !!userA, hasUserB: !!userB });
    return;
  }

  // ownerUserId can be a UUID or an email (older rows). Match both.
  function ownerMatches(ownerUserId: unknown, user: any): boolean {
    const owner = normalizeString(ownerUserId);
    return owner === normalizeString(user.id) || owner === normalizeString(user.email);
  }

  const actorsA = (actorRows as any[]).filter((a) => a.type === 'user' && ownerMatches(a.ownerUserId, userA));
  const actorsB = (actorRows as any[]).filter((a) => a.type === 'user' && ownerMatches(a.ownerUserId, userB));

  console.log('Actors:', { countA: actorsA.length, countB: actorsB.length });

  const aIds = new Set<string>(actorsA.map((a) => String(a.id)));
  const bIds = new Set<string>(actorsB.map((a) => String(a.id)));

  const isAccepted = (meta: any) => (meta?.status || 'accepted') === 'accepted';

  const outgoingAB = (relRows as any[]).filter(
    (r) => r.kind === 'follow' && isAccepted(r.metadata) && aIds.has(String(r.fromActorId)) && bIds.has(String(r.toActorId))
  );
  const incomingBA = (relRows as any[]).filter(
    (r) => r.kind === 'follow' && isAccepted(r.metadata) && bIds.has(String(r.fromActorId)) && aIds.has(String(r.toActorId))
  );

  console.log('Edges:', { outgoingAB: outgoingAB.length, incomingBA: incomingBA.length });
  if (outgoingAB.length) console.log('Sample outgoing A->B:', outgoingAB.slice(0, 3));
  if (incomingBA.length) console.log('Sample incoming B->A:', incomingBA.slice(0, 3));

  if (outgoingAB.length && incomingBA.length) console.log('Result: Mutual connection exists');
  else if (outgoingAB.length || incomingBA.length) console.log('Result: One-way connection exists');
  else console.log('Result: No connection found');
}

main()
  .catch((err) => {
    console.error('Error checking connections:', err);
  })
  .finally(async () => {
    await closeDbPool();
  });


