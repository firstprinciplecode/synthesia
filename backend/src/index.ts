// Load environment variables FIRST before any other imports
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '../.env') });

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { WebSocketServer } from './websocket/server.js';
import { randomUUID } from 'crypto';
import { db, agents, users, conversations, actors, rooms, roomMembers, relationships, policies, messages, closeDbPool } from './db/index.js';
import bcrypt from 'bcryptjs';
import { LLMRouter, ModelConfigs } from './llm/providers.js';
import { and, eq, isNull } from 'drizzle-orm';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { mkdirSync, createWriteStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { xService } from './tools/x-service.js';

// Helper to normalize avatar URL to a relative /uploads path
function normalizeAvatarUrl(input?: string | null): string | null {
  if (!input) return null;
  try {
    // If already a relative uploads path, keep as-is
    if (input.startsWith('/uploads/')) return input;
    // If it's an absolute URL containing /uploads/, strip origin and everything before that
    const idx = input.indexOf('/uploads/');
    if (idx !== -1) {
      return input.slice(idx);
    }
    // Otherwise, keep unchanged but prefer returning null if it doesn't look like an uploads path
    return input.startsWith('http') ? input : null;
  } catch {
    return null;
  }
}


const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Register plugins
await fastify.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-user-id'],
  maxAge: 86400,
});

await fastify.register(websocket);
await fastify.register(multipart);

// Static file serving for uploads
const uploadsDir = join(process.cwd(), 'uploads');
try { mkdirSync(uploadsDir, { recursive: true }); } catch {}
await fastify.register(fastifyStatic, {
  root: uploadsDir,
  prefix: '/uploads/',
});

// Ensure DB pool is closed when Fastify shuts down
fastify.addHook('onClose', async () => {
  try { await closeDbPool(); } catch {}
});

// Migrate existing agents with avatar info in instructions to avatar field
async function migrateAgentAvatars() {
  try {
    const agentsWithInstructions = await db.select().from(agents).where(isNull(agents.avatar));
    for (const agent of agentsWithInstructions) {
      const instr = agent.instructions || '';
      const avatarMatch = instr.match(/Avatar:\s*(.*)\n/);
      if (avatarMatch) {
        const raw = avatarMatch[1].trim();
        const avatarUrl = normalizeAvatarUrl(raw) || raw;
        await db.update(agents).set({ 
          avatar: avatarUrl,
          updatedAt: new Date()
        }).where(eq(agents.id, agent.id));
        console.log(`Migrated avatar for agent ${agent.id}: ${avatarUrl}`);
      }
    }
  } catch (error) {
    console.error('Error migrating agent avatars:', error);
  }
}

// Normalize any absolute avatar URLs to relative uploads paths on startup
async function normalizeExistingAgentAvatars() {
  try {
    const all = await db.select().from(agents);
    for (const a of all as any[]) {
      const normalized = normalizeAvatarUrl(a.avatar);
      if (normalized && normalized !== a.avatar) {
        await db.update(agents).set({ avatar: normalized, updatedAt: new Date() }).where(eq(agents.id, a.id));
        console.log(`Normalized avatar for agent ${a.id}: ${normalized}`);
      }
    }
  } catch (e) {
    console.error('Error normalizing agent avatars:', e);
  }
}

// Run migrations on startup
migrateAgentAvatars();
normalizeExistingAgentAvatars();

// Initialize WebSocket server
const wsServer = new WebSocketServer();
wsServer.register(fastify);

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    availableProviders: wsServer.getAvailableProviders(),
  };
});

// API Info endpoint
fastify.get('/api/info', async (request, reply) => {
  return {
    name: 'SuperAgent Backend',
    version: '0.1.0',
    websocket: '/ws',
    availableProviders: wsServer.getAvailableProviders(),
    supportedMethods: [
      'message.create',
      'room.join',
      'room.leave',
    ],
  };
});

// === Local Auth (email/password) ===
fastify.post('/api/local-auth/register', async (request, reply) => {
  try {
    const body = (request.body || {}) as any;
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    if (!email || !password) { reply.code(400); return { error: 'Email and password required' }; }
    const existing = await db.select().from(users).where(eq(users.email as any, email as any));
    if (existing.length) { reply.code(409); return { error: 'Email already registered' }; }
    const hash = await bcrypt.hash(password, 12);
    const now = new Date();
    const id = randomUUID();
    await db.insert(users as any).values({
      id,
      email,
      name,
      avatar: '',
      phone: '', bio: '', location: '', company: '', website: '',
      requireApproval: true,
      xAuth: { local: { passwordHash: hash } } as any,
      createdAt: now,
      updatedAt: now,
    } as any);
    return { ok: true };
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500); return { error: 'Registration failed' };
  }
});

fastify.post('/api/local-auth/verify', async (request, reply) => {
  try {
    const body = (request.body || {}) as any;
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) { reply.code(400); return { error: 'Email and password required' }; }
    const rows = await db.select().from(users).where(eq(users.email as any, email as any));
    if (!rows.length) { reply.code(401); return { error: 'Invalid credentials' }; }
    const user: any = rows[0];
    const saved = user?.xAuth?.local?.passwordHash;
    const ok = saved ? await bcrypt.compare(password, saved) : false;
    if (!ok) { reply.code(401); return { error: 'Invalid credentials' }; }
    // Minimal profile for NextAuth Credentials provider
    return { id: user.id, email: user.email, name: user.name || '' };
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500); return { error: 'Verification failed' };
  }
});

// LLM models endpoint with optional GPT-5 gating
fastify.get('/api/llm/models', async (request, reply) => {
  const enableGpt5 = String(process.env.ENABLE_GPT5 || '').toLowerCase() === 'true';
  const models = Object.entries(ModelConfigs)
    .filter(([name]) => {
      if (name.startsWith('gpt-5')) return enableGpt5;
      return true;
    })
    .map(([name, cfg]) => ({ name, provider: cfg.provider, maxTokens: cfg.maxTokens }));
  const providers = wsServer.getAvailableProviders();
  return { providers, models };
});

// === SOCIAL CORE (feature-flagged) ===
const SOCIAL_CORE = String(process.env.SOCIAL_CORE || '').trim() === '1';

// === Link Unfurl (OpenGraph/Twitter) ===
type UnfurlData = {
  url: string;
  host: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
};

const UNFURL_TTL_MS = 60 * 60 * 1000; // 1 hour
const unfurlCache: Map<string, { data: UnfurlData; expiresAt: number }> = new Map();

function isLikelyIp(hostname: string): boolean {
  // Very small guard: block localhost and obvious local IPs. Full DNS/IP checks intentionally avoided.
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  if (/^127\./.test(h)) return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(h)) return true;
  if (/^\[(::1|fc00:|fe80:)/.test(h)) return true;
  return false;
}

function absolutize(baseUrl: string, maybeRelative?: string | null): string | undefined {
  try {
    if (!maybeRelative) return undefined;
    const u = new URL(maybeRelative, baseUrl);
    return u.toString();
  } catch {
    return undefined;
  }
}

function extractMeta(html: string, baseUrl: string): UnfurlData {
  const out: UnfurlData = { url: baseUrl, host: new URL(baseUrl).host };
  const lower = html.toLowerCase();

  // Helper to find <meta ... property/name="key" ... content="value">
  const findMeta = (keyAttr: 'property' | 'name', key: string): string | undefined => {
    const re = new RegExp(`<meta[^>]*${keyAttr}=["']${key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}["'][^>]*>`, 'i');
    const m = lower.match(re);
    if (!m) return undefined;
    const tag = html.substring(m.index!, m.index! + m[0].length);
    const cm = tag.match(/content=["']([^"']+)["']/i);
    return cm ? cm[1].trim() : undefined;
  };

  const ogTitle = findMeta('property', 'og:title') || findMeta('name', 'twitter:title');
  const ogDesc = findMeta('property', 'og:description') || findMeta('name', 'description') || findMeta('name', 'twitter:description');
  const ogImage = findMeta('property', 'og:image') || findMeta('name', 'twitter:image');
  const ogSite = findMeta('property', 'og:site_name');

  if (ogTitle) out.title = ogTitle;
  if (ogDesc) out.description = ogDesc;
  if (ogImage) out.image = absolutize(baseUrl, ogImage);
  if (ogSite) out.siteName = ogSite;

  if (!out.title) {
    const tm = html.match(/<title[^>]*>([^<]{1,256})<\/title>/i);
    if (tm) out.title = tm[1].trim();
  }

  return out;
}

fastify.get('/api/unfurl', async (request, reply) => {
  try {
    const q = request.query as any;
    const urlInput = String(q.url || '').trim();
    if (!urlInput) { reply.code(400); return { error: 'url required' }; }

    let target: URL;
    try {
      target = new URL(urlInput);
    } catch {
      reply.code(400); return { error: 'invalid url' };
    }
    if (!(target.protocol === 'http:' || target.protocol === 'https:')) {
      reply.code(400); return { error: 'unsupported protocol' };
    }
    if (isLikelyIp(target.hostname)) {
      reply.code(400); return { error: 'blocked host' };
    }

    const now = Date.now();
    const cached = unfurlCache.get(target.toString());
    if (cached && cached.expiresAt > now) {
      return { ok: true, ...cached.data };
    }

    // Fetch with short timeout
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (SuperAgent Unfurl Bot)'
      },
      signal: ctrl.signal,
    } as any).catch((e: any) => {
      if (e?.name === 'AbortError') return null;
      throw e;
    });
    clearTimeout(t);
    if (!res || !res.ok) {
      reply.code(502); return { error: 'fetch failed' };
    }
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) {
      // Non-HTML: return a minimal card
      const data: UnfurlData = { url: target.toString(), host: target.host, title: target.toString() };
      unfurlCache.set(target.toString(), { data, expiresAt: now + UNFURL_TTL_MS });
      return { ok: true, ...data };
    }
    const html = await res.text();
    const data = extractMeta(html, target.toString());
    unfurlCache.set(target.toString(), { data, expiresAt: now + UNFURL_TTL_MS });
    return { ok: true, ...data };
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500); return { error: 'unfurl failed' };
  }
});

function getUserIdFromRequest(request: any): string {
  try {
    const hdr = String((request.headers['x-user-id'] as string) || '').trim();
    if (hdr) return hdr;
  } catch {}
  try {
    const cookie = String(request.headers['cookie'] || '');
    const m = cookie.match(/(?:^|;\s*)x-user-id=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch {}
  return DEFAULT_USER_ID;
}

async function getCanonicalUserIdFromRequest(request: any): Promise<string> {
  const raw = getUserIdFromRequest(request);
  return await normalizeUserId(raw);
}

async function getMyActorIdsForUser(uid: string): Promise<Set<string>> {
  const meId = await getOrCreateUserActor(uid);
  const actorRows = await db.select().from(actors);
  // Resolve the user's canonical id and email
  let userEmail: string | null = null;
  try {
    const urows = await db.select().from(users).where(eq(users.id as any, await normalizeUserId(uid) as any));
    if (urows && urows.length) userEmail = (urows[0] as any).email || null;
  } catch {}
  const meActor = (actorRows as any[]).find(a => a.id === meId);
  const ownerId = meActor?.ownerUserId || null;
  const ids = new Set<string>((actorRows as any[])
    .filter(a => a.type === 'user' && (
      (ownerId && a.ownerUserId === ownerId) ||
      (userEmail && a.ownerUserId === userEmail)
    ))
    .map(a => a.id));
  if (!ids.size) ids.add(meId);
  return ids;
}

async function normalizeUserId(userId: string): Promise<string> {
  try {
    if (userId && userId.includes('@')) {
      const rows = await db.select().from(users).where(eq(users.email as any, userId as any));
      if (rows && rows.length) return (rows[0] as any).id as string;
    }
  } catch {}
  return userId;
}

async function getOrCreateUserActor(userId: string): Promise<string> {
  const canonical = await normalizeUserId(userId);
  // Gather any actors tied to either the canonical id or the raw id (email)
  let existing: any[] = [];
  try {
    const all = await db.select().from(actors);
    existing = (all as any[]).filter(a => a.type === 'user' && (a.ownerUserId === canonical || a.ownerUserId === userId));
  } catch {}
  if (existing.length > 0) {
    // Prefer actor whose ownerUserId matches the canonical id; otherwise update the first to canonical
    const preferred = existing.find(a => a.ownerUserId === canonical) || existing[0];
    if (preferred.ownerUserId !== canonical) {
      try { await db.update(actors as any).set({ ownerUserId: canonical, updatedAt: new Date() } as any).where(eq(actors.id as any, preferred.id as any)); } catch {}
    }
    // Optionally mark any other duplicates as owned by canonical too (to avoid future dup lookups)
    for (const dup of existing) {
      if (dup.id !== preferred.id && dup.ownerUserId !== canonical) {
        try { await db.update(actors as any).set({ ownerUserId: canonical, updatedAt: new Date() } as any).where(eq(actors.id as any, dup.id as any)); } catch {}
      }
    }
    return preferred.id as string;
  }
  // None exists, create one with canonical owner id
  const id = randomUUID();
  try {
    await db.insert(actors as any).values({
      id,
      type: 'user',
      handle: null,
      displayName: null,
      avatarUrl: null,
      ownerUserId: canonical,
      orgId: null,
      capabilityTags: null,
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  } catch {}
  return id;
}

// Ensure there is a canonical Social Core actor for a given agentId
async function getOrCreateAgentActor(agentId: string): Promise<string> {
  try {
    const actorRows = await db.select().from(actors);
    const existing = (actorRows as any[]).find(a => a.type === 'agent' && a?.settings?.agentId === agentId);
    if (existing) return existing.id as string;
  } catch {}
  // Create a canonical agent actor owned by the agent creator, if available
  let ownerUserId: string | null = null;
  try {
    const arows = await db.select().from(agents).where(eq(agents.id as any, agentId as any));
    if (arows && arows.length) ownerUserId = (arows[0] as any).createdBy || null;
  } catch {}
  const id = randomUUID();
  try {
    await db.insert(actors as any).values({
      id,
      type: 'agent',
      handle: null,
      displayName: null,
      avatarUrl: null,
      ownerUserId,
      orgId: null,
      capabilityTags: null,
      settings: { agentId } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  } catch {}
  return id;
}

if (SOCIAL_CORE) {
  // Actors API (read-only/minimal create for current user)
  fastify.get('/api/actors/me', async (request, reply) => {
    const uid = getUserIdFromRequest(request);
    const actorId = await getOrCreateUserActor(uid);
    const rows = await db.select().from(actors).where(eq(actors.id as any, actorId));
    return rows && rows[0] ? rows[0] : { id: actorId, type: 'user', ownerUserId: uid };
  });

  fastify.get('/api/actors/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db.select().from(actors).where(eq(actors.id as any, id));
    if (!rows || rows.length === 0) { reply.code(404); return { error: 'Actor not found' }; }
    const a: any = rows[0];
    // Enrich user actors with profile name/avatar; enrich agent actors with agent name/avatar
    try {
      if (a.type === 'user' && a.ownerUserId) {
        // Canonicalize owner id if email
        let ownerId = String(a.ownerUserId);
        if (ownerId.includes && ownerId.includes('@')) {
          const urows = await db.select().from(users).where(eq(users.email as any, ownerId as any));
          if (urows && urows.length) ownerId = (urows[0] as any).id as string;
        }
        const uRows = await db.select().from(users).where(eq(users.id as any, ownerId as any));
        if (uRows && uRows.length) {
          const u: any = uRows[0];
          if (!a.displayName) a.displayName = u.name || u.email || a.handle || a.id;
          if (!a.avatarUrl && u.avatar) a.avatarUrl = normalizeAvatarUrl(u.avatar);
          a.ownerUserId = ownerId; // rewrite to canonical for consistency
        }
      } else if (a.type === 'agent') {
        const aid = a?.settings?.agentId as string | undefined;
        if (aid) {
          const agRows = await db.select().from(agents).where(eq(agents.id as any, aid as any));
          if (agRows && agRows.length) {
            const ag: any = agRows[0];
            if (!a.displayName) a.displayName = ag.name || a.displayName;
            if (!a.avatarUrl && ag.avatar) a.avatarUrl = normalizeAvatarUrl(ag.avatar);
          }
        }
      }
    } catch {}
    return a;
  });

  fastify.get('/api/actors', async (request, reply) => {
    try {
      const { handle, agentId } = request.query as any;
      if (handle) {
        const normalized = String(handle).trim().toLowerCase();
        const rows = await db.select().from(actors).where(eq((actors.handle as any), normalized as any));
        if (!rows || rows.length === 0) { reply.code(404); return { error: 'Actor not found' }; }
        return rows[0];
      }
      if (agentId) {
        const list = await db.select().from(actors).where(eq(actors.type as any, 'agent' as any));
        const found = (list as any[]).find(a => a?.settings && a.settings.agentId === String(agentId));
        if (!found) { reply.code(404); return { error: 'Actor not found' }; }
        return found;
      }

      const uid = getUserIdFromRequest(request);

      // Ensure agent actors exist for this user's agents
      const canonicalUid = await normalizeUserId(uid);
      const myAgents = await db.select().from(agents).where(eq(agents.createdBy as any, canonicalUid as any));
      const currentActors = await db.select().from(actors);
      const byAgentId: Record<string, any> = {};
      for (const a of currentActors as any[]) {
        const aid = a?.settings?.agentId as string | undefined;
        if (aid) byAgentId[aid] = a;
      }
      for (const ag of myAgents as any[]) {
        if (!byAgentId[ag.id]) {
          try {
            await db.insert(actors as any).values({
              id: randomUUID(),
              type: 'agent',
              handle: null,
              displayName: ag.name || null,
              avatarUrl: ag.avatar || null,
              ownerUserId: uid,
              orgId: ag.organizationId || null,
              capabilityTags: null,
              settings: { agentId: ag.id },
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any);
          } catch {}
        }
      }

      // Reselect after potential inserts
      const rows = await db.select().from(actors);

      // Enrich user actors with profile name/avatar
      const userRows = await db.select().from(users);
      const usersById: Record<string, any> = {};
      for (const u of userRows as any[]) usersById[u.id] = u;

      const agentsById: Record<string, any> = {};
      for (const ag of myAgents as any[]) agentsById[ag.id] = ag;

      // Collapse duplicate user-actors by ownerUserId (keep the most recently updated) and canonicalize owner emails->uuid
      const userGroups: Record<string, any[]> = {};
      for (const a of rows as any[]) {
        if (a.type === 'user' && a.ownerUserId) {
          const raw = String(a.ownerUserId);
          const key = raw.includes('@') ? (usersById[raw]?.id || raw) : raw;
          if (!userGroups[key]) userGroups[key] = [];
          const normalized = { ...a } as any;
          normalized.ownerUserId = key; // rewrite email owner to uuid for grouping/response consistency
          userGroups[key].push(normalized);
        }
      }
      const toDrop = new Set<string>();
      for (const key of Object.keys(userGroups)) {
        const list = userGroups[key].sort((x, y) => new Date(y.updatedAt || y.createdAt || 0).getTime() - new Date(x.updatedAt || x.createdAt || 0).getTime());
        // Keep list[0], drop others from response
        for (let i = 1; i < list.length; i++) toDrop.add(list[i].id);
      }

      const enriched = (Object.values(userGroups).flat().concat((rows as any[]).filter(a => !(a.type === 'user' && a.ownerUserId))))
        .filter(a => !toDrop.has(a.id))
        .map((a) => {
        const out = { ...a } as any;
        if (out.type === 'user' && out.ownerUserId && usersById[out.ownerUserId]) {
          const u = usersById[out.ownerUserId];
          if (!out.displayName) out.displayName = u.name || u.email || out.handle || out.id;
          if (!out.avatarUrl) out.avatarUrl = u.avatar || null;
        }
        if (out.type === 'agent') {
          const aid = out?.settings?.agentId as string | undefined;
          if (aid && agentsById[aid]) {
            const ag = agentsById[aid];
            if (!out.displayName) out.displayName = ag.name || out.displayName;
            if (!out.avatarUrl) out.avatarUrl = ag.avatar || out.avatarUrl;
          }
        }
        return out;
      });
      // Final filter: drop orphan user-actors (no valid owner), default-user, and entries without displayName
      const validUserIds = new Set(Object.keys(usersById));
      const sanitized = enriched.filter((a: any) => {
        if (a.type !== 'user') return true;
        if (!a.ownerUserId || a.ownerUserId === 'default-user' || a.displayName === null) return false;
        return validUserIds.has(String(a.ownerUserId));
      });
      return { actors: sanitized };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to list actors' };
    }
  });

  // Create/update actor (minimal; owner-only in future auth)
  fastify.post('/api/actors', async (request, reply) => {
    const body = (request.body || {}) as any;
    const id = randomUUID();
    const type = String(body.type || 'user');
    const handlePattern = /^[a-z0-9_]{2,32}$/;
    let handle: string | null = body.handle ? String(body.handle).trim().toLowerCase() : null;
    if (handle && !handlePattern.test(handle)) {
      reply.code(400);
      return { error: 'Invalid handle. Use 2-32 chars: a-z, 0-9, underscore' };
    }
    if (handle === '') handle = null;
    const displayName = body.displayName ? String(body.displayName) : null;
    const avatarUrl = body.avatarUrl ? String(body.avatarUrl) : null;
    const ownerUserId = body.ownerUserId ? String(body.ownerUserId) : null;
    const orgId = body.orgId ? String(body.orgId) : null;
    const capabilityTags = Array.isArray(body.capabilityTags)
      ? body.capabilityTags.map((t: any) => String(t).toLowerCase()).filter((t: string) => /^[a-z0-9:-]{1,32}$/.test(t)).slice(0, 32)
      : null;
    const settings = body.settings && typeof body.settings === 'object' ? body.settings : null;
    try {
      await db.insert(actors as any).values({
        id,
        type,
        handle,
        displayName,
        avatarUrl,
        ownerUserId,
        orgId,
        capabilityTags,
        settings,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      reply.code(201);
      return { id };
    } catch (e: any) {
      reply.code(400);
      return { error: 'Failed to create actor', details: e?.message };
    }
  });

  fastify.put('/api/actors/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;
    const patch: any = { updatedAt: new Date() };
    if (body.handle !== undefined) {
      const handlePattern = /^[a-z0-9_]{2,32}$/;
      const next = body.handle ? String(body.handle).trim().toLowerCase() : null;
      if (next && !handlePattern.test(next)) {
        reply.code(400);
        return { error: 'Invalid handle. Use 2-32 chars: a-z, 0-9, underscore' };
      }
      patch.handle = next;
    }
    for (const key of ['displayName','avatarUrl','ownerUserId','orgId']) {
      if (body[key] !== undefined) patch[key] = body[key] === null ? null : String(body[key]);
    }
    if (Array.isArray(body.capabilityTags)) {
      patch.capabilityTags = body.capabilityTags.map((t: any) => String(t).toLowerCase()).filter((t: string) => /^[a-z0-9:-]{1,32}$/.test(t)).slice(0, 32);
    }
    if (body.settings && typeof body.settings === 'object') patch.settings = body.settings;
    try {
      await db.update(actors as any).set(patch).where(eq(actors.id as any, id as any));
      return { ok: true };
    } catch (e: any) {
      reply.code(400);
      return { error: 'Failed to update actor', details: e?.message };
    }
  });

  // Rooms API (create/join)
  fastify.post('/api/rooms', async (request, reply) => {
    try {
      const body = (request.body || {}) as any;
      const kind = String(body.kind || 'dm');
      const title = body.title || null;
      const participantActorIds: string[] = Array.isArray(body.participants) ? body.participants : [];
      const agentIds: string[] = Array.isArray(body.agentIds) ? body.agentIds : [];
      const createdBy = await getOrCreateUserActor(getUserIdFromRequest(request));
      const id = randomUUID();
      await db.insert(rooms as any).values({
        id,
        kind,
        title,
        slug: null,
        createdByActorId: createdBy,
        orgId: null,
        isPublic: false,
        policyId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      const members = new Set<string>(participantActorIds.concat([createdBy]));
      // Map each agentId to an actor; if none exists, create one
      for (const aid of agentIds) {
        try {
          // Lookup an actor that represents this agent (type=agent, settings.agentId)
          let actorId: string | null = null;
          try {
            const rows = await db.select().from(actors).where(eq(actors.type as any, 'agent')).where(eq((actors.settings as any), (actors.settings as any)));
          } catch {}
          // Fallback: create a lightweight agent actor record
          const newId = randomUUID();
          await db.insert(actors as any).values({
            id: newId,
            type: 'agent',
            handle: null,
            displayName: null,
            avatarUrl: null,
            ownerUserId: null,
            orgId: null,
            capabilityTags: null,
            settings: { agentId: aid } as any,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any);
          members.add(newId);
        } catch {}
      }
      for (const actorId of members) {
        await db.insert(roomMembers as any).values({
          id: randomUUID(),
          roomId: id,
          actorId,
          role: actorId === createdBy ? 'owner' : 'member',
          joinsAt: new Date(),
          leavesAt: null,
          settings: null,
        } as any);
      }
      reply.code(201);
      return { id, kind, title, participants: Array.from(members) };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to create room' };
    }
  });

  // List rooms for current user (group rooms only; hide dm/agent_chat from Rooms list)
  fastify.get('/api/rooms', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request);
      // Include ALL user-actors for this owner to avoid missing rooms created with older actor ids
      const myActorIds = await getMyActorIdsForUser(uid);
      // Fetch memberships for all my actors (drizzle simple filter, fallback to app-layer filter)
      const allMemberships = await db.select().from(roomMembers);
      const memberships = (allMemberships as any[]).filter(m => myActorIds.has(m.actorId));
      const roomIds = Array.from(new Set(memberships.map((m: any) => m.roomId)));
      const rows = [] as any[];
      for (const rid of roomIds) {
        const r = await db.select().from(rooms).where(eq(rooms.id as any, rid));
        if (r?.length && String((r[0] as any).kind) === 'group') rows.push(r[0]);
      }
      return { rooms: rows };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to list rooms' };
    }
  });

  fastify.post('/api/rooms/:id/join', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const actorId = await getOrCreateUserActor(getUserIdFromRequest(request));
      // Upsert-like: try insert, ignore if exists
      try {
        await db.insert(roomMembers as any).values({
          id: randomUUID(),
          roomId: id,
          actorId,
          role: 'member',
          joinsAt: new Date(),
          leavesAt: null,
          settings: null,
        } as any);
      } catch {}
      return { ok: true };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to join room' };
    }
  });

  // Invite user or agent actor to a room
  fastify.post('/api/rooms/:id/invite', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as any;
      let actorId = (body.actorId ? String(body.actorId) : '').trim();
      const agentId = (body.agentId ? String(body.agentId) : '').trim();
      const role = String(body.role || 'member');
      if (!actorId && !agentId) { reply.code(400); return { error: 'actorId or agentId is required' }; }
      if (!actorId && agentId) {
        // Create a minimal agent actor for this agentId
        const newId = randomUUID();
        await db.insert(actors as any).values({
          id: newId,
          type: 'agent',
          handle: null,
          displayName: null,
          avatarUrl: null,
          ownerUserId: null,
          orgId: null,
          capabilityTags: null,
          settings: { agentId } as any,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
        actorId = newId;
      }
      try {
        await db.insert(roomMembers as any).values({
          id: randomUUID(),
          roomId: id,
          actorId,
          role,
          joinsAt: new Date(),
          leavesAt: null,
          settings: null,
        } as any);
      } catch {}
      return { ok: true };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to invite actor' };
    }
  });

  fastify.post('/api/rooms/:id/leave', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const actorId = await getOrCreateUserActor(getUserIdFromRequest(request));
      // Soft-leave by setting leavesAt
      try {
        await db.update(roomMembers as any)
          .set({ leavesAt: new Date() } as any)
          .where((rm: any) => (rm.roomId.eq ? rm.roomId.eq(id) : (rm as any)) && (rm.actorId.eq ? rm.actorId.eq(actorId) : (rm as any)));
      } catch {}
      return { ok: true };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to leave room' };
    }
  });

  fastify.get('/api/rooms/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const rows = await db.select().from(rooms).where(eq(rooms.id as any, id));
      if (!rows || rows.length === 0) { reply.code(404); return { error: 'Room not found' }; }
      const members = await db.select().from(roomMembers).where(eq(roomMembers.roomId as any, id));
      // Enrich DM room with a friendly title/avatar for the current viewer
      let dm: any = null;
      try {
        const uid = getUserIdFromRequest(request);
        const myActorIds = await getMyActorIdsForUser(uid);
        const otherActorId = (members as any[])
          .map((m) => m.actorId as string)
          .find((aid) => !myActorIds.has(aid));
        if ((rows[0] as any).kind === 'dm' && otherActorId) {
          const aRows = await db.select().from(actors).where(eq(actors.id as any, otherActorId as any));
          const act: any = aRows[0];
          if (act && act.ownerUserId) {
            const uRows = await db.select().from(users).where(eq(users.id, act.ownerUserId));
            if (uRows.length) {
              const u: any = uRows[0];
              dm = { title: u.name || u.email, avatar: u.avatar || null };
            }
          }
        }
        // For agent_chat, present the agent as the title/avatar for convenience
        if ((rows[0] as any).kind === 'agent_chat') {
          // Find the agent actor in members
          const actorRows = await db.select().from(actors);
          const agentActor = (actorRows as any[]).find(a => (members as any[]).some(m => m.actorId === a.id) && a.type === 'agent');
          if (agentActor && agentActor.settings?.agentId) {
            const agentRows = await db.select().from(agents).where(eq(agents.id as any, String(agentActor.settings.agentId)));
            const ag = (agentRows as any[])[0];
            if (ag) {
              dm = { title: ag.name, avatar: ag.avatar || null };
            }
          }
        }
      } catch {}
      return { room: rows[0], members, ...(dm ? { dm } : {}) };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to fetch room' };
    }
  });

  // Create or get a per-user agent chat room (private 1:1: user <-> agent)
  fastify.post('/api/rooms/agent', async (request, reply) => {
    try {
      const body = (request.body || {}) as any;
      const agentId = String(body.agentId || '').trim();
      if (!agentId) { reply.code(400); return { error: 'agentId required' }; }

      const uid = await normalizeUserId(getUserIdFromRequest(request));
      if (!uid) { reply.code(401); return { error: 'Unauthorized' }; }

      // Resolve user actor
      const myActorId = await getOrCreateUserActor(uid);
      // Resolve agent actor (one per agent)
      const agentActorId = await getOrCreateAgentActor(agentId);

      // Verify user has access (owner or accepted agent_access)
      const allAgents = await db.select().from(agents);
      const ag = (allAgents as any[]).find(a => a.id === agentId);
      if (!ag) { reply.code(404); return { error: 'Agent not found' }; }
      let hasAccess = ag.createdBy === uid;
      if (!hasAccess) {
        const rels = await db.select().from(relationships);
        hasAccess = (rels as any[]).some(r => r.kind === 'agent_access' && (r.metadata?.status || 'accepted') === 'accepted' && r.fromActorId === myActorId && r.toActorId === agentActorId);
      }
      if (!hasAccess) { reply.code(403); return { error: 'Forbidden' }; }

      // Find existing room with exactly these two participants and kind='agent_chat'
      const allRooms = await db.select().from(rooms);
      const allMembers = await db.select().from(roomMembers);
      let room = (allRooms as any[]).find(r => r.kind === 'agent_chat' && (allMembers as any[]).some(m => m.roomId === r.id && m.actorId === myActorId) && (allMembers as any[]).some(m => m.roomId === r.id && m.actorId === agentActorId));

      if (!room) {
        // Create room
        const roomId = agentId + ':' + uid; // deterministic per-user+agent
        const created = {
          id: roomId,
          kind: 'agent_chat',
          title: null,
          slug: null,
          createdByActorId: myActorId,
          orgId: null,
          isPublic: false,
          policyId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any;
        try { await db.insert(rooms as any).values(created); } catch {}
        try {
          await db.insert(roomMembers as any).values({ id: randomUUID(), roomId, actorId: myActorId, role: 'member', joinsAt: new Date(), leavesAt: null, settings: null } as any);
        } catch {}
        try {
          await db.insert(roomMembers as any).values({ id: randomUUID(), roomId, actorId: agentActorId, role: 'member', joinsAt: new Date(), leavesAt: null, settings: null } as any);
        } catch {}
        room = created;
      }

      return { roomId: room.id };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to create/get agent room' };
    }
  });

  // Messages: list recent for a room with simple pagination
  fastify.get('/api/rooms/:id/messages', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { before, limit } = (request.query || {}) as any;
      const uid = getUserIdFromRequest(request);
      const myActorIds = await getMyActorIdsForUser(uid);

      // authorize: must be member of room (no agentId fallback)
      const allMembers = await db.select().from(roomMembers);
      const isMember = (allMembers as any[]).some(m => m.roomId === id && myActorIds.has(m.actorId));
      if (!isMember) { reply.code(403); return { error: 'Forbidden' }; }

      // fetch messages for conversation id == room id
      const all = await db.select().from(messages);
      let list = (all as any[]).filter(m => m.conversationId === id);
      list = list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (before) {
        const t = new Date(String(before));
        list = list.filter(m => new Date(m.createdAt).getTime() < t.getTime());
      }
      const max = Math.min(100, Number(limit) || 50);
      const page = list.slice(0, max);

      // Enrich with author identity so the client can label correctly after reloads
      try {
        // Load actors/users/agents for attribution
        const actorRows = await db.select().from(actors);
        const userRows = await db.select().from(users);
        const agentRows = await db.select().from(agents);
        const actorById: Record<string, any> = {};
        for (const a of actorRows as any[]) actorById[String(a.id)] = a;
        const userById: Record<string, any> = {};
        const userByEmail: Record<string, any> = {};
        for (const u of userRows as any[]) {
          userById[String(u.id)] = u;
          if (u.email) userByEmail[String(u.email)] = u;
        }
        const agentById: Record<string, any> = {};
        for (const ag of agentRows as any[]) agentById[String(ag.id)] = ag;

        const enriched = page.map((m: any) => {
          const out: any = { ...m };
          const a = actorById[String(m.authorId)] as any | undefined;
          if (a) {
            if (a.type === 'user') {
              // ownerUserId may be uuid or legacy email
              const owner = a.ownerUserId && (userById[String(a.ownerUserId)] || userByEmail[String(a.ownerUserId)]);
              out.authorUserId = owner?.id || a.ownerUserId;
              out.authorName = owner?.name || a.displayName || a.handle || 'User';
              const avatar = owner?.avatar || a.avatarUrl || null;
              out.authorAvatar = normalizeAvatarUrl(avatar) || undefined;
            } else if (a.type === 'agent') {
              // Link to agent record via settings.agentId when present
              const agentId = a?.settings?.agentId as string | undefined;
              const ag = (agentId && agentById[agentId]) || undefined;
              out.authorName = ag?.name || a.displayName || 'Agent';
              const avatar = ag?.avatar || a.avatarUrl || null;
              out.authorAvatar = normalizeAvatarUrl(avatar) || undefined;
            }
          } else {
            // Fallback: if authorId is an agentId (not an actor id), map directly
            const ag = agentById[String(m.authorId)];
            if (ag) {
              out.authorName = ag.name || 'Agent';
              out.authorAvatar = normalizeAvatarUrl(ag.avatar || null) || undefined;
            }
          }
          return out;
        });
        return { messages: enriched };
      } catch {
        // Fallback to raw page on any enrichment error
        return { messages: page };
      }
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to list messages' };
    }
  });

  // Policies API (set and resolve)
  fastify.post('/api/policies', async (request, reply) => {
    try {
      const body = (request.body || {}) as any;
      const scope = String(body.scope || '').trim(); // room|actor|org
      const scopeId = String(body.scopeId || '').trim();
      if (!scope || !scopeId) { reply.code(400); return { error: 'scope and scopeId are required' }; }
      const record: any = {
        id: randomUUID(),
        scope,
        scopeId,
        requireApproval: (body.requireApproval || 'ask') as string,
        toolLimits: body.toolLimits ?? null,
        autoReplyThreshold: body.autoReplyThreshold ?? '0.70',
        safety: body.safety ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // Upsert-like: delete existing then insert
      try {
        await db.delete(policies as any).where(
          (policies.scope as any).eq ? (policies.scope as any).eq(scope) : (eq as any)(policies.scope as any, scope)
        ).where(
          (policies.scopeId as any).eq ? (policies.scopeId as any).eq(scopeId) : (eq as any)(policies.scopeId as any, scopeId)
        );
      } catch {}
      await db.insert(policies as any).values(record);
      reply.code(201);
      return { ok: true };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to set policy' };
    }
  });

  fastify.get('/api/policies/resolve', async (request, reply) => {
    try {
      const q = request.query as any;
      const roomId = q.roomId ? String(q.roomId) : undefined;
      const actorId = q.actorId ? String(q.actorId) : undefined;
      const orgId = q.orgId ? String(q.orgId) : undefined;
      const result = { requireApproval: 'ask', toolLimits: null as any, scope: 'default', scopeId: null as any };
      // precedence: room > actor > org
      if (roomId) {
        const pr = await db.select().from(policies).where(eq(policies.scope as any, 'room')).where(eq(policies.scopeId as any, roomId));
        if (pr?.length) { Object.assign(result, pr[0], { scope: 'room' }); return result; }
      }
      if (actorId) {
        const pa = await db.select().from(policies).where(eq(policies.scope as any, 'actor')).where(eq(policies.scopeId as any, actorId));
        if (pa?.length) { Object.assign(result, pa[0], { scope: 'actor' }); return result; }
      }
      if (orgId) {
        const po = await db.select().from(policies).where(eq(policies.scope as any, 'org')).where(eq(policies.scopeId as any, orgId));
        if (po?.length) { Object.assign(result, po[0], { scope: 'org' }); return result; }
      }
      return result;
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to resolve policy' };
    }
  });

  // Relationships: follow/unfollow/list (also used for agent access handshake via kind='agent_access')
  fastify.post('/api/relationships', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request);
      const meId = await getOrCreateUserActor(uid);
      const body = (request.body || {}) as any;
      let toActorId = String(body.toActorId || '').trim();
      const agentIdForAccess = String(body.agentId || '').trim();
      const kind = String(body.kind || 'follow').trim();
      request.server.log.info({ uid, meId, toActorId, kind }, 'relationships.create: incoming');
      if (!toActorId && agentIdForAccess) {
        toActorId = await getOrCreateAgentActor(agentIdForAccess);
      }
      if (!toActorId) { reply.code(400); return { error: 'toActorId or agentId required' }; }
      if (!['follow','block','mute','agent_access'].includes(kind)) { reply.code(400); return { error: 'invalid kind' }; }
      if (toActorId === meId) { reply.code(400); return { error: 'Cannot create relationship with yourself' }; }
      // Determine approval requirement
      const targetRows = await db.select().from(actors).where(eq(actors.id as any, toActorId as any));
      const target = (targetRows && targetRows[0]) as any;
      let status: 'pending' | 'accepted' = 'accepted';
      if (kind === 'agent_access') {
        // Agent access requires owner approval unless requester owns the agent
        let ownerUserId: string | undefined = undefined;
        try {
          const agId = target?.settings?.agentId || agentIdForAccess || null;
          if (agId) {
            const arows = await db.select().from(agents).where(eq(agents.id as any, agId as any));
            if (arows && arows.length) ownerUserId = (arows[0] as any).createdBy as string;
          }
        } catch {}
        const myCanonical = await normalizeUserId(uid);
        status = ownerUserId && myCanonical === ownerUserId ? 'accepted' : 'pending';
      } else {
        status = (target?.type === 'user' ? 'pending' : 'accepted');
      }
      const metadata = { status } as any;
      // Avoid duplicate edges
      const existing = await db.select().from(relationships as any).where(
        and(
          eq(relationships.fromActorId as any, meId as any) as any,
          eq(relationships.toActorId as any, toActorId as any) as any,
          eq(relationships.kind as any, kind as any) as any,
        ) as any
      );
      request.server.log.info({ existingCount: existing.length, targetType: target?.type, metadata }, 'relationships.create: dedupe check');
      if (!existing.length) {
        await db.insert(relationships as any).values({
          id: randomUUID(),
          fromActorId: meId,
          toActorId,
          kind,
          metadata,
          createdAt: new Date(),
        } as any);
        request.server.log.info({ meId, toActorId, kind, metadata }, 'relationships.create: inserted');
      }
      reply.code(201);
      return { ok: true };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to create relationship' };
    }
  });

  fastify.delete('/api/relationships', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request);
      const meId = await getOrCreateUserActor(uid);
      const { toActorId, kind } = (request.query || {}) as any;
      const toId = String(toActorId || '').trim();
      const k = String(kind || 'follow').trim();
      if (!toId) { reply.code(400); return { error: 'toActorId required' }; }
      await db.delete(relationships as any).where(
        and(
          eq(relationships.fromActorId as any, meId as any) as any,
          eq(relationships.toActorId as any, toId as any) as any,
          eq(relationships.kind as any, k as any) as any,
        ) as any
      );
      // Note: drizzle lacks composite delete chaining in this simplified call; refetch then filter
      // Safer approach: filter in app layer when selecting, but delete requires where. Keeping minimal.
      return { ok: true };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to delete relationship' };
    }
  });

  fastify.get('/api/relationships', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request);
      const { direction = 'outgoing', kind = 'follow', status } = (request.query || {}) as any;
      const all = await db.select().from(relationships);
      const myActorIds = await getMyActorIdsForUser(uid);
      const canonicalUid = await normalizeUserId(uid);

      // For agent_access, we need to know if the target agent belongs to the current user
      // Build maps: actor(agent) -> agentId, agentId -> createdBy
      const actorRows = await db.select().from(actors);
      const agentRows = await db.select().from(agents);
      const userRows = await db.select().from(users);
      const agentIdByActorId: Record<string, string> = {};
      for (const a of actorRows as any[]) {
        if (a.type === 'agent' && a?.settings?.agentId) agentIdByActorId[a.id] = String(a.settings.agentId);
      }
      const agentOwnerByAgentId: Record<string, string> = {};
      for (const ag of agentRows as any[]) agentOwnerByAgentId[ag.id] = String(ag.createdBy || '');
      const isAgentOwnedByMeByActorId = (actorId: string): boolean => {
        const aid = agentIdByActorId[actorId];
        if (!aid) return false;
        const owner = agentOwnerByAgentId[aid];
        return !!owner && (owner === canonicalUid || owner === uid);
      };

      const filtered = (all as any[]).filter(r => {
        if (r.kind !== kind) return false;
        let dirOk = false;
        if (direction === 'incoming') {
          if (kind === 'agent_access') {
            // Incoming agent access: toActorId is an agent actor; treat as incoming if that agent belongs to me
            dirOk = isAgentOwnedByMeByActorId(r.toActorId);
          } else {
            dirOk = myActorIds.has(r.toActorId);
          }
        } else {
          // outgoing
          dirOk = myActorIds.has(r.fromActorId);
        }
        if (!dirOk) return false;
        if (status) return (r.metadata?.status || 'accepted') === status;
        return true;
      });

      // Enrich response with actor details (name/avatar) for convenience
      const actorById: Record<string, any> = {};
      for (const a of actorRows as any[]) actorById[a.id] = a;
      const usersById: Record<string, any> = {};
      const usersByEmail: Record<string, any> = {};
      for (const u of userRows as any[]) { usersById[u.id] = u; if (u.email) usersByEmail[String(u.email)] = u; }
      const agentById: Record<string, any> = {};
      for (const ag of agentRows as any[]) agentById[ag.id] = ag;

      const toUploads = (v?: string | null) => {
        if (!v || typeof v !== 'string') return null;
        const idx = v.indexOf('/uploads/');
        return idx !== -1 ? v.slice(idx) : v;
      };
      const enrichActor = (actorId: string) => {
        const a = actorById[actorId];
        if (!a) return { id: actorId, type: 'unknown', displayName: actorId, avatarUrl: null };
        const out: any = { id: a.id, type: a.type, displayName: a.displayName || null, avatarUrl: a.avatarUrl || null };
        if (a.type === 'user') {
          let owner = a.ownerUserId as string | undefined;
          if (owner && owner.includes && owner.includes('@')) owner = usersByEmail[String(owner)]?.id || owner;
          const u = owner ? usersById[String(owner)] : undefined;
          if (!out.displayName) out.displayName = u?.name || u?.email || a.handle || a.id;
          if (!out.avatarUrl) out.avatarUrl = toUploads(u?.avatar || null);
        } else if (a.type === 'agent') {
          const aid = a?.settings?.agentId as string | undefined;
          const ag = aid ? agentById[aid] : undefined;
          if (!out.displayName) out.displayName = ag?.name || out.displayName || a.handle || a.id;
          if (!out.avatarUrl) out.avatarUrl = toUploads(ag?.avatar || a.avatarUrl || null);
        }
        return out;
      };

      const enriched = filtered.map((r: any) => ({
        ...r,
        fromActor: enrichActor(r.fromActorId),
        toActor: enrichActor(r.toActorId),
      }));

      request.server.log.info({ uid, direction, kind, status, count: enriched.length }, 'relationships.list');
      return { relationships: enriched };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to list relationships' };
    }
  });

  // Approve a pending incoming follow (create reciprocal accepted edge and update current)
  fastify.post('/api/relationships/approve', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request);
      const { fromActorId, kind = 'follow' } = (request.body || {}) as any;
      const fromId = String(fromActorId || '').trim();
      request.server.log.info({ uid, fromId, kind }, 'relationships.approve: incoming');
      if (!fromId) { reply.code(400); return { error: 'fromActorId required' }; }
      // Update existing to accepted
      const all = await db.select().from(relationships);
      const myActorIds = await getMyActorIdsForUser(uid);

      if (kind === 'agent_access') {
        // Find the pending edge requester(user-actor) -> agent-actor where agent belongs to me
        const actorRows = await db.select().from(actors);
        const agentRows = await db.select().from(agents);
        const agentIdByActorId: Record<string, string> = {};
        for (const a of actorRows as any[]) {
          if (a.type === 'agent' && a?.settings?.agentId) agentIdByActorId[a.id] = String(a.settings.agentId);
        }
        const ownerOfAgentActor = (agentActorId: string): string | undefined => {
          const aid = agentIdByActorId[agentActorId];
          if (!aid) return undefined;
          const ag = (agentRows as any[]).find(x => x.id === aid) as any;
          return ag?.createdBy as string | undefined;
        };
        const myCanonical = await normalizeUserId(uid);
        const candidates = (all as any[]).filter(r => r.kind === 'agent_access' && r.fromActorId === fromId);
        let updated = 0;
        for (const r of candidates) {
          const owner = ownerOfAgentActor(r.toActorId);
          const isMine = !!owner && (owner === myCanonical || owner === uid);
          if (!isMine) continue;
          try {
            await db.update(relationships as any).set({ metadata: { status: 'accepted' } as any }).where(eq(relationships.id as any, r.id as any));
            updated++;
          } catch (e) {
            request.server.log.error({ err: (e as any)?.message }, 'relationships.approve(agent_access): update failed');
          }
        }
        request.server.log.info({ candidateCount: candidates.length, updated }, 'relationships.approve(agent_access): applied');
        // No reciprocal edge needed for agent_access
        return { ok: true };
      } else {
        const pending = (all as any[]).find(r => r.kind === kind && r.fromActorId === fromId && myActorIds.has(r.toActorId));
        request.server.log.info({ hasPending: !!pending, myActorCount: myActorIds.size }, 'relationships.approve: pending check');
        if (pending) {
          try {
            await db.update(relationships as any).set({ metadata: { status: 'accepted' } as any }).where(eq(relationships.id as any, pending.id as any));
          } catch {}
        }
        // Create reciprocal if missing (for follow)
        const myPrimary = Array.from(myActorIds)[0];
        const reciprocal = (all as any[]).find(r => r.kind === kind && myActorIds.has(r.fromActorId) && r.toActorId === fromId);
        if (!reciprocal) {
          await db.insert(relationships as any).values({
            id: randomUUID(),
            fromActorId: myPrimary,
            toActorId: fromId,
            kind,
            metadata: { status: 'accepted' } as any,
            createdAt: new Date(),
          } as any);
          request.server.log.info({ myPrimary, toActorId: fromId }, 'relationships.approve: reciprocal created');
        }
        return { ok: true };
      }
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to approve relationship' };
    }
  });

  // Reject a pending incoming relationship (e.g., agent_access)
  fastify.post('/api/relationships/reject', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request);
      const { fromActorId, kind = 'follow' } = (request.body || {}) as any;
      const fromId = String(fromActorId || '').trim();
      if (!fromId) { reply.code(400); return { error: 'fromActorId required' }; }
      const myActorIds = await getMyActorIdsForUser(uid);
      const all = await db.select().from(relationships);
      const pending = (all as any[]).find(r => r.kind === kind && r.fromActorId === fromId && myActorIds.has(r.toActorId));
      if (pending) {
        try {
          await db.update(relationships as any).set({ metadata: { status: 'rejected' } as any }).where(eq(relationships.id as any, pending.id as any));
        } catch {}
      }
      return { ok: true };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to reject relationship' };
    }
  });

  // Agents accessible to current user: owned + agent_access accepted
  fastify.get('/api/agents/accessible', async (request, reply) => {
    try {
      const uidHeader = String((request.headers['x-user-id'] as string) || '').trim();
      if (!uidHeader) return { agents: [] };
      const canonical = await normalizeUserId(uidHeader);
      const allAgents = await db.select().from(agents);
      const allActors = await db.select().from(actors);
      const allRels = await db.select().from(relationships);
      const myActorIds = await getMyActorIdsForUser(uidHeader);

      // Owned agents
      const owned = (allAgents as any[]).filter(a => a.createdBy === canonical || a.createdBy === uidHeader);

      // Map agentId -> agent actor
      const agentActorByAgentId: Record<string, any> = {};
      for (const ac of allActors as any[]) {
        const aid = ac?.settings?.agentId;
        if (ac.type === 'agent' && typeof aid === 'string') agentActorByAgentId[aid] = ac;
      }

      // Accepted agent_access relationships
      const accepted = (allRels as any[]).filter(r => r.kind === 'agent_access' && (r.metadata?.status || 'accepted') === 'accepted' && myActorIds.has(r.fromActorId));
      const accessibleAgentIds = new Set<string>();
      for (const rel of accepted) {
        const ac = (allActors as any[]).find(a => a.id === rel.toActorId);
        const aid = ac?.settings?.agentId;
        if (aid) accessibleAgentIds.add(aid);
      }
      const shared = (allAgents as any[]).filter(a => accessibleAgentIds.has(a.id));

      const out = [...owned, ...shared].map((a: any) => {
        const o: any = { ...a };
        if (o.avatar && typeof o.avatar === 'string') {
          const idx = o.avatar.indexOf('/uploads/');
          if (idx !== -1) o.avatar = o.avatar.slice(idx);
        }
        return o;
      });
      return { agents: out };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to list accessible agents' };
    }
  });
  fastify.get('/api/connections', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request);
      const all = await db.select().from(relationships);
      const actorRows = await db.select().from(actors);
      const userRows = await db.select().from(users);
      const myActorIds = await getMyActorIdsForUser(uid);

      // Accepted edges only
      const isAccepted = (r: any) => (r?.metadata?.status || 'accepted') === 'accepted';
      const outgoing = (all as any[]).filter(r => r.kind === 'follow' && isAccepted(r) && myActorIds.has(r.fromActorId));
      const incoming = (all as any[]).filter(r => r.kind === 'follow' && isAccepted(r) && myActorIds.has(r.toActorId));

      // Owner lookup helpers with canonicalization (convert email owners to users.id)
      const actorById: Record<string, any> = {};
      for (const a of actorRows as any[]) actorById[a.id] = a;
      const usersByEmail: Record<string, string> = {};
      for (const u of userRows as any[]) { if (u?.email) usersByEmail[String(u.email)] = String(u.id); }
      const ownerOf = (actorId: string) => {
        const raw = actorById[actorId]?.ownerUserId as string | undefined;
        if (!raw) return undefined;
        if (raw.includes && raw.includes('@')) return usersByEmail[raw] || raw; // resolve email->uuid if possible
        return raw;
      };

      // Determine my owner id
      let myOwnerId: string | undefined;
      for (const id of myActorIds) {
        const own = ownerOf(id);
        if (own) { myOwnerId = own; break; }
      }
      if (!myOwnerId) {
        try { myOwnerId = await normalizeUserId(uid); } catch {}
      }

      // Build set of owners who have an accepted edge to any of my actors
      const incomingOwnerSet = new Set<string>();
      for (const i of incoming) {
        const owner = ownerOf(i.fromActorId);
        if (owner && owner !== myOwnerId) incomingOwnerSet.add(owner);
      }

      // Choose a representative actor per owner (most recently updated), canonicalizing owner ids
      const ownerToActors: Record<string, any[]> = {};
      for (const a of actorRows as any[]) {
        if (a.type === 'user' && a.ownerUserId) {
          const key = (String(a.ownerUserId).includes('@') ? (usersByEmail[String(a.ownerUserId)] || String(a.ownerUserId)) : String(a.ownerUserId));
          if (!ownerToActors[key]) ownerToActors[key] = [];
          ownerToActors[key].push(a);
        }
      }
      const ownerRepActorId: Record<string, string> = {};
      for (const [owner, list] of Object.entries(ownerToActors)) {
        const sorted = list.sort((x: any, y: any) => new Date(y.updatedAt || y.createdAt || 0).getTime() - new Date(x.updatedAt || x.createdAt || 0).getTime());
        ownerRepActorId[owner] = sorted[0]?.id;
      }

      const mutualRepIds = new Set<string>();
      for (const o of outgoing) {
        const tgtOwner = ownerOf(o.toActorId);
        if (tgtOwner && tgtOwner !== myOwnerId && incomingOwnerSet.has(tgtOwner)) {
          const repId = ownerRepActorId[tgtOwner] || o.toActorId;
          mutualRepIds.add(repId);
        }
      }

      let connections = (actorRows as any[]).filter(a => mutualRepIds.has(a.id));

      // Enrich user actors with profile name/avatar
      const usersById: Record<string, any> = {};
      for (const u of userRows as any[]) usersById[u.id] = u;
      connections = connections.map((a: any) => {
        const out = { ...a };
        if (out.type === 'user' && out.ownerUserId && usersById[out.ownerUserId]) {
          const u = usersById[out.ownerUserId];
          if (!out.displayName) out.displayName = u.name || u.email || out.handle || out.id;
          if (!out.avatarUrl) out.avatarUrl = u.avatar || null;
        }
        return out;
      });
      // Filter out any orphan user-actors without a resolvable owner (prevents raw UUID rows like ca47f8...)
      connections = connections.filter((a: any) => {
        if (a.type !== 'user') return true;
        const own = ownerOf(a.id);
        return !!own && own !== myOwnerId;
      });
      request.server.log.info({ uid, outgoingCount: outgoing.length, incomingCount: incoming.length, mutualCount: connections.length }, 'connections.list');
      return { connections };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to list connections' };
    }
  });

  // Create or open a DM room between current user and target user actor
  fastify.post('/api/rooms/dm', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request);
      const { targetActorId } = (request.body || {}) as any;
      const toId = String(targetActorId || '').trim();
      if (!toId) { reply.code(400); return { error: 'targetActorId required' }; }

      const actorRows = await db.select().from(actors);
      const actorById: Record<string, any> = {};
      for (const a of actorRows as any[]) actorById[a.id] = a;
      const targetActor = actorById[toId];
      if (!targetActor || targetActor.type !== 'user') { reply.code(404); return { error: 'Target user actor not found' }; }

      // Gather my user-actors and target owner's user-actors
      const myActorIds = await getMyActorIdsForUser(uid);
      const targetOwnerId = String(targetActor.ownerUserId || '');
      const targetActors = (actorRows as any[]).filter(a => a.type === 'user' && a.ownerUserId === targetOwnerId).map(a => a.id as string);
      if (!targetActors.length) { reply.code(404); return { error: 'Target owner has no user actors' }; }

      // Require mutual accepted follow
      const rels = await db.select().from(relationships);
      const isAccepted = (r: any) => (r?.metadata?.status || 'accepted') === 'accepted';
      const a2b = (rels as any[]).some(r => r.kind === 'follow' && isAccepted(r) && myActorIds.has(r.fromActorId) && targetActors.includes(r.toActorId));
      const b2a = (rels as any[]).some(r => r.kind === 'follow' && isAccepted(r) && targetActors.includes(r.fromActorId) && myActorIds.has(r.toActorId));
      if (!a2b || !b2a) { reply.code(403); return { error: 'Not connected' }; }

      // Choose primary user-actor for me and target (most recently updated)
      const userActorsById = (actorRows as any[]).filter(a => a.type === 'user');
      const pickPrimary = (ids: Set<string> | string[]) => {
        const set = Array.isArray(ids) ? ids : Array.from(ids);
        const list = userActorsById.filter(a => set.includes(a.id))
          .sort((x: any, y: any) => new Date(y.updatedAt || y.createdAt || 0).getTime() - new Date(x.updatedAt || x.createdAt || 0).getTime());
        return list[0]?.id as string;
      };
      const myPrimary = pickPrimary(myActorIds);
      const theirPrimary = pickPrimary(targetActors);
      if (!myPrimary || !theirPrimary) { reply.code(500); return { error: 'Failed to resolve participants' }; }

      // Get-or-create DM room with exactly these two participants (order-agnostic)
      const allRooms = await db.select().from(rooms);
      const allMembers = await db.select().from(roomMembers);
      const byRoom: Record<string, string[]> = {};
      for (const m of allMembers as any[]) {
        const arr = byRoom[m.roomId] || (byRoom[m.roomId] = []);
        arr.push(m.actorId);
      }
      let existingRoomId: string | null = null;
      for (const r of allRooms as any[]) {
        if (r.kind !== 'dm') continue;
        const members = (byRoom[r.id] || []).sort();
        const want = [myPrimary, theirPrimary].sort();
        if (members.length === 2 && members[0] === want[0] && members[1] === want[1]) { existingRoomId = r.id; break; }
      }

      if (!existingRoomId) {
        const roomId = randomUUID();
        await db.insert(rooms as any).values({
          id: roomId,
          kind: 'dm',
          title: null,
          slug: null,
          createdByActorId: myPrimary,
          orgId: null,
          isPublic: false,
          policyId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
        await db.insert(roomMembers as any).values([
          { id: randomUUID(), roomId, actorId: myPrimary, role: 'member', joinsAt: new Date(), leavesAt: null, settings: null } as any,
          { id: randomUUID(), roomId, actorId: theirPrimary, role: 'member', joinsAt: new Date(), leavesAt: null, settings: null } as any,
        ] as any);
        request.server.log.info({ roomId, myPrimary, theirPrimary }, 'rooms.dm.created');
        return { roomId };
      } else {
        request.server.log.info({ roomId: existingRoomId, myPrimary, theirPrimary }, 'rooms.dm.existing');
        return { roomId: existingRoomId };
      }
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500); return { error: 'Failed to create/open DM' };
    }
  });
}

// === Interest summary + embedding (admin/dev endpoint) ===
fastify.post('/api/agents/:id/rebuild-interest', async (request, reply) => {
  try {
    const agentId = (request.params as any).id as string;
    const rows = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!rows.length) { reply.code(404); return { error: 'Agent not found' }; }
    const a: any = rows[0];

    // Build a concise interest summary from description + instructions + existing interests/expertise
    const seed = [
      a.name ? `Name: ${a.name}` : '',
      a.description ? `Description: ${a.description}` : '',
      Array.isArray(a.interests) ? `Interests: ${(a.interests as string[]).join(', ')}` : '',
      Array.isArray(a.expertise) ? `Expertise: ${(a.expertise as string[]).join(', ')}` : '',
      typeof a.instructions === 'string' ? `Instructions:\n${a.instructions.slice(0, 1200)}` : '',
    ].filter(Boolean).join('\n');

    const router = new LLMRouter();
    const sys = 'You are a system that writes a short interest summary for an AI agent. 3-6 sentences. No markdown.';
    const res = await router.complete('openai', [
      { role: 'system', content: sys },
      { role: 'user', content: seed },
    ], { model: 'gpt-4.1-mini', temperature: 0.2, maxTokens: 256, stream: false } as any);
    const summary = (res as any).content || 'General-purpose assistant.';

    // Generate embedding using our embedding service
    const { embeddingService } = await import('./memory/embedding-service.js');
    const vec = await embeddingService.generateEmbedding(summary);

    await db.update(agents).set({ interestSummary: summary, interestEmbedding: vec as any, updatedAt: new Date() }).where(eq(agents.id, agentId));
    return { ok: true, interestSummary: summary, embeddingDims: Array.isArray(vec) ? vec.length : 0 };
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500);
    return { error: 'Failed to rebuild interest summary' };
  }
});

// === X (Twitter) OAuth and Integration Endpoints ===
const X_SCOPES: string[] = [
  'users.read',
  'tweet.read',
  'tweet.write',
  'list.read',
  'list.write',
  'dm.read',
  'dm.write',
  'like.read',
  'like.write',
  'follows.read',
  'follows.write',
  'bookmark.read',
  'bookmark.write',
  'space.read',
  'offline.access',
];

fastify.get('/api/integrations/x/start', async (request, reply) => {
  try {
    const { userId } = (request.query as any) || {};
    const uid = userId || DEFAULT_USER_ID;
    const redirectUri = process.env.X_REDIRECT_URI || `${(request.headers['x-forwarded-proto'] as string) || 'http'}://${request.headers.host}/api/integrations/x/callback`;
    const { url } = xService.createAuthStart(uid, redirectUri, X_SCOPES);
    return { url, scopes: X_SCOPES };
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500);
    return { error: 'Failed to start X OAuth' };
  }
});

fastify.get('/api/integrations/x/callback', async (request, reply) => {
  try {
    const { code, state } = (request.query as any) || {};
    if (!code || !state) {
      reply.code(400);
      return { error: 'Missing code/state' };
    }
    const redirectUri = process.env.X_REDIRECT_URI || `${(request.headers['x-forwarded-proto'] as string) || 'http'}://${request.headers.host}/api/integrations/x/callback`;
    const { userId, tokens } = await xService.exchangeCode(code, state, redirectUri);
    // Persist minimal tokens in DB user (optional mirror of file store)
    try {
      await db.update(users).set({ xAuth: tokens as any, updatedAt: new Date() }).where(eq(users.id, userId));
    } catch {}
    // Redirect back to integrations page
    reply.header('Content-Type', 'text/html');
    const dest = (process.env.NEXTAUTH_URL || 'http://localhost:3000') + '/integrations';
    return `<!doctype html><html><body>
<script>
try { if (window.opener) { window.opener.postMessage({ type: 'x-connected' }, '*'); } } catch (e) {}
setTimeout(function(){ window.location.replace('${dest}'); }, 50);
</script>
Connected to X. Redirecting…
</body></html>`;
  } catch (e: any) {
    request.server.log.error(e);
    // If user refreshes or provider retries, state may be missing; provide a gentle redirect instead of 500
    if (String(e?.message || '').includes('Invalid state')) {
      reply.header('Content-Type', 'text/html');
      const dest = (process.env.NEXTAUTH_URL || 'http://localhost:3000') + '/integrations';
      return `<!doctype html><html><body>
<script>
try { if (window.opener) { window.opener.postMessage({ type: 'x-connected' }, '*'); } } catch (e) {}
setTimeout(function(){ window.location.replace('${dest}'); }, 50);
</script>
Already handled. Redirecting…
</body></html>`;
    }
    reply.code(500);
    return { error: 'X OAuth callback failed' };
  }
});

fastify.get('/api/integrations/x/status', async (request, reply) => {
  try {
    const { userId } = (request.query as any) || {};
    const uid = userId || DEFAULT_USER_ID;
    // Prefer in-memory/file store; fallback to DB mirror
    let tokens = xService.getSaved(uid);
    if (!tokens) {
      try {
        const rows = await db.select().from(users).where(eq(users.id, uid));
        if (rows.length && (rows[0] as any).xAuth) tokens = (rows[0] as any).xAuth;
      } catch {}
    }
    return { connected: !!tokens?.access_token, user: tokens?.user || null, scope: tokens?.scope || null };
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500);
    return { error: 'Failed to get X status' };
  }
});

fastify.post('/api/integrations/x/disconnect', async (request, reply) => {
  try {
    const { userId } = (request.body as any) || {};
    const uid = userId || DEFAULT_USER_ID;
    xService.disconnect(uid);
    try { await db.update(users).set({ xAuth: null as any, updatedAt: new Date() }).where(eq(users.id, uid)); } catch {}
    return { ok: true };
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500);
    return { error: 'Failed to disconnect X' };
  }
});

// Upload avatar (multipart/form-data, field name: file)
fastify.post('/api/uploads/avatar', async (request, reply) => {
  try {
    const file = await (request as any).file();
    if (!file) {
      reply.code(400);
      return { error: 'No file uploaded' };
    }
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
    if (file.mimetype && !allowed.has(file.mimetype)) {
      reply.code(400);
      return { error: 'Unsupported file type' };
    }
    const orig = file.filename || 'upload';
    const ext = orig.includes('.') ? '.' + orig.split('.').pop() : '';
    const name = `${randomUUID()}${ext}`;
    const dest = createWriteStream(join(uploadsDir, name));
    const pump = promisify(pipeline);
    await pump(file.file, dest);
    return { url: `/uploads/${name}` };
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500);
    return { error: 'Upload failed' };
  }
});

// Upload agent avatar and update agent record
fastify.post('/api/agents/:id/avatar', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const file = await (request as any).file();
    if (!file) {
      reply.code(400);
      return { error: 'No file uploaded' };
    }
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
    if (file.mimetype && !allowed.has(file.mimetype)) {
      reply.code(400);
      return { error: 'Unsupported file type' };
    }
    const orig = file.filename || 'upload';
    const ext = orig.includes('.') ? '.' + orig.split('.').pop() : '';
    const name = `agent-${id}-${randomUUID()}${ext}`;
    const dest = createWriteStream(join(uploadsDir, name));
    const pump = promisify(pipeline);
    await pump(file.file, dest);
    
    // Update agent record with new avatar URL
    const avatarUrl = `/uploads/${name}`;
    await db.update(agents).set({ 
      avatar: avatarUrl,
      updatedAt: new Date()
    }).where(eq(agents.id, id));
    
    return { url: avatarUrl };
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500);
    return { error: 'Upload failed' };
  }
});

// Conversations API
fastify.get('/api/conversations', async (request, reply) => {
  try {
    // Scope single-agent items by current user (canonicalized)
    const uidHeader = String((request.headers['x-user-id'] as string) || '').trim();
    const canonicalUid = await normalizeUserId(uidHeader);
    // Get all conversations (legacy multi-agent rooms have no owner)
    const rooms = await db.select().from(conversations);
    // Only include this user's agents for single-agent entries
    const agentList = uidHeader ? (await db.select().from(agents)).filter((a: any) => a.createdBy === canonicalUid || a.createdBy === uidHeader) : [] as any[];
    
    const result = [];
    
    // Add multi-agent rooms
    for (const room of rooms) {
      const participantIds = Array.isArray(room.participants) ? room.participants : [];
      const participantNames = [];
      
      for (const pid of participantIds) {
        const agent = agentList.find(a => a.id === pid);
        if (agent) participantNames.push(agent.name);
      }
      
      result.push({
        id: room.id,
        name: room.title || participantNames.join(' & ') || 'Multi-Agent Room',
        type: 'multi-agent' as const,
        status: 'online' as const,
        lastMessage: `${participantNames.length} participants`,
        timestamp: room.updatedAt ? new Date(room.updatedAt).toLocaleDateString() : '',
        avatarUrl: undefined,
        participants: participantIds,
      });
    }
    
    // Add individual agent conversations
    for (const agent of agentList) {
      result.push({
        id: agent.id,
        name: agent.name,
        type: 'agent' as const,
        status: 'online' as const,
        lastMessage: agent.description || '',
        timestamp: '',
        avatarUrl: agent.avatar || undefined,
      });
    }
    
    return { conversations: result };
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return { conversations: [] };
  }
});

// Delete conversation endpoint
fastify.delete('/api/conversations/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    
    // Check if conversation exists
    const existingConv = await db.select().from(conversations).where(eq(conversations.id, id));
    if (existingConv.length === 0) {
      reply.code(404);
      return { error: 'Conversation not found' };
    }
    
    // Delete the conversation
    await db.delete(conversations).where(eq(conversations.id, id));
    
    return { success: true, message: 'Conversation deleted successfully' };
  } catch (error) {
    console.error('Error deleting conversation:', error);
    reply.code(500);
    return { error: 'Failed to delete conversation' };
  }
});

  // Delete Social Core room and memberships
  fastify.delete('/api/rooms/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      try { await db.delete(roomMembers as any).where(eq(roomMembers.roomId as any, id as any)); } catch {}
      try { await db.delete(rooms as any).where(eq(rooms.id as any, id as any)); } catch {}
      return { ok: true };
    } catch (e: any) {
      request.server.log.error(e);
      reply.code(500);
      return { error: 'Failed to delete room' };
    }
  });

// Agents API
fastify.get('/api/agents', async (request, reply) => {
  // List only agents created by the current signed-in user; if no user, return empty
  const uidHeader = String((request.headers['x-user-id'] as string) || '').trim();
  if (!uidHeader) return { agents: [] };
  // Some environments showed where() not applying as expected; defensively filter in app layer
  const all = await db.select().from(agents);
  // Support GitHub sessions where x-user-id is an email, but agents.createdBy may be users.id
  let altId: string | null = null;
  try {
    if (uidHeader.includes('@')) {
      const urows = await db.select().from(users).where(eq(users.email as any, uidHeader as any));
      if (urows && urows.length) altId = (urows[0] as any).id as string;
    }
  } catch {}
  const mine = (all as any[]).filter(a => a.createdBy === uidHeader || (altId && a.createdBy === altId));
  const sanitized = mine.map((a: any) => {
    const out = { ...a } as any;
    if (out.avatar && typeof out.avatar === 'string') {
      const idx = out.avatar.indexOf('/uploads/');
      if (idx !== -1) out.avatar = out.avatar.slice(idx);
    }
    return out;
  });
  return { agents: sanitized };
});

