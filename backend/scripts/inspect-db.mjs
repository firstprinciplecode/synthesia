#!/usr/bin/env node
import { config } from 'dotenv'
import { join } from 'path'
import pkg from 'pg'

config({ path: join(process.cwd(), '../.env') })

const { Client } = pkg

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  const users = await client.query(`select id, email, coalesce(name,'') as name, created_at from users order by created_at desc limit 20`)
  console.log('USERS:')
  console.log(JSON.stringify(users.rows, null, 2))

  const agents = await client.query(`select id, name, coalesce(created_by,'') as created_by, created_at from agents order by created_at desc limit 50`)
  console.log('AGENTS:')
  console.log(JSON.stringify(agents.rows, null, 2))

  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })


