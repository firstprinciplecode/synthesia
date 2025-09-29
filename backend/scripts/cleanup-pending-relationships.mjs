#!/usr/bin/env node
import { config } from 'dotenv'
import { join } from 'path'
import pg from 'pg'

config({ path: join(process.cwd(), '../.env') })

const { Client } = pg

async function main() {
  const emailA = process.argv[2]
  const emailB = process.argv[3]
  if (!emailA || !emailB) {
    console.error('Usage: node scripts/cleanup-pending-relationships.mjs <emailA> <emailB>')
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  try {
    await client.query('begin')
    const ua = await client.query('select id from users where email = $1 limit 1', [emailA])
    const ub = await client.query('select id from users where email = $1 limit 1', [emailB])
    if (!ua.rows.length || !ub.rows.length) throw new Error('User(s) not found')
    const aId = ua.rows[0].id
    const bId = ub.rows[0].id

    const aActors = await client.query("select id from actors where type = 'user' and owner_user_id = $1", [aId])
    const bActors = await client.query("select id from actors where type = 'user' and owner_user_id = $1", [bId])
    const aSet = aActors.rows.map(r => r.id)
    const bSet = bActors.rows.map(r => r.id)

    // Delete pending follow relationships in both directions between any of these actor ids
    const res1 = await client.query(
      "delete from relationships where kind = 'follow' and (metadata->>'status') = 'pending' and from_actor_id = any($1) and to_actor_id = any($2)",
      [aSet, bSet]
    )
    const res2 = await client.query(
      "delete from relationships where kind = 'follow' and (metadata->>'status') = 'pending' and from_actor_id = any($1) and to_actor_id = any($2)",
      [bSet, aSet]
    )

    await client.query('commit')
    console.log(JSON.stringify({ emailA, emailB, deletedAtoB: res1.rowCount, deletedBtoA: res2.rowCount }, null, 2))
  } catch (e) {
    await client.query('rollback')
    console.error(e)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })


