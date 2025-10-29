#!/usr/bin/env node
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import pkg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load env (prefer repo env.local, fallback to .env)
dotenv.config({ path: path.join(__dirname, '../../env.local') })
dotenv.config({ path: path.join(__dirname, '../../.env') })

const { Pool } = pkg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
})

function heading(title) {
  console.log(`\n=== ${title} ===`)
}

function fmt(n) {
  return new Intl.NumberFormat().format(n)
}

async function auditRelationships() {
  heading('Duplicate relationships (from_actor_id, to_actor_id, kind)')
  const q = `
    SELECT from_actor_id, to_actor_id, kind,
           COUNT(*) AS cnt,
           ARRAY_AGG(id ORDER BY created_at ASC) AS ids
    FROM relationships
    GROUP BY from_actor_id, to_actor_id, kind
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `
  const { rows } = await pool.query(q)
  let dupRows = 0
  rows.forEach(r => { dupRows += (Number(r.cnt) - 1) })
  console.log(`Groups: ${fmt(rows.length)}, Rows to delete to enforce uniqueness: ${fmt(dupRows)}`)
  rows.slice(0, 50).forEach((r, i) => {
    const keep = r.ids?.[0]
    const toDelete = (r.ids || []).slice(1)
    console.log(` ${i+1}. ${r.from_actor_id} -> ${r.to_actor_id} [${r.kind}] cnt=${r.cnt} keep=${keep} delete=${toDelete.length}`)
  })
  return { groups: rows.length, rowsToDelete: dupRows }
}

async function auditRoomMembers() {
  heading('Duplicate room_members (room_id, actor_id)')
  const q = `
    SELECT room_id, actor_id,
           COUNT(*) AS cnt,
           ARRAY_AGG(id ORDER BY joins_at ASC) AS ids
    FROM room_members
    GROUP BY room_id, actor_id
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `
  const { rows } = await pool.query(q)
  let dupRows = 0
  rows.forEach(r => { dupRows += (Number(r.cnt) - 1) })
  console.log(`Groups: ${fmt(rows.length)}, Rows to delete to enforce uniqueness: ${fmt(dupRows)}`)
  rows.slice(0, 50).forEach((r, i) => {
    const keep = r.ids?.[0]
    const toDelete = (r.ids || []).slice(1)
    console.log(` ${i+1}. room=${r.room_id} actor=${r.actor_id} cnt=${r.cnt} keep=${keep} delete=${toDelete.length}`)
  })
  return { groups: rows.length, rowsToDelete: dupRows }
}

async function auditWallets() {
  heading('Duplicate wallets (owner_id, owner_type)')
  const q = `
    SELECT owner_id, owner_type, COUNT(*) AS cnt,
           ARRAY_AGG(json_build_object('id', id, 'balance', balance, 'updated_at', updated_at) ORDER BY updated_at DESC) AS wallets
    FROM wallets
    GROUP BY owner_id, owner_type
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `
  const { rows } = await pool.query(q)
  console.log(`Groups: ${fmt(rows.length)} (manual review recommended before merging balances)`) 
  rows.slice(0, 25).forEach((r, i) => {
    console.log(` ${i+1}. owner=${r.owner_id} type=${r.owner_type} cnt=${r.cnt}`)
    const wl = Array.isArray(r.wallets) ? r.wallets : []
    wl.forEach((w, j) => {
      console.log(`     - ${j+1}. id=${w.id} balance=${w.balance} updated_at=${w.updated_at}`)
    })
  })
  return { groups: rows.length }
}

async function auditAgentActors() {
  heading('Duplicate agent actors by settings.agentId')
  const q = `
    SELECT settings->>'agentId' AS agent_id,
           COUNT(*) AS cnt,
           ARRAY_AGG(json_build_object('id', id, 'display_name', display_name, 'owner_user_id', owner_user_id, 'created_at', created_at) ORDER BY created_at ASC) AS actors
    FROM actors
    WHERE type = 'agent' AND (settings ? 'agentId')
    GROUP BY settings->>'agentId'
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `
  const { rows } = await pool.query(q)
  let dupRows = 0
  rows.forEach(r => { dupRows += (Number(r.cnt) - 1) })
  console.log(`Groups: ${fmt(rows.length)}, Actors to delete to enforce one-per-agentId: ${fmt(dupRows)}`)
  rows.slice(0, 50).forEach((r, i) => {
    const list = Array.isArray(r.actors) ? r.actors : []
    const canonical = list.find(a => a.display_name && a.owner_user_id) || list[0]
    const toDelete = list.filter(a => a.id !== canonical?.id)
    console.log(` ${i+1}. agentId=${r.agent_id} cnt=${r.cnt} keep=${canonical?.id} delete=${toDelete.length}`)
  })
  return { groups: rows.length, rowsToDelete: dupRows }
}

async function auditUserActors() {
  heading('Multiple user actors per owner_user_id (may be expected)')
  const q = `
    SELECT owner_user_id, COUNT(*) AS cnt, ARRAY_AGG(id ORDER BY updated_at DESC) AS ids
    FROM actors
    WHERE type = 'user' AND owner_user_id IS NOT NULL AND owner_user_id <> ''
    GROUP BY owner_user_id
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `
  const { rows } = await pool.query(q)
  let dupRows = 0
  rows.forEach(r => { dupRows += (Number(r.cnt) - 1) })
  console.log(`Owners with >1 user-actor: ${fmt(rows.length)} (backend already collapses these at runtime)`) 
  rows.slice(0, 25).forEach((r, i) => {
    console.log(` ${i+1}. owner=${r.owner_user_id} cnt=${r.cnt} sample_keep=${r.ids?.[0]}`)
  })
  return { groups: rows.length, rowsExtra: dupRows }
}

async function auditUsersByEmail() {
  heading('Duplicate users by email')
  const q = `
    SELECT email, COUNT(*) AS cnt, ARRAY_AGG(id ORDER BY created_at ASC) AS ids
    FROM users
    WHERE email IS NOT NULL AND email <> ''
    GROUP BY email
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `
  const { rows } = await pool.query(q)
  let dupRows = 0
  rows.forEach(r => { dupRows += (Number(r.cnt) - 1) })
  console.log(`Emails with >1 user: ${fmt(rows.length)}, Rows to delete/merge: ${fmt(dupRows)}`)
  rows.slice(0, 25).forEach((r, i) => {
    console.log(` ${i+1}. email=${r.email} cnt=${r.cnt} keep=${r.ids?.[0]} delete=${(r.ids||[]).length - 1}`)
  })
  return { groups: rows.length, rowsToDelete: dupRows }
}

async function main() {
  const start = Date.now()
  console.log('DB:', process.env.DATABASE_URL ? 'configured' : 'missing (set DATABASE_URL)')
  const summary = {}
  try {
    await pool.query('select 1')
  } catch (e) {
    console.error('Failed to connect to DB:', e?.message || e)
    process.exit(1)
  }

  summary.relationships = await auditRelationships()
  summary.roomMembers = await auditRoomMembers()
  summary.wallets = await auditWallets()
  summary.agentActors = await auditAgentActors()
  summary.userActors = await auditUserActors()
  summary.usersByEmail = await auditUsersByEmail()

  heading('Summary')
  console.log(JSON.stringify(summary, null, 2))
  console.log(`\nCompleted in ${fmt(Date.now() - start)} ms`)

  await pool.end()
}

main().catch(async (e) => {
  console.error(e)
  try { await pool.end() } catch {}
  process.exit(1)
})

