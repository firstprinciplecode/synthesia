#!/usr/bin/env node
import { config } from 'dotenv'
import { join } from 'path'
import pkg from 'pg'

config({ path: join(process.cwd(), '../.env') })

const { Client } = pkg

async function main() {
  const [email, ...agentIds] = process.argv.slice(2)
  if (!email || agentIds.length === 0) {
    console.error('Usage: node scripts/assign-agents-to-user.mjs <ownerEmail> <agentId> [<agentId> ...]')
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  const ures = await client.query('select id from users where email = $1 limit 1', [email])
  if (ures.rows.length === 0) {
    console.error('No user found with email:', email)
    process.exit(2)
  }
  const userId = ures.rows[0].id

  const res = await client.query(
    `update agents set created_by = $1, updated_at = now() where id = any($2::text[]) returning id, name, created_by`,
    [userId, agentIds]
  )
  console.log('Reassigned agents:', res.rows)

  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })


