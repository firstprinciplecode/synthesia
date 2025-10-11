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
    // Find Gordon Ramsay agent
    const gordonAgentRes = await client.query(`
      SELECT a.id, a.name, a.created_by, u.email as creator_email
      FROM agents a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.name = 'Gordon Ramsay' 
      LIMIT 1
    `);
    
    if (gordonAgentRes.rows.length === 0) {
      console.log('Gordon Ramsay agent not found');
      return;
    }
    
    const gordon = gordonAgentRes.rows[0];
    console.log('Gordon Ramsay Agent:');
    console.log(`  ID: ${gordon.id}`);
    console.log(`  Created By: ${gordon.created_by}`);
    console.log(`  Creator Email: ${gordon.creator_email}`);

    // Find all Gordon Ramsay actor instances
    const gordonActorsRes = await client.query(`
      SELECT a.id, a.owner_user_id, a.created_at, u.email as owner_email
      FROM actors a
      LEFT JOIN users u ON u.id = a.owner_user_id
      WHERE a.type = 'agent' AND a.settings->>'agentId' = $1
      ORDER BY a.created_at
    `, [gordon.id]);
    
    console.log(`\nGordon Ramsay Actor Instances: ${gordonActorsRes.rows.length}`);
    for (const actor of gordonActorsRes.rows) {
      console.log(`\n  Actor ID: ${actor.id}`);
      console.log(`    Owner User ID: ${actor.owner_user_id}`);
      console.log(`    Owner Email: ${actor.owner_email || 'N/A'}`);
      console.log(`    Created: ${actor.created_at}`);
      console.log(`    Is Canonical: ${actor.owner_user_id === gordon.created_by ? 'YES' : 'NO'}`);
    }
    
    // Find the canonical actor (owned by creator)
    const canonical = gordonActorsRes.rows.find(a => a.owner_user_id === gordon.created_by);
    
    if (canonical) {
      console.log(`\n=== Canonical Gordon Ramsay Actor ===`);
      console.log(`  Actor ID: ${canonical.id}`);
      console.log(`  Owned by: ${canonical.owner_email}`);
      
      // Delete all non-canonical actors
      const nonCanonical = gordonActorsRes.rows.filter(a => a.id !== canonical.id);
      if (nonCanonical.length > 0) {
        console.log(`\n=== Deleting ${nonCanonical.length} non-canonical Gordon Ramsay actors ===`);
        for (const actor of nonCanonical) {
          console.log(`  - ${actor.id} (owned by ${actor.owner_email || 'N/A'})`);
        }
        
        const actorIds = nonCanonical.map(a => a.id);
        await client.query(`DELETE FROM actors WHERE id = ANY($1)`, [actorIds]);
        console.log(`Deleted ${nonCanonical.length} duplicate actors`);
      }
    } else {
      console.log('\nWARNING: No canonical actor found (none owned by creator)');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main();
