#!/usr/bin/env node
import { WebSocket } from 'ws';
import { config as dotenv } from 'dotenv';
import path from 'path';

try { dotenv({ path: path.resolve(process.cwd(), '../.env') }); } catch {}

const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';
const ROOM_ID = process.argv.includes('--room') ? process.argv[process.argv.indexOf('--room') + 1] : (process.env.AGENT_ROOM_ID || '6049f7be-6bbd-4fba-bf1d-62e4691077f0');
const URL_TO_SCRAPE = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : process.env.URL;

if (!URL_TO_SCRAPE) {
  console.error('Usage: node scripts/scrape-url.mjs --room <roomId> --url <https://...>');
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
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }
    }, 30000);
  });
}

ws.on('open', async () => {
  try {
    console.log('[ws] connected', WS_URL);
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'room.join', params: { roomId: ROOM_ID, userId: 'default-user' } }));
    await new Promise(r => setTimeout(r, 300));
    const res = await sendRequest('tool.web.scrape', { roomId: ROOM_ID, url: URL_TO_SCRAPE });
    const data = res?.result || res;
    const text = String(data?.text || '').replace(/\s+/g, ' ').slice(0, 600);
    console.log('[scrape.ok]', { url: data?.url, title: data?.title, textLen: (data?.text || '').length });
    console.log(text);
    process.exit(0);
  } catch (e) {
    console.error('[scrape.err]', e?.message || e);
    process.exit(1);
  }
});

ws.on('message', (data) => {
  try {
    const obj = JSON.parse(String(data));
    if (obj && obj.jsonrpc === '2.0' && obj.id && (obj.result !== undefined || obj.error)) {
      const p = pending.get(obj.id);
      if (p) {
        pending.delete(obj.id);
        if (obj.error) p.reject(new Error(obj.error.message || 'JSON-RPC error'));
        else p.resolve(obj.result);
      }
    }
  } catch {}
});

ws.on('error', (e) => {
  console.error('[ws.error]', e?.message || e);
});


