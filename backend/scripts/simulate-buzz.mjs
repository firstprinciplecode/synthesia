#!/usr/bin/env node
import { WebSocket } from 'ws';
import { config as dotenv } from 'dotenv';
import path from 'path';

// Load env from project root if available
try { dotenv({ path: path.resolve(process.cwd(), '../.env') }); } catch {}

const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';
const ROOM_ID = process.env.AGENT_ROOM_ID || (process.argv.includes('--room') ? process.argv[process.argv.indexOf('--room')+1] : '6049f7be-6bbd-4fba-bf1d-62e4691077f0');
const TOPIC = process.env.TOPIC || (process.argv.includes('--topic') ? process.argv[process.argv.indexOf('--topic')+1] : 'spacex');
const PICK_INDEX = Number(process.env.PICK_INDEX || (process.argv.includes('--index') ? process.argv[process.argv.indexOf('--index')+1] : 4));

if (!ROOM_ID) {
  console.error('Missing ROOM_ID. Pass via --room <id> or AGENT_ROOM_ID.');
  process.exit(1);
}

const ws = new WebSocket(WS_URL);

const pending = new Map();
function nextId() { return `req_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId();
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 30000);
  });
}
function notify(method, params) {
  ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
}

let lastResultId = null;

ws.on('open', async () => {
  console.log(`[ws] connected ${WS_URL}`);
  try {
    // Join agent room
    console.log('[step] join room', ROOM_ID);
    notify('room.join', { roomId: ROOM_ID, userId: 'default-user' });

    // Say hi
    console.log('[step] message: Hey Buzz');
    notify('message.create', { roomId: ROOM_ID, message: { role: 'user', content: [{ type: 'text', text: 'Hey Buzz' }] } });

    // Wait a bit for reply
    await new Promise(r => setTimeout(r, 1500));

    // Ask for news
    const newsMsg = `Can you get the latest news about ${TOPIC} from Google News?`;
    console.log('[step] message:', newsMsg);
    notify('message.create', { roomId: ROOM_ID, message: { role: 'user', content: [{ type: 'text', text: newsMsg }] } });

    // Wait up to 5s for search.results broadcast
    const rid = await waitForResultId(5000);
    if (rid) {
      console.log('[info] captured resultId:', rid);
      lastResultId = rid;
    } else {
      console.warn('[warn] no search.results received; will try direct serpapi.run');
      const res = await sendRequest('tool.serpapi.run', { roomId: ROOM_ID, engine: 'google_news', query: TOPIC });
      console.log('[info] serpapi.run ok');
      // small wait for search.results
      lastResultId = await waitForResultId(3000);
      console.log('[info] resultId after direct run:', lastResultId);
    }

    // Ask to read Nth
    const readMsg = `Can you read the ${PICK_INDEX}th article for me?`;
    console.log('[step] message:', readMsg);
    notify('message.create', { roomId: ROOM_ID, message: { role: 'user', content: [{ type: 'text', text: readMsg }] } });

    // Execute deterministic pick directly to isolate UI approval issues
    if (lastResultId) {
      console.log('[step] tool.web.scrape.pick', { index: PICK_INDEX, resultId: lastResultId });
      const pick = await sendRequest('tool.web.scrape.pick', { roomId: ROOM_ID, index: PICK_INDEX, resultId: lastResultId });
      console.log('[ok] pick result meta:', { pickedIndex: pick?.pickedIndex, ok: pick?.ok });
    } else {
      console.warn('[warn] no resultId available; calling pick without it (may fail)');
      try {
        const pick = await sendRequest('tool.web.scrape.pick', { roomId: ROOM_ID, index: PICK_INDEX });
        console.log('[ok] pick (fallback) result meta:', { pickedIndex: pick?.pickedIndex, ok: pick?.ok });
      } catch (e) {
        console.error('[err] pick without resultId failed:', e.message);
      }
    }

    // Let messages flow briefly
    await new Promise(r => setTimeout(r, 2000));
    process.exit(0);
  } catch (e) {
    console.error('[script error]', e);
    process.exit(1);
  }
});

ws.on('message', (data) => {
  try {
    const obj = JSON.parse(String(data));
    if (obj && obj.jsonrpc === '2.0') {
      if (obj.id && (obj.result !== undefined || obj.error)) {
        const p = pending.get(obj.id);
        if (p) {
          pending.delete(obj.id);
          if (obj.error) p.reject(new Error(obj.error.message || 'JSON-RPC error'));
          else p.resolve(obj.result);
        }
        return;
      }
      if (obj.method === 'message.received') {
        const text = extractText(obj.params?.message);
        console.log('[assistant]', text.slice(0, 200));
        return;
      }
      if (obj.method === 'message.delta') {
        process.stdout.write(obj.params?.delta || '');
        return;
      }
      if (obj.method === 'message.complete') {
        const text = extractText(obj.params?.finalMessage);
        console.log('\n[assistant complete]', text.slice(0, 200));
        return;
      }
      if (obj.method === 'search.results') {
        lastResultId = String(obj.params?.resultId || '');
        console.log('[search.results] items=', Array.isArray(obj.params?.items) ? obj.params.items.length : 0, 'resultId=', lastResultId);
        return;
      }
      if (obj.method === 'tool.result') {
        console.log('[tool.result]', Object.keys(obj.params || {}));
        return;
      }
    }
  } catch {}
});

ws.on('error', (e) => {
  console.error('[ws error]', e.message);
});

function extractText(m) {
  if (!m) return '';
  if (typeof m === 'string') return m;
  if (Array.isArray(m?.content)) return m.content.map(c => (typeof c?.text === 'string' ? c.text : '')).join('');
  if (typeof m?.text === 'string') return m.text;
  return '';
}

function waitForResultId(ms) {
  return new Promise((resolve) => {
    if (lastResultId) return resolve(lastResultId);
    const t = setTimeout(() => resolve(null), ms);
    const handler = (data) => {
      try {
        const obj = JSON.parse(String(data));
        if (obj?.method === 'search.results') {
          lastResultId = String(obj.params?.resultId || '');
          clearTimeout(t);
          ws.off('message', handler);
          resolve(lastResultId);
        }
      } catch {}
    };
    ws.on('message', handler);
  });
}


