#!/usr/bin/env node
import { config } from 'dotenv'
import { join } from 'path'
import pg from 'pg'

config({ path: join(process.cwd(), '../.env') })

const { Client } = pg

function isUuidLike(value) {
  return typeof value === 'string' && /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value)
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  })
  await client.connect()

  const usersRes = await client.query(
    'select id, email, name, avatar, phone, bio, location, company, website, created_at, updated_at from users order by email'
  )
  const actorsRes = await client.query(
    "select id, type, owner_user_id, handle, display_name, created_at, updated_at from actors where type = 'user' order by owner_user_id, updated_at desc"
  )

  const users = usersRes.rows
  const userActors = actorsRes.rows

  const actorsByOwner = new Map()
  for (const a of userActors) {
    const key = a.owner_user_id
    if (!actorsByOwner.has(key)) actorsByOwner.set(key, [])
    actorsByOwner.get(key).push(a)
  }

  const summary = users.map(u => {
    const owned = actorsByOwner.get(u.id) || []
    const actorCount = owned.length
    const mostRecent = owned[0] || null
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      actorCount,
      mostRecentActorId: mostRecent?.id || null,
      hasAvatar: !!u.avatar,
      hasWebsite: !!u.website,
      hasBio: !!u.bio,
    }
  })

  const orphanedOwners = Array.from(actorsByOwner.keys()).filter(ownerId => !users.find(u => u.id === ownerId))
  const nonUuidOwners = Array.from(actorsByOwner.keys()).filter(ownerId => typeof ownerId === 'string' && ownerId.includes('@'))

  console.log('--- USERS ---')
  console.table(summary)
  console.log('Total users:', users.length)

  console.log('\n--- USER ACTORS (counts by owner) ---')
  for (const [owner, list] of actorsByOwner) {
    console.log(owner, 'count=', list.length, 'ownerIsUuid=', isUuidLike(owner))
  }

  if (orphanedOwners.length) {
    console.log('\n[WARN] Found user-actors whose owner_user_id has no matching user.id:')
    console.log(orphanedOwners)
  }
  if (nonUuidOwners.length) {
    console.log('\n[WARN] Found user-actors whose owner_user_id looks like an email (should be UUID):')
    console.log(nonUuidOwners)
  }

  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })


