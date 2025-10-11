import pkg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../env.local') });

const { Pool } = pkg;

const pool = process.env.DATABASE_URL 
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'synthesia',
      user: process.env.PGUSER || 'thomas',
      password: process.env.PGPASSWORD || '',
    });

async function main() {
  try {
    // Get all agent actors
    const result = await pool.query(`
      SELECT id, type, display_name, owner_user_id, settings, created_at
      FROM actors 
      WHERE type = 'agent' 
      ORDER BY created_at
    `);
    
    // Group by agentId
    const agentIdMap = new Map();
    result.rows.forEach(row => {
      const agentId = row.settings?.agentId;
      if (agentId) {
        if (!agentIdMap.has(agentId)) {
          agentIdMap.set(agentId, []);
        }
        agentIdMap.get(agentId).push(row);
      }
    });
    
    console.log('\n=== Cleaning up duplicate agent actors ===\n');
    
    let totalDeleted = 0;
    
    for (const [agentId, actors] of agentIdMap.entries()) {
      if (actors.length > 1) {
        // Keep the one with display_name and owner_user_id (the canonical one)
        // If none have both, keep the oldest one
        const canonical = actors.find(a => a.display_name && a.owner_user_id) || actors[0];
        const toDelete = actors.filter(a => a.id !== canonical.id);
        
        console.log(`Agent ID ${agentId} (${canonical.display_name || 'Unknown'}):`);
        console.log(`  Keeping: ${canonical.id} (created ${canonical.created_at})`);
        console.log(`  Deleting ${toDelete.length} duplicate(s):`);
        
        for (const actor of toDelete) {
          console.log(`    - ${actor.id} (created ${actor.created_at})`);
          
          // Delete from room_members first (foreign key constraint)
          await pool.query('DELETE FROM room_members WHERE actor_id = $1', [actor.id]);
          
          // Delete from relationships
          await pool.query('DELETE FROM relationships WHERE from_actor_id = $1 OR to_actor_id = $1', [actor.id]);
          
          // Delete the actor
          await pool.query('DELETE FROM actors WHERE id = $1', [actor.id]);
          
          totalDeleted++;
        }
        
        console.log('');
      }
    }
    
    console.log(`\n✅ Cleanup complete! Deleted ${totalDeleted} duplicate actor records.`);
    
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

main();