fastify.get('/api/agents/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const uidHeader = String((request.headers['x-user-id'] as string) || '').trim();
  const rows = await db.select().from(agents).where(eq(agents.id, id));
  if (rows.length === 0) {
    reply.code(404);
    return { error: 'Agent not found' };
  }
  const a: any = rows[0];
  // Allow either direct match or email->users.id match
  let ok = !!uidHeader && a.createdBy === uidHeader;
  if (!ok && uidHeader && uidHeader.includes('@')) {
    try {
      const urows = await db.select().from(users).where(eq(users.email as any, uidHeader as any));
      if (urows && urows.length) ok = a.createdBy === (urows[0] as any).id;
    } catch {}
  }
  if (!ok) {
    reply.code(404);
    return { error: 'Agent not found' };
  }
  if (a.avatar && typeof a.avatar === 'string') {
    const idx = a.avatar.indexOf('/uploads/');
    if (idx !== -1) a.avatar = a.avatar.slice(idx);
  }
  return a;
});

fastify.post('/api/agents', async (request, reply) => {
  const body = request.body as any;
  const id = randomUUID();
  const now = new Date();
  const creator = getUserIdFromRequest(request);
  if (!creator) { reply.code(401); return { error: 'Unauthorized' }; }
  const record = {
    id,
    name: body?.name || 'Untitled Agent',
    description: body?.description || null,
    instructions: body?.instructions || 'You are a helpful assistant.',
    avatar: normalizeAvatarUrl(body?.avatar) || null,
    organizationId: body?.organizationId || 'default-org',
    createdBy: creator,
    defaultModel: body?.defaultModel || 'gpt-4o',
    defaultProvider: body?.defaultProvider || 'openai',
    autoExecuteTools: body?.autoExecuteTools !== undefined ? !!body.autoExecuteTools : false,
    isActive: body?.isActive !== undefined ? !!body.isActive : true,
    createdAt: now,
    updatedAt: now,
    maxTokensPerRequest: body?.maxTokensPerRequest ?? 4000,
    maxToolCallsPerRun: body?.maxToolCallsPerRun ?? 10,
    maxRunTimeSeconds: body?.maxRunTimeSeconds ?? 300,
  } as any;
  await db.insert(agents).values(record);
  reply.code(201);
  return { id };
});

fastify.put('/api/agents/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as any;
  const patch: any = {
    updatedAt: new Date(),
  };
  for (const key of [
    'name',
    'description',
    'instructions',
    'avatar',
    'defaultModel',
    'defaultProvider',
    'autoExecuteTools',
    'isActive',
    'maxTokensPerRequest',
    'maxToolCallsPerRun',
    'maxRunTimeSeconds',
  ]) {
    if (body?.[key] !== undefined) patch[key] = body[key];
  }
  if (patch.avatar !== undefined) {
    patch.avatar = normalizeAvatarUrl(patch.avatar);
  }
  const res = await db.update(agents).set(patch).where(eq(agents.id, id));
  return { ok: true };
});

// Profile API
const DEFAULT_USER_ID = 'default-user';

fastify.get('/api/profile', async (request, reply) => {
  try {
    const rawUid = getUserIdFromRequest(request);
    const canonicalUid = await normalizeUserId(rawUid);
    const isEmail = (v: string) => typeof v === 'string' && v.includes('@');

    // Require an explicit user id; don't auto-create users without an email
    if (!rawUid || rawUid === DEFAULT_USER_ID) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }

    // Prefer selecting by canonical id (UUID). If canonical is still an email, fall back to email lookup
    let userRows: any[] = [];
    if (canonicalUid && !isEmail(canonicalUid)) {
      userRows = await db.select().from(users).where(eq(users.id as any, canonicalUid as any));
    }
    if (!userRows.length && isEmail(rawUid)) {
      userRows = await db.select().from(users).where(eq(users.email as any, rawUid as any));
    }
    if (!userRows.length) {
      // Only create a new user when we have a valid email
      if (isEmail(rawUid)) {
        const now = new Date();
        const id = randomUUID();
        await db.insert(users).values({
          id,
          email: rawUid,
          name: '',
          avatar: '',
          phone: '',
          bio: '',
          location: '',
          company: '',
          website: '',
          createdAt: now,
          updatedAt: now,
        } as any);
        userRows = await db.select().from(users).where(eq(users.id as any, id as any));
      } else {
        reply.code(404);
        return { error: 'User not found' };
      }
    }
    return userRows[0];
  } catch (e: any) {
    request.server.log.error(e);
    reply.code(500);
    return { error: 'Failed to load profile' };
  }
});

fastify.put('/api/profile', async (request, reply) => {
  const body = request.body as any;
  const rawUid = getUserIdFromRequest(request);
  const canonicalUid = await normalizeUserId(rawUid);
  
  // Validate and sanitize input
  const patch: any = {
    updatedAt: new Date(),
  };
  
  // Only update allowed fields
  for (const key of ['name', 'email', 'avatar', 'phone', 'bio', 'location', 'company', 'website']) {
    if (body?.[key] !== undefined) {
      patch[key] = body[key];
    }
  }
  
  // Ensure user exists using canonical id or email
  let existing: any[] = [];
  if (canonicalUid && !canonicalUid.includes('@')) {
    existing = await db.select().from(users).where(eq(users.id as any, canonicalUid as any));
  }
  if (!existing.length && rawUid && rawUid.includes('@')) {
    existing = await db.select().from(users).where(eq(users.email as any, rawUid as any));
  }
  if (!existing.length) {
    const now = new Date();
    const email = typeof body?.email === 'string' && body.email ? body.email : (rawUid && rawUid.includes('@') ? rawUid : '');
    const newId = randomUUID();
    await db.insert(users).values({
      id: newId,
      email,
      name: body?.name || '',
      avatar: body?.avatar || '',
      phone: body?.phone || '',
      bio: body?.bio || '',
      location: body?.location || '',
      company: body?.company || '',
      website: body?.website || '',
      createdAt: now,
      updatedAt: now,
    } as any);
  } else {
    const targetId = existing[0].id as string;
    await db.update(users).set(patch).where(eq(users.id as any, targetId as any));
  }
  
  return { ok: true };
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001');
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    
    console.log(`
🚀 SuperAgent Backend Server Started!
   
   HTTP:      http://localhost:${port}
   WebSocket: ws://localhost:${port}/ws
   Health:    http://localhost:${port}/health
   API Info:  http://localhost:${port}/api/info
   
   Available LLM Providers: ${wsServer.getAvailableProviders().join(', ')}
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (signal: string) => {
  try {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    await fastify.close();
  } catch (e) {}
  try { await closeDbPool(); } catch {}
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
