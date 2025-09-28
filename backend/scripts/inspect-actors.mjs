import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '../.env') });

import { db, actors, users } from '../src/db/index.js';

async function inspectActors() {
  const all = await db.select().from(actors);
  const userActors = all.filter(a => a.type === 'user');
  const agentActors = all.filter(a => a.type === 'agent');

  // Load users to show emails for ownerUserId if they are user ids
  const allUsers = await db.select().from(users);
  const usersById = Object.fromEntries(allUsers.map(u => [u.id, u]));

  function mapUser(a) {
    const u = usersById[a.ownerUserId];
    return {
      id: a.id,
      ownerUserId: a.ownerUserId,
      ownerEmail: u?.email || null,
      handle: a.handle,
      displayName: a.displayName,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  const usersMapped = userActors.map(mapUser);
  const dupGroups = {};
  for (const ua of usersMapped) {
    const key = ua.ownerUserId;
    dupGroups[key] = dupGroups[key] || [];
    dupGroups[key].push(ua);
  }

  const dups = Object.entries(dupGroups).filter(([_, list]) => list.length > 1);

  console.log('[actors] total:', all.length);
  console.log('[actors] user actors:', userActors.length);
  console.log('[actors] agent actors:', agentActors.length);
  console.log('[actors] duplicate user groups by ownerUserId:', dups.length);
  for (const [owner, list] of dups) {
    console.log('  ownerUserId:', owner);
    console.table(list);
  }

  // Also show any actors sharing the same displayName for visibility
  const byName = {};
  for (const ua of usersMapped) {
    const key = (ua.displayName || '').toLowerCase();
    byName[key] = byName[key] || [];
    byName[key].push(ua);
  }
  const nameDups = Object.entries(byName).filter(([k, list]) => k && list.length > 1);
  if (nameDups.length) {
    console.log('[actors] potential duplicates by displayName:');
    for (const [name, list] of nameDups) {
      console.log(`  name: ${name}`);
      console.table(list);
    }
  }
}

inspectActors().catch(err => { console.error(err); process.exit(1); });


