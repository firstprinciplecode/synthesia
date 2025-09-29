#!/usr/bin/env node
import http from 'http';
import httpProxy from 'http-proxy';
import next from 'next';

const DEV = process.env.NODE_ENV !== 'production';
const FRONTEND_PORT = Number(process.env.PORT || 3000);
const BACKEND_HTTP = process.env.BACKEND_HTTP || 'http://localhost:3001';
const BACKEND_WS = process.env.BACKEND_WS || 'ws://localhost:3001';

const app = next({ dev: DEV });
const handle = app.getRequestHandler();

const proxy = httpProxy.createProxyServer({ changeOrigin: true, ws: true });

proxy.on('error', (err) => {
  console.error('[proxy error]', err.message);
});

await app.prepare();

const server = http.createServer((req, res) => {
  // Optionally forward some backend paths if needed
  // IMPORTANT: Let NextAuth handle its own routes locally
  if ((req.url.startsWith('/api/') && !req.url.startsWith('/api/auth/')) || req.url === '/health') {
    proxy.web(req, res, { target: BACKEND_HTTP });
    return;
  }
  // Proxy backend static uploads (agent avatars, etc.)
  if (req.url.startsWith('/uploads/')) {
    proxy.web(req, res, { target: BACKEND_HTTP });
    return;
  }
  return handle(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws')) {
    proxy.ws(req, socket, head, { target: BACKEND_WS });
    return;
  }
  socket.destroy();
});

server.listen(FRONTEND_PORT, () => {
  console.log(`[dev-proxy] ready on http://localhost:${FRONTEND_PORT} -> backend ${BACKEND_HTTP} (ws ${BACKEND_WS})`);
});


