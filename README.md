## SuperAgent - Local Setup and Run Guide

### Overview
This repo contains a Fastify + Drizzle/Postgres backend and a Next.js 15 App Router frontend. The frontend dev server proxies API/WebSocket traffic to the backend.

Ports (default):
- Frontend: 3000
- Backend: 3001

### Requirements
- Node.js 18+ (recommended 20+)
- npm 9+ (or Yarn 1.x if you prefer)
- A Postgres instance and connection string
- Optional API keys for LLMs and data sources

### 1) Clone the repo
```bash
git clone https://github.com/firstprinciplecode/synthesia.git
cd synthesia
```

### 2) Environment variables
Create a `.env` in the repo root with your own values (DB connection, feature flags, API keys). `.env` is git-ignored and not committed. The backend reads env via `dotenv`; the frontend proxy uses `BACKEND_HTTP/WS`.

### 3) Install dependencies
Use the workspace helper to install everything:
```bash
npm run install:all
```

Alternatively:
```bash
npm install              # root workspace
cd frontend && npm install
cd ../backend && npm install
```

### 4) Initialize the database (migrations)
Apply the SQL migrations in `backend/drizzle/` to your Postgres:
```bash
for f in backend/drizzle/*.sql; do echo "Applying $f"; psql "$DATABASE_URL" -f "$f"; done
```

Verify connectivity:
```bash
cd backend
npm run start --silent --prefix . ../../backend/src/test-db.ts  # or run: npm run start then hit /health
```

### 5) Run in development
From the repo root:
```bash
npm run dev
```
This starts:
- Backend Fastify API on http://localhost:3001
- Frontend dev server (custom `server.mjs`) on http://localhost:3000

Open http://localhost:3000

### 6) Production build and start
```bash
npm run build    # builds frontend and backend
npm run start    # serves both with "next start" and backend start
```

### 7) Troubleshooting
- 404 on `/api/connections`: ensure `SOCIAL_CORE=1` in `.env`, restart backend
- SerpAPI not returning results: ensure `SERPAPI_KEY` is set in `.env`
- Monitoring posts old items: ensure the backend process is restarted after changes; monitors only post items newer than the last run
- Port conflicts: free 3000/3001 or change proxy/ports in `.env` and `server.mjs`
- See `docs/TROUBLESHOOTING-CONNECTIONS.md` for more details

### 8) Useful scripts
```bash
# Workspace helpers
npm run stop            # kill typical dev servers on 3000/3001
npm run clean           # remove node_modules in root/frontend/backend

# Individual apps
cd frontend && npm run dev
cd backend  && npm run dev
```

### 9) Optional: Seed/diagnostic scripts
The backend includes many scripts under `backend/scripts/` (e.g., `ensure-user.mjs`, `smoke-*.mjs`, `ws-*.mjs`) to help diagnose or seed data flows. Run with:
```bash
node backend/scripts/ensure-user.mjs
```

### 10) Security
Never commit `.env` or API keys. The repo has a pre-commit safety check; if it complains about large, random strings in staged files, unstage the file (e.g., `git reset HEAD yarn.lock`) and commit again.


