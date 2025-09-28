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

  const tables = [
    'tool_calls',
    'runs',
    'messages',
    'conversations',
    'room_members',
    'rooms',
    'relationships',
    'policies',
    'chunks',
    'files',
    'tool_configs',
    'actors',
    'agents',
    'users',
  ]

  for (const t of tables) {
    try {
      await client.query(`DELETE FROM ${t}`)
      console.log(`[reset-db] cleared ${t}`)
    } catch (e) {
      console.warn(`[reset-db] failed ${t}`, e?.message || e)
    }
  }

  await client.end()
  console.log('[reset-db] Done')
}

main().catch((e) => { console.error(e); process.exit(1) })


