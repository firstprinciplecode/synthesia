#!/usr/bin/env node
import { spawn } from 'node:child_process';
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

  // Start ngrok for FRONTEND (3000) so the public domain serves the Next app
  const domain = process.env.NGROK_DOMAIN && String(process.env.NGROK_DOMAIN).trim();
  const port = Number(process.env.NGROK_PORT || 3000);
  const args = ['http'];
  if (domain) args.push('--domain', domain);
  args.push(String(port));
  const ngrokProc = spawn('ngrok', args, { stdio: 'ignore' });

  process.on('exit', () => { try { ngrokProc.kill('SIGTERM'); } catch {} });
  process.on('SIGINT', () => { try { ngrokProc.kill('SIGTERM'); } catch {} process.exit(0); });

  const httpsUrl = domain ? `https://${domain}` : await getNgrokHttpsUrlFor(port);
  // WS should go through the same public domain and hit our frontend proxy's /ws
  const wssUrl = httpsUrl.replace(/^https:/, 'wss:') + '/ws';
  console.log(`Using WebSocket (public): ${wssUrl}`);

  // Start dev servers (frontend + backend)
  // Ensure the frontend proxy points to local backend
  // Do not set PORT here: it leaks to the backend process under concurrently.
  // Frontend server.mjs defaults to 3000 without PORT.
  const env = { ...process.env, BACKEND_HTTP: 'http://127.0.0.1:3001', BACKEND_WS: 'ws://127.0.0.1:3001', NEXT_PUBLIC_WS_URL: wssUrl, NEXTAUTH_URL: httpsUrl, SOCIAL_CORE: '1', AGENT_LOOP: '1', NODE_OPTIONS: '--max-old-space-size=3072' };
  const dev = spawn('npm', ['run', 'dev'], { stdio: 'inherit', cwd: repoRoot, env });
  dev.on('close', (code) => {
    try { ngrokProc.kill('SIGTERM'); } catch {}
    process.exit(code ?? 0);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


