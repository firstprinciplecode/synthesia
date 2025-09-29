#!/usr/bin/env node
// WS test: capability tags should bias routing without explicit @mentions
import WebSocket from 'ws';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const WS_URL = process.env.BACKEND_WS_URL || 'ws://localhost:3001/ws';
const V33_AGENT_ID = process.env.V33_AGENT_ID || 'd669e5e6-4ab3-45ae-8e22-bbb8e9e5995a';
const BUZZ_AGENT_ID = process.env.BUZZ_AGENT_ID || '6049f7be-6bbd-4fba-bf1d-62e4691077f0';

async function ensureTags() {
  // Ensure V33 actor has tags including spacex/news
  try {
    const byAgent = await fetch(`${BASE_URL}/api/actors?agentId=${encodeURIComponent(V33_AGENT_ID)}`);
    if (!byAgent.ok) return;
    const act = await byAgent.json();
    await fetch(`${BASE_URL}/api/actors/${act.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilityTags: ['news','spacex','x-twitter'] })
    });
  } catch {}
}

async function createRoomWithAgents(aids) {
  const res = await fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'WS Capabilities Test', agentIds: aids })
  });
  if (!res.ok) throw new Error('createRoom failed');
  const data = await res.json();
  return data?.id || data?.roomId;
}

function rpc(method, params, id) { return { jsonrpc: '2.0', id, method, params }; }

async function run() {
  await ensureTags();
  const roomId = await createRoomWithAgents([V33_AGENT_ID, BUZZ_AGENT_ID]);
  console.log('[caps] room=', roomId);
  const ws = new WebSocket(WS_URL);
  let nextId = 1; let resolved = false;

  ws.on('open', () => {
    ws.send(JSON.stringify(rpc('room.join', { roomId }, String(nextId++))));
  });

  ws.on('message', (buf) => {
    const msg = JSON.parse(buf.toString());
    if (msg.method === 'room.participants' && !resolved) {
      const text = `What's the latest SpaceX news?`;
      const message = { role: 'user', content: [{ type: 'text', text }] };
      ws.send(JSON.stringify(rpc('message.create', { roomId, message }, String(nextId++))));
    } else if ((msg.method === 'message.delta' || msg.method === 'message.complete') && !resolved) {
      const { authorId, authorType } = msg.params || {};
      if (authorType === 'agent') {
        console.log('[caps] first agent replying:', authorId);
        resolved = true;
        if (authorId === V33_AGENT_ID) {
          console.log('[caps] SUCCESS: capability tags biased V33');
          process.exit(0);
        } else {
          console.error('[caps] WARNING: another agent replied first');
          process.exit(2);
        }
      }
    }
  });

  setTimeout(() => { if (!resolved) { console.error('[caps] TIMEOUT'); process.exit(1); } }, 25000);
}

run().catch((e) => { console.error('[caps] fatal', e); process.exit(1); });


