import { FastifyInstance } from 'fastify';
// import { SocketStream } from '@fastify/websocket';
import { 
  JSONRPCRequest, 
  JSONRPCResponse, 
  JSONRPCNotification,
  JSONRPCError,
  ErrorCodes,
  MessageCreateRequest,
  MessageDeltaNotification,
  RunStatusNotification,
  TypingStartRequest,
  TypingStopRequest,
  RoomTypingNotification
} from '../types/protocol.js';
import { LLMRouter, ModelConfigs, SupportedModel } from '../llm/providers.js';
import { ParticipationRouter } from './participation-router.js';
import { terminalService } from '../terminal/terminal-service.js';
import { serpapiService } from '../tools/serpapi-service.js';
import { elevenLabsService } from '../tools/elevenlabs-service.js';
import { memoryService } from '../memory/memory-service.js';
import { db, users, agents, roomReads } from '../db/index.js';
import * as DBSchema from '../db/schema.js';
import { and, eq, gt, inArray, ne, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { webScraperService } from '../tools/web-scraper-service.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { ToolRunner } from '../tools/tool-runner.js';
import { Tool } from '../tools/tool-contract.js';
import { xService } from '../tools/x-service.js';
import { WebSocketBus } from './bus.js';
import { RoomRegistry } from './room-registry.js';
import { handleXSearch, handleXLists, handleXListTweets, handleXTweet, handleXDm } from '../handlers/tools/x.js';
import { handleSerpSearch, handleSerpImages, handleSerpRun } from '../handlers/tools/serpapi.js';
import { AgentOrchestrator } from '../agents/agent-orchestrator.js';
import { buildUserProfileContext } from '../agents/context-builder.js';
import { setLastLinks, getLastLinks } from './link-cache.js';
import { createResults, getResults, getLatestResultId } from './results-registry.js';
import { codeSearch } from '../tools/code-search.js';

export class WebSocketServer {
  private llmRouter: LLMRouter;
  private connections: Map<string, any> = new Map();
  private rooms: Map<string, Set<string>> = new Map();
  private connectionUserId: Map<string, string> = new Map();
  private lastLinks: Map<string, string[]> = new Map();
  private roomLastLinks: Map<string, string[]> = new Map();
  private toolRegistry: ToolRegistry = new ToolRegistry();
  private toolRunner: ToolRunner;
  // Track invited agents per room (roomId -> Set<agentId>)
  private roomAgents: Map<string, Set<string>> = new Map();
  private participationRouter: ParticipationRouter = new ParticipationRouter(5);
  // Turn-taking state
  private roomSpeaking: Set<string> = new Set();
  private roomQueue: Map<string, string[]> = new Map();
  private roomCooldownUntil: Map<string, Map<string, number>> = new Map();
  private roomTyping: Map<string, Map<string, number>> = new Map(); // roomId -> actorId -> expiresAtMs
  private roomReceipts: Map<string, Map<string, Set<string>>> = new Map(); // roomId -> messageId -> Set<actorId>
  private lastUnreadBroadcast: Map<string, Map<string, number>> = new Map(); // roomId -> actorId -> unreadCount
  private connectionActorId: Map<string, string> = new Map();
  private actorConnections: Map<string, Set<string>> = new Map();
  private bus: WebSocketBus;
  private roomsRegistry: RoomRegistry;
  private orchestrator: AgentOrchestrator;

  // Normalize assistant final text to avoid accidental duplication like "Hello!Hello!"
  private normalizeFinalText(text: string): string {
    try {
      const s = String(text || '');
      const t = s.trim();
      if (!t) return s;
      if (t.length % 2 === 0) {
        const mid = t.length / 2;
        const a = t.slice(0, mid);
        const b = t.slice(mid);
        if (a === b) return a;
      }
      return s;
    } catch { return text; }
  }

  constructor() {
    this.llmRouter = new LLMRouter();
    this.bus = new WebSocketBus(this.connections, this.rooms);
    this.roomsRegistry = new RoomRegistry(this.rooms, this.connectionUserId, this.roomAgents);
    this.orchestrator = new AgentOrchestrator({ llmRouter: this.llmRouter });
    // Register tools
    this.toolRegistry.register(new Tool({
      name: 'web',
      functions: {
        scrape: {
          name: 'scrape',
          execute: async (args, ctx) => {
            const url = String(args.url || '')
            if (!url) throw new Error('url is required')
            return await webScraperService.scrape(url)
          },
        },
      },
    }));
    this.toolRegistry.register(new Tool({
      name: 'serpapi',
      functions: {
        run: {
          name: 'run',
          description: 'Run a SerpAPI engine (e.g., google_news, images, finance)',
          tags: ['search','news','web','images'],
          synonyms: ['news.search','web.search','image.search'],
          execute: async (args, ctx) => {
            return await serpapiService.run(String(args.engine || ''), String(args.query || ''), args.extra || undefined)
          },
        },
      },
    }));
    this.toolRegistry.register(new Tool({
      name: 'code',
      functions: {
        search: {
          name: 'search',
          description: 'Search codebase for a pattern (ripgrep fallback to grep)',
          tags: ['code','search','grep'],
          approval: 'ask',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              path: { type: 'string' },
              glob: { type: 'string' },
              maxResults: { type: 'number' },
              caseInsensitive: { type: 'boolean' },
              regex: { type: 'boolean' },
            },
            required: ['pattern']
          },
          execute: async (args, ctx) => {
            const out = await codeSearch({
              pattern: String(args.pattern || ''),
              path: args.path ? String(args.path) : undefined,
              glob: args.glob ? String(args.glob) : undefined,
              maxResults: args.maxResults ? Number(args.maxResults) : undefined,
              caseInsensitive: !!args.caseInsensitive,
              regex: !!args.regex,
            })
            const header = `Code search for "${args.pattern}": ${out.results.length} hit(s) using ${out.used}`
            const md = [header]
              .concat(out.results.slice(0, 50).map(r => `- ${r.file}:${r.line} — ${r.text}`))
              .join('\n')
            return { ok: true, results: out.results, markdown: md }
          },
        },
      },
    }));
    this.toolRegistry.register(new Tool({
      name: 'x',
      functions: {
        tweet: {
          name: 'tweet',
          description: 'Post a tweet (side-effectful)',
          tags: ['post','x','publish'],
          sideEffects: true,
          approval: 'ask',
          execute: async (args, ctx) => {
            const text = String(args.text || '').trim();
            if (!text) throw new Error('text is required');
            const userId = this.connectionUserId.get(ctx.connectionId) || 'default-user';
            return await xService.postTweet(userId, text);
          },
        },
        dm: {
          name: 'dm',
          description: 'Send a direct message on X (side-effectful)',
          tags: ['dm','x','message'],
          sideEffects: true,
          approval: 'ask',
          execute: async (args, ctx) => {
            const to = String(args.recipientId || '').trim();
            const text = String(args.text || '').trim();
            if (!to || !text) throw new Error('recipientId and text are required');
            const userId = this.connectionUserId.get(ctx.connectionId) || 'default-user';
            return await xService.sendDm(userId, to, text);
          },
        },
        search: {
          name: 'search',
          description: 'Search recent tweets for a query',
          tags: ['search','x','social'],
          synonyms: ['x.search','twitter search'],
          execute: async (args, ctx) => {
            const q = String(args.query || '').trim();
            const max = Number(args.max || 10);
            if (!q) throw new Error('query is required');
            const userId = this.connectionUserId.get(ctx.connectionId) || 'default-user';
            return await xService.searchRecent(userId, q, max);
          },
        },
        lists: {
          name: 'lists',
          description: 'List owned Twitter lists for a handle or current user',
          tags: ['x','lists'],
          execute: async (args, ctx) => {
            const userId = this.connectionUserId.get(ctx.connectionId) || 'default-user';
            const handle = String(args.username || '').trim();
            if (handle) {
              return await xService.getOwnedListsByUsername(userId, handle);
            }
            return await xService.getOwnedLists(userId);
          },
        },
        listTweets: {
          name: 'listTweets',
          description: 'Fetch tweets from a list',
          tags: ['x','lists','search'],
          execute: async (args, ctx) => {
            const listId = String(args.listId || '').trim();
            const max = Number(args.max || 20);
            if (!listId) throw new Error('listId is required');
            const userId = this.connectionUserId.get(ctx.connectionId) || 'default-user';
            return await xService.getListTweets(userId, listId, max);
          },
        },
      },
    }));
    this.toolRegistry.register(new Tool({
      name: 'elevenlabs',
      functions: {
        tts: {
          name: 'tts',
          execute: async (args, ctx) => {
            const text = String(args.text || '')
            const voiceId = String(args.voiceId || 'Antoni')
            const format = (String(args.format || 'mp3') === 'wav' ? 'wav' : 'mp3') as 'mp3' | 'wav'
            return await elevenLabsService.tts(text, voiceId, format)
          },
        },
      },
    }));
    // Finance tools (quote/news)
    this.toolRegistry.register(new Tool({
      name: 'finance',
      functions: {
        getQuote: {
          name: 'getQuote',
          execute: async (args, ctx) => {
            const symbol = String(args.symbol || '').trim();
            if (!symbol) throw new Error('symbol is required');
            return await serpapiService.run('google_finance', symbol, undefined);
          },
        },
        getNews: {
          name: 'getNews',
          execute: async (args, ctx) => {
            const symbol = String(args.symbol || '').trim();
            if (!symbol) throw new Error('symbol is required');
            const max = Number(args.max || 5);
            return await serpapiService.run('google_news', symbol, { num: max });
          },
        },
      },
    }));
    this.toolRunner = new ToolRunner(this.toolRegistry, {
      onCall: (roomId, runId, toolCallId, tool, func, args) => this.bus.broadcastToolCall(roomId, runId, toolCallId, tool, func, args),
      onResult: (roomId, runId, toolCallId, result) => this.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: true }),
      onError: (roomId, runId, toolCallId, error) => this.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: false, error: String(error?.message || error) }),
    });
  }

  private async canonicalizeUserId(userId: string): Promise<string> {
    try {
      const uid = String(userId || '').trim();
      if (uid.includes('@')) {
        const rows = await db.select().from(users).where(eq(users.email as any, uid as any));
        if (rows.length && rows[0]?.id) return String(rows[0].id);
      }
      return uid;
    } catch {
      return userId;
    }
  }

  private async safeCanonicalizeActorId(identifier: string): Promise<string | undefined> {
    try {
      return await this.canonicalizeActorId(identifier);
    } catch {
      return undefined;
    }
  }

  private async resolvePrimaryUserActorId(userId: string): Promise<string> {
    try {
      const canonical = await this.canonicalizeUserId(userId);
      const rows = await db.select().from(DBSchema.actors).where(eq(DBSchema.actors.ownerUserId as any, canonical as any));
      const users = (rows as any[]).filter(a => a.type === 'user');
      const sorted = users.sort((x: any, y: any) => new Date(y.updatedAt || y.createdAt || 0).getTime() - new Date(x.updatedAt || x.createdAt || 0).getTime());
      if (sorted.length) return sorted[0].id as string;
    } catch {}
    return userId;
  }

  private async canonicalizeActorId(identifier: string): Promise<string> {
    const raw = String(identifier || '').trim();
    if (!raw) return raw;
    try {
      const match = await db
        .select({ id: DBSchema.actors.id })
        .from(DBSchema.actors)
        .where(eq(DBSchema.actors.id as any, raw as any))
        .limit(1);
      if (match.length) return raw;
    } catch {}
    try {
      const canonicalUserId = await this.canonicalizeUserId(raw);
      return await this.resolvePrimaryUserActorId(canonicalUserId);
    } catch {}
    return raw;
  }

  private registerActorConnection(connectionId: string, actorId: string) {
    const current = this.connectionActorId.get(connectionId);
    if (current && current !== actorId) this.unregisterActorConnection(connectionId, current);
    this.connectionActorId.set(connectionId, actorId);
    if (!this.actorConnections.has(actorId)) this.actorConnections.set(actorId, new Set());
    this.actorConnections.get(actorId)!.add(connectionId);
  }

  private unregisterActorConnection(connectionId: string, actorId?: string) {
    const resolved = actorId || this.connectionActorId.get(connectionId);
    if (!resolved) return;
    const set = this.actorConnections.get(resolved);
    if (set) {
      set.delete(connectionId);
      if (set.size === 0) this.actorConnections.delete(resolved);
    }
    this.connectionActorId.delete(connectionId);
  }

  private async getMemberActorIds(roomId: string): Promise<string[]> {
    try {
      const members = await db.select().from(DBSchema.roomMembers).where(eq(DBSchema.roomMembers.roomId as any, roomId as any));
      return members.map((m: any) => String(m.actorId)).filter(Boolean);
    } catch (error) {
      console.error('[getMemberActorIds] failed', error);
      return [];
    }
  }

  private async recordMessageRead(roomId: string, actorId: string, messageId: string, readAt: Date): Promise<void> {
    try {
      const resolvedActorId = await this.canonicalizeActorId(actorId);
      await db
        .insert(roomReads)
        .values({
          roomId,
          actorId: resolvedActorId,
          lastReadMessageId: messageId,
          lastReadAt: readAt,
          updatedAt: readAt,
        } as any)
        .onConflictDoUpdate({
          target: [roomReads.roomId, roomReads.actorId],
          set: {
            lastReadMessageId: messageId,
            lastReadAt: readAt,
            updatedAt: readAt,
          },
        });
    } catch (error) {
      console.error('[recordMessageRead] failed', error);
    }
  }

  private async computeUnreadCounts(roomId: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    try {
      const messages = await db
        .select({
          id: DBSchema.messages.id,
          authorId: DBSchema.messages.authorId,
          createdAt: DBSchema.messages.createdAt,
        })
        .from(DBSchema.messages)
        .where(eq(DBSchema.messages.conversationId as any, roomId as any));

      const timestamps = new Map<string, Date>();
      for (const row of messages as any[]) {
        const id = String(row.id);
        const ts = row.createdAt ? new Date(row.createdAt) : undefined;
        if (!ts) continue;
        timestamps.set(id, ts);
      }

      if (!timestamps.size) return counts;

      const actorIds = new Set<string>();
      for (const row of messages as any[]) {
        const authorId = String(row.authorId || '');
        if (authorId) actorIds.add(authorId);
      }

      // Include any known room members even if they haven't posted yet
      try {
        const memberActorIds = await this.getMemberActorIds(roomId);
        for (const id of memberActorIds) {
          if (id) actorIds.add(String(id));
        }
      } catch (error) {
        console.error('[computeUnreadCounts] failed to load room members', error);
      }

      const reads = await db
        .select()
        .from(roomReads)
        .where(eq(roomReads.roomId, roomId));

      const messageReadByActor = new Map<string, Set<string>>();
      for (const row of reads as any[]) {
        const actorId = await this.canonicalizeActorId(String(row.actorId || ''));
        if (!actorId) continue;
        actorIds.add(actorId);
        const msgId = row.lastReadMessageId ? String(row.lastReadMessageId) : null;
        const readAt = row.lastReadAt ? new Date(row.lastReadAt) : null;
        if (msgId && timestamps.has(msgId)) {
          if (!messageReadByActor.has(actorId)) messageReadByActor.set(actorId, new Set());
          messageReadByActor.get(actorId)!.add(msgId);
        } else if (readAt) {
          for (const [id, ts] of timestamps.entries()) {
            if (ts <= readAt) {
              if (!messageReadByActor.has(actorId)) messageReadByActor.set(actorId, new Set());
              messageReadByActor.get(actorId)!.add(id);
            }
          }
        }
      }

      for (const actorId of actorIds) {
        let unread = 0;
        const readSet = messageReadByActor.get(actorId) || new Set();
        for (const msg of messages as any[]) {
          if (String(msg.authorId || '') === actorId) continue;
          const id = String(msg.id);
          if (!readSet.has(id)) unread += 1;
        }
        counts.set(actorId, unread);
      }
    } catch (error) {
      console.error('[computeUnreadCounts] failed', error);
    }

    return counts;
  }

  private broadcastUnread(roomId: string, counts: Map<string, number>) {
    const cached = this.lastUnreadBroadcast.get(roomId) || new Map();
    for (const [actorId, count] of counts.entries()) {
      const previous = cached.get(actorId);
      if (previous === count) continue;
      cached.set(actorId, count);
      const connections = this.roomsRegistry.listConnections(roomId);
      try { console.log('[broadcastUnread] room', roomId, 'actor', actorId, 'count', count, 'roomConns', connections); } catch {}
      for (const connectionId of connections) {
        const connActor = this.connectionActorId.get(connectionId);
        if (connActor && connActor !== actorId) continue;
        try { console.log('[broadcastUnread] send to roomConn', connectionId, 'connActor', connActor); } catch {}
        this.bus.sendToConnection(connectionId, {
          jsonrpc: '2.0',
          method: 'room.unread',
          params: {
            roomId,
            actorId,
            unreadCount: count,
            updatedAt: new Date().toISOString(),
          },
        });
      }
      const actorSockets = this.actorConnections.get(actorId);
      if (actorSockets) {
        const roomConnSet = new Set(connections);
        for (const connectionId of actorSockets) {
          if (roomConnSet.has(connectionId)) continue;
          try { console.log('[broadcastUnread] send to actorConn', connectionId, 'for actor', actorId); } catch {}
          this.bus.sendToConnection(connectionId, {
            jsonrpc: '2.0',
            method: 'room.unread',
            params: {
              roomId,
              actorId,
              unreadCount: count,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }
    }
    this.lastUnreadBroadcast.set(roomId, cached);
  }

  private broadcastDmPing(fromActorId: string, toActorId: string, roomId: string) {
    try {
      const sockets = this.actorConnections.get(toActorId);
      if (!sockets || sockets.size === 0) return;
      for (const connectionId of sockets) {
        this.bus.sendToConnection(connectionId, {
          jsonrpc: '2.0',
          method: 'dm.ping',
          params: {
            roomId,
            fromActorId,
            toActorId,
            updatedAt: new Date().toISOString(),
          },
        });
      }
    } catch (e) {
      console.error('[broadcastDmPing] failed', e);
    }
  }

  register(fastify: FastifyInstance) {
    const self = this;
    fastify.register(async function (fastify: any) {
      fastify.get('/ws', { websocket: true }, (connection: any, request: any) => {
        try {
          // Try to parse NextAuth session from cookie header (JWT strategy)
          const cookie = String(request.headers['cookie'] || '');
          const m = cookie.match(/next-auth\.session-token=([^;]+)/) || cookie.match(/__Secure-next-auth\.session-token=([^;]+)/);
          if (m) {
            // We don't verify JWT signature here; for dev map token presence to a user hint
            const hinted = (request.headers['x-user-id'] as string) || 'default-user';
            const cid = (connection as any).socket ? (connection as any).socket : connection;
            // assign after connection established in handleConnection via a side-channel
          }
        } catch {}
        self.handleConnection(connection, request);
      });
    });
  }

  private async handleConnection(connection: any, request: any) {
    const connectionId = randomUUID();
    this.connections.set(connectionId, connection as any);

    const ws: any = (connection as any).socket ?? connection;

    console.log(`WebSocket connection established: ${connectionId}`);

    let hintedUser = String((request.headers['x-user-id'] as string) || '').trim();
    try {
      const rawUrl = String((request as any).url || '');
      const host = String(((request as any).headers && (request as any).headers.host) || 'localhost');
      const u = new URL(rawUrl, `http://${host}`);
      const qp = u.searchParams.get('uid');
      if (qp && !hintedUser) hintedUser = String(qp).trim();
    } catch {}
    const hintedActor = hintedUser ? await this.safeCanonicalizeActorId(hintedUser) : undefined;
    if (hintedActor) this.registerActorConnection(connectionId, hintedActor);

    ws.on('message', (data: Buffer) => {
      this.handleMessage(connectionId, data);
    });

    ws.on('close', () => {
      console.log(`WebSocket connection closed: ${connectionId}`);
      this.connections.delete(connectionId);
      this.unregisterActorConnection(connectionId);
      const affectedRooms = this.removeFromAllRooms(connectionId);
      for (const roomId of affectedRooms) {
        this.broadcastParticipants(roomId).catch((e) => console.error('broadcastParticipants on close failed', e));
      }
    });

    ws.on('error', (error: any) => {
      console.error(`WebSocket error for ${connectionId}:`, error);
    });
  }

  private async handleMessage(connectionId: string, data: Buffer) {
    try {
      const message = JSON.parse(data.toString());
      
      // Validate JSON-RPC format
      if (!this.isValidJSONRPC(message)) {
        this.bus.sendError(connectionId, null, ErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC request');
        return;
      }

      const request = message as JSONRPCRequest;
      
      // Route to appropriate handler
      switch (request.method) {
        case 'typing.start':
          await this.handleTypingStart(connectionId, request as TypingStartRequest);
          break;
        case 'typing.stop':
          await this.handleTypingStop(connectionId, request as TypingStopRequest);
          break;
        case 'message.create':
          await this.handleMessageCreate(connectionId, request as MessageCreateRequest);
          break;
          
        case 'terminal.execute':
          await this.handleTerminalExecute(connectionId, request);
          break;
          
        case 'agent.execute':
          await this.handleAgentExecute(connectionId, request);
          break;
          
        case 'room.join':
          await this.handleRoomJoin(connectionId, request);
          break;
          
        case 'room.leave':
          await this.handleRoomLeave(connectionId, request);
          break;

        case 'room.invite':
          await this.handleRoomInvite(connectionId, request);
          break;

        case 'room.remove':
          await this.handleRoomRemove(connectionId, request);
          break;

        case 'room.create':
          await this.handleRoomCreate(connectionId, request);
          break;

        case 'tool.serpapi.search':
          await handleSerpSearch(this.buildSerpCtx(), connectionId, request);
          break;
        case 'tool.serpapi.images':
          await handleSerpImages(this.buildSerpCtx(), connectionId, request);
          break;
        case 'tool.serpapi.run':
          await handleSerpRun(this.buildSerpCtx(), connectionId, request);
          break;
        case 'tool.elevenlabs.tts':
          await this.handleElevenLabsTTS(connectionId, request);
          break;
        case 'tool.web.scrape':
          await this.handleWebScrape(connectionId, request);
          break;
        case 'tool.web.scrape.pick':
          await this.handleWebScrapePick(connectionId, request);
          break;
        case 'message.read':
          await this.handleMessageRead(connectionId, request);
          break;
        case 'tool.x.tweet':
          await handleXTweet(this.buildXCtx(), connectionId, request);
          break;
        case 'tool.x.dm':
          await handleXDm(this.buildXCtx(), connectionId, request);
          break;
        case 'tool.x.search':
          await handleXSearch(this.buildXCtx(), connectionId, request);
          break;
        case 'tool.x.lists':
          await handleXLists(this.buildXCtx(), connectionId, request);
          break;
        case 'tool.x.listTweets':
          await handleXListTweets(this.buildXCtx(), connectionId, request);
          break;
        case 'tool.code.search':
          await this.handleCodeSearch(connectionId, request);
          break;
          
        default:
          this.bus.sendError(connectionId, request.id, ErrorCodes.METHOD_NOT_FOUND, `Method not found: ${request.method}`);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      this.bus.sendError(connectionId, null, ErrorCodes.PARSE_ERROR, 'Parse error');
    }
  }

  // Lightweight helper to decide which invited agents should speak next based on content and mentions
  private async routeParticipation(roomId: string, text: string): Promise<string[]> {
    // Do not invite agents in direct messages between users
    try {
      const r = await db.select().from(DBSchema.rooms).where(eq(DBSchema.rooms.id as any, roomId as any));
      if (r.length && String((r[0] as any).kind) === 'dm') {
        console.log(`[routeParticipation] Room ${roomId} is a DM; suppressing agent participation.`);
        return [];
      }
    } catch (e) {
      console.warn('[routeParticipation] Failed to read room kind, continuing with default behavior');
    }
    // Eligible agents come from DB conversation participants; fallback to legacy invited set
    let eligible: string[] = [];
    try {
      const conv = await db.select().from(DBSchema.conversations).where(eq(DBSchema.conversations.id as any, roomId as any));
      if (conv.length && Array.isArray((conv[0] as any).participants)) {
        const participants = (conv[0] as any).participants as any[];
        console.log(`[routeParticipation] Room ${roomId} participants from DB:`, participants);
        // Handle both formats: ['agent-id'] and [{ type: 'agent', id: 'agent-id' }]
        eligible = participants
          .map((p) => {
            if (typeof p === 'string') return p; // Simple string format
            if (p && p.type === 'agent' && typeof p.id === 'string') return p.id; // Object format
            return null;
          })
          .filter((id): id is string => id !== null);
        console.log(`[routeParticipation] Eligible agents:`, eligible);
      }
    } catch (e) {
      console.error(`[routeParticipation] Error fetching conversation:`, e);
    }
    // Fallback to Social Core room members → actors → agents mapping
    if (eligible.length === 0) {
      try {
        const members = await db.select().from(DBSchema.roomMembers).where(eq(DBSchema.roomMembers.roomId as any, roomId as any));
        const candidateAgentIds: string[] = [];
        for (const m of members as any[]) {
          try {
            const aRows = await db.select().from(DBSchema.actors).where(eq(DBSchema.actors.id as any, m.actorId as any));
            if (!aRows.length) continue;
            const act: any = aRows[0];
            if (String(act.type) !== 'agent') continue;
            const settings = (act.settings || {}) as any;
            const mappedAgentId = settings?.agentId;
            if (mappedAgentId && typeof mappedAgentId === 'string') {
              candidateAgentIds.push(mappedAgentId);
            }
          } catch {}
        }
        eligible = Array.from(new Set(candidateAgentIds));
        if (eligible.length) {
          console.log(`[routeParticipation] Eligible agents from Social Core members:`, eligible);
        }
      } catch (e) {
        console.error(`[routeParticipation] Error fetching Social Core room members:`, e);
      }
    }
    // Legacy invited set fallback
    if (eligible.length === 0) {
      eligible = Array.from(this.roomAgents.get(roomId) || []);
    }
    if (eligible.length === 0) return [];
    // Build name->id map for mentions
    const agentIdByName = new Map<string, string>();
    try {
      for (const aid of eligible) {
        const rows = await db.select().from(agents).where(eq(agents.id as any, aid as any));
        if (rows.length) {
          const agentName = String(rows[0].name || '').toLowerCase();
          agentIdByName.set(agentName, aid);
          // Also add condensed slug (no spaces) for @handle-style mentions
          const slug = agentName.replace(/\s+/g, '');
          if (slug && slug !== agentName) agentIdByName.set(slug, aid);
          console.log(`[routeParticipation] Agent mapping: "${agentName}" (slug: ${slug}) -> ${aid}`);
        }
      }
    } catch {}
    console.log(`[routeParticipation] Processing message: "${text}"`);
    console.log(`[routeParticipation] Agent name map:`, Array.from(agentIdByName.entries()));
    const { all, mentionedIds } = this.participationRouter.parseMentions(text, eligible, agentIdByName);
    console.log(`[routeParticipation] Parsed mentions:`, { all, mentionedIds });
    if (mentionedIds.length > 0) return mentionedIds.slice(0, 5);
    if (!all) {
      // Score by interest/keywords
      const scored = await this.participationRouter.scoreAgentsForMessage(roomId, text, eligible);
      const picked = scored.map(s => s.agentId).slice(0, 5);
      if (picked.length > 0) return picked;
      // Fallback: if no scores, still let eligible agents speak (up to 5)
      return eligible.slice(0, 5);
    }
    // @all → allow up to 5, scored order
    const scored = await this.participationRouter.scoreAgentsForMessage(roomId, text, eligible);
    const picked = scored.map(s => s.agentId).slice(0, 5);
    if (picked.length > 0) return picked;
    // Fallback: if no scores (e.g., no keywords configured), allow all eligible up to 5
    return eligible.slice(0, 5);
  }

  private async handleTerminalExecute(connectionId: string, request: JSONRPCRequest) {
    try {
      const { command, agentId, roomId } = request.params;
      
      if (!command) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'Command is required');
        return;
      }

      // Execute terminal command
      const result = await terminalService.executeCommand(command, agentId || connectionId);
      
      // Store terminal command in memory
      const terminalMessage = {
        id: randomUUID(),
        role: 'terminal' as const,
        content: `$ ${result.command}\n${result.stdout}${result.stderr ? '\n' + result.stderr : ''}`,
        timestamp: new Date(),
        conversationId: roomId || 'default-room',
        agentId: agentId || connectionId,
        terminalResult: {
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        },
      };

      // Add to short-term memory
      memoryService.addToShortTerm(agentId || connectionId, terminalMessage);

      // Add to long-term memory
      await memoryService.addToLongTerm(terminalMessage.content, {
        agentId: agentId || connectionId,
        conversationId: roomId || 'default-room',
        messageId: terminalMessage.id,
        role: 'terminal',
        timestamp: new Date().toISOString(),
        messageType: 'conversation',
      });
      
      // Send terminal result to room
      this.bus.broadcastToRoom(roomId || 'default-room', {
        jsonrpc: '2.0',
        method: 'terminal.result',
        params: {
          roomId: roomId || 'default-room',
          agentId: agentId || connectionId,
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          timestamp: new Date().toISOString(),
        },
      });

      // Persist terminal result to message history
      try {
        await db.insert(DBSchema.messages as any).values({
          id: randomUUID(),
          conversationId: (roomId || 'default-room') as any,
          authorId: String(agentId || roomId || 'agent'),
          authorType: 'agent',
          role: 'terminal',
          content: [{ type: 'text', text: `$ ${result.command}\n${result.stdout}${result.stderr ? '\n' + result.stderr : ''}` }] as any,
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
      } catch {}

      // Send response to requester
      this.bus.sendResponse(connectionId, request.id, {
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });

    } catch (error) {
      console.error('Error in handleTerminalExecute:', error);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, `Terminal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleAgentExecute(connectionId: string, request: JSONRPCRequest) {
    try {
      const { command, roomId, reason } = request.params;
      
      if (!command) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'Command is required');
        return;
      }

      // Execute terminal command as agent
      const result = await terminalService.executeCommand(command, connectionId);
      
      // Store agent terminal command in memory
      const terminalMessage = {
        id: randomUUID(),
        role: 'terminal' as const,
        content: `Agent executed: ${reason || 'Terminal command'}\n$ ${result.command}\n${result.stdout}${result.stderr ? '\n' + result.stderr : ''}`,
        timestamp: new Date(),
        conversationId: roomId || 'default-room',
        agentId: connectionId,
        terminalResult: {
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        },
      };

      // Add to short-term memory
      memoryService.addToShortTerm(connectionId, terminalMessage);

      // Add to long-term memory
      await memoryService.addToLongTerm(terminalMessage.content, {
        agentId: connectionId,
        conversationId: roomId || 'default-room',
        messageId: terminalMessage.id,
        role: 'terminal',
        timestamp: new Date().toISOString(),
        messageType: 'conversation',
      });
      
      // Send agent execution result to room
      this.bus.broadcastToRoom(roomId || 'default-room', {
        jsonrpc: '2.0',
        method: 'agent.executed',
        params: {
          roomId: roomId || 'default-room',
          agentId: connectionId,
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          reason: reason,
          timestamp: new Date().toISOString(),
        },
      });

      // Persist terminal output as a terminal message in history
      try {
        await db.insert(DBSchema.messages as any).values({
          id: randomUUID(),
          conversationId: (roomId || 'default-room') as any,
          authorId: String(roomId || 'agent'),
          authorType: 'agent',
          role: 'terminal',
          content: [{ type: 'text', text: `$ ${result.command}\n${result.stdout}${result.stderr ? '\n' + result.stderr : ''}` }] as any,
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
      } catch {}

      // Send response to requester
      this.bus.sendResponse(connectionId, request.id, {
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });

      // Generate assistant analysis of the terminal output
      try {
        const model: SupportedModel = 'gpt-4o';
        const modelConfig = ModelConfigs[model];
        const analysisMessages = [
          {
            role: 'system' as const,
            content:
              'You analyze terminal command results and explain them succinctly. Focus on what the results mean for the user\'s goal. If ping-like output, report reachability, packet loss, min/avg/max latency, and a short conclusion. If there is an error or non-zero exit code, explain the likely cause and next steps. Keep it concise.',
          },
          {
            role: 'user' as const,
            content:
              `User request: ${reason || 'Analyze the following terminal result.'}\nCommand: ${result.command}\nExit code: ${result.exitCode}\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`,
          },
        ];

        const analysis = await this.llmRouter.complete(
          modelConfig.provider,
          analysisMessages,
          { model, temperature: 0.2, maxTokens: 600 }
        );

        // Log for operator visibility
        console.log('[analysis]', analysis.content);

        // Store analysis in memory
        const analysisMessage = {
          id: randomUUID(),
          role: 'assistant' as const,
          content: analysis.content,
          timestamp: new Date(),
          conversationId: roomId || 'default-room',
          agentId: connectionId,
        };
        memoryService.addToShortTerm(connectionId, analysisMessage);
        await memoryService.addToLongTerm(analysis.content, {
          agentId: connectionId,
          conversationId: roomId || 'default-room',
          messageId: analysisMessage.id,
          role: 'assistant',
          timestamp: new Date().toISOString(),
          messageType: 'conversation',
        });

        // Broadcast analysis as assistant message
        this.bus.broadcastToRoom(roomId || 'default-room', {
          jsonrpc: '2.0',
          method: 'agent.analysis',
          params: {
            roomId: roomId || 'default-room',
            content: analysis.content,
            model,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (analysisError) {
        console.error('Failed to generate analysis:', analysisError);
      }

    } catch (error) {
      console.error('Error in handleAgentExecute:', error);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, `Agent execution error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleMessageCreate(connectionId: string, request: MessageCreateRequest) {
    try {
    const { roomId, message, runOptions } = request.params;
      
      // Validate user is in room (simplified for MVP)
      if (!this.isUserInRoom(connectionId, roomId)) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.FORBIDDEN, 'Not authorized for this room');
        return;
      }

      // Resolve active user and primary actor id (for author identity)
      const DEFAULT_USER_ID = 'default-user';
      const rawActiveUserId = this.connectionUserId.get(connectionId) || DEFAULT_USER_ID;
      const activeUserId = await this.canonicalizeUserId(rawActiveUserId);
      const myActorId = await this.resolvePrimaryUserActorId(activeUserId);

      // Check if this room is a DM; if so, no agents or system fallback should speak
      let isDmRoom = false;
      try {
        const r = await db.select().from(DBSchema.rooms).where(eq(DBSchema.rooms.id as any, roomId as any));
        isDmRoom = !!(r.length && String((r[0] as any).kind) === 'dm');
      } catch {}

      // Resolve friendly author identity (name/avatar) for immediate client rendering
      let authorName: string | undefined = undefined;
      let authorAvatar: string | undefined = undefined;
      try {
        const aRows = await db.select().from(DBSchema.actors).where(eq(DBSchema.actors.id as any, myActorId as any));
        const act: any = aRows[0];
        if (act && (act.ownerUserId || activeUserId)) {
          const ownerId = act.ownerUserId || activeUserId;
          const uRows = await db.select().from(users).where(eq(users.id, ownerId));
          if (uRows.length) {
            authorName = uRows[0].name || uRows[0].email || undefined;
            authorAvatar = uRows[0].avatar || undefined;
          }
        }
      } catch {}

      // Echo the user message to the room
      const messageId = randomUUID();

      this.bus.broadcastToRoom(roomId, {
        jsonrpc: '2.0',
        method: 'message.received',
        params: {
          roomId,
          messageId,
          authorId: myActorId,
          authorType: 'user',
          authorUserId: activeUserId,
          authorName,
          authorAvatar,
          message,
        },
      });

      // Persist user message to DB
      let createdAt = new Date();
      try {
        const now = new Date();
        await db.insert(DBSchema.messages as any).values({
          id: messageId,
          conversationId: roomId,
          authorId: String(myActorId),
          authorType: 'user',
          role: 'user',
          content: Array.isArray(message?.content) ? (message.content as any) : [{ type: 'text', text: String(message || '') }] as any,
          status: 'completed',
          createdAt: now,
          updatedAt: now,
        } as any);

        createdAt = now;
        await this.recordMessageRead(roomId, String(myActorId), messageId, now);
      } catch (error) {
        console.error('[handleMessageCreate] failed to persist message', error);
      }

      // Generate a separate message id for the agent's streaming/final reply
      const agentRunMessageId = randomUUID();

      try {
        const unread = await this.computeUnreadCounts(roomId);
        this.broadcastUnread(roomId, unread);
      } catch (error) {
        console.error('[handleMessageCreate] failed to broadcast unread', error);
      }

      // For DM rooms, also emit an immediate actor-based ping to the receiver so their sidebar can show a dot without room mapping
      try {
        if (isDmRoom) {
          // Identify the receiver actor (any user member other than the sender)
          const memberActorIds = await this.getMemberActorIds(roomId);
          const receiver = (memberActorIds || []).find((a) => String(a) !== String(myActorId));
          if (receiver) this.broadcastDmPing(String(myActorId), String(receiver), roomId);
        }
      } catch (e) {
        console.error('[handleMessageCreate] dm.ping failed', e);
      }

      // For DM rooms, do not trigger agent routing or system fallback; store only the user message and return
      if (isDmRoom) {
        try {
          const userMessage = message.content.map((p: any) => p.text).join('');
          const msgId = randomUUID();
          const mem = {
            id: msgId,
            role: 'user' as const,
            content: userMessage,
            timestamp: new Date(),
            conversationId: roomId,
            agentId: roomId as any,
            metadata: { userId: activeUserId },
          };
          memoryService.addToShortTerm(roomId, mem);
          await memoryService.addToLongTerm(userMessage, ({
            agentId: roomId as any,
            conversationId: roomId,
            messageId: msgId,
            role: 'user',
            timestamp: new Date().toISOString(),
            messageType: 'conversation',
            userId: activeUserId,
          } as any));
        } catch {}
        if ((request as any).id) this.bus.sendResponse(connectionId, (request as any).id, { ok: true });
        return;
      }

      // Start agent run
      const runId = randomUUID();
      const runMessageId = randomUUID();
      
      // Send run started notification
      this.bus.broadcastToRoom(roomId, {
        jsonrpc: '2.0',
        method: 'run.status',
        params: {
          runId,
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      } as RunStatusNotification);

      // If this was a request (has id), ACK so client resolves; for notifications, skip
      if ((request as any).id) {
        this.bus.sendResponse(connectionId, (request as any).id, {
          runId,
          messageId: runMessageId,
          status: 'running',
        });
      }

      // Get model and provider (gate gpt-5 via env flag)
      let model = (runOptions?.model || 'gpt-4o') as SupportedModel;
      const enableGpt5 = String(process.env.ENABLE_GPT5 || '').toLowerCase() === 'true';
      if (!enableGpt5 && String(model).startsWith('gpt-5')) {
        model = 'gpt-4o' as SupportedModel;
      }
      const modelConfig = ModelConfigs[model];
      
      if (!modelConfig) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, `Unsupported model: ${model}`);
        return;
      }

      // Get agent profile and preferences for context
      // Load user profile for the active connection
      // activeUserId already resolved above
      let userProfile = null;
      try {
        const userRows = await db.select().from(users).where(eq(users.id, activeUserId));
        if (userRows.length > 0) {
          userProfile = userRows[0];
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      }

      // Short-term memory per agent/room
      const shortTermMemory = memoryService.getShortTerm(roomId);
      
      // Get relevant long-term memory
      const userMessage = message.content.map(part => part.text).join('');
      const relevantMemories = await memoryService.searchLongTerm(roomId, userMessage, 3, 'conversation');
      
      // Build context from user profile and memories
      let memoryContext = '';
      memoryContext += buildUserProfileContext(userProfile);
      if (relevantMemories.length > 0) {
        memoryContext += `\nRelevant Context from Previous Conversations:\n`;
        relevantMemories.forEach(memory => {
          memoryContext += `- ${memory.content}\n`;
        });
      }

      // Resolve agent persona and settings; support legacy agentId rooms and agent_chat rooms
      let agentName = '';
      let agentPersona = '';
      let autoExecuteTools = false;
      let isAgentRoom = false;
      let primaryAgentId: string | null = null;
      try {
        const { db, agents } = await import('../db/index.js');
        const { eq } = await import('drizzle-orm');
        // Legacy: roomId is agentId
        const rows = await db.select().from(agents).where(eq(agents.id, roomId as any));
        if (rows.length > 0) {
          primaryAgentId = String(roomId);
        } else {
          // agent_chat: find agent actor in members and map to agentId via settings.agentId
          try {
            const { rooms, roomMembers, actors } = await import('../db/index.js');
            const rr = await db.select().from(rooms).where(eq(rooms.id as any, roomId as any));
            if (rr.length && String((rr[0] as any).kind) === 'agent_chat') {
              const m = await db.select().from(roomMembers).where(eq(roomMembers.roomId as any, roomId as any));
              const actorIds = (m as any[]).map(x => x.actorId);
              const aRows = await db.select().from(actors);
              const agentActor = (aRows as any[]).find(a => a.type === 'agent' && actorIds.includes(a.id) && a?.settings?.agentId);
              if (agentActor?.settings?.agentId) primaryAgentId = String(agentActor.settings.agentId);
            }
          } catch {}
        }
        if (primaryAgentId) {
          const pr = await db.select().from(agents).where(eq(agents.id as any, primaryAgentId as any));
          if (pr.length > 0) {
            isAgentRoom = true;
            const a: any = pr[0];
            agentName = a.name || '';
            autoExecuteTools = a.autoExecuteTools || false;
            const instr: string = a.instructions || '';
            const desc = a.description ? `Description: ${a.description}` : '';
            const personalityMatch = instr.match(/Personality:\s*([\s\S]*?)(?:\n\n|$)/);
            const extraMatch = instr.match(/Extra instructions:\s*([\s\S]*)$/);
            const personality = personalityMatch ? personalityMatch[1].trim() : '';
            const extra = extraMatch ? extraMatch[1].trim() : '';
            agentPersona = [
              agentName ? `Agent Name: ${agentName}` : '',
              desc,
              personality ? `Personality: ${personality}` : '',
              extra ? `Extra instructions: ${extra}` : '',
            ].filter(Boolean).join('\n');
          }
        }
      } catch {}

      const personaBlock = agentPersona
        ? `\n\nAGENT PERSONA\n${agentPersona}\n\n`
        : '\n\n';

      // Create personalized greeting
      const userName = userProfile?.name || 'there';
      const personalizedGreeting = userProfile?.name ? `Hello ${userName}!` : 'Hello there!';
      
      // Create conversation context with memory and terminal capabilities
      const messages = [
        {
          role: 'system' as const,
          content: `You are a helpful AI assistant with tool access and memory. When greeting the user, address them by name: "${userName}".

${personalizedGreeting} You have access to their profile information and should use it to provide personalized assistance.

PARTICIPANTS
- User: ${userProfile?.name || 'User'}

REFERENCE TOKENS
- The user may reference tools or objects with @tokens (e.g., @terminal, @mysql, @x, @twitter, @serpapi, @michaeljames).
- Treat @terminal as a request to run a shell command in a sandbox.
- Twitter/X: Treat @x and @twitter as requests to use native X tools. Use these forms:
  • x.search "<query>" (e.g., "from:@handle", "to:@handle", keywords)
  • x.lists { username: "@handle" } (users may also write "@x.lists @handle")
  • x.dm { recipientId: "<userId>", text: "<message>" }
  • x.tweet "<text>"
  NEVER propose or use serpapi.twitter. If a previous answer used serpapi.twitter, rewrite to the appropriate x.* tool.
- Treat @serpapi as a request to perform a SerpAPI call for web/news/images/video discovery. When the user mentions @serpapi, you MUST use SerpAPI tools. For google news specifically, use: $ serpapi.google_news "<query>". For other searches, prefer engine-specific forms like: $ serpapi.google_images "<query>", $ serpapi.bing_images "<query>", $ serpapi.youtube "<query>", $ serpapi.yelp "<query>", $ serpapi.patents "<query>", $ serpapi.google_maps "<query>". The system also accepts $ serpapi.run <engine> "<query>" with optional key=value args. NEVER say you cannot access SerpAPI when @serpapi is mentioned - always provide the appropriate command.

IMPORTANT: Agent instructions take precedence over these general tool guidelines. If the agent has specific instructions about tool preferences (e.g., "use Twitter/X first for news"), follow those instructions instead of the general guidelines above.
- To read the content of a specific web page (when you have a concrete URL), use the website scraper: tool.web.scrape { url: "https://..." }. Use SerpAPI for discovery (finding links/news), then scrape the chosen URL for details. If the user references a numbered result from the last list (e.g., "read #2" or "open 2"), use tool.web.scrape.pick { index: 2 } to scrape that result by position.
- Treat @elevenlabs as a request to synthesize speech. Propose the tool call in one line: elevenlabs.tts "<text>" voice=<voiceId> format=mp3 (voice optional).
- Finance tools are available when needed (no default preference). When the user asks for quotes or finance news, use:
  • finance.getQuote { symbol: "NVDA" }
  • finance.getNews { symbol: "NVDA", max: 5 }
  Prefer canonical tools over raw engine strings across all domains. Do not invent engine names. If given a company name, map to a ticker when possible (e.g., NVIDIA → NVDA).
- When proposing a terminal command, produce exactly one suggestion line in the format:
  Should I run: $ <command>
  where <command> contains no backticks or extra prose. Do not append explanations on the same line.

${autoExecuteTools 
  ? `TERMINAL EXECUTION POLICY
1) Explain intent briefly.
2) Execute the terminal command directly by outputting: $ <command>
3) Analyze returned output and answer the user's goal.
Note: You have auto-execute enabled, so run commands directly without asking for approval.`
  : `TERMINAL EXECUTION POLICY
1) Explain intent briefly.
2) Propose exactly one clean suggestion line (as above).
3) Wait for approval (Yes/No). After approval the system will execute the command and return output.
4) Analyze returned output and answer the user's goal.`}

SAFETY
- Avoid destructive operations. Ask before any action with side effects.

ENVIRONMENT
- Current working directory: /tmp/superagent-sandbox/agent-${connectionId}
${personaBlock}${memoryContext}`,
        },
        // Add recent conversation context including terminal messages
        ...shortTermMemory.slice(-10)
          .map(msg => {
            if (msg.role === 'terminal') {
              return {
                role: 'system' as const,
                content: `Terminal output:\n${msg.content}`,
              };
            }
            return {
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
            };
          }),
        {
          role: message.role,
          content: userMessage,
        },
      ];

      // If this is a conversation (not a single-agent channel), route to participating agents instead of running a generic assistant
      if (!isAgentRoom) {
        try {
          const candidates = await this.routeParticipation(roomId, userMessage);
          if (candidates.length > 0) {
            const now = Date.now();
            const cool = this.roomCooldownUntil.get(roomId) || new Map<string, number>();
            let speakNext = candidates.filter(aid => (cool.get(aid) || 0) <= now).slice(0, 5);
            // If all candidates are cooling down, allow the first one to speak anyway
            if (speakNext.length === 0) {
              speakNext = candidates.slice(0, 1);
            }
            if (speakNext.length > 0) {
              // Skip announcing queued participants to maintain agent illusion
              this.roomQueue.set(roomId, speakNext);
              this.processRoomQueue(roomId, userMessage, activeUserId).catch((e) => console.error('processRoomQueue failed', e));
              return; // Do not run primary assistant
            }
          }
        } catch (e) {
          console.error('participation routing (conversation) failed', e);
        }
        // Conversation room: do not fall back to generic assistant
        this.broadcastToRoom(roomId, {
          jsonrpc: '2.0',
          method: 'message.received',
          params: {
            roomId,
            messageId: randomUUID(),
            authorId: 'system',
            authorType: 'system',
            message: 'No eligible agents responded. Mention an agent (e.g., @Buzz Daly) or add agents to this room.',
          },
        });
        return;
      }

      // For single-agent rooms (isAgentRoom = true), run primary agent logic
      // This prevents double responses when an agent is both the primary agent and in participants

      // Choose execution mode (feature-flag)
      const useLoop = process.env.AGENT_LOOP === '1';
      console.log(`[debug] AGENT_LOOP env var: "${process.env.AGENT_LOOP}", useLoop: ${useLoop}`);
      this.roomSpeaking.add(roomId);
      let responseText = '';
      if (useLoop) {
        const agentRecord = isAgentRoom && primaryAgentId ? (await db.select().from(agents).where(eq(agents.id as any, primaryAgentId as any)))[0] : null;
        const { finalText, pendingApproval } = await this.orchestrator.runTask({
          roomId,
          activeUserId,
          connectionId,
          agentRecord,
          userProfile,
          userMessage,
          runOptions: { model, temperature: runOptions?.temperature, budget: runOptions?.budget },
          executeTool: async (call) => {
            const fn = call.func || 'run';
            // Special-case: web.scrape.pick is an RPC handler, not a ToolRunner function
            if (call.name === 'web' && fn === 'scrape.pick') {
              const pickIndex = Number(call.args?.index || 0);
              const rid = String(call.args?.resultId || '');
              if (!pickIndex || pickIndex < 1) throw new Error('index must be >= 1');
              let url: string | undefined;
              if (rid) {
                const stored = getResults(rid);
                const itemsLen = stored?.items?.length || 0;
                console.log('[pick.executeTool] room=%s resultId=%s items=%d index=%d', roomId, rid, itemsLen, pickIndex);
                if (!stored || stored.roomId !== roomId) throw new Error('Invalid or expired resultId for this room');
                url = stored.items.find(i => i.index === pickIndex)?.url;
              } else {
                const links = (this.lastLinks.get(connectionId) || this.roomLastLinks.get(roomId) || getLastLinks(connectionId) || []);
                console.log('[pick.executeTool] room=%s resultId=<none> links=%d index=%d', roomId, links.length, pickIndex);
                url = links[pickIndex - 1];
              }
              if (!url) throw new Error(`No URL for index ${pickIndex}`);
              const trRunId = randomUUID();
              const toolCallId = randomUUID();
              this.bus.broadcastToolCall(roomId, trRunId, toolCallId, 'web', 'scrape.pick', { index: pickIndex });
              const result = await webScraperService.scrape(url);
              this.bus.broadcastToolResult(roomId, trRunId, toolCallId, { ok: true });
              return { ok: true, result, pickedIndex: pickIndex };
            }
            const { runId: trRunId, toolCallId, result } = await this.toolRunner.run(call.name, fn, call.args || {}, { roomId, userId: activeUserId } as any);
            // Mirror via bus for UI
            this.bus.broadcastToolCall(roomId, trRunId, toolCallId, call.name, fn, call.args || {});
            this.bus.broadcastToolResult(roomId, trRunId, toolCallId, result);
            try {
              if (call.name === 'serpapi' && fn === 'run' && result) {
                const raw = (result as any).raw || {};
                let links: string[] = [];
                if (Array.isArray(raw.news_results) && raw.news_results.length) {
                  links = raw.news_results.map((n: any) => n.link).filter((u: any) => typeof u === 'string');
                } else if (Array.isArray(raw.organic_results) && raw.organic_results.length) {
                  links = raw.organic_results.map((r: any) => r.link).filter((u: any) => typeof u === 'string');
                }
                if (links.length) {
                  this.lastLinks.set(connectionId, links);
                  this.roomLastLinks.set(roomId, links);
                  setLastLinks(connectionId, links);
                  // Create stable results and broadcast to clients
                  const items = links.slice(0, 10).map((url, i) => ({ index: i + 1, url }));
                  const rid = createResults(roomId, items);
                  this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'search.results', params: { roomId, resultId: rid, items } });
                } else {
                  // Fallback: parse markdown for [View](...)
                  try {
                    const md = String((result as any).markdown || '');
                    const mdLinks: string[] = [];
                    const re = /\[View\]\((https?:\/\/[^\s)]+)\)/g;
                    let m: RegExpExecArray | null;
                    while ((m = re.exec(md)) !== null) { mdLinks.push(m[1]); }
                    if (mdLinks.length) {
                      this.lastLinks.set(connectionId, mdLinks);
                      this.roomLastLinks.set(roomId, mdLinks);
                      setLastLinks(connectionId, mdLinks);
                      const items = mdLinks.slice(0, 10).map((url, i) => ({ index: i + 1, url }));
                      const rid = createResults(roomId, items);
                      this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'search.results', params: { roomId, resultId: rid, items } });
                    }
                  } catch {}
                }
              }
            } catch {}
            return result;
          },
          onAnalysis: (note) => this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'agent.analysis', params: { content: note, authorId: (primaryAgentId || roomId), authorType: 'agent' } }),
          onDelta: async (delta) => {
            const aid = (primaryAgentId || roomId);
            let authorName: string | undefined;
            let authorAvatar: string | undefined;
            try {
              if (primaryAgentId) {
                const arows = await db.select().from(agents).where(eq(agents.id as any, primaryAgentId as any));
                if (arows && arows.length) {
                  authorName = (arows[0] as any).name || undefined;
                  authorAvatar = (arows[0] as any).avatar || undefined;
                }
              }
            } catch {}
            this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'message.delta', params: { roomId, messageId: agentRunMessageId, delta, authorId: aid, authorType: 'agent', ...(authorName ? { authorName } : {}), ...(authorAvatar ? { authorAvatar } : {}) } } as MessageDeltaNotification);
          },
          getCatalog: () => this.toolRegistry.catalog(),
          getLatestResultId: (ridRoomId: string) => getLatestResultId(ridRoomId),
        });
        responseText = finalText;
        
        // If we have pending approval and user said yes, continue the loop
        if (pendingApproval && /^(yes|y|ok|okay|sure|go ahead|do it|run it|execute)$/i.test(userMessage.trim())) {
          const { finalText: approvedText } = await this.orchestrator.runTask({
            roomId,
            activeUserId,
            connectionId,
            agentRecord,
            userProfile,
            userMessage: `User approved the ${pendingApproval.tool} request for "${pendingApproval.hint}"`,
            runOptions: { model, temperature: runOptions?.temperature, budget: runOptions?.budget },
            executeTool: async (call) => {
              const fn = call.func || 'run';
              if (call.name === 'web' && fn === 'scrape.pick') {
                const pickIndex = Number(call.args?.index || 0);
                const rid = String(call.args?.resultId || '');
                if (!pickIndex || pickIndex < 1) throw new Error('index must be >= 1');
                let url: string | undefined;
                if (rid) {
                  const stored = getResults(rid);
                  const itemsLen = stored?.items?.length || 0;
                  console.log('[pick.executeTool.approved] room=%s resultId=%s items=%d index=%d', roomId, rid, itemsLen, pickIndex);
                  if (!stored || stored.roomId !== roomId) throw new Error('Invalid or expired resultId for this room');
                  url = stored.items.find(i => i.index === pickIndex)?.url;
                } else {
                  const links = (this.lastLinks.get(connectionId) || this.roomLastLinks.get(roomId) || getLastLinks(connectionId) || []);
                  console.log('[pick.executeTool.approved] room=%s resultId=<none> links=%d index=%d', roomId, links.length, pickIndex);
                  url = links[pickIndex - 1];
                }
                if (!url) throw new Error(`No URL for index ${pickIndex}`);
                const trRunId = randomUUID();
                const toolCallId = randomUUID();
                this.bus.broadcastToolCall(roomId, trRunId, toolCallId, 'web', 'scrape.pick', { index: pickIndex });
                const result = await webScraperService.scrape(url);
                this.bus.broadcastToolResult(roomId, trRunId, toolCallId, { ok: true });
                return { ok: true, result, pickedIndex: pickIndex };
              }
              const { runId: trRunId, toolCallId, result } = await this.toolRunner.run(call.name, fn, call.args || {}, { roomId, userId: activeUserId } as any);
              // Mirror via bus for UI
              this.bus.broadcastToolCall(roomId, trRunId, toolCallId, call.name, fn, call.args || {});
              this.bus.broadcastToolResult(roomId, trRunId, toolCallId, result);
              return result;
            },
            onAnalysis: (note) => this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'agent.analysis', params: { content: note, authorId: (primaryAgentId || roomId), authorType: 'agent' } }),
            onDelta: (delta) => this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'message.delta', params: { roomId, messageId, delta, authorId: (primaryAgentId || roomId), authorType: 'agent' } } as MessageDeltaNotification),
            getCatalog: () => this.toolRegistry.catalog(),
            getLatestResultId: (ridRoomId: string) => getLatestResultId(ridRoomId),
            pendingApproval,
          });
          responseText = approvedText;
        }
        
        {
          const aid = (primaryAgentId || roomId);
          let authorName: string | undefined;
          let authorAvatar: string | undefined;
          try {
            if (primaryAgentId) {
              const arows = await db.select().from(agents).where(eq(agents.id as any, primaryAgentId as any));
              if (arows && arows.length) {
                authorName = (arows[0] as any).name || undefined;
                authorAvatar = (arows[0] as any).avatar || undefined;
              }
            }
          } catch {}
          this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'message.complete', params: { runId, messageId: agentRunMessageId, finalMessage: { role: 'assistant', content: [{ type: 'text', text: this.normalizeFinalText(responseText) }] }, authorId: aid, authorType: 'agent', ...(authorName ? { authorName } : {}), ...(authorAvatar ? { authorAvatar } : {}) } });
        }
      } else {
        const { fullResponse } = await this.orchestrator.streamPrimaryAgentResponse({
          roomId,
          activeUserId,
          connectionId,
          agentRecord: isAgentRoom && primaryAgentId ? (await db.select().from(agents).where(eq(agents.id as any, primaryAgentId as any)))[0] : null,
          userProfile,
          userMessage,
          runOptions: { model, temperature: runOptions?.temperature, budget: runOptions?.budget },
          onDelta: async (delta: string) => {
            const aid = (primaryAgentId || roomId);
            let authorName: string | undefined;
            let authorAvatar: string | undefined;
            try {
              if (primaryAgentId) {
                const arows = await db.select().from(agents).where(eq(agents.id as any, primaryAgentId as any));
                if (arows && arows.length) {
                  authorName = (arows[0] as any).name || undefined;
                  authorAvatar = (arows[0] as any).avatar || undefined;
                }
              }
            } catch {}
            this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'message.delta', params: { roomId, messageId: agentRunMessageId, delta, authorId: aid, authorType: 'agent', ...(authorName ? { authorName } : {}), ...(authorAvatar ? { authorAvatar } : {}) } } as MessageDeltaNotification);
          },
        });
        responseText = fullResponse;
        {
          const aid = (primaryAgentId || roomId);
          let authorName: string | undefined;
          let authorAvatar: string | undefined;
          try {
            if (primaryAgentId) {
              const arows = await db.select().from(agents).where(eq(agents.id as any, primaryAgentId as any));
              if (arows && arows.length) {
                authorName = (arows[0] as any).name || undefined;
                authorAvatar = (arows[0] as any).avatar || undefined;
              }
            }
          } catch {}
          this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'message.complete', params: { runId, messageId: agentRunMessageId, finalMessage: { role: 'assistant', content: [{ type: 'text', text: this.normalizeFinalText(fullResponse) }] }, authorId: aid, authorType: 'agent', ...(authorName ? { authorName } : {}), ...(authorAvatar ? { authorAvatar } : {}) } });
        }
      }

      // Persist assistant final message for primary agent responses (single-agent rooms)
      try {
        if (responseText && typeof responseText === 'string') {
          await db.insert(DBSchema.messages as any).values({
            id: agentRunMessageId,
            conversationId: roomId,
            authorId: String(primaryAgentId || roomId),
            authorType: 'agent',
            role: 'assistant',
            content: [{ type: 'text', text: this.normalizeFinalText(responseText) }] as any,
            status: 'completed',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any);
        }
      } catch {}

      // Primary finished speaking
      this.roomSpeaking.delete(roomId);

      // Participation routing (enqueue other invited agents if relevant)
      try {
        let candidates = await this.routeParticipation(roomId, userMessage);
        // Prevent the primary agent from being re-enqueued in single-agent rooms
        // In legacy single-agent rooms, primary agent id == roomId
        // In agent_chat rooms, primaryAgentId is the real agent id
        const excludeId = (primaryAgentId || roomId);
        candidates = candidates.filter(aid => aid !== excludeId);
        // Filter by cooldown and cap
        const now = Date.now();
        const cool = this.roomCooldownUntil.get(roomId) || new Map<string, number>();
        const speakNext = candidates.filter(aid => (cool.get(aid) || 0) <= now).slice(0, 5);
        if (speakNext.length > 0) {
          // Enqueue and start processing (no announcement)
          this.roomQueue.set(roomId, speakNext);
          this.processRoomQueue(roomId, userMessage, activeUserId).catch((e) => console.error('processRoomQueue failed', e));
        }
      } catch (e) {
        console.error('participation routing failed', e);
      }

      // Store messages in memory
      const userMemoryMessage = {
        id: messageId,
        role: 'user' as const,
        content: userMessage,
        timestamp: new Date(),
        conversationId: roomId,
        agentId: roomId as any,
        metadata: { userId: activeUserId },
      };

      const assistantMemoryMessage = {
        id: messageId + '-assistant',
        role: 'assistant' as const,
        content: responseText,
        timestamp: new Date(),
        conversationId: roomId,
        agentId: roomId as any,
        metadata: { userId: activeUserId },
      };

      // Check for auto-executable commands if autoExecuteTools is enabled
      if (autoExecuteTools) {
        const autoExecutableCommands = this.extractAutoExecutableCommands(responseText);
        for (const command of autoExecutableCommands) {
          try {
            console.log(`[auto-execute] Running command: ${command}`);
            const result = await terminalService.executeCommand(command, connectionId);
            
            // Send terminal result to room
            this.bus.broadcastToRoom(roomId, {
              jsonrpc: '2.0',
              method: 'terminal.result',
              params: {
                messageId: randomUUID(),
                command: result.command,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                timestamp: new Date().toISOString(),
              },
            });
          // Persist auto-executed terminal output
          try {
            await db.insert(DBSchema.messages as any).values({
              id: randomUUID(),
              conversationId: roomId as any,
              authorId: String(primaryAgentId || roomId),
              authorType: 'agent',
              role: 'terminal',
              content: [{ type: 'text', text: `$ ${result.command}\n${result.stdout}${result.stderr ? '\n' + result.stderr : ''}` }] as any,
              status: 'completed',
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any);
          } catch {}
          } catch (error) {
            console.error(`[auto-execute] Error executing command "${command}":`, error);
          }
        }
      }

      // Add to short-term memory (scope by agent/room to avoid cross-agent leakage)
      memoryService.addToShortTerm(roomId, userMemoryMessage);
      memoryService.addToShortTerm(roomId, assistantMemoryMessage);

      // Add to long-term memory
      await memoryService.addToLongTerm(userMessage, ({
        agentId: roomId as any,
        conversationId: roomId,
        messageId,
        role: 'user',
        timestamp: new Date().toISOString(),
        messageType: 'conversation',
        userId: activeUserId,
      } as any));

      await memoryService.addToLongTerm(responseText, ({
        agentId: roomId as any,
        conversationId: roomId,
        messageId: messageId + '-assistant',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        messageType: 'conversation',
        userId: activeUserId,
      } as any));

      // Check if we should perform reflection (per agent)
      if (await memoryService.shouldReflect(roomId)) {
        await memoryService.performReflection(roomId);
      }

      // Send run completed notification
      this.bus.broadcastToRoom(roomId, {
        jsonrpc: '2.0',
        method: 'run.status',
        params: {
          runId,
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      } as RunStatusNotification);

    } catch (error) {
      console.error('Error in handleMessageCreate:', error);
      this.bus.sendError(connectionId, request.id, ErrorCodes.LLM_ERROR, `LLM error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleSerpApiSearch(connectionId: string, request: JSONRPCRequest) {
    try {
      const { roomId, query, num, agentId } = request.params as any;
      if (!query) {
        this.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'query is required');
        return;
      }
      console.log('[serpapi.search] query=', query, 'num=', num);
      const runId = randomUUID();
      const toolCallId = randomUUID();
      this.bus.broadcastToolCall(roomId || 'default-room', runId, toolCallId, 'serpapi', 'search', { query, num });
      const { items } = await serpapiService.searchGoogle(query, { num });
      const md = serpapiService.formatAsMarkdown(items, query);
      console.log('[serpapi.search] results=', items.length);

      // Store as assistant message
      const analysisMessage = {
        id: randomUUID(),
        role: 'assistant' as const,
        content: md,
        timestamp: new Date(),
        conversationId: roomId || 'default-room',
        agentId: connectionId,
      };
      memoryService.addToShortTerm(connectionId, analysisMessage);
      await memoryService.addToLongTerm(md, {
        agentId: connectionId,
        conversationId: roomId || 'default-room',
        messageId: analysisMessage.id,
        role: 'assistant',
        timestamp: new Date().toISOString(),
        messageType: 'conversation',
      });

      // Broadcast
      this.bus.broadcastToRoom(roomId || 'default-room', {
        jsonrpc: '2.0',
        method: 'agent.analysis',
        params: {
          roomId: roomId || 'default-room',
          content: md,
          model: 'tool.serpapi',
          timestamp: new Date().toISOString(),
          authorId: (agentId || connectionId || 'agent') as any,
          authorType: 'agent',
        },
      });

      this.bus.broadcastToolResult(roomId || 'default-room', runId, toolCallId, { ok: true });

      this.bus.sendResponse(connectionId, request.id!, { ok: true });
    } catch (error) {
      console.error('Error in handleSerpApiSearch:', error);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, `SerpAPI error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleSerpApiImages(connectionId: string, request: JSONRPCRequest) {
    try {
      const { roomId, query, num, agentId } = request.params as any;
      if (!query) {
        this.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'query is required');
        return;
      }
      console.log('[serpapi.images] query=', query, 'num=', num);
      const runId = randomUUID();
      const toolCallId = randomUUID();
      this.bus.broadcastToolCall(roomId || 'default-room', runId, toolCallId, 'serpapi', 'images', { query, num });
      const { items } = await serpapiService.searchGoogleImages(query, { num });
      const md = serpapiService.formatImagesAsMarkdown(items, query);
      console.log('[serpapi.images] results=', items.length);

      const msg = {
        id: randomUUID(),
        role: 'assistant' as const,
        content: md,
        timestamp: new Date(),
        conversationId: roomId || 'default-room',
        agentId: connectionId,
      };
      memoryService.addToShortTerm(connectionId, msg);
      await memoryService.addToLongTerm(md, {
        agentId: connectionId,
        conversationId: roomId || 'default-room',
        messageId: msg.id,
        role: 'assistant',
        timestamp: new Date().toISOString(),
        messageType: 'conversation',
      });

      this.bus.broadcastToRoom(roomId || 'default-room', {
        jsonrpc: '2.0',
        method: 'agent.analysis',
        params: {
          roomId: roomId || 'default-room',
          content: md,
          model: 'tool.serpapi',
          timestamp: new Date().toISOString(),
          authorId: (agentId || connectionId || 'agent') as any,
          authorType: 'agent',
        },
      });

      this.bus.broadcastToolResult(roomId || 'default-room', runId, toolCallId, { ok: true });

      this.bus.sendResponse(connectionId, request.id!, { ok: true });
    } catch (error) {
      console.error('Error in handleSerpApiImages:', error);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, `SerpAPI error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleSerpApiRun(connectionId: string, request: JSONRPCRequest) {
    try {
      const params = (request.params || {}) as any;
      const engine = String(params.engine || '').trim();
      const query = String(params.query || '').trim();
      const attributedAgentId = String(params.agentId || '').trim();
      console.log('[serpapi.run] attributedAgentId:', attributedAgentId, 'connectionId:', connectionId, 'params:', params);

      // Map deprecated/unsupported engines to first-party tools
      // Twitter is no longer supported by SerpAPI; route to X search instead when requested
      const engineNormalized = engine.replace(/^( ["'] )(.*)\1$/, '$2');
      const engineUse = engineNormalized === 'yahoo_finance' ? 'google_finance' : engineNormalized;
      if (engineUse === 'twitter') {
        const roomId = this.getRoomForConnection(connectionId) || 'default-room';
        const runId = randomUUID();
        const toolCallId = randomUUID();
        this.bus.broadcastToolCall(roomId, runId, toolCallId, 'x', 'search', { query });
        try {
          // Use the connected user's X account for search
          const result = await xService.searchRecent(this.connectionUserId.get(connectionId) || 'default-user', query, Number(params?.extra?.num || 5));
          const data: any[] = Array.isArray(result?.data) ? result.data : [];
          const lines = data.slice(0, Number(params?.extra?.num || 5)).map((t: any, idx: number) => {
            const ts = t.created_at ? ` (${t.created_at})` : '';
            return `- ${idx + 1}. ${t.text || '(no text)'}${ts}`;
          });
          const markdown = lines.length ? `X search for "${query}":\n\n${lines.join('\n')}` : `No tweets found for "${query}".`;
          this.bus.broadcastToRoom(roomId, {
            jsonrpc: '2.0',
            method: 'message.received',
            params: {
              roomId,
              messageId: randomUUID(),
              authorId: 'agent',
              authorType: 'assistant',
              message: markdown,
            },
          });
          this.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: true });
          this.bus.sendResponse(connectionId, request.id, { ok: true, result, used: 'x.search' });
        } catch (e: any) {
          this.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: false, error: e?.message || String(e) });
          this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, e?.message || 'X search failed');
        }
        return;
      }

      // If engine is 'url' (or quoted) or the query itself looks like a URL, delegate to web scraper instead
      const engineIsUrl = engineUse === 'url';
      const queryLooksLikeUrl = /^https?:\/\//i.test(query);
      if (engineIsUrl || queryLooksLikeUrl) {
        const url = queryLooksLikeUrl ? query : engineUse;
        const runId = randomUUID();
        const toolCallId = randomUUID();
        const roomId = this.getRoomForConnection(connectionId) || 'default-room';
        this.bus.broadcastToolCall(roomId, runId, toolCallId, 'web', 'scrape', { url });
        console.log('[serpapi.run:url->web.scrape] url=', url);
        const scrapeResult = await webScraperService.scrape(url);
        const preview = (scrapeResult.text || '').replace(/\s+/g, ' ').trim();
        const summary = `${scrapeResult.title ? `**${scrapeResult.title}**\n\n` : ''}- URL: ${scrapeResult.url}\n- Links: ${scrapeResult.links?.length || 0}, Images: ${scrapeResult.images?.length || 0}\n\n${preview.slice(0, 800)}`;
        this.bus.broadcastToRoom(roomId, {
          jsonrpc: '2.0',
          method: 'message.received',
          params: {
            roomId,
            messageId: randomUUID(),
            authorId: 'agent',
            authorType: 'assistant',
            message: summary,
          },
        });
        this.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: true });
        this.bus.sendResponse(connectionId, request.id, { ok: true, result: scrapeResult, used: 'web.scrape' });
        return;
      }

      // Fallback to regular SerpAPI handler
      const result = await serpapiService.run(engineUse, query, params.extra || undefined);
      const roomId = this.getRoomForConnection(connectionId) || 'default-room';
      const runId = randomUUID();
      const toolCallId = randomUUID();
      this.bus.broadcastToolCall(roomId, runId, toolCallId, 'serpapi', 'run', { engine: engineUse, query, extra: params.extra });
      // Capture last links deterministically
      try {
        let urls: string[] = [];
        // Prefer structured items from the service
        const itemsFromService = Array.isArray((result as any).items) ? (result as any).items : [];
        if (itemsFromService.length) {
          urls = itemsFromService.map((it: any) => it.link || it.url).filter((u: any) => typeof u === 'string');
        }
        // Next, raw news/organic
        if (!urls.length) {
          const raw = (result as any).raw || {};
          if (Array.isArray(raw.news_results) && raw.news_results.length) {
            urls = raw.news_results.map((n: any) => n.link).filter((u: any) => typeof u === 'string');
          } else if (Array.isArray(raw.organic_results) && raw.organic_results.length) {
            urls = raw.organic_results.map((r: any) => r.link).filter((u: any) => typeof u === 'string');
          }
        }
        // Finally, parse markdown for [View](url)
        if (!urls.length) {
          try {
            const md = String((result as any).markdown || '');
            const mdLinks: string[] = [];
            const re = /\[View\]\((https?:\/\/[^\s)]+)\)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(md)) !== null) { mdLinks.push(m[1]); }
            urls = mdLinks;
          } catch {}
        }
        console.log('[serpapi.run:url-derive] urls=', urls.length);
        if (urls.length) {
          this.lastLinks.set(connectionId, urls);
          this.roomLastLinks.set(roomId, urls);
          setLastLinks(connectionId, urls);
          const items = urls.slice(0, 10).map((url, i) => ({ index: i + 1, url }));
          const rid = createResults(roomId, items);
          console.log('[serpapi.run:search.results] room=%s items=%d resultId=%s', roomId, items.length, rid);
          this.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'search.results', params: { roomId, resultId: rid, items } });
        }
      } catch {}
      this.bus.broadcastToRoom(roomId, {
        jsonrpc: '2.0',
        method: 'message.received',
        params: {
          roomId,
          messageId: randomUUID(),
          authorId: attributedAgentId || connectionId || 'agent',
          authorType: 'agent',
          message: result.markdown || `SERPAPI ${engineUse} for "${query}": (no markdown available)`,
        },
      });
      // Persist assistant message so the LLM remembers results on next turn
      try {
        const msgId = randomUUID();
        const msg = {
          id: msgId,
          role: 'assistant' as const,
          content: result.markdown || `SERPAPI ${engineUse} for "${query}": (no markdown available)`,
          timestamp: new Date(),
          conversationId: roomId,
          agentId: attributedAgentId || connectionId,
        };
        memoryService.addToShortTerm(connectionId, msg);
        await memoryService.addToLongTerm(msg.content, {
          agentId: connectionId,
          conversationId: roomId,
          messageId: msgId,
          role: 'assistant',
          timestamp: new Date().toISOString(),
          messageType: 'conversation',
        });
      } catch (e) {
        console.error('[serpapi.run] failed to persist results to memory', e);
      }
      this.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: true });
      this.bus.sendResponse(connectionId, request.id, { ok: true, result });
    } catch (e: any) {
      console.error('Error in handleSerpApiRun:', e);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, e?.message || 'SerpAPI run failed');
    }
  }

  private async handleWebScrapePick(connectionId: string, request: JSONRPCRequest) {
    try {
      const { index, resultId } = (request.params || {}) as { index?: number; resultId?: string };
      if (!index || index < 1) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'index must be >= 1');
        return;
      }
      const roomId = this.getRoomForConnection(connectionId) || 'default-room';
      let url: string | undefined;
      if (resultId) {
        const stored = getResults(resultId);
        if (!stored || stored.roomId !== roomId) {
          this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'Invalid or expired resultId for this room');
          return;
        }
        url = stored.items.find(i => i.index === index)?.url;
      } else {
        // Fallback to last links if no resultId given
        const links = (this.lastLinks.get(connectionId) || this.roomLastLinks.get(roomId) || getLastLinks(connectionId) || []);
        url = links[index - 1];
      }
      if (!url) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, `No URL for index ${index}`);
        return;
      }
      const runId = randomUUID();
      const toolCallId = randomUUID();
      console.log('[web.scrape.pick] index=', index, 'url=', url);
      const result = await webScraperService.scrape(url);
      
      const preview = (result.text || '').replace(/\s+/g, ' ').trim();
      const summary = `${result.title ? `**${result.title}**\n\n` : ''}- URL: ${result.url}\n- Links: ${result.links?.length || 0}, Images: ${result.images?.length || 0}\n\n${preview.slice(0, 800)}`;
      console.log('[web.scrape.pick] text.length=', (result.text || '').length, 'preview.sample=', preview.slice(0, 120));
      this.bus.broadcastToRoom(roomId, {
        jsonrpc: '2.0',
        method: 'message.received',
        params: {
          roomId,
          messageId: randomUUID(),
          authorId: (connectionId || 'agent') as any,
          authorType: 'agent',
          message: summary,
        },
      });
      this.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: true });
      this.bus.sendResponse(connectionId, request.id, { ok: true, result, pickedIndex: index });
    } catch (e: any) {
      console.error('[tool.web.scrape.pick] error', e);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, e?.message || 'Scrape pick failed');
    }
  }

  private buildXCtx() {
    return {
      bus: this.bus,
      toolRunner: this.toolRunner,
      getRoomForConnection: (connectionId: string) => this.getRoomForConnection(connectionId),
      getUserRequireApproval: (connectionId: string) => this.getUserRequireApproval(connectionId),
    };
  }

  private buildSerpCtx() {
    return {
      bus: this.bus,
      toolRunner: this.toolRunner,
      getRoomForConnection: (connectionId: string) => this.getRoomForConnection(connectionId),
    };
  }

  private async handleElevenLabsTTS(connectionId: string, request: JSONRPCRequest) {
    try {
      const { text, voiceId = 'Antoni', format = 'mp3' } = (request.params || {}) as any;
      if (!text || typeof text !== 'string') {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'text is required');
        return;
      }
      const roomId = this.getRoomForConnection(connectionId) || 'default-room';
      const { result } = await this.toolRunner.run('elevenlabs', 'tts', { text, voiceId, format }, { roomId, connectionId });
      const base64 = result.buffer.toString('base64');
      this.bus.sendResponse(connectionId, request.id!, { contentType: result.contentType, base64 });
    } catch (error) {
      console.error('Error in handleElevenLabsTTS:', error);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, `ElevenLabs error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleWebScrape(connectionId: string, request: JSONRPCRequest) {
    try {
      const { url, agentId } = (request.params || {}) as { url?: string; agentId?: string };
      if (!url) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'Missing url');
        return;
      }
      const roomId = this.getRoomForConnection(connectionId) || 'default-room';
      console.log('[web.scrape] url=', url);
    const { result } = await this.toolRunner.run('web', 'scrape', { url }, { roomId, connectionId });

      // Build a compact markdown summary for the chat
      const title = result.title ? `**${result.title}**` : '';
      const metaTitle = result.meta?.['og:title'] || result.meta?.['twitter:title'] || '';
      const summaryTitle = title || metaTitle || result.url;
      const linkCount = result.links?.length || 0;
      const imageCount = result.images?.length || 0;
      const preview = (result.text || '').replace(/\s+/g, ' ').trim().slice(0, 800);
      console.log('[web.scrape] text.length=', (result.text || '').length, 'preview.sample=', preview.slice(0, 120));

      const markdown = `${summaryTitle}\n\n- URL: ${result.url}\n- Content-Type: ${result.contentType}\n- Links: ${linkCount}, Images: ${imageCount}\n\n${preview || '_No readable article text found_'}\n`;

      // Notify room with assistant message
      this.bus.broadcastToRoom(roomId, {
        jsonrpc: '2.0',
        method: 'message.received',
        params: {
          roomId,
          messageId: randomUUID(),
          authorId: (agentId || connectionId || 'agent') as any,
          authorType: 'assistant',
          message: markdown,
        },
      });

      this.bus.sendResponse(connectionId, request.id, { ok: true, result });
    } catch (e: any) {
      console.error('[tool.web.scrape] error', e);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, e?.message || 'Scrape failed');
    }
  }

  // === X tool handlers (respect per-user approval policy for writes) ===
  private async getUserRequireApproval(connectionId: string): Promise<boolean> {
    const DEFAULT_USER_ID = 'default-user';
    const uid = this.connectionUserId.get(connectionId) || DEFAULT_USER_ID;
    try {
      const rows = await db.select().from(users).where(eq(users.id, uid));
      if (rows.length > 0 && (rows[0] as any).requireApproval !== undefined) {
        return !!(rows[0] as any).requireApproval;
      }
    } catch {}
    return true;
  }

  private async handleXTweet(connectionId: string, request: JSONRPCRequest) {
    try {
      const { roomId, text } = (request.params || {}) as any;
      if (!text) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'text is required');
        return;
      }
      const room = roomId || this.getRoomForConnection(connectionId) || 'default-room';
      const requireApproval = await this.getUserRequireApproval(connectionId);
      if (requireApproval) {
        // Broadcast a suggestion instead of executing directly
        this.bus.broadcastToRoom(room, {
          jsonrpc: '2.0',
          method: 'message.received',
          params: {
            roomId: room,
            messageId: randomUUID(),
            authorId: 'agent',
            authorType: 'assistant',
            message: `Should I post this on X?\n\n${text}`,
          },
        });
        this.bus.sendResponse(connectionId, request.id!, { ok: true, awaitingApproval: true });
        return;
      }
      const runId = randomUUID();
      const toolCallId = randomUUID();
      this.bus.broadcastToolCall(room, runId, toolCallId, 'x', 'tweet', { text });
      const res = await this.toolRunner.run('x', 'tweet', { text }, { roomId: room, connectionId });
      this.bus.broadcastToolResult(room, runId, toolCallId, { ok: true });
      this.bus.sendResponse(connectionId, request.id!, { ok: true, result: res.result });
    } catch (e: any) {
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, e?.message || 'X tweet failed');
    }
  }

  private async handleXDm(connectionId: string, request: JSONRPCRequest) {
    try {
      const { roomId, recipientId, text } = (request.params || {}) as any;
      if (!recipientId || !text) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'recipientId and text are required');
        return;
      }
      const room = roomId || this.getRoomForConnection(connectionId) || 'default-room';
      const requireApproval = await this.getUserRequireApproval(connectionId);
      if (requireApproval) {
        this.bus.broadcastToRoom(room, {
          jsonrpc: '2.0',
          method: 'message.received',
          params: {
            roomId: room,
            messageId: randomUUID(),
            authorId: 'agent',
            authorType: 'assistant',
            message: `Should I send this DM on X to ${recipientId}?\n\n${text}`,
          },
        });
        this.bus.sendResponse(connectionId, request.id!, { ok: true, awaitingApproval: true });
        return;
      }
      const runId = randomUUID();
      const toolCallId = randomUUID();
      this.bus.broadcastToolCall(room, runId, toolCallId, 'x', 'dm', { recipientId, text });
      const res = await this.toolRunner.run('x', 'dm', { recipientId, text }, { roomId: room, connectionId });
      this.bus.broadcastToolResult(room, runId, toolCallId, { ok: true });
      this.bus.sendResponse(connectionId, request.id!, { ok: true, result: res.result });
    } catch (e: any) {
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, e?.message || 'X DM failed');
    }
  }

  

  private async handleRoomJoin(connectionId: string, request: JSONRPCRequest) {
    const { roomId } = request.params as { roomId: string; userId?: string };
    // Derive userId from request params, then headers fallback
    let userId: string | undefined = (request.params as any)?.userId;
    if (!userId) {
      userId = this.connectionUserId.get(connectionId);
    }

    let connectionActorId: string | undefined = this.connectionActorId.get(connectionId);
    if (!connectionActorId && userId) {
      try {
        connectionActorId = await this.canonicalizeActorId(userId);
      } catch {
        connectionActorId = userId;
      }
      if (connectionActorId) this.registerActorConnection(connectionId, connectionActorId);
    }

    this.roomsRegistry.addConnection(roomId, connectionId, userId);
    
    this.bus.sendResponse(connectionId, request.id, {
      roomId,
      status: 'joined',
      participants: Array.from(this.rooms.get(roomId)!),
    });

    // After join, compute unread state for this actor
    if (connectionActorId) {
      const unread = await this.computeUnreadCounts(roomId);
      const count = unread.get(connectionActorId) ?? 0;
      this.broadcastUnread(roomId, new Map([[connectionActorId, count]]));
    }

    // Cache resolved actor id for this connection to simplify unread bookkeeping
    if (connectionActorId) this.registerActorConnection(connectionId, connectionActorId);

    // Notify room with enriched participants list
    await this.broadcastParticipants(roomId);
  }

  private async handleRoomLeave(connectionId: string, request: JSONRPCRequest) {
    const { roomId } = request.params;
    
    this.roomsRegistry.removeConnection(roomId, connectionId);
    this.connectionActorId.delete(connectionId);
    
    this.bus.sendResponse(connectionId, request.id, { 
      roomId, 
      status: 'left' 
    });

    // Notify room with enriched participants list
    await this.broadcastParticipants(roomId);
  }

  private async handleRoomInvite(connectionId: string, request: JSONRPCRequest) {
    const { roomId, participant } = request.params as { roomId: string; participant: { type: 'user' | 'agent'; id: string } };
    if (!roomId || !participant || !participant.id) {
      this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'roomId and participant are required');
      return;
    }
    if (participant.type !== 'agent') {
      // For now only agents are supported
      this.bus.sendResponse(connectionId, request.id!, { ok: true, ignored: true });
      return;
    }
    this.roomsRegistry.inviteAgent(roomId, participant.id);
    this.bus.sendResponse(connectionId, request.id!, { ok: true });
    await this.broadcastParticipants(roomId);
  }

  private async handleRoomRemove(connectionId: string, request: JSONRPCRequest) {
    const { roomId, participantId, participantType } = request.params as { roomId: string; participantId: string; participantType: 'user' | 'agent' };
    if (!roomId || !participantId) {
      this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'roomId and participantId are required');
      return;
    }
    if (participantType === 'agent') this.roomsRegistry.removeAgent(roomId, participantId);
    this.bus.sendResponse(connectionId, request.id!, { ok: true });
    await this.broadcastParticipants(roomId);
  }

  private async handleRoomCreate(connectionId: string, request: JSONRPCRequest) {
    try {
      const { agentIds, userIds, title, type } = (request.params || {}) as { agentIds: string[]; userIds?: string[]; title?: string; type?: string };
      if (!Array.isArray(agentIds) || agentIds.length === 0) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'agentIds[] is required');
        return;
      }
      // Derive org from first agent
      let orgId: string | undefined = undefined;
      try {
        const first = await db.select().from(agents).where(eq(agents.id as any, agentIds[0] as any));
        orgId = first[0]?.organizationId;
      } catch {}
      const conversationId = randomUUID();
      const participants = [
        ...agentIds.map((id) => ({ type: 'agent', id })),
        ...(Array.isArray(userIds) ? userIds.map((id) => ({ type: 'user', id })) : []),
      ];
      await db.insert(DBSchema.conversations).values({
        id: conversationId as any,
        organizationId: (orgId || 'default-org') as any,
        title: title || null as any,
        type: (type || 'agent_chat') as any,
        participants: participants as any,
        isArchived: false as any,
      } as any);
      this.bus.sendResponse(connectionId, request.id!, { ok: true, roomId: conversationId });
    } catch (e: any) {
      console.error('room.create failed', e);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, 'room.create failed');
    }
  }

  private isValidJSONRPC(message: any): boolean {
    return (
      message &&
      message.jsonrpc === '2.0' &&
      typeof message.method === 'string' &&
      typeof message.params === 'object' &&
      // allow requests (with id) and notifications (no id)
      (message.id === undefined || message.id === null || typeof message.id === 'string')
    );
  }

  private isUserInRoom(connectionId: string, roomId: string): boolean {
    // Simplified: allow anyone to join any room for MVP
    // In production, check actual authorization
    return this.rooms.get(roomId)?.has(connectionId) || true;
  }

  private removeFromAllRooms(connectionId: string): string[] {
    const affected: string[] = [];
    for (const [roomId, participants] of this.rooms.entries()) {
      if (participants.delete(connectionId)) {
        affected.push(roomId);
      }
    }
    // Also clear any invited agents if no participants remain (optional hygiene)
    for (const roomId of affected) {
      const hasAny = (this.rooms.get(roomId)?.size || 0) > 0;
      if (!hasAny) this.roomAgents.delete(roomId);
    }
    return affected;
  }

  private extractAutoExecutableCommands(responseText: string): string[] {
    const commands: string[] = [];
    const lines = responseText.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Look for lines that start with $ (direct command execution)
      if (trimmed.startsWith('$ ')) {
        const command = trimmed.substring(2).trim();
        if (command && !command.includes('Should I run:')) {
          commands.push(command);
        }
      }
      // Also handle SerpAPI calls
      else if (trimmed.match(/^serpapi\./)) {
        commands.push(trimmed);
      }
    }
    
    return commands;
  }

  private getRoomForConnection(connectionId: string): string | undefined {
    for (const [roomId, participants] of this.rooms.entries()) {
      if (participants.has(connectionId)) return roomId;
    }
    return undefined;
  }

  private sendResponse(connectionId: string, id: string, result: any) {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    
    this.sendToConnection(connectionId, response);
  }

  private sendError(connectionId: string, id: string | null, code: number, message: string, data?: any) {
    const error: JSONRPCError = { code, message, data };
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: id || 'unknown',
      error,
    };
    
    this.sendToConnection(connectionId, response);
  }

  private sendToConnection(connectionId: string, message: any) {
    const connection = this.connections.get(connectionId) as any;
    const ws = connection?.socket ?? connection;
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(message));
      } catch (err) {
        console.error(`Failed to send WS message to ${connectionId}:`, err);
      }
    }
  }

  private broadcastToRoom(roomId: string, notification: JSONRPCNotification) {
    const participants = this.rooms.get(roomId);
    if (!participants) return;

    for (const connectionId of participants) {
      this.sendToConnection(connectionId, notification);
    }
  }

  private broadcastToolCall(roomId: string, runId: string, toolCallId: string, tool: string, func: string, args: Record<string, any>) {
    this.broadcastToRoom(roomId, {
      jsonrpc: '2.0',
      method: 'tool.call',
      params: {
        runId,
        toolCallId,
        tool,
        function: func,
        args,
      },
    });
  }

  private broadcastToolResult(roomId: string, runId: string, toolCallId: string, result: any) {
    this.broadcastToRoom(roomId, {
      jsonrpc: '2.0',
      method: 'tool.result',
      params: {
        runId,
        toolCallId,
        result,
      },
    });
  }

  private async broadcastParticipants(roomId: string) {
    console.log(`[broadcastParticipants] Starting for room: ${roomId}`);
    try {
      const participantsConns = Array.from(this.rooms.get(roomId) || []);
      console.log(`[broadcastParticipants] Room ${roomId} has ${participantsConns.length} connections`);
      const userIds = participantsConns
        .map((cid) => this.connectionUserId.get(cid) || 'default-user');
      const uniqueUserIds = Array.from(new Set(userIds));
      console.log(`[broadcastParticipants] Unique user IDs:`, uniqueUserIds);

      // Fetch user profiles
      const userProfiles: any[] = [];
      for (const uid of uniqueUserIds) {
        try {
          const rows = await db.select().from(users).where(eq(users.id, uid));
          if (rows.length > 0) userProfiles.push(rows[0]);
        } catch {}
      }

      const participants = await this.roomsRegistry.buildParticipants(roomId);
      
      console.log(`[broadcastParticipants] Final participants for room ${roomId}:`, participants);

      const broadcastMessage = {
        jsonrpc: '2.0',
        method: 'room.participants',
        params: {
          roomId,
          participants,
          updatedAt: new Date().toISOString(),
        },
      };
      
      console.log(`[broadcastParticipants] Broadcasting message:`, broadcastMessage);
      this.bus.broadcastToRoom(roomId, broadcastMessage as any);
    } catch (e) {
      console.error('Failed to broadcast participants:', e);
    }
  }

  private pruneTyping(roomId: string) {
    const now = Date.now();
    const map = this.roomTyping.get(roomId);
    if (!map) return;
    for (const [actorId, expires] of map.entries()) {
      if (expires <= now) map.delete(actorId);
    }
    if (map.size === 0) this.roomTyping.delete(roomId);
  }

  private broadcastTyping(roomId: string) {
    this.pruneTyping(roomId);
    const map = this.roomTyping.get(roomId) || new Map();
    const typing = Array.from(map.keys()).map(actorId => ({ actorId }));
    const notif: RoomTypingNotification = {
      jsonrpc: '2.0',
      method: 'room.typing',
      params: { roomId, typing, updatedAt: new Date().toISOString() },
    };
    this.bus.broadcastToRoom(roomId, notif);
  }

  private broadcastReceipts(roomId: string, messageId: string) {
    const byMessage = this.roomReceipts.get(roomId);
    const actorIds = Array.from(byMessage?.get(messageId) || []);
    this.bus.broadcastToRoom(roomId, {
      jsonrpc: '2.0',
      method: 'message.receipts',
      params: { roomId, messageId, actorIds, updatedAt: new Date().toISOString() },
    } as any);
  }

  private async handleTypingStart(connectionId: string, request: TypingStartRequest) {
    const { roomId } = request.params || ({} as any);
    if (!roomId) {
      this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'roomId required');
      return;
    }
    // Resolve actorId: prefer provided, else current user
    let actorId = String(request.params?.actorId || '');
    if (!actorId) {
      const userId = this.connectionUserId.get(connectionId) || 'default-user';
      actorId = userId;
    }
    const ttlMs = Math.min(Math.max(Number(request.params?.ttlMs || 4000), 1000), 15000);
    if (!this.roomTyping.has(roomId)) this.roomTyping.set(roomId, new Map());
    const map = this.roomTyping.get(roomId)!;
    map.set(actorId, Date.now() + ttlMs);
    this.roomTyping.set(roomId, map);
    this.bus.sendResponse(connectionId, request.id, { ok: true });
    this.broadcastTyping(roomId);
  }

  private async handleTypingStop(connectionId: string, request: TypingStopRequest) {
    const { roomId } = request.params || ({} as any);
    if (!roomId) {
      this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'roomId required');
      return;
    }
    let actorId = String(request.params?.actorId || '');
    if (!actorId) {
      const userId = this.connectionUserId.get(connectionId) || 'default-user';
      actorId = userId;
    }
    const map = this.roomTyping.get(roomId);
    if (map) {
      map.delete(actorId);
      if (map.size === 0) this.roomTyping.delete(roomId);
    }
    this.bus.sendResponse(connectionId, request.id, { ok: true });
    this.broadcastTyping(roomId);
  }

  private async handleMessageRead(connectionId: string, request: any) {
    const roomId = String(request?.params?.roomId || '');
    const messageId = String(request?.params?.messageId || '');
    if (!roomId || !messageId) {
      this.bus.sendError(connectionId, request?.id, ErrorCodes.INVALID_PARAMS, 'roomId and messageId required');
      return;
    }
    let actorId = String(request?.params?.actorId || '');
    if (!actorId) {
      actorId = this.connectionActorId.get(connectionId) || this.connectionUserId.get(connectionId) || 'default-user';
    }
    actorId = await this.canonicalizeActorId(actorId);
    this.registerActorConnection(connectionId, actorId);
    if (!this.roomReceipts.has(roomId)) this.roomReceipts.set(roomId, new Map());
    const byMessage = this.roomReceipts.get(roomId)!;
    if (!byMessage.has(messageId)) byMessage.set(messageId, new Set());
    byMessage.get(messageId)!.add(actorId);
    this.roomReceipts.set(roomId, byMessage);
    const readAt = new Date();
    await this.recordMessageRead(roomId, actorId, messageId, readAt);

    this.bus.sendResponse(connectionId, request?.id, { ok: true });
    this.broadcastReceipts(roomId, messageId);

    const unread = await this.computeUnreadCounts(roomId);
    this.broadcastUnread(roomId, unread);
  }

  // Public method to get router info
  getAvailableProviders() {
    return this.llmRouter.getAvailableProviders();
  }

  // Process queued invited agents one-by-one with cooldowns
  private async processRoomQueue(roomId: string, userMessage: string, activeUserId: string) {
    if (this.roomSpeaking.has(roomId)) return; // someone is already speaking
    const queue = this.roomQueue.get(roomId) || [];
    if (queue.length === 0) return;
    const nextAgentId = queue.shift()!;
    this.roomQueue.set(roomId, queue);
    this.roomSpeaking.add(roomId);

    // Load agent config for model/provider, cooldown, and instructions
    let model: string = 'gpt-4o';
    let provider: any = 'openai';
    let cooldownSec = 20;
    let agentName = '';
    let agentInstructions = '';
    let agentPersona = '';
    try {
      const rows = await db.select().from(agents).where(eq(agents.id as any, nextAgentId as any));
      if (rows.length) {
        const a: any = rows[0];
        model = a.defaultModel || model;
        provider = a.defaultProvider || provider;
        cooldownSec = Number(a.cooldownSec || cooldownSec);
        agentName = a.name || '';
        agentInstructions = a.instructions || '';
        
        // Extract Personality and Extra instructions blocks if present
        const personalityMatch = agentInstructions.match(/Personality:\s*([\s\S]*?)(?:\n\n|$)/);
        const extraMatch = agentInstructions.match(/Extra instructions:\s*([\s\S]*)$/);
        const desc = a.description ? `Description: ${a.description}` : '';
        
        if (personalityMatch || extraMatch) {
          // Structured format
          const personality = personalityMatch ? personalityMatch[1].trim() : '';
          const extra = extraMatch ? extraMatch[1].trim() : '';
          agentPersona = [
            agentName ? `Agent Name: ${agentName}` : '',
            desc,
            personality ? `Personality: ${personality}` : '',
            extra ? `Extra instructions: ${extra}` : '',
          ].filter(Boolean).join('\n');
        } else {
          // Unstructured format - treat entire instructions as personality
          agentPersona = [
            agentName ? `Agent Name: ${agentName}` : '',
            desc,
            agentInstructions ? `Instructions: ${agentInstructions}` : '',
          ].filter(Boolean).join('\n');
        }
      }
    } catch {}

    const runId = randomUUID();
    const runMessageId = randomUUID();
    this.broadcastToRoom(roomId, {
      jsonrpc: '2.0',
      method: 'run.status',
      params: { runId, status: 'running', startedAt: new Date().toISOString() },
    } as RunStatusNotification);

    // Load Pinecone memory for this agent, scoped to this user/room
    let memoryContext = '';
    try {
      const memoryResults = await memoryService.searchLongTermByUser(
        activeUserId,
        userMessage,
        5,
        { agentId: nextAgentId as any, roomId }
      );
      if (memoryResults.length > 0) {
        memoryContext = `\n\nRELEVANT MEMORY:\n${memoryResults.map(m => `- ${m.content}`).join('\n')}\n`;
      }
    } catch (e) {
      console.error('Failed to load memory for agent:', e);
    }

    // Create personalized greeting
    const userName = 'there'; // Could be enhanced to get actual user name
    
    // Context with agent-specific instructions, personality, and memory
    const personaBlock = agentPersona
      ? `\n\nAGENT PERSONA\n${agentPersona}\n\n`
      : '\n\n';

    const messages = [
      {
        role: 'system' as const,
        content: `You are ${agentName || 'an agent'} joining an ongoing discussion. You have access to tools and should use them when appropriate.

TOOL USAGE
- When the user mentions @serpapi, you MUST use SerpAPI tools. For google news specifically, use: $ serpapi.google_news "<query>". For other searches, use: $ serpapi.google_images "<query>", $ serpapi.bing_images "<query>", $ serpapi.youtube "<query>", $ serpapi.yelp "<query>", etc. NEVER say you cannot access SerpAPI when @serpapi is mentioned - always provide the appropriate command.
- For terminal commands, use: $ <command>
- For web scraping, use: tool.web.scrape { url: "https://..." }
- For X/Twitter, use: x.search "<query>", x.lists { username: "@handle" }, etc.

IMPORTANT: Agent instructions take precedence over these general tool guidelines. If the agent has specific instructions about tool preferences (e.g., "use Twitter/X first for news"), follow those instructions instead of the general guidelines above.

Provide helpful responses using available tools. Be concise but thorough.${personaBlock}${memoryContext}` 
      },
      { role: 'user' as const, content: userMessage },
    ];

    let fullResponse = '';
    try {
      for await (const chunk of this.llmRouter.stream(provider, messages as any, { model, temperature: 0.6, maxTokens: 500, stream: true } as any)) {
        if (chunk.delta) {
          fullResponse += chunk.delta;
          this.broadcastToRoom(roomId, {
            jsonrpc: '2.0',
            method: 'message.delta',
            params: { roomId, messageId: runMessageId, delta: chunk.delta, authorId: nextAgentId, authorType: 'agent' },
          } as MessageDeltaNotification);
        }
        if (chunk.finishReason) {
          this.broadcastToRoom(roomId, {
            jsonrpc: '2.0',
            method: 'message.complete',
            params: {
              runId,
              messageId: runMessageId,
              finalMessage: { role: 'assistant', content: [{ type: 'text', text: this.normalizeFinalText(fullResponse) }] },
              usage: chunk.usage,
              authorId: nextAgentId,
              authorType: 'agent',
            },
          });
          // Persist assistant final message
          try {
            await db.insert(DBSchema.messages as any).values({
              id: runMessageId,
              conversationId: roomId,
              authorId: String(nextAgentId),
              authorType: 'agent',
              role: 'assistant',
              content: [{ type: 'text', text: this.normalizeFinalText(fullResponse) }] as any,
              status: 'completed',
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any);
          } catch {}
        }
      }
    } catch (e) {
      console.error('queued agent failed', e);
    }

    // Store messages in memory for this agent
    if (fullResponse) {
      try {
        const userMemoryMessage = {
          id: randomUUID(),
          role: 'user' as const,
          content: userMessage,
          timestamp: new Date(),
          conversationId: roomId,
          agentId: nextAgentId as any,
          metadata: { userId: activeUserId },
        };

        const assistantMemoryMessage = {
          id: randomUUID(),
          role: 'assistant' as const,
          content: fullResponse,
          timestamp: new Date(),
          conversationId: roomId,
          agentId: nextAgentId as any,
          metadata: { userId: activeUserId },
        };

        // Short-term memory (per-agent)
        memoryService.addToShortTerm(nextAgentId, userMemoryMessage as any);
        memoryService.addToShortTerm(nextAgentId, assistantMemoryMessage as any);

        // Long-term memory (Pinecone), guard if not configured inside service
        await memoryService.addToLongTerm(userMemoryMessage.content, {
          agentId: nextAgentId as any,
          conversationId: roomId,
          messageId: userMemoryMessage.id,
          role: 'user',
          timestamp: new Date().toISOString(),
          messageType: 'conversation',
          userId: activeUserId,
        } as any);
        await memoryService.addToLongTerm(assistantMemoryMessage.content, {
          agentId: nextAgentId as any,
          conversationId: roomId,
          messageId: assistantMemoryMessage.id,
          role: 'assistant',
          timestamp: new Date().toISOString(),
          messageType: 'conversation',
          userId: activeUserId,
        } as any);
      } catch (e) {
        console.error('Failed to store memory for agent:', e);
      }
    }

    // Cooldown
    const m = this.roomCooldownUntil.get(roomId) || new Map<string, number>();
    m.set(nextAgentId, Date.now() + cooldownSec * 1000);
    this.roomCooldownUntil.set(roomId, m);

    // Release speaking and continue with next if any
    this.roomSpeaking.delete(roomId);
    if ((this.roomQueue.get(roomId) || []).length > 0) {
      this.processRoomQueue(roomId, userMessage, activeUserId).catch(() => {});
    }
  }

  private async handleCodeSearch(connectionId: string, request: JSONRPCRequest) {
    try {
      const params = (request.params || {}) as any;
      const pattern = String(params.pattern || '').trim();
      if (!pattern) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'pattern is required');
        return;
      }
      const out = await codeSearch({
        pattern,
        path: params.path ? String(params.path) : undefined,
        glob: params.glob ? String(params.glob) : undefined,
        maxResults: params.maxResults ? Number(params.maxResults) : undefined,
        caseInsensitive: !!params.caseInsensitive,
        regex: !!params.regex,
      });
      const roomId = this.getRoomForConnection(connectionId) || 'default-room';
      const runId = randomUUID();
      const toolCallId = randomUUID();
      this.bus.broadcastToolCall(roomId, runId, toolCallId, 'code', 'search', { pattern, path: params.path, glob: params.glob });
      const header = `Code search for "${pattern}": ${out.results.length} hit(s) using ${out.used}`;
      const md = [header]
        .concat(out.results.slice(0, 50).map((r: any) => `- ${r.file}:${r.line} — ${r.text}`))
        .join('\n');
      this.bus.broadcastToRoom(roomId, {
        jsonrpc: '2.0',
        method: 'message.received',
        params: { roomId, messageId: randomUUID(), authorId: connectionId as any, authorType: 'agent', message: md },
      });
      this.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: true });
      this.bus.sendResponse(connectionId, request.id, { ok: true, results: out.results, used: out.used });
    } catch (e: any) {
      console.error('[tool.code.search] error', e);
      this.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, e?.message || 'Code search failed');
    }
  }
}
