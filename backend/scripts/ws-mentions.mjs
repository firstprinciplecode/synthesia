#!/usr/bin/env node
// WS test: mention @handle should route to the correct agent
import WebSocket from 'ws';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const WS_URL = process.env.BACKEND_WS_URL || 'ws://localhost:3001/ws';
const V33_AGENT_ID = process.env.V33_AGENT_ID || 'd669e5e6-4ab3-45ae-8e22-bbb8e9e5995a';
const V33_HANDLE = process.env.V33_HANDLE || 'v33';

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function ensureActorForAgent(agentId) {
  const byAgent = await fetch(`${BASE_URL}/api/actors?agentId=${encodeURIComponent(agentId)}`);
  if (byAgent.ok) return await byAgent.json();
  const create = await fetch(`${BASE_URL}/api/actors`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'agent', handle: V33_HANDLE, displayName: 'V33', settings: { agentId } }),
  });
  if (!create.ok) throw new Error('failed to create actor for agent ' + agentId);
  const { id } = await create.json();
  return { id, type: 'agent', settings: { agentId } };
}

async function createRoomWithAgent(agentId) {
  const res = await fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'WS Mentions Test', agentIds: [agentId] }),
  });
  if (!res.ok) throw new Error('createRoom failed ' + res.status);
  const data = await res.json();
  return data?.id || data?.roomId;
}

function rpc(method, params, id) { return { jsonrpc: '2.0', id, method, params }; }

async function run() {
  console.log('[mention] BASE_URL=', BASE_URL, 'WS_URL=', WS_URL);
  await ensureActorForAgent(V33_AGENT_ID);
  const roomId = await createRoomWithAgent(V33_AGENT_ID);
  console.log('[mention] room=', roomId);

  let nextId = 1; let resolved = false;
  const ws = new WebSocket(WS_URL);
  ws.on('open', () => {
    console.log('[ws] open');
    ws.send(JSON.stringify(rpc('room.join', { roomId }, String(nextId++))));
  });

  ws.on('message', (buf) => {
    const msg = JSON.parse(buf.toString());
    if (msg.method === 'room.participants' && !resolved) {
      // Send a message that mentions @v33 using correct payload shape
      const text = `Hi @${V33_HANDLE} can you hear me?`;
      const message = { role: 'user', content: [{ type: 'text', text }] };
      ws.send(JSON.stringify(rpc('message.create', { roomId, message }, String(nextId++))));
    } else if (msg.method === 'message.delta' || msg.method === 'message.complete') {
      const { authorId, authorType } = msg.params || {};
      if (authorType === 'agent') {
        console.log('[mention] agent replying:', authorId);
        if (authorId === V33_AGENT_ID) {
          console.log('[mention] SUCCESS: reply from V33');
          resolved = true; try { ws.close(); } catch {}
          process.exit(0);
        }
      }
    }
  });

  ws.on('error', (e) => { console.error('[ws] error', e); });
  setTimeout(() => {
    if (!resolved) {
      console.error('[mention] TIMEOUT without V33 reply');
      try { ws.close(); } catch {}
      process.exit(1);
    }
  }, 20000);
}

run().catch((e) => { console.error('[mention] fatal', e); process.exit(1); });


