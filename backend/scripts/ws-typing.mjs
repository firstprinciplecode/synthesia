#!/usr/bin/env node
import WebSocket from 'ws';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const WS_URL = process.env.BACKEND_WS_URL || 'ws://localhost:3001/ws';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function rpc(method, params, id){ return { jsonrpc: '2.0', id, method, params }; }

async function main(){
  // Create room
  const roomRes = await fetch(`${BASE_URL}/api/rooms`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: 'typing-test' }) });
  const room = await roomRes.json();
  const roomId = room.id || room.roomId;
  if (!roomId) throw new Error('no roomId');
  console.log('[typing] room=', roomId);

  let nextId = 1;
  const ws = new WebSocket(WS_URL);
  let gotTyping = 0;
  ws.on('open', async () => {
    console.log('[ws] open');
    ws.send(JSON.stringify(rpc('room.join', { roomId }, String(nextId++))));
    await sleep(200);
    ws.send(JSON.stringify(rpc('typing.start', { roomId, ttlMs: 1500 }, String(nextId++))));
    await sleep(3000);
    ws.send(JSON.stringify(rpc('typing.stop', { roomId }, String(nextId++))));
    await sleep(500);
    ws.close();
  });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data));
      if (msg.method === 'room.typing') {
        gotTyping++;
        console.log('[notify] room.typing size=', msg.params?.typing?.length);
      }
    } catch {}
  });
  await new Promise(resolve => ws.on('close', resolve));
  if (gotTyping >= 2) {
    console.log('[typing] SUCCESS: received typing notifications');
  } else {
    console.log('[typing] FAIL: insufficient typing notifications');
    process.exit(1);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });


