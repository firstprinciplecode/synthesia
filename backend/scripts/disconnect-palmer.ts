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
    // Find thomas@firstprinciple.co user
    const thomasRes = await client.query(`SELECT id FROM users WHERE email = 'thomas@firstprinciple.co' LIMIT 1`);
    if (thomasRes.rows.length === 0) {
      console.log('thomas@firstprinciple.co user not found');
      return;
    }
    const thomasUserId = thomasRes.rows[0].id;
    console.log('Thomas user ID:', thomasUserId);

    // Find all actors belonging to thomas@firstprinciple.co
    const thomasActorsRes = await client.query(`SELECT id FROM actors WHERE owner_user_id = $1`, [thomasUserId]);
    console.log('Thomas actors:', thomasActorsRes.rows.length);
    const thomasActorIds = thomasActorsRes.rows.map((r: any) => r.id);

    // Find Palmer Lucky agent
    const palmerAgentRes = await client.query(`SELECT id FROM agents WHERE name = 'PalmerLucky' LIMIT 1`);
    if (palmerAgentRes.rows.length === 0) {
      console.log('Palmer Lucky agent not found');
      return;
    }
    const palmerAgentId = palmerAgentRes.rows[0].id;
    console.log('Palmer agent ID:', palmerAgentId);

    // Find Palmer Lucky actor
    const palmerActorRes = await client.query(`SELECT id FROM actors WHERE type = 'agent' AND settings->>'agentId' = $1 LIMIT 1`, [palmerAgentId]);
    if (palmerActorRes.rows.length === 0) {
      console.log('Palmer Lucky actor not found');
      return;
    }
    const palmerActorId = palmerActorRes.rows[0].id;
    console.log('Palmer actor ID:', palmerActorId);

    // Delete all agent_access relationships from Thomas actors to Palmer actor
    const deleteRes = await client.query(
      `DELETE FROM relationships WHERE kind = 'agent_access' AND "from_actor_id" = ANY($1) AND "to_actor_id" = $2 RETURNING id`,
      [thomasActorIds, palmerActorId]
    );

    console.log('Deleted relationships:', deleteRes.rowCount);
    console.log('Deleted relationship IDs:', deleteRes.rows.map(r => r.id));
    console.log('Successfully disconnected Thomas from Palmer Lucky');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
