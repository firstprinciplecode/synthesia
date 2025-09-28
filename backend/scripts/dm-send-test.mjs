#!/usr/bin/env node
// Quick DM echo test: prints the payload sent by backend when a user sends a message in a DM
// Usage: node scripts/dm-send-test.mjs <senderEmail> <recipientEmail> "message"
import { config } from 'dotenv'
import { join } from 'path'
import pg from 'pg'

config({ path: join(process.cwd(), './backend/.env') })

const { Client } = pg

async function main() {
  const [senderEmail, recipientEmail, ...msgParts] = process.argv.slice(2)
  if (!senderEmail || !recipientEmail || msgParts.length === 0) {
    console.error('Usage: node backend/scripts/dm-send-test.mjs <senderEmail> <recipientEmail> "message"')
    process.exit(1)
  }
  const message = msgParts.join(' ')
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false })
  await client.connect()

  const getUserId = async (email) => (await client.query('select id, name, avatar from users where email=$1 limit 1', [email])).rows[0]
  const su = await getUserId(senderEmail)
  const ru = await getUserId(recipientEmail)
  if (!su || !ru) throw new Error('Users not found')
  const sActors = (await client.query("select id from actors where type='user' and owner_user_id=$1 order by updated_at desc", [su.id])).rows.map(r=>r.id)
  const rActors = (await client.query("select id from actors where type='user' and owner_user_id=$1 order by updated_at desc", [ru.id])).rows.map(r=>r.id)
  if (!sActors.length || !rActors.length) throw new Error('Missing user actors')
  const sPrimary = sActors[0]
  const rPrimary = rActors[0]
  const rooms = await client.query("select id from rooms where kind='dm'")
  const members = await client.query('select room_id, actor_id from room_members')
  let roomId = null
  const map = new Map()
  members.rows.forEach(m => { const arr = map.get(m.room_id) || []; arr.push(m.actor_id); map.set(m.room_id, arr) })
  for (const r of rooms.rows) {
    const arr = (map.get(r.id) || []).sort()
    const want = [sPrimary, rPrimary].sort()
    if (arr.length === 2 && arr[0] === want[0] && arr[1] === want[1]) { roomId = r.id; break; }
  }
  if (!roomId) throw new Error('DM room not found; create via POST /api/rooms/dm in the app first')

  console.log('Simulated backend payload that should be sent to clients:')
  const payload = {
    jsonrpc: '2.0',
    method: 'message.received',
    params: {
      roomId,
      messageId: '<randomUUID>',
      authorId: sPrimary,
      authorType: 'user',
      authorUserId: su.id,
      authorName: su.name || senderEmail,
      authorAvatar: su.avatar || null,
      message: { content: [{ type: 'text', text: message }] },
    },
  }
  console.log(JSON.stringify(payload, null, 2))
  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })


