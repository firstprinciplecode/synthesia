#!/usr/bin/env node
import pg from 'pg'

// Usage:
//   DATABASE_URL=... node backend/scripts/cleanup-agent-access.mjs <userEmail> <agentId>

const { Client } = pg

async function main() {
  const userEmail = process.argv[2]
  const agentId = process.argv[3]
  if (!userEmail || !agentId) {
    console.error('Usage: node backend/scripts/cleanup-agent-access.mjs <userEmail> <agentId>')
    process.exit(1)
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false })
  await client.connect()
  try {
    const u = await client.query('SELECT id FROM users WHERE email=$1', [userEmail])
    if (!u.rows.length) throw new Error('User not found for email: ' + userEmail)
    const userId = u.rows[0].id
    const a = await client.query("SELECT id FROM actors WHERE type='user' AND owner_user_id=$1 ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1", [userId])
    if (!a.rows.length) throw new Error('No user actor for owner ' + userId)
    const userActorId = a.rows[0].id

    const agActor = await client.query("SELECT id FROM actors WHERE type='agent' AND settings->>'agentId' = $1 LIMIT 1", [agentId])
    if (!agActor.rows.length) {
      console.log('No agent actor found for agentId, nothing to delete')
      process.exit(0)
    }
    const agentActorId = agActor.rows[0].id

    await client.query('BEGIN')
    const del = await client.query("DELETE FROM relationships WHERE kind='agent_access' AND ((from_actor_id=$1 AND to_actor_id=$2) OR (from_actor_id=$2 AND to_actor_id=$1))", [userActorId, agentActorId])
    await client.query('COMMIT')
    console.log('Deleted relationships:', del.rowCount)
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    console.error('Failed:', e.message)
    process.exit(2)
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e); process.exit(2) })


