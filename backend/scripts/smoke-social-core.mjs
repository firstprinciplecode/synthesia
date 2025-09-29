#!/usr/bin/env node
/*
  Social Core end-to-end smoke test
  Steps:
  1) Create two users (A, B)
  2) Resolve their actors
  3) Create an agent under B
  4) A follows B; B approves
  5) A requests agent_access to B's agent; B approves
  6) A opens agent chat room and sends a message via WS
  7) A creates DM with B and sends a message via WS
  8) Verify messages history and unfurl endpoint
*/

import { WebSocket } from 'ws';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3001/ws';

const USER_A = process.env.USER_A || 'qa+usera@example.com';
const USER_B = process.env.USER_B || 'qa+userb@example.com';

const results = [];

async function httpJson(method, path, { body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e?.message || e) }) }));
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function assertOk(ok, msg) {
  results.push({ ok, msg });
  if (!ok) console.error('FAIL:', msg);
  else console.log('OK  :', msg);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getActorId(xUserId) {
  const r = await httpJson('GET', '/api/actors/me', { headers: { 'x-user-id': xUserId } });
  assertOk(r.ok && r.data?.id, `actors.me for ${xUserId}`);
  return r.data?.id;
}

async function wsSend(ws, payload) {
  return new Promise((resolve, reject) => {
    try { ws.send(JSON.stringify(payload), (err) => err ? reject(err) : resolve()); } catch (e) { reject(e); }
  });
}

async function run() {
  // Preflight health
  const health = await httpJson('GET', '/health');
  assertOk(health.ok, 'backend /health');

  // 1) Create users via profile (idempotent)
  const uA = await httpJson('GET', '/api/profile', { headers: { 'x-user-id': USER_A } });
  assertOk(uA.ok && uA.data?.id, 'create/resolve user A profile');
  const uB = await httpJson('GET', '/api/profile', { headers: { 'x-user-id': USER_B } });
  assertOk(uB.ok && uB.data?.id, 'create/resolve user B profile');

  // 2) Actors
  const aActorId = await getActorId(USER_A);
  const bActorId = await getActorId(USER_B);

  // 3) Create agent (under user B)
  const agentRes = await httpJson('POST', '/api/agents', {
    headers: { 'x-user-id': USER_B },
    body: {
      name: 'QA Smoke Agent',
      description: 'E2E smoke test agent',
      instructions: 'You are a concise, helpful assistant used for smoke tests.',
    },
  });
  assertOk(agentRes.ok && agentRes.data?.id, 'create agent (B)');
  const agentId = agentRes.data?.id;

  // 4) A follows B; 5) B approves
  const followReq = await httpJson('POST', '/api/relationships', {
    headers: { 'x-user-id': USER_A },
    body: { toActorId: bActorId, kind: 'follow' },
  });
  assertOk(followReq.ok, 'A follows B');
  const followApprove = await httpJson('POST', '/api/relationships/approve', {
    headers: { 'x-user-id': USER_B },
    body: { fromActorId: aActorId, kind: 'follow' },
  });
  assertOk(followApprove.ok, 'B approves follow (A)');

  // 6) A requests agent_access; B approves
  const accessReq = await httpJson('POST', '/api/relationships', {
    headers: { 'x-user-id': USER_A },
    body: { kind: 'agent_access', agentId },
  });
  assertOk(accessReq.ok, 'A requests agent_access to B\'s agent');
  const accessApprove = await httpJson('POST', '/api/relationships/approve', {
    headers: { 'x-user-id': USER_B },
    body: { fromActorId: aActorId, kind: 'agent_access' },
  });
  assertOk(accessApprove.ok, 'B approves agent_access (A)');

  // 7) Open agent chat room for A
  const roomAgent = await httpJson('POST', '/api/rooms/agent', {
    headers: { 'x-user-id': USER_A },
    body: { agentId },
  });
  assertOk(roomAgent.ok && roomAgent.data?.roomId, 'open agent chat room (A<->agent)');
  const agentRoomId = roomAgent.data?.roomId;

  // 8) WS send a message to agent
  let agentReply = null;
  try {
    const ws = new WebSocket(WS_URL, { headers: { 'x-user-id': USER_A } });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const reqId = `req_${Date.now()}`;
    await wsSend(ws, { jsonrpc: '2.0', id: reqId, method: 'room.join', params: { roomId: agentRoomId, userId: USER_A } });
    await sleep(150);
    await wsSend(ws, {
      jsonrpc: '2.0',
      method: 'message.create',
      params: { roomId: agentRoomId, message: { role: 'user', content: [{ type: 'text', text: 'Hello agent, this is a smoke test.' }] } },
    });

    const until = Date.now() + 15000;
    await new Promise((resolve) => {
      ws.on('message', (buf) => {
        try {
          const msg = JSON.parse(String(buf));
          if (msg?.method === 'message.complete' || (msg?.method === 'message.received' && msg?.params?.authorType === 'assistant')) {
            agentReply = msg;
            resolve();
          }
        } catch {}
        if (Date.now() > until) resolve();
      });
    });
    try { ws.close(); } catch {}
  } catch (e) {
    console.error('WS agent chat error:', e?.message || e);
  }
  assertOk(!!agentReply, 'agent chat produced a reply or completion (tolerate fallback)');

  // 9) Create DM A<->B and send a message
  const dm = await httpJson('POST', '/api/rooms/dm', {
    headers: { 'x-user-id': USER_A },
    body: { targetActorId: bActorId },
  });
  assertOk(dm.ok && dm.data?.roomId, 'create/open DM room A<->B');
  const dmRoomId = dm.data?.roomId;

  let dmEcho = null;
  try {
    const ws = new WebSocket(WS_URL, { headers: { 'x-user-id': USER_A } });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    await wsSend(ws, { jsonrpc: '2.0', id: `req_${Date.now()}`, method: 'room.join', params: { roomId: dmRoomId, userId: USER_A } });
    await sleep(100);
    await wsSend(ws, {
      jsonrpc: '2.0', method: 'message.create', params: { roomId: dmRoomId, message: { role: 'user', content: [{ type: 'text', text: 'Hello B (DM) – smoke test.' }] } }
    });
    const until = Date.now() + 5000;
    await new Promise((resolve) => {
      ws.on('message', (buf) => {
        try {
          const msg = JSON.parse(String(buf));
          if (msg?.method === 'message.received' && msg?.params?.authorType === 'user') {
            dmEcho = msg;
            resolve();
          }
        } catch {}
        if (Date.now() > until) resolve();
      });
    });
    try { ws.close(); } catch {}
  } catch (e) {
    console.error('WS DM error:', e?.message || e);
  }
  assertOk(!!dmEcho, 'DM message echoed by server');

  // 10) Verify histories
  const agentHist = await httpJson('GET', `/api/rooms/${encodeURIComponent(agentRoomId)}/messages?limit=50`, { headers: { 'x-user-id': USER_A } });
  assertOk(agentHist.ok && Array.isArray(agentHist.data?.messages), 'agent room history loads');
  const dmHist = await httpJson('GET', `/api/rooms/${encodeURIComponent(dmRoomId)}/messages?limit=50`, { headers: { 'x-user-id': USER_A } });
  assertOk(dmHist.ok && Array.isArray(dmHist.data?.messages), 'dm room history loads');

  // 11) Unfurl check
  const unf = await httpJson('GET', `/api/unfurl?url=${encodeURIComponent('https://www.perfectcorp.com/consumer/blog/generative-AI/best-ai-girl-generators')}`);
  assertOk(unf.ok && unf.data?.url && unf.data?.host, 'unfurl endpoint responds');

  // Summary
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n==== Smoke Test Summary ====`);
  console.log(`Base: ${BASE}`);
  console.log(`WS  : ${WS_URL}`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} - ${r.msg}`);
  console.log(`Totals: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error('Smoke test crashed:', e?.stack || e);
  process.exit(1);
});


