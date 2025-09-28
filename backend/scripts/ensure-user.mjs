#!/usr/bin/env node
import { config } from 'dotenv'
import { join } from 'path'
import pkg from 'pg'

config({ path: join(process.cwd(), '../.env') })

const { Client } = pkg

async function main() {
  const email = process.argv[2]
  const name = process.argv[3] || ''
  if (!email) {
    console.error('Usage: node scripts/ensure-user.mjs <email> [name]')
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  const existing = await client.query('select id, email from users where email = $1 limit 1', [email])
  let id
  if (existing.rows.length) {
    id = existing.rows[0].id
  } else {
    const res = await client.query(
      `insert into users (id, email, name, avatar, phone, bio, location, company, website, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, '', '', '', '', '', '', now(), now())
       returning id`,
      [email, name]
    )
    id = res.rows[0].id
  }

  console.log(JSON.stringify({ id, email }, null, 2))
  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })


