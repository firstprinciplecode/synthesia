#!/usr/bin/env node
/*
  Memory E2E test using an existing agent (e.g., Buzz Daly)
  - Drives a WS chat to fetch Google News about SpaceX (via SerpAPI)
  - Confirms short-term memory by a follow-up question
  - Outputs ROOM_ID and USER_ID for further inspection
*/

import { WebSocket } from 'ws';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3001/ws';
const USER_ID = process.env.USER_ID || 'thomas@firstprinciple.co';
const AGENT_NAME = process.env.AGENT_NAME || 'Buzz Daly';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function httpJson(method, path, { body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e?.message || e) }) }));
  let data = null; try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

async function wsSend(ws, payload) {
  return new Promise((resolve, reject) => {
    try { ws.send(JSON.stringify(payload), (err) => err ? reject(err) : resolve()); } catch (e) { reject(e); }
  });
}

async function ensureAgentAccessible() {
  const r = await httpJson('GET', '/api/agents/accessible', { headers: { 'x-user-id': USER_ID } });
  if (!r.ok) throw new Error(`Failed to fetch accessible agents (${r.status})`);
  const list = Array.isArray(r.data?.agents) ? r.data.agents : [];
  const found = list.find(a => String(a.name || '').toLowerCase() === AGENT_NAME.toLowerCase());
  if (!found) {
    throw new Error(`Agent '${AGENT_NAME}' not accessible for ${USER_ID}. Accessible: ${list.map(a => a.name).join(', ')}`);
  }
  return found.id;
}

async function openAgentRoom(agentId) {
  const r = await httpJson('POST', '/api/rooms/agent', { headers: { 'x-user-id': USER_ID }, body: { agentId } });
  if (!r.ok || !r.data?.roomId) throw new Error('Failed to open agent room');
  return r.data.roomId;
}

async function run() {
  // Health
  const h = await httpJson('GET', '/health');
  if (!h.ok) throw new Error('Backend health failed');

  // Resolve agent id
  const agentId = await ensureAgentAccessible();
  const roomId = await openAgentRoom(agentId);

  const ws = new WebSocket(WS_URL, { headers: { 'x-user-id': USER_ID } });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await wsSend(ws, { jsonrpc: '2.0', id: `join_${Date.now()}`, method: 'room.join', params: { roomId, userId: USER_ID } });
  await sleep(100);

  // Ask for latest Google News about SpaceX
  await wsSend(ws, {
    jsonrpc: '2.0', method: 'message.create', params: {
      roomId, message: { role: 'user', content: [{ type: 'text', text: 'Get latest Google News about SpaceX' }] }
    }
  });

  let askedApproval = false;
  let gotToolResults = false;
  let shortTermOk = false;

  const until = Date.now() + 30000;
  ws.on('message', async (buf) => {
    try {
      const msg = JSON.parse(String(buf));
      // console.log('WS:', msg);
      if (msg?.method === 'message.complete' || msg?.method === 'message.received') {
        const text = JSON.stringify(msg.params || msg.result || msg);
        if (!askedApproval && /serpapi\.google_news|Should I run serpapi/i.test(text)) {
          askedApproval = true;
          await wsSend(ws, { jsonrpc: '2.0', method: 'message.create', params: { roomId, message: { role: 'user', content: [{ type: 'text', text: 'yes' }] } } });
        }
        if (/Google News for|Headlines for|SERPAPI news for|SERPAPI results for/i.test(text)) {
          gotToolResults = true;
          // Follow-up to validate short-term memory
          await wsSend(ws, { jsonrpc: '2.0', method: 'message.create', params: { roomId, message: { role: 'user', content: [{ type: 'text', text: 'In one word, what topic did we just fetch news about?' }] } } });
        }
        if (/spacex/i.test(text)) {
          shortTermOk = true;
        }
      }
    } catch {}
  });

  while (Date.now() < until && !(askedApproval && gotToolResults && shortTermOk)) {
    await sleep(200);
  }
  try { ws.close(); } catch {}

  if (!askedApproval) throw new Error('Did not see tool approval question');
  if (!gotToolResults) throw new Error('Did not see tool results/summary');
  if (!shortTermOk) throw new Error('Short-term follow-up did not reference SpaceX');

  console.log(`OK: Memory flow completed. ROOM_ID=${roomId} USER_ID=${USER_ID}`);
  console.log(JSON.stringify({ roomId, userId: USER_ID }, null, 2));
}

run().catch((e) => {
  console.error('Memory flow failed:', e?.message || e);
  process.exit(1);
});


