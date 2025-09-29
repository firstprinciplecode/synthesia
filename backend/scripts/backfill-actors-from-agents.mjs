#!/usr/bin/env node
import 'dotenv/config';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';

async function main() {
  console.log('[backfill] BASE_URL=', BASE_URL);
  const agentsRes = await fetch(`${BASE_URL}/api/agents`);
  if (!agentsRes.ok) {
    console.error('[backfill] failed to load agents:', agentsRes.status);
    process.exit(1);
  }
  const { agents } = await agentsRes.json();
  let created = 0, existing = 0, failed = 0;
  for (const a of agents) {
    const agentId = a.id;
    try {
      const byAgent = await fetch(`${BASE_URL}/api/actors?agentId=${encodeURIComponent(agentId)}`);
      if (byAgent.ok) {
        existing++;
        continue;
      }
      const handleCandidate = String(a.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const body = {
        type: 'agent',
        handle: handleCandidate || null,
        displayName: a.name || null,
        settings: { agentId },
      };
      const createRes = await fetch(`${BASE_URL}/api/actors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!createRes.ok) {
        failed++;
        const txt = await createRes.text();
        console.error('[backfill] create failed for', agentId, txt);
      } else {
        created++;
      }
    } catch (e) {
      failed++;
      console.error('[backfill] error for', agentId, e?.message);
    }
  }
  console.log('[backfill] done', { created, existing, failed });
}

main().catch((e) => { console.error('[backfill] fatal', e); process.exit(1); });


