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
    const relationshipId = '4e5d29db-ca88-4983-8b8b-958e94de93ab';
    
    const deleteRes = await client.query(
      `DELETE FROM relationships WHERE id = $1 RETURNING id, kind, from_actor_id, to_actor_id`,
      [relationshipId]
    );

    if (deleteRes.rowCount > 0) {
      console.log('Successfully deleted relationship:');
      console.log(deleteRes.rows[0]);
    } else {
      console.log('No relationship found with that ID');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
