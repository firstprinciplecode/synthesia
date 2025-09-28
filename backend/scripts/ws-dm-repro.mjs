#!/usr/bin/env node
import WebSocket from 'ws'
import { config } from 'dotenv'
import { join } from 'path'
import pg from 'pg'

config({ path: join(process.cwd(), './backend/.env') })

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3001/ws'
const HTTP_BASE = process.env.HTTP_BASE || 'http://127.0.0.1:3001'

const { Client } = pg

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function jrpc(method, params, id) {
  return JSON.stringify({ jsonrpc: '2.0', method, params, ...(id ? { id } : {}) })
}

async function ensureDmRoom(senderEmail, recipientEmail) {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false })
  await client.connect()
  const su = (await client.query('select id from users where email=$1 limit 1', [senderEmail])).rows[0]
  const ru = (await client.query('select id from users where email=$1 limit 1', [recipientEmail])).rows[0]
  if (!su || !ru) throw new Error('sender/recipient users missing')
  const sAct = (await client.query("select id from actors where type='user' and owner_user_id=$1 order by updated_at desc limit 1", [su.id])).rows[0]
  const rAct = (await client.query("select id from actors where type='user' and owner_user_id=$1 order by updated_at desc limit 1", [ru.id])).rows[0]
  if (!sAct || !rAct) throw new Error('user actors missing')
  // find or create DM room with these two actors
  const rooms = (await client.query("select id from rooms where kind='dm'" )).rows
  const memberships = (await client.query('select room_id, actor_id from room_members')).rows
  const byRoom = new Map()
  memberships.forEach(m => { const arr = byRoom.get(m.room_id) || []; arr.push(m.actor_id); byRoom.set(m.room_id, arr) })
  let roomId = null
  for (const r of rooms) {
    const arr = (byRoom.get(r.id) || []).sort()
    const want = [sAct.id, rAct.id].sort()
    if (arr.length === 2 && arr[0] === want[0] && arr[1] === want[1]) { roomId = r.id; break }
  }
  await client.end()
  if (!roomId) throw new Error('DM room not found - create it via the app first (POST /api/rooms/dm)')
  return roomId
}

async function openClient(email, roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { 'x-user-id': email } })
    ws.on('open', () => {
      // join room
      ws.send(jrpc('room.join', { roomId, userId: email }, 'join'))
      resolve(ws)
    })
    ws.on('error', reject)
  })
}

function onMessages(ws, label) {
  ws.on('message', (data) => {
    try {
      const obj = JSON.parse(data.toString())
      if (obj.jsonrpc === '2.0' && obj.method === 'message.received') {
        const p = obj.params || {}
        console.log(`[${label}] message.received room=${p.roomId} authorType=${p.authorType} authorId=${p.authorId} authorUserId=${p.authorUserId} authorName=${p.authorName}`)
        const text = Array.isArray(p?.message?.content) ? p.message.content.map(c => c.text).join('') : (p?.message?.text || '')
        console.log(`[${label}] text=`, text)
      }
      if (obj.jsonrpc === '2.0' && obj.method === 'room.participants') {
        const ids = (obj.params?.participants || []).map((x) => `${x.type}:${x.id}`).join(', ')
        console.log(`[${label}] participants: ${ids}`)
      }
    } catch {}
  })
}

async function sendFrom(ws, roomId, text) {
  ws.send(jrpc('message.create', { roomId, message: { role: 'user', content: [{ type: 'text', text }] } }))
}

async function main() {
  const [senderEmail, recipientEmail, ...msgParts] = process.argv.slice(2)
  if (!senderEmail || !recipientEmail) {
    console.error('Usage: node backend/scripts/ws-dm-repro.mjs <senderEmail> <recipientEmail> "message"')
    process.exit(1)
  }
  const text = msgParts.length ? msgParts.join(' ') : 'Hello from repro test'
  const roomId = await ensureDmRoom(senderEmail, recipientEmail)
  console.log('Using DM room:', roomId)
  const a = await openClient(senderEmail, roomId)
  const b = await openClient(recipientEmail, roomId)
  onMessages(a, 'A:'+senderEmail)
  onMessages(b, 'B:'+recipientEmail)
  await sleep(300)
  console.log('Sending message from A ->', text)
  await sendFrom(a, roomId, text)
  await sleep(1200)
  console.log('Done. Close sockets.')
  try { a.close() } catch {}
  try { b.close() } catch {}
}

main().catch((e) => { console.error(e); process.exit(1) })
