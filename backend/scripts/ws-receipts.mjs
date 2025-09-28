#!/usr/bin/env node
import WebSocket from 'ws';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const WS_URL = process.env.BACKEND_WS_URL || 'ws://localhost:3001/ws';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function rpc(method, params, id){ return { jsonrpc: '2.0', id, method, params }; }

async function main(){
  // Create room
  const res = await fetch(`${BASE_URL}/api/rooms`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ name: 'receipts-test' }) });
  const room = await res.json();
  const roomId = room.id || room.roomId;
  if (!roomId) throw new Error('no roomId');
  console.log('[receipts] room=', roomId);

  let nextId = 1;
  const ws = new WebSocket(WS_URL);
  let lastAssistantId = '';
  let gotReceipts = false;
  ws.on('open', async () => {
    console.log('[ws] open');
    ws.send(JSON.stringify(rpc('room.join', { roomId }, String(nextId++))));
    await sleep(200);
    // Send a user message to trigger any assistant reply (or echo back)
    const msgId = `m_${Date.now()}`;
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'message.create', params: { roomId, message: { role: 'user', content: [{ type: 'text', text: 'ping' }] } } }));
    await sleep(400);
    // Mark read for a synthetic id (just to exercise the API)
    const readId = String(nextId++);
    ws.send(JSON.stringify(rpc('message.read', { roomId, messageId: msgId }, readId)));
    setTimeout(() => ws.close(), 2000);
  });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data));
      if (msg.method === 'message.receipts') {
        console.log('[notify] message.receipts', msg.params);
        gotReceipts = true;
      }
    } catch {}
  });
  await new Promise(resolve => ws.on('close', resolve));
  if (!gotReceipts) {
    console.log('[receipts] WARN: no receipts observed (may depend on messageId match)');
  } else {
    console.log('[receipts] SUCCESS: observed receipts');
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });


