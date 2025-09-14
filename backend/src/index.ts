// Load environment variables FIRST before any other imports
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '../.env') });

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { WebSocketServer } from './websocket/server.js';
import { randomUUID } from 'crypto';
import { db, agents, users, conversations } from './db/index.js';
import { LLMRouter, ModelConfigs } from './llm/providers.js';
import { eq, isNull } from 'drizzle-orm';
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
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-domain.com'] 
    : true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
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
    // Get all conversations (multi-agent rooms)
    const rooms = await db.select().from(conversations);
    
    // Get all agents for single-agent conversations
    const agentList = await db.select().from(agents);
    
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

// Agents API
fastify.get('/api/agents', async (request, reply) => {
  // List agents; seed a default agent if none exist
  const list = await db.select().from(agents);
  if (list.length === 0) {
    const id = randomUUID();
    await db.insert(agents).values({
      id,
      name: 'GPT-4o Assistant',
      description: 'General-purpose assistant',
      instructions: 'You are a helpful multi-tool assistant. Keep responses concise. When users reference @tools like @terminal or @serpapi, interpret them as tool instructions. Propose clean one-line terminal commands only when necessary.',
      organizationId: 'default-org',
      createdBy: 'system',
      defaultModel: 'gpt-4o',
      defaultProvider: 'openai',
      isActive: true,
    });
  }
  const results = await db.select().from(agents);
  return { agents: results };
});

fastify.get('/api/agents/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const rows = await db.select().from(agents).where(eq(agents.id, id));
  if (rows.length === 0) {
    reply.code(404);
    return { error: 'Agent not found' };
  }
  return rows[0];
});

fastify.post('/api/agents', async (request, reply) => {
  const body = request.body as any;
  const id = randomUUID();
  const now = new Date();
  const record = {
    id,
    name: body?.name || 'Untitled Agent',
    description: body?.description || null,
    instructions: body?.instructions || 'You are a helpful assistant.',
    avatar: normalizeAvatarUrl(body?.avatar) || null,
    organizationId: body?.organizationId || 'default-org',
    createdBy: body?.createdBy || 'system',
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
  // For now, use a default user - in production this would use authentication
  let rows = await db.select().from(users).where(eq(users.id, DEFAULT_USER_ID));
  
  if (rows.length === 0) {
    // Create default user if doesn't exist
    const now = new Date();
    await db.insert(users).values({
      id: DEFAULT_USER_ID,
      email: 'user@example.com',
      name: '',
      avatar: '',
      phone: '',
      bio: '',
      location: '',
      company: '',
      website: '',
      createdAt: now,
      updatedAt: now,
    });
    rows = await db.select().from(users).where(eq(users.id, DEFAULT_USER_ID));
  }
  
  return rows[0];
});

fastify.put('/api/profile', async (request, reply) => {
  const body = request.body as any;
  
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
  
  // Ensure user exists
  const existing = await db.select().from(users).where(eq(users.id, DEFAULT_USER_ID));
  if (existing.length === 0) {
    const now = new Date();
    await db.insert(users).values({
      id: DEFAULT_USER_ID,
      email: body?.email || 'user@example.com',
      name: body?.name || '',
      avatar: body?.avatar || '',
      phone: body?.phone || '',
      bio: body?.bio || '',
      location: body?.location || '',
      company: body?.company || '',
      website: body?.website || '',
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db.update(users).set(patch).where(eq(users.id, DEFAULT_USER_ID));
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
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await fastify.close();
  process.exit(0);
});

start();
