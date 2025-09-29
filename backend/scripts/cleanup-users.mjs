#!/usr/bin/env node
import { config } from 'dotenv'
import { join } from 'path'
import pkg from 'pg'

config({ path: join(process.cwd(), '../.env') })

const { Client } = pkg

async function main() {
  const primaryEmail = process.argv[2] || 'thomas.petersen@gmail.com'
  const toDeleteEmails = process.argv.slice(3)
  if (toDeleteEmails.length === 0) {
    console.error('Usage: node scripts/cleanup-users.mjs <primaryEmail> <deleteEmail> [<deleteEmail> ...]')
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  const ures = await client.query('select id, email from users where email = $1 limit 1', [primaryEmail])
  if (ures.rows.length === 0) {
    console.error('Primary user not found:', primaryEmail)
    process.exit(2)
  }
  const primaryId = ures.rows[0].id

  // Normalize user-actors to primary id
  await client.query('update actors set owner_user_id = $1, updated_at = now() where type = $2 and owner_user_id <> $1', [primaryId, 'user'])

  for (const email of toDeleteEmails) {
    const rows = await client.query('select id from users where email = $1 limit 1', [email])
    if (rows.rows.length === 0) continue
    const delId = rows.rows[0].id

    // Reassign any agents that may still point to the old id
    await client.query('update agents set created_by = $1, updated_at = now() where created_by = $2', [primaryId, delId])

    // Remove the user
    await client.query('delete from users where id = $1', [delId])
    console.log('Deleted user:', email)
  }

  await client.end()
  console.log('Cleanup complete. Primary user:', primaryEmail)
}

main().catch((e) => { console.error(e); process.exit(1) })


