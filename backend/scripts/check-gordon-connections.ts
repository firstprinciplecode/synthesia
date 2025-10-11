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

    // Find Gordon Ramsay agent
    const gordonAgentRes = await client.query(`SELECT id FROM agents WHERE name = 'Gordon Ramsay' LIMIT 1`);
    if (gordonAgentRes.rows.length === 0) {
      console.log('Gordon Ramsay agent not found');
      return;
    }
    const gordonAgentId = gordonAgentRes.rows[0].id;
    console.log('Gordon agent ID:', gordonAgentId);

    // Find Gordon Ramsay actor
    const gordonActorRes = await client.query(`SELECT id FROM actors WHERE type = 'agent' AND settings->>'agentId' = $1`, [gordonAgentId]);
    console.log(`\nGordon Ramsay actors found: ${gordonActorRes.rows.length}`);
    for (const actor of gordonActorRes.rows) {
      console.log(`  - Actor ID: ${actor.id}`);
    }

    // Find all relationships FROM thomas's actors TO Gordon actors
    const relsRes = await client.query(`
      SELECT r.id, r.kind, r.from_actor_id, r.to_actor_id, r.metadata, r.created_at
      FROM relationships r
      WHERE r.from_actor_id = ANY($1) 
        AND r.to_actor_id = ANY($2)
      ORDER BY r.created_at
    `, [thomasActorIds, gordonActorRes.rows.map(a => a.id)]);

    console.log('\n=== All relationships FROM Thomas TO Gordon Ramsay ===');
    console.log('Total:', relsRes.rows.length);
    
    const toDelete: string[] = [];
    const toKeep: string[] = [];
    
    for (const rel of relsRes.rows) {
      console.log(`\nRelationship ID: ${rel.id}`);
      console.log(`  Kind: ${rel.kind}`);
      console.log(`  From Actor: ${rel.from_actor_id}`);
      console.log(`  To Actor: ${rel.to_actor_id}`);
      console.log(`  Status: ${rel.metadata?.status || 'none'}`);
      console.log(`  Created: ${rel.created_at}`);
      
      // Keep only the first accepted agent_access, delete all others
      if (rel.kind === 'agent_access' && rel.metadata?.status === 'accepted') {
        if (toKeep.length === 0) {
          toKeep.push(rel.id);
          console.log('  -> KEEP (first accepted)');
        } else {
          toDelete.push(rel.id);
          console.log('  -> DELETE (duplicate)');
        }
      } else {
        toDelete.push(rel.id);
        console.log(`  -> DELETE (${rel.metadata?.status || 'not accepted'})`);
      }
    }
    
    if (toDelete.length > 0) {
      console.log('\n=== Deleting duplicate/pending relationships ===');
      const deleteRes = await client.query(
        `DELETE FROM relationships WHERE id = ANY($1) RETURNING id`,
        [toDelete]
      );
      console.log(`Deleted ${deleteRes.rowCount} relationships`);
    } else {
      console.log('\nNo duplicate relationships to delete.');
    }
    
    console.log(`\nKept ${toKeep.length} relationship(s)`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
