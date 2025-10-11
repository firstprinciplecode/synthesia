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
    // Find thomas.petersen@gmail.com user
    const thomasPetersenRes = await client.query(`SELECT id FROM users WHERE email = 'thomas.petersen@gmail.com' LIMIT 1`);
    if (thomasPetersenRes.rows.length === 0) {
      console.log('thomas.petersen@gmail.com user not found');
      return;
    }
    const thomasPetersenUserId = thomasPetersenRes.rows[0].id;
    console.log('Thomas Petersen user ID:', thomasPetersenUserId);

    // Find all actors belonging to thomas.petersen
    const thomasPetersenActorsRes = await client.query(`SELECT id FROM actors WHERE owner_user_id = $1`, [thomasPetersenUserId]);
    console.log('Thomas Petersen actors:', thomasPetersenActorsRes.rows.length);
    const thomasPetersenActorIds = thomasPetersenActorsRes.rows.map(r => r.id);

    // Find Gordon Ramsay agent
    const gordonAgentRes = await client.query(`SELECT id FROM agents WHERE name = 'Gordon Ramsay' LIMIT 1`);
    const gordonAgentId = gordonAgentRes.rows[0].id;
    console.log('Gordon agent ID:', gordonAgentId);

    // Find all Gordon Ramsay actors
    const gordonActorRes = await client.query(`SELECT id, owner_user_id, created_at FROM actors WHERE type = 'agent' AND settings->>'agentId' = $1`, [gordonAgentId]);
    console.log(`\nGordon Ramsay actors found: ${gordonActorRes.rows.length}`);

    // Find all relationships FROM thomas.petersen's actors TO Gordon actors
    const relsRes = await client.query(`
      SELECT r.id, r.kind, r.from_actor_id, r.to_actor_id, r.metadata, r.created_at,
             a.owner_user_id as gordon_owner
      FROM relationships r
      LEFT JOIN actors a ON a.id = r.to_actor_id
      WHERE r.from_actor_id = ANY($1) 
        AND r.to_actor_id = ANY($2)
      ORDER BY r.created_at
    `, [thomasPetersenActorIds, gordonActorRes.rows.map(a => a.id)]);

    console.log('\n=== All relationships FROM Thomas Petersen TO Gordon Ramsay ===');
    console.log('Total:', relsRes.rows.length);
    
    const toDelete: string[] = [];
    
    for (const rel of relsRes.rows) {
      console.log(`\nRelationship ID: ${rel.id}`);
      console.log(`  Kind: ${rel.kind}`);
      console.log(`  From Actor: ${rel.from_actor_id}`);
      console.log(`  To Actor: ${rel.to_actor_id}`);
      console.log(`  Gordon Owner: ${rel.gordon_owner}`);
      console.log(`  Status: ${rel.metadata?.status || 'none'}`);
      console.log(`  Created: ${rel.created_at}`);
      
      // Delete all except the first accepted one
      if (toDelete.length === 0 && rel.kind === 'agent_access' && rel.metadata?.status === 'accepted') {
        console.log('  -> KEEP (first accepted)');
      } else {
        toDelete.push(rel.id);
        console.log('  -> DELETE');
      }
    }
    
    if (toDelete.length > 0) {
      console.log('\n=== Deleting duplicate relationships ===');
      const deleteRes = await client.query(
        `DELETE FROM relationships WHERE id = ANY($1) RETURNING id`,
        [toDelete]
      );
      console.log(`Deleted ${deleteRes.rowCount} relationships`);
    } else {
      console.log('\nNo duplicate relationships found.');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
