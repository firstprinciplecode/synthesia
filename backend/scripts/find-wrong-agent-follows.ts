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
    // Find all 'follow' relationships where the TO actor is an agent
    const relsRes = await client.query(`
      SELECT r.id, r.kind, r.from_actor_id, r.to_actor_id, r.metadata,
             a_to.type as to_type, a_to.settings as to_settings,
             a_from.type as from_type, a_from.owner_user_id, u.email
      FROM relationships r
      LEFT JOIN actors a_to ON a_to.id = r.to_actor_id
      LEFT JOIN actors a_from ON a_from.id = r.from_actor_id
      LEFT JOIN users u ON u.id = a_from.owner_user_id
      WHERE r.kind = 'follow' AND a_to.type = 'agent'
    `);

    console.log('\n=== Wrong "follow" relationships to agents ===');
    console.log('Total:', relsRes.rows.length);
    
    const toDelete: string[] = [];
    
    for (const rel of relsRes.rows) {
      const agentId = rel.to_settings?.agentId;
      
      // Get agent name
      let agentName = 'Unknown';
      if (agentId) {
        const agentRes = await client.query(`SELECT name FROM agents WHERE id = $1`, [agentId]);
        if (agentRes.rows.length > 0) {
          agentName = agentRes.rows[0].name;
        }
      }
      
      console.log(`\nRelationship ID: ${rel.id}`);
      console.log(`  Agent: ${agentName} (${agentId})`);
      console.log(`  From User: ${rel.email || 'default-user'}`);
      console.log(`  From Actor: ${rel.from_actor_id} (${rel.from_type})`);
      console.log(`  Metadata: ${JSON.stringify(rel.metadata)}`);
      
      toDelete.push(rel.id);
    }
    
    if (toDelete.length > 0) {
      console.log('\n=== Deleting all wrong relationships ===');
      const deleteRes = await client.query(
        `DELETE FROM relationships WHERE id = ANY($1) RETURNING id`,
        [toDelete]
      );
      console.log(`Deleted ${deleteRes.rowCount} relationships`);
    } else {
      console.log('\nNo wrong relationships found.');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
