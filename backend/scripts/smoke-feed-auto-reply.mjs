#!/usr/bin/env node
import 'dotenv/config';

const BASE = process.env.BASE_URL || 'https://agent.firstprinciple.co';
const POSTER = process.env.USER_ID || 'thomas@firstprinciple.co';
const AGENT_OWNER = process.env.AGENT_OWNER_ID || 'thomas.petersen@gmail.com';
const AGENT_ID = process.env.AGENT_ID || '5df77be8-50fa-4293-b9f1-beb4a10c3e6a'; // Gordon Ramsay

async function httpJson(method, path, { body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e?.message || e) }) }));
  let data = null; try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function ensureAgentPublic() {
  const get = await httpJson('GET', `/api/agents/${AGENT_ID}`, { headers: { 'x-user-id': AGENT_OWNER } });
  if (!get.ok) throw new Error('Agent fetch failed');
  const cur = get.data || {};
  if (cur.isPublic && Array.isArray(cur.interests) && cur.interests.length) return true;
  const interests = ['food','drinks','wine','dining','michelin','restaurants'];
  const put = await httpJson('PUT', `/api/agents/${AGENT_ID}`, { headers: { 'x-user-id': AGENT_OWNER }, body: { isPublic: true, publicMatchThreshold: 0.5, interests } });
  if (!put.ok) throw new Error('Agent update failed');
  return true;
}

async function postAndWait(text){
  const post = await httpJson('POST', '/api/feed?diag=1', { headers: { 'x-user-id': POSTER }, body: { text } });
  if (!post.ok) throw new Error(`Post failed (${post.status})`);
  const id = post.data?.id; if (!id) throw new Error('No post id');
  const diags = Array.isArray(post.data?.diagnostics) ? post.data.diagnostics : [];
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const r = await httpJson('GET', `/api/feed/${id}`);
    const replies = Array.isArray(r.data?.replies) ? r.data.replies : [];
    if (replies.length) return { id, diagnostics: diags, replies };
    await sleep(1000);
  }
  return { id, diagnostics: diags, replies: [] };
}

async function main(){
  console.log('Ensuring agent is public…');
  await ensureAgentPublic();
  const text = 'Anyone got any recommendations for food in Copenhagen?';
  console.log('Posting:', text);
  const { id, diagnostics, replies } = await postAndWait(text);
  console.log('Post id:', id, 'reply count:', replies.length);
  if (diagnostics && diagnostics.length) {
    console.log('Diagnostics:');
    for (const d of diagnostics) {
      console.log('-', d.name || d.agentId, 'score=', d.score?.toFixed?.(3), 'threshold=', d.threshold, 'keyword=', d.hitByKeyword, 'replied=', d.replied);
    }
  }
  for (const r of replies) {
    console.log('-', r.authorType, r.authorId, ':', String(r.text||'').slice(0,160).replace(/\s+/g,' '));
  }
}

main().catch(e=>{ console.error('Smoke failed:', e?.stack||e); process.exit(1); });


