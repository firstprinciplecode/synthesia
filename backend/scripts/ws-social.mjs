#!/usr/bin/env node
// Minimal end-to-end social room WS test
// Steps:
// 1) Create a room with a known agent
// 2) Connect to WS and join that room
// 3) Trigger SerpAPI google_news search
// 4) Wait for search.results, then pick index 1 and scrape
// 5) Log received messages

import WebSocket from 'ws';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const WS_URL = (process.env.BACKEND_WS_URL || 'ws://localhost:3001/ws');
const AGENT_ID = process.env.AGENT_ID || '6049f7be-6bbd-4fba-bf1d-62e4691077f0'; // Buzz Daly (example)

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function createRoom() {
  const body = { agentIds: [AGENT_ID], title: 'WS Social Test' };
  const res = await fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`createRoom failed: ${res.status} ${txt}`);
  }
  const data = await res.json();
  const rid = data?.roomId || data?.id;
  if (!rid) throw new Error('createRoom: missing roomId/id in response');
  return rid;
}

function rpc(method, params, id) {
  return { jsonrpc: '2.0', id, method, params };
}

async function run() {
  console.log('[test] BASE_URL=', BASE_URL, 'WS_URL=', WS_URL);
  let roomId;
  try {
    roomId = await createRoom();
    console.log('[test] created room:', roomId);
  } catch (e) {
    console.error('[test] createRoom error:', e.message);
    console.error('Make sure backend is running on', BASE_URL, 'with SOCIAL_CORE=1');
    process.exit(1);
  }

  const ws = new WebSocket(WS_URL);
  let nextId = 1;
  const waiters = new Map();
  let latestResultId = null;

  ws.on('open', () => {
    console.log('[ws] open');
    const id = String(nextId++);
    ws.send(JSON.stringify(rpc('room.join', { roomId }, id)));
    waiters.set(id, { resolve: (v) => console.log('[rpc:room.join] ok', v), reject: console.error });
  });

  ws.on('message', (buf) => {
    const msg = JSON.parse(buf.toString());
    if (msg.id && waiters.has(msg.id)) {
      const { resolve } = waiters.get(msg.id);
      waiters.delete(msg.id);
      resolve(msg.result);
      return;
    }
    if (msg.method === 'room.participants') {
      console.log('[notify] room.participants participants=', (msg.params?.participants || []).length);
      // kick off serpapi
      const id = String(nextId++);
      ws.send(JSON.stringify(rpc('tool.serpapi.run', { engine: 'google_news', query: 'SpaceX' }, id)));
      waiters.set(id, { resolve: (v) => console.log('[rpc:serpapi.run] ok'), reject: console.error });
    } else if (msg.method === 'search.results') {
      latestResultId = msg.params?.resultId || null;
      const items = msg.params?.items || [];
      console.log('[notify] search.results count=', items.length, 'resultId=', latestResultId);
      if (latestResultId && items.length) {
        // pick index 1
        const id = String(nextId++);
        ws.send(JSON.stringify(rpc('tool.web.scrape.pick', { index: 1, resultId: latestResultId }, id)));
        waiters.set(id, { resolve: (v) => console.log('[rpc:web.scrape.pick] ok'), reject: console.error });
      }
    } else if (msg.method === 'message.received') {
      const text = msg.params?.message || '';
      const sample = String(text).slice(0, 160).replace(/\s+/g, ' ');
      console.log('[notify] message.received sample=', sample);
    } else if (msg.method === 'tool.result') {
      console.log('[notify] tool.result ok=', !!(msg.params?.result?.ok));
    } else if (msg.method === 'run.status') {
      console.log('[notify] run.status', msg.params?.status);
    }
  });

  ws.on('error', (err) => {
    console.error('[ws] error', err);
  });

  ws.on('close', () => {
    console.log('[ws] close');
  });

  // Safety timeout
  setTimeout(() => {
    console.log('[test] timeout reached, closing');
    try { ws.close(); } catch {}
    process.exit(0);
  }, 30000);
}

run().catch((e) => {
  console.error('[test] fatal', e);
  process.exit(1);
});


