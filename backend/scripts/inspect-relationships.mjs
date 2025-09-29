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
    console.error('Usage: node scripts/inspect-relationships.mjs <emailA> <emailB>')
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  const getUser = async (email) => (await client.query('select id, email, name from users where email=$1 limit 1', [email])).rows[0]
  const ua = await getUser(emailA)
  const ub = await getUser(emailB)
  const actorsA = (await client.query("select id, type, owner_user_id, handle, display_name from actors where owner_user_id=$1 order by updated_at desc", [ua?.id])).rows
  const actorsB = (await client.query("select id, type, owner_user_id, handle, display_name from actors where owner_user_id=$1 order by updated_at desc", [ub?.id])).rows
  const idsA = actorsA.map(a => a.id)
  const idsB = actorsB.map(a => a.id)

  const relAB = (await client.query(
    "select id, from_actor_id, to_actor_id, kind, metadata, created_at from relationships where kind='follow' and from_actor_id = ANY($1) and to_actor_id = ANY($2) order by created_at desc limit 20",
    [idsA, idsB]
  )).rows
  const relBA = (await client.query(
    "select id, from_actor_id, to_actor_id, kind, metadata, created_at from relationships where kind='follow' and from_actor_id = ANY($1) and to_actor_id = ANY($2) order by created_at desc limit 20",
    [idsB, idsA]
  )).rows

  console.log(JSON.stringify({ ua, ub, actorsA, actorsB, relAB, relBA }, null, 2))
  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })


