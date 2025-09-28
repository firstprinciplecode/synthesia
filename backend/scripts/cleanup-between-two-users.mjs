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
    console.error('Usage: node scripts/cleanup-between-two-users.mjs <emailA> <emailB>')
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  const getUser = async (email) => (await client.query('select id from users where email=$1 limit 1', [email])).rows[0]
  const ua = await getUser(emailA)
  const ub = await getUser(emailB)
  if (!ua || !ub) {
    console.error('Users not found')
    process.exit(2)
  }

  const actorsA = (await client.query("select id from actors where type='user' and owner_user_id=$1", [ua.id])).rows.map(r=>r.id)
  const actorsB = (await client.query("select id from actors where type='user' and owner_user_id=$1", [ub.id])).rows.map(r=>r.id)

  const delAB = await client.query("delete from relationships where kind='follow' and from_actor_id = ANY($1) and to_actor_id = ANY($2)", [actorsA, actorsB])
  const delBA = await client.query("delete from relationships where kind='follow' and from_actor_id = ANY($1) and to_actor_id = ANY($2)", [actorsB, actorsA])

  console.log(JSON.stringify({ deletedAtoB: delAB.rowCount, deletedBtoA: delBA.rowCount }, null, 2))
  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })
