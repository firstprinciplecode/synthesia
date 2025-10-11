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
    // Find Palmer Lucky agent and actor
    const palmerAgentRes = await client.query(`SELECT id FROM agents WHERE name = 'PalmerLucky' LIMIT 1`);
    if (palmerAgentRes.rows.length === 0) {
      console.log('Palmer Lucky agent not found');
      return;
    }
    const palmerAgentId = palmerAgentRes.rows[0].id;
    console.log('Palmer agent ID:', palmerAgentId);

    const palmerActorRes = await client.query(`SELECT id FROM actors WHERE type = 'agent' AND settings->>'agentId' = $1 LIMIT 1`, [palmerAgentId]);
    if (palmerActorRes.rows.length === 0) {
      console.log('Palmer Lucky actor not found');
      return;
    }
    const palmerActorId = palmerActorRes.rows[0].id;
    console.log('Palmer actor ID:', palmerActorId);

    // Find all relationships TO Palmer Lucky
    const relsRes = await client.query(
      `SELECT r.id, r.kind, r.from_actor_id, r.to_actor_id, r.metadata, 
              a.type as from_type, a.owner_user_id, u.email
       FROM relationships r
       LEFT JOIN actors a ON a.id = r.from_actor_id
       LEFT JOIN users u ON u.id = a.owner_user_id
       WHERE r.to_actor_id = $1`,
      [palmerActorId]
    );

    console.log('\n=== All relationships TO Palmer Lucky ===');
    console.log('Total:', relsRes.rows.length);
    for (const rel of relsRes.rows) {
      console.log(`\nRelationship ID: ${rel.id}`);
      console.log(`  Kind: ${rel.kind}`);
      console.log(`  From Actor: ${rel.from_actor_id} (${rel.from_type})`);
      console.log(`  Owner User: ${rel.owner_user_id}`);
      console.log(`  Email: ${rel.email || 'N/A'}`);
      console.log(`  Metadata: ${JSON.stringify(rel.metadata)}`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
