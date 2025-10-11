#!/usr/bin/env node
// Test room context: ask Agent A, then follow up to Agent B with elliptical question
import WebSocket from 'ws';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const WS_URL = process.env.BACKEND_WS_URL || 'ws://localhost:3001/ws';
let A_ID = process.env.AGENT_A_ID || process.env.V33_AGENT_ID || '';
let B_ID = process.env.AGENT_B_ID || '';
const A_HANDLE = process.env.AGENT_A_HANDLE || 'v33';
const B_HANDLE = process.env.AGENT_B_HANDLE || 'palmerlucky';

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function createRoomWithAgents(agentIds) {
  const res = await fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Room Context Test', agentIds }),
  });
  if (!res.ok) throw new Error('createRoom failed ' + res.status);
  const data = await res.json();
  return data?.id || data?.roomId;
}

function rpc(method, params, id) { return { jsonrpc: '2.0', id, method, params }; }

async function findAgentIdByActors(preferredNames) {
  try {
    const res = await fetch(`${BASE_URL}/api/actors`, { cache: 'no-store' });
    const j = await res.json();
    const list = Array.isArray(j?.actors) ? j.actors : (Array.isArray(j) ? j : []);
    const lowerSet = new Set(preferredNames.map(s => s.toLowerCase()));
    // Find agent actors whose displayName or handle matches
    for (const a of list) {
      if (a?.type !== 'agent') continue;
      const name = String(a?.displayName || '').toLowerCase();
      const handle = String(a?.handle || '').toLowerCase();
      if (lowerSet.has(name) || lowerSet.has(handle)) {
        const agentId = a?.settings?.agentId;
        if (agentId) return agentId;
      }
    }
  } catch (e) {
    console.error('[room-context] actors fetch failed', e);
  }
  return null;
}

async function run() {
  // Resolve IDs from DB if not provided via env
  if (!A_ID) {
    A_ID = await findAgentIdByActors(['v33', 'V33']) || '';
  }
  if (!B_ID) {
    B_ID = await findAgentIdByActors(['palmerlucky', 'Palmer Lucky', 'PalmerLucky']) || '';
  }
  if (!A_ID || !B_ID) {
    console.error('[room-context] Could not resolve agent IDs from database. Provide AGENT_A_ID/AGENT_B_ID env vars.');
    process.exit(1);
  }
  const roomId = await createRoomWithAgents([A_ID, B_ID]);
  console.log('[room-context] room=', roomId);

  let nextId = 1; let phase = 0; let gotB = false;
  const ws = new WebSocket(WS_URL);
  ws.on('open', () => {
    console.log('[ws] open');
    ws.send(JSON.stringify(rpc('room.join', { roomId }, String(nextId++))));
  });
  ws.on('message', (buf) => {
    const msg = JSON.parse(buf.toString());
    if (msg.method === 'room.participants' && phase === 0) {
      // Ask agent A
      const text = `Got any good quotes @${A_HANDLE}?`;
      const message = { role: 'user', content: [{ type: 'text', text }] };
      ws.send(JSON.stringify(rpc('message.create', { roomId, message }, String(nextId++))));
      phase = 1;
    } else if (msg.method === 'message.complete' && phase === 1) {
      // Follow-up to agent B elliptically
      const text = `What about you @${B_HANDLE}?`;
      const message = { role: 'user', content: [{ type: 'text', text }] };
      ws.send(JSON.stringify(rpc('message.create', { roomId, message }, String(nextId++))));
      phase = 2;
    } else if ((msg.method === 'message.delta' || msg.method === 'message.complete') && phase >= 2) {
      const { authorId, authorType } = msg.params || {};
      if (authorType === 'agent' && authorId === B_ID) {
        gotB = true;
        console.log('[room-context] SUCCESS: Agent B replied in context');
        try { ws.close(); } catch {}
        process.exit(0);
      }
    }
  });
  ws.on('error', (e) => { console.error('[ws] error', e); });
  setTimeout(() => {
    if (!gotB) {
      console.error('[room-context] TIMEOUT without B reply');
      try { ws.close(); } catch {}
      process.exit(1);
    }
  }, 25000);
}

run().catch((e) => { console.error('[room-context] fatal', e); process.exit(1); });


