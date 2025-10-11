import 'dotenv/config';
import { Client } from 'pg';
import fs from 'fs';

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return String(process.env.DATABASE_URL);
  try {
    const rootEnv = fs.existsSync('../.env') ? fs.readFileSync('../.env', 'utf8') : '';
    const m = rootEnv.match(/^DATABASE_URL=(.*)$/m);
    if (m && m[1]) return m[1].trim();
  } catch {}
  throw new Error('DATABASE_URL not set');
}

async function main() {
  const connectionString = getDatabaseUrl();
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const relIds = [
      '3c2c81f3-422b-42c0-a245-4eb3fb9e606d', // PalmerLucky
      'cbef3869-9493-45ff-8c56-ed25d4b3c8cc'  // Gordon Ramsay
    ];
    
    const deleteRes = await client.query(
      `DELETE FROM relationships WHERE id = ANY($1) RETURNING id, kind, to_actor_id`,
      [relIds]
    );

    console.log(`Deleted ${deleteRes.rowCount} relationships:`);
    for (const row of deleteRes.rows) {
      console.log(`  - ${row.id} (${row.kind})`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
