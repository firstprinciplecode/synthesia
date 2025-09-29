#!/usr/bin/env node
import WebSocket from 'ws'
import { config } from 'dotenv'
import { join } from 'path'
import pg from 'pg'

config({ path: join(process.cwd(), './backend/.env') })

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3001/ws'

const { Client } = pg
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const jrpc = (method, params, id) => JSON.stringify({ jsonrpc: '2.0', method, params, ...(id ? { id } : {}) })

async function loadParticipants(roomId) {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false })
  await client.connect()
  const rows = (await client.query('select id, participants from conversations where id=$1 limit 1', [roomId])).rows
  await client.end()
  const participants = Array.isArray(rows?.[0]?.participants) ? rows[0].participants : []
  return participants
}

async function ensureDmRoom(a, b) {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false })
  await client.connect()
  const getUser = async (email) => (await client.query('select id, name, avatar from users where email=$1 limit 1', [email])).rows[0]
  const ua = await getUser(a); const ub = await getUser(b)
  if (!ua || !ub) throw new Error('Missing users for DM')
  const aAct = (await client.query("select id from actors where type='user' and owner_user_id=$1 order by updated_at desc limit 1", [ua.id])).rows[0]
  const bAct = (await client.query("select id from actors where type='user' and owner_user_id=$1 order by updated_at desc limit 1", [ub.id])).rows[0]
  const rooms = (await client.query("select id from rooms where kind='dm'" )).rows
  const members = (await client.query('select room_id, actor_id from room_members')).rows
  const byRoom = new Map(); members.forEach(m => { const arr = byRoom.get(m.room_id) || []; arr.push(m.actor_id); byRoom.set(m.room_id, arr) })
  let roomId = null
  for (const r of rooms) {
    const arr = (byRoom.get(r.id) || []).sort(); const want = [aAct.id, bAct.id].sort()
    if (arr.length === 2 && arr[0] === want[0] && arr[1] === want[1]) { roomId = r.id; break }
  }
  await client.end()
  if (!roomId) throw new Error('DM room not found; create via /api/rooms/dm in app first')
  return roomId
}

function open(email, roomId, label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { 'x-user-id': email } })
    ws.on('open', () => {
      ws.send(jrpc('room.join', { roomId, userId: email }, 'join'))
      resolve(ws)
    })
    ws.on('error', reject)
  })
}

function attachLog(ws, label, state, viewerUserId) {
  ws.on('message', (data) => {
    try {
      const obj = JSON.parse(data.toString())
      if (obj.jsonrpc === '2.0' && obj.method === 'message.received') {
        const p = obj.params || {}
        const text = Array.isArray(p?.message?.content) ? p.message.content.map(c => c.text).join('') : (p?.message?.text || '')
        const authorId = p.authorId
        const authorUserId = p.authorUserId
        const authorName = p.authorName
        // Simulate frontend label resolution used now:
        const participant = state.participants?.find((q) => q.type === 'user' && (q.id === authorUserId || q.id === authorId))
        const resolvedName = authorName || participant?.name || 'User'
        const viewerLabel = (viewerUserId && authorUserId === viewerUserId) ? 'You' : resolvedName
        console.log(`[${label}] message.received: authorUserId=${authorUserId} senderLabel="${resolvedName}" viewerLabel="${viewerLabel}" text="${text}"`)
      }
      if (obj.jsonrpc === '2.0' && obj.method === 'room.participants') {
        state.participants = obj.params?.participants || []
        console.log(`[${label}] participants: ${state.participants.map(p => `${p.type}:${p.name}`).join(', ')}`)
      }
    } catch {}
  })
}

async function send(ws, roomId, text) {
  ws.send(jrpc('message.create', { roomId, message: { role: 'user', content: [{ type: 'text', text }] } }))
}

async function main() {
  const [emailA, emailB] = process.argv.slice(2)
  if (!emailA || !emailB) { console.error('Usage: node backend/scripts/ws-dm-roundtrip.mjs <emailA> <emailB>'); process.exit(1) }
  const roomId = await ensureDmRoom(emailA, emailB)
  console.log('Room:', roomId)
  const stateA = { participants: [] }
  const stateB = { participants: [] }
  // Resolve canonical UUIDs for viewers
  const userIds = async (email) => {
    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false })
    await client.connect()
    const row = (await client.query('select id, name from users where email=$1 limit 1', [email])).rows[0]
    await client.end()
    return row?.id
  }
  const viewerA = await userIds(emailA)
  const viewerB = await userIds(emailB)
  const a = await open(emailA, roomId, 'A');
  const b = await open(emailB, roomId, 'B');
  attachLog(a, 'A', stateA, viewerA); attachLog(b, 'B', stateB, viewerB)
  await sleep(400)
  console.log('A -> B')
  await send(a, roomId, 'Ping from A')
  await sleep(900)
  console.log('B -> A')
  await send(b, roomId, 'Pong from B')
  await sleep(900)
  try { a.close() } catch {}
  try { b.close() } catch {}
}

main().catch(e => { console.error(e); process.exit(1) })
