#!/usr/bin/env node
import { config } from 'dotenv'
import { join } from 'path'
import pg from 'pg'

config({ path: join(process.cwd(), '../.env') })

const { Client } = pg

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: node scripts/migrate-user-id-to-uuid.mjs <email>')
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  try {
    await client.query('begin')

    const ures = await client.query('select id, email from users where email = $1 limit 1 for update', [email])
    if (ures.rows.length === 0) {
      throw new Error(`User not found for email=${email}`)
    }
    const oldId = ures.rows[0].id

    const nres = await client.query('select gen_random_uuid() as id')
    const newId = nres.rows[0].id

    // Update users.id first
    await client.query('update users set id = $2, updated_at = now() where id = $1', [oldId, newId])

    // Update references
    await client.query('update actors set owner_user_id = $2, updated_at = now() where owner_user_id = $1', [oldId, newId])
    await client.query('update agents set created_by = $2, updated_at = now() where created_by = $1', [oldId, newId])
    await client.query('update files set uploaded_by = $2, updated_at = now() where uploaded_by = $1', [oldId, newId])
    await client.query('update memberships set user_id = $2 where user_id = $1', [oldId, newId])

    await client.query('commit')
    console.log(JSON.stringify({ email, oldId, newId, status: 'ok' }, null, 2))
  } catch (e) {
    await client.query('rollback')
    console.error(e)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })


