#!/usr/bin/env node
import pg from 'pg'

const { Client } = pg

async function main() {
  const actorId = process.argv[2]
  if (!actorId) {
    console.error('Usage: node scripts/delete-actor.mjs <actorId>')
    process.exit(1)
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false })
  await client.connect()
  try {
    await client.query('BEGIN')
    // Remove relationships where this actor is either side
    await client.query('DELETE FROM relationships WHERE from_actor_id = $1 OR to_actor_id = $1', [actorId])
    // Remove room memberships
    await client.query('DELETE FROM room_members WHERE actor_id = $1', [actorId])
    // Finally remove actor
    const res = await client.query('DELETE FROM actors WHERE id = $1', [actorId])
    await client.query('COMMIT')
    console.log('Deleted actor rows:', res.rowCount)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('Failed:', e.message)
    process.exit(2)
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e); process.exit(2) })


