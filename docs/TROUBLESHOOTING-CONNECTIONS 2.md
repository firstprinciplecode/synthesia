# Troubleshooting: Connections (Left Sidebar) show empty, `/api/connections` 404

This runbook documents the issue where connected users did not appear in the left sidebar and requests to `/api/connections` returned 404. It also captures the resolution steps and verification commands.

## Symptoms
- Clicking or loading the sidebar showed agents but no connected users.
- Requests to `GET /api/connections` returned 404 Not Found.
- `GET /api/relationships` (GET/POST) also returned 404.
- Other endpoints (e.g., `GET /api/profile`, `GET /api/agents/accessible`, `GET /api/conversations`) worked.

## Root Cause
- Social features (actors/relationships/connections) are behind a feature flag in the backend:
  - `SOCIAL_CORE` must be set to `1` for the routes to register.
- Additionally, multiple backend processes were running on port 3001 simultaneously, which could cause inconsistent route registration.
- Frontend proxy (`frontend/server.mjs`) was correct and forwards all `/api/*` (except NextAuth) and `/uploads/*` to the backend; the proxy was not the cause.

## Fix
1) Ensure only one backend process is running
```bash
# Kill anything on port 3001
lsof -i :3001 -n -P | awk 'NR>1 {print $2}' | xargs -r kill -9
```

2) Start backend with Social Core enabled
```bash
cd backend
SOCIAL_CORE=1 npm run dev
# or
SOCIAL_CORE=1 npm start
```

3) Ensure frontend dev proxy runs (and forwards to backend)
```bash
cd frontend
npm run dev
```

4) If using ngrok for `agent.firstprinciple.co`, ensure one ngrok agent only
- End other ngrok sessions from dashboard (Agents page) or use a different authtoken.
- Our `scripts/dev-ngrok.mjs` starts ngrok for the frontend and sets `BACKEND_HTTP`/`BACKEND_WS` for proxying.

## Verify
Local backend:
```bash
curl -s http://localhost:3001/api/profile -H 'x-user-id: thomas@firstprinciple.co' | jq '.email'
curl -s http://localhost:3001/api/connections -H 'x-user-id: thomas@firstprinciple.co' | jq '.connections | length'
```

Through public domain (proxied via frontend/ngrok):
```bash
curl -s https://agent.firstprinciple.co/api/profile -H 'x-user-id: thomas@firstprinciple.co' | jq '.email'
curl -s https://agent.firstprinciple.co/api/connections -H 'x-user-id: thomas@firstprinciple.co' | jq '.connections | length'
```

Expected: HTTP 200 and a non-zero `connections` length when a mutual or accepted follow exists.

## Useful Scripts
- Shell test (created at repo root):
```bash
./test-connections.sh
```
- DB-level check (no network/proxy dependency):
```bash
cd backend
npx tsx scripts/check-connections.ts "thomas@firstprinciple.co" "thomas.petersen@gmail.com"
```
Outputs counts of user-actors and accepted relationship edges A→B and B→A.

## Notes
- DB tables exist in Drizzle migration `backend/drizzle/0001_add_social_core.sql` (`actors`, `relationships`, etc.).
- The `/feed` feature and its real-time activity do not affect route registration. The issue was exclusively the `SOCIAL_CORE` flag and multiple backend processes.
- Frontend fallback: `frontend/src/components/nav-projects.tsx` temporarily hardcodes a connection only when the `/api/connections` call fails. With the backend fixed, the real list is shown and the fallback is not used.

## Quick Checks
```bash
# Confirm single backend process
lsof -i :3001 -n -P

# Confirm SOCIAL_CORE is applied (expect social routes to exist)
curl -s http://localhost:3001/api/connections -H 'x-user-id: thomas@firstprinciple.co' | jq '.'
```

## Related Observations (not blocking)
- SerpAPI Yelp engine may return `Missing location find_loc` if the post text lacks a location. We added heuristics to infer location, but ensure queries contain location for best results.

## TL;DR
- Set `SOCIAL_CORE=1` for backend.
- Ensure only one backend on port 3001.
- Verify via `curl` locally and via `agent.firstprinciple.co`.
- Use provided scripts for quick diagnostics.
