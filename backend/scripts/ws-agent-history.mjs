#!/usr/bin/env node
// Quick script: send a user message to an agent room and then fetch recent messages via HTTP
import WebSocket from 'ws'
import { config } from 'dotenv'
import { join } from 'path'

config({ path: join(process.cwd(), './backend/.env') })

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3001/ws'
const HTTP_BASE = process.env.HTTP_BASE || 'http://127.0.0.1:3001'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function jrpc(method, params, id) { return JSON.stringify({ jsonrpc: '2.0', method, params, ...(id ? { id } : {}) }) }

async function openClient(userId, roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { 'x-user-id': userId } })
    ws.on('open', () => { ws.send(jrpc('room.join', { roomId, userId }, 'join')); resolve(ws) })
    ws.on('error', reject)
  })
}

async function sendUser(ws, roomId, text) {
  ws.send(jrpc('message.create', { roomId, message: { role: 'user', content: [{ type: 'text', text }] } }))
}

async function main() {
  const [userId, roomId, ...rest] = process.argv.slice(2)
  if (!userId || !roomId) {
    console.error('Usage: node backend/scripts/ws-agent-history.mjs <userIdOrEmail> <agentRoomId> "message"')
    process.exit(1)
  }
  const text = rest.length ? rest.join(' ') : 'history test message'
  const ws = await openClient(userId, roomId)
  await sleep(200)
  await sendUser(ws, roomId, text)
  await sleep(1200)
  try { ws.close() } catch {}

  // Fetch messages via HTTP
  const res = await fetch(`${HTTP_BASE}/api/rooms/${roomId}/messages`, { headers: { 'x-user-id': userId } })
  const json = await res.json()
  console.log('HTTP messages status', res.status)
  console.log(JSON.stringify(json, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })



