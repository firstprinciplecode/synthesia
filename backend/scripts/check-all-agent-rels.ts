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

    // Find all actors belonging to thomas
    const thomasActorsRes = await client.query(`SELECT id, type FROM actors WHERE owner_user_id = $1`, [thomasUserId]);
    console.log('Thomas actors:', thomasActorsRes.rows.length);
    const thomasActorIds = thomasActorsRes.rows.map(r => r.id);

    // Find all relationships FROM thomas's actors
    const relsRes = await client.query(`
      SELECT r.id, r.kind, r.from_actor_id, r.to_actor_id, r.metadata,
             a_to.type as to_type, a_to.settings as to_settings
      FROM relationships r
      LEFT JOIN actors a_to ON a_to.id = r.to_actor_id
      WHERE r.from_actor_id = ANY($1)
      ORDER BY r.kind, a_to.type
    `, [thomasActorIds]);

    console.log('\n=== All relationships FROM Thomas\'s actors ===');
    console.log('Total:', relsRes.rows.length);
    
    const agentRels: any[] = [];
    const userRels: any[] = [];
    
    for (const rel of relsRes.rows) {
      if (rel.to_type === 'agent') {
        agentRels.push(rel);
      } else {
        userRels.push(rel);
      }
    }
    
    console.log('\n--- Relationships to AGENTS ---');
    console.log('Count:', agentRels.length);
    for (const rel of agentRels) {
      const agentId = rel.to_settings?.agentId;
      let agentName = 'Unknown';
      if (agentId) {
        const agentRes = await client.query(`SELECT name FROM agents WHERE id = $1`, [agentId]);
        if (agentRes.rows.length > 0) {
          agentName = agentRes.rows[0].name;
        }
      }
      console.log(`  ${rel.id}: kind=${rel.kind}, agent=${agentName}, status=${rel.metadata?.status || 'none'}`);
    }
    
    console.log('\n--- Relationships to USERS ---');
    console.log('Count:', userRels.length);
    for (const rel of userRels) {
      console.log(`  ${rel.id}: kind=${rel.kind}, status=${rel.metadata?.status || 'none'}`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
