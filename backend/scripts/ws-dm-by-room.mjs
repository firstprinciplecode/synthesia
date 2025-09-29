#!/usr/bin/env node
// WS DM test by explicit roomId (no DB dependency)
// Usage: node backend/scripts/ws-dm-by-room.mjs <emailA> <emailB> <roomId>
import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3001/ws'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jrpc = (method, params, id) => JSON.stringify({ jsonrpc: '2.0', method, params, ...(id ? { id } : {}) })

function open(email, roomId, state) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { 'x-user-id': email } })
    ws.on('open', () => {
      ws.send(jrpc('room.join', { roomId, userId: email }, 'join'))
      resolve(ws)
    })
    ws.on('error', reject)
    ws.on('message', (data) => {
      try {
        const obj = JSON.parse(data.toString())
        if (obj.jsonrpc === '2.0' && obj.method === 'room.participants') {
          state.participants = obj.params?.participants || []
          const list = state.participants.map((p) => `${p.type}:${p.name || p.id}`).join(', ')
          console.log(`[${email}] participants: ${list}`)
        }
        if (obj.jsonrpc === '2.0' && obj.method === 'message.received') {
          const p = obj.params || {}
          const text = Array.isArray(p?.message?.content)
            ? p.message.content.map((c) => c.text).join('')
            : p?.message?.text || ''
          const authorUserId = p.authorUserId
          const authorName = p.authorName
          const authorId = p.authorId
          const participant = state.participants?.find(
            (q) => q.type === 'user' && (q.id === authorUserId || q.id === authorId)
          )
          const resolvedName = authorName || participant?.name || 'User'
          const viewerUserId = state.viewerUserId
          const viewerLabel = viewerUserId && authorUserId === viewerUserId ? 'You' : resolvedName
          console.log(
            `[${email}] message.received room=${p.roomId} authorUserId=${authorUserId} senderLabel="${resolvedName}" viewerLabel="${viewerLabel}" text="${text}"`
          )
        }
      } catch {}
    })
  })
}

async function getViewerUserId(email) {
  // If backend exposes canonicalization via WS only, we can't fetch directly here without DB.
  // For viewer label, rely on authorUserId === provided email canonicalization in server.
  // As a fallback, use email string; server compares after canonicalization.
  return email
}

async function send(ws, roomId, text) {
  ws.send(jrpc('message.create', { roomId, message: { role: 'user', content: [{ type: 'text', text }] } }))
}

async function main() {
  const [emailA, emailB, roomId] = process.argv.slice(2)
  if (!emailA || !emailB || !roomId) {
    console.error('Usage: node backend/scripts/ws-dm-by-room.mjs <emailA> <emailB> <roomId>')
    process.exit(1)
  }
  const stateA = { participants: [], viewerUserId: await getViewerUserId(emailA) }
  const stateB = { participants: [], viewerUserId: await getViewerUserId(emailB) }
  const a = await open(emailA, roomId, stateA)
  const b = await open(emailB, roomId, stateB)
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

main().catch((e) => { console.error(e); process.exit(1) })



