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
  RunStatusNotification
} from '../types/protocol.js';
import { LLMRouter, ModelConfigs, SupportedModel } from '../llm/providers.js';
import { ParticipationRouter } from './participation-router.js';
import { terminalService } from '../terminal/terminal-service.js';
import { serpapiService } from '../tools/serpapi-service.js';
import { elevenLabsService } from '../tools/elevenlabs-service.js';
import { memoryService } from '../memory/memory-service.js';
import { db, users, agents } from '../db/index.js';
import * as DBSchema from '../db/schema.js';
import { eq } from 'drizzle-orm';
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

export class WebSocketServer {
  private llmRouter: LLMRouter;
  private connections: Map<string, any> = new Map();
  private rooms: Map<string, Set<string>> = new Map();
  private connectionUserId: Map<string, string> = new Map();
  private lastLinks: Map<string, string[]> = new Map();
  private toolRegistry: ToolRegistry = new ToolRegistry();
  private toolRunner: ToolRunner;
  // Track invited agents per room (roomId -> Set<agentId>)
  private roomAgents: Map<string, Set<string>> = new Map();
  private participationRouter: ParticipationRouter = new ParticipationRouter(5);
  // Turn-taking state
  private roomSpeaking: Set<string> = new Set();
  private roomQueue: Map<string, string[]> = new Map();
  private roomCooldownUntil: Map<string, Map<string, number>> = new Map();
  private bus: WebSocketBus;
  private roomsRegistry: RoomRegistry;
  private orchestrator: AgentOrchestrator;

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
          execute: async (args, ctx) => {
            return await serpapiService.run(String(args.engine || ''), String(args.query || ''), args.extra || undefined)
          },
        },
      },
    }));
    this.toolRegistry.register(new Tool({
      name: 'x',
      functions: {
        tweet: {
          name: 'tweet',
          execute: async (args, ctx) => {
            const text = String(args.text || '').trim();
            if (!text) throw new Error('text is required');
            const userId = this.connectionUserId.get(ctx.connectionId) || 'default-user';
            return await xService.postTweet(userId, text);
          },
        },
        dm: {
          name: 'dm',
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

  register(fastify: FastifyInstance) {
    const self = this;
    fastify.register(async function (fastify: any) {
      fastify.get('/ws', { websocket: true }, self.handleConnection.bind(self));
    });
  }

  private async handleConnection(connection: any, request: any) {
    const connectionId = randomUUID();
    this.connections.set(connectionId, connection as any);

    const ws: any = (connection as any).socket ?? connection;

    console.log(`WebSocket connection established: ${connectionId}`);

    ws.on('message', (data: Buffer) => {
      this.handleMessage(connectionId, data);
    });

    ws.on('close', () => {
      console.log(`WebSocket connection closed: ${connectionId}`);
      this.connections.delete(connectionId);
      const affectedRooms = this.removeFromAllRooms(connectionId);
      // Broadcast updated participants for any affected rooms
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
          console.log(`[routeParticipation] Agent mapping: "${agentName}" -> ${aid}`);
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

      // Echo the user message to the room
      this.bus.broadcastToRoom(roomId, {
        jsonrpc: '2.0',
        method: 'message.received',
        params: {
          roomId,
          messageId: randomUUID(),
          authorId: connectionId,
          authorType: 'user',
          message,
        },
      });

      // Start agent run
      const runId = randomUUID();
      const messageId = randomUUID();
      
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
          messageId,
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
      const DEFAULT_USER_ID = 'default-user';
      const activeUserId = this.connectionUserId.get(connectionId) || DEFAULT_USER_ID;
      let userProfile = null;
      try {
        const userRows = await db.select().from(users).where(eq(users.id, activeUserId));
        if (userRows.length > 0) {
          userProfile = userRows[0];
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      }

      const shortTermMemory = memoryService.getShortTerm(activeUserId);
      
      // Get relevant long-term memory
      const userMessage = message.content.map(part => part.text).join('');
      const relevantMemories = await (activeUserId
        ? memoryService.searchLongTermByUser(activeUserId, userMessage, 3, { agentId: roomId as any, roomId: roomId as any })
        : memoryService.searchLongTerm(connectionId, userMessage, 3));
      
      // Build context from user profile and memories
      let memoryContext = '';
      memoryContext += buildUserProfileContext(userProfile);
      if (relevantMemories.length > 0) {
        memoryContext += `\nRelevant Context from Previous Conversations:\n`;
        relevantMemories.forEach(memory => {
          memoryContext += `- ${memory.content}\n`;
        });
      }

      // Resolve agent persona and settings by roomId (treat roomId as agentId)
      let agentName = '';
      let agentPersona = '';
      let autoExecuteTools = false;
      let isAgentRoom = false;
      try {
        const { db, agents } = await import('../db/index.js');
        const { eq } = await import('drizzle-orm');
        const rows = await db.select().from(agents).where(eq(agents.id, roomId as any));
        if (rows.length > 0) {
          isAgentRoom = true;
          const a: any = rows[0];
          agentName = a.name || '';
          autoExecuteTools = a.autoExecuteTools || false;
          const instr: string = a.instructions || '';
          const desc = a.description ? `Description: ${a.description}` : '';
          // Extract Personality and Extra instructions blocks if present
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

      // Stream LLM response via orchestrator (primary agent = roomId)
      this.roomSpeaking.add(roomId);
      const { fullResponse } = await this.orchestrator.streamPrimaryAgentResponse({
        roomId,
        activeUserId,
        connectionId,
        agentRecord: isAgentRoom ? (await db.select().from(agents).where(eq(agents.id as any, roomId as any)))[0] : null,
        userProfile,
        userMessage,
        runOptions: { model, temperature: runOptions?.temperature, budget: runOptions?.budget },
        onDelta: (delta: string) => {
          this.bus.broadcastToRoom(roomId, {
            jsonrpc: '2.0',
            method: 'message.delta',
            params: { roomId, messageId, delta, authorId: roomId, authorType: 'agent' },
          } as MessageDeltaNotification);
        },
      });

      // Send completion notification
      this.bus.broadcastToRoom(roomId, {
        jsonrpc: '2.0',
        method: 'message.complete',
        params: {
          runId,
          messageId,
          finalMessage: {
            role: 'assistant',
            content: [{ type: 'text', text: fullResponse }],
          },
          authorId: roomId,
          authorType: 'agent',
        },
      });

      // Primary finished speaking
      this.roomSpeaking.delete(roomId);

      // Participation routing (enqueue other invited agents if relevant)
      try {
        const candidates = await this.routeParticipation(roomId, userMessage);
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
        content: fullResponse,
        timestamp: new Date(),
        conversationId: roomId,
        agentId: roomId as any,
        metadata: { userId: activeUserId },
      };

      // Check for auto-executable commands if autoExecuteTools is enabled
      if (autoExecuteTools) {
        const autoExecutableCommands = this.extractAutoExecutableCommands(fullResponse);
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
          } catch (error) {
            console.error(`[auto-execute] Error executing command "${command}":`, error);
          }
        }
      }

      // Add to short-term memory
      memoryService.addToShortTerm(activeUserId, userMemoryMessage);
      memoryService.addToShortTerm(activeUserId, assistantMemoryMessage);

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

      await memoryService.addToLongTerm(fullResponse, ({
        agentId: roomId as any,
        conversationId: roomId,
        messageId: messageId + '-assistant',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        messageType: 'conversation',
        userId: activeUserId,
      } as any));

      // Check if we should perform reflection
      if (await memoryService.shouldReflect(activeUserId)) {
        await memoryService.performReflection(activeUserId);
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
      // Capture last links if present (news or organic)
      try {
        const raw = (result as any).raw || {};
        let links: string[] = [];
        if (Array.isArray(raw.news_results) && raw.news_results.length) {
          links = raw.news_results.map((n: any) => n.link).filter((u: any) => typeof u === 'string');
        } else if (Array.isArray(raw.organic_results) && raw.organic_results.length) {
          links = raw.organic_results.map((r: any) => r.link).filter((u: any) => typeof u === 'string');
        }
        if (links.length) this.lastLinks.set(connectionId, links);
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
      const { index } = (request.params || {}) as { index?: number };
      if (!index || index < 1) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'index must be >= 1');
        return;
      }
      const links = this.lastLinks.get(connectionId) || [];
      const url = links[index - 1];
      if (!url) {
        this.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, `No URL for index ${index}`);
        return;
      }
      const runId = randomUUID();
      const toolCallId = randomUUID();
      console.log('[web.scrape.pick] index=', index, 'url=', url);
      const result = await webScraperService.scrape(url);
      const roomId = this.getRoomForConnection(connectionId) || 'default-room';
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
    const { roomId, userId } = request.params as { roomId: string; userId?: string };
    
    this.roomsRegistry.addConnection(roomId, connectionId, userId);
    
    this.bus.sendResponse(connectionId, request.id, { 
      roomId, 
      status: 'joined',
      participants: Array.from(this.rooms.get(roomId)!),
    });

    // Notify room with enriched participants list
    await this.broadcastParticipants(roomId);
  }

  private async handleRoomLeave(connectionId: string, request: JSONRPCRequest) {
    const { roomId } = request.params;
    
    this.roomsRegistry.removeConnection(roomId, connectionId);
    
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
        const personality = personalityMatch ? personalityMatch[1].trim() : '';
        const extra = extraMatch ? extraMatch[1].trim() : '';
        const desc = a.description ? `Description: ${a.description}` : '';
        
        agentPersona = [
          agentName ? `Agent Name: ${agentName}` : '',
          desc,
          personality ? `Personality: ${personality}` : '',
          extra ? `Extra instructions: ${extra}` : '',
        ].filter(Boolean).join('\n');
      }
    } catch {}

    const runId = randomUUID();
    const messageId = randomUUID();
    this.broadcastToRoom(roomId, {
      jsonrpc: '2.0',
      method: 'run.status',
      params: { runId, status: 'running', startedAt: new Date().toISOString() },
    } as RunStatusNotification);

    // Load Pinecone memory for this agent
    let memoryContext = '';
    try {
      const memoryResults = await memoryService.searchLongTerm(nextAgentId, userMessage, 5);
      
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
            params: { roomId, messageId, delta: chunk.delta, authorId: nextAgentId, authorType: 'agent' },
          } as MessageDeltaNotification);
        }
        if (chunk.finishReason) {
          this.broadcastToRoom(roomId, {
            jsonrpc: '2.0',
            method: 'message.complete',
            params: {
              runId,
              messageId,
              finalMessage: { role: 'assistant', content: [{ type: 'text', text: fullResponse }] },
              usage: chunk.usage,
              authorId: nextAgentId,
              authorType: 'agent',
            },
          });
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
}
