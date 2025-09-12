#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getNgrokHttpsUrlFor(port, attempts = 40) {
  const api = 'http://127.0.0.1:4040/api/tunnels';
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(api);
      if (!res.ok) throw new Error('ngrok api not ready');
      const data = await res.json();
      const t = data.tunnels.find(t => t.proto === 'https' && (t.config?.addr?.endsWith(`:${port}`) || !port));
      if (t) return t.public_url;
    } catch {}
    await sleep(500);
  }
  throw new Error('Timed out waiting for ngrok URL');
}

async function main() {
  const repoRoot = resolve(process.cwd());
  const frontendDir = resolve(repoRoot, 'frontend');

  // Start ngrok for backend WS (3001)
  const domain = process.env.NGROK_DOMAIN && String(process.env.NGROK_DOMAIN).trim();
  const args = ['http'];
  if (domain) args.push('--domain', domain);
  args.push('3001');
  const ngrokProc = spawn('ngrok', args, { stdio: 'ignore' });

  process.on('exit', () => { try { ngrokProc.kill('SIGTERM'); } catch {} });
  process.on('SIGINT', () => { try { ngrokProc.kill('SIGTERM'); } catch {} process.exit(0); });

  const httpsUrl = domain ? `https://${domain}` : await getNgrokHttpsUrlFor(3001);
  const wssUrl = httpsUrl.replace(/^https:/, 'wss:') + '/ws';
  const envPath = resolve(frontendDir, '.env.local');
  await writeFile(envPath, `NEXT_PUBLIC_WS_URL=${wssUrl}\n`);
  console.log(`Using WebSocket: ${wssUrl}`);

  // Start dev servers (frontend + backend)
  const dev = spawn('npm', ['run', 'dev'], { stdio: 'inherit', cwd: repoRoot, env: process.env });
  dev.on('close', (code) => {
    try { ngrokProc.kill('SIGTERM'); } catch {}
    process.exit(code ?? 0);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


