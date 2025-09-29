#!/usr/bin/env node
import { config as dotenv } from 'dotenv';
import path from 'path';

try { dotenv({ path: path.resolve(process.cwd(), '../.env') }); } catch {}

const BASE = process.env.BASE_URL || 'http://localhost:3001';

async function main() {
  const fetchJson = async (url, opts = {}) => {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
  };

  console.log('[actors.me]');
  const me = await fetchJson(`${BASE}/api/actors/me`);
  console.log(me);

  console.log('[rooms.create]');
  const created = await fetchJson(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ kind: 'dm', participants: [] }) });
  console.log(created);
  const roomId = created?.body?.id;

  console.log('[rooms.get]');
  const room = await fetchJson(`${BASE}/api/rooms/${roomId}`);
  console.log(room);

  console.log('[rooms.join]');
  const join = await fetchJson(`${BASE}/api/rooms/${roomId}/join`, { method: 'POST' });
  console.log(join);

  console.log('[policies.set]');
  const polSet = await fetchJson(`${BASE}/api/policies`, { method: 'POST', body: JSON.stringify({ scope: 'room', scopeId: roomId, requireApproval: 'ask' }) });
  console.log(polSet);

  console.log('[policies.resolve]');
  const polGet = await fetchJson(`${BASE}/api/policies/resolve?roomId=${encodeURIComponent(roomId)}`);
  console.log(polGet);

  console.log('[rooms.leave]');
  const leave = await fetchJson(`${BASE}/api/rooms/${roomId}/leave`, { method: 'POST' });
  console.log(leave);
}

main().catch((e) => { console.error('[test-social] failed', e); process.exit(1); });


