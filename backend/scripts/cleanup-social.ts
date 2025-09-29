/*
  Cleanup script: remove follows, agent_access, and DM rooms; clear room_reads; print before/after counts.
  Usage:
    DATABASE_URL=postgres://... node -r ts-node/register backend/scripts/cleanup-social.ts
  or
    cd backend && npm run ts-node -- scripts/cleanup-social.ts
*/

import 'dotenv/config';
import { Client } from 'pg';
import fs from 'fs';

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return String(process.env.DATABASE_URL);
  try {
    const rootEnv = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
    const m = rootEnv.match(/^DATABASE_URL=(.*)$/m);
    if (m && m[1]) return m[1].trim();
  } catch {}
  try {
    const beEnvPath = new URL('../.env', import.meta.url);
    const beEnv = fs.readFileSync(beEnvPath, 'utf8');
    const m = beEnv.match(/^DATABASE_URL=(.*)$/m);
    if (m && m[1]) return m[1].trim();
  } catch {}
  throw new Error('DATABASE_URL not set');
}

async function main() {
  const connectionString = getDatabaseUrl();
  const client = new Client({ connectionString });
  await client.connect();
  const q = async <T = any>(text: string, values: any[] = []) => {
    const r = await client.query({ text, values });
    return r.rows as T[];
  };

  const preview = async () => {
    const rel = await q<{ kind: string; count: string }>(
      'SELECT kind, COUNT(*) FROM relationships GROUP BY 1 ORDER BY 1'
    );
    const dm = await q<{ count: string }>(
      'SELECT COUNT(*) FROM rooms WHERE kind = $1',
      ['dm']
    );
    console.log('relationships:', rel);
    console.log('dm_rooms:', dm);
  };

  console.log('PREVIEW');
  await preview();

  console.log('Deleting relationships (follow, agent_access) ...');
  await client.query({
    text: 'DELETE FROM relationships WHERE kind = ANY($1::text[])',
    values: [['follow', 'agent_access']],
  });

  console.log('Deleting DM room members and rooms ...');
  const ids = await q<{ id: string }>('SELECT id FROM rooms WHERE kind = $1', ['dm']);
  const dmIds = ids.map(r => String(r.id));
  if (dmIds.length) {
    // IDs are stored as text/varchar in this schema
    await client.query({ text: 'DELETE FROM room_members WHERE room_id = ANY($1::text[])', values: [dmIds] });
    await client.query({ text: 'DELETE FROM rooms WHERE id = ANY($1::text[])', values: [dmIds] });
  }

  console.log('Truncating room_reads ...');
  try {
    await client.query('TRUNCATE room_reads');
  } catch (e) {
    console.warn('TRUNCATE room_reads failed (may not exist):', (e as Error).message);
  }

  console.log('POSTVIEW');
  await preview();

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


