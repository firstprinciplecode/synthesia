/*
  SuperAgent WebSocket JSON-RPC client
  - Exposes a small API used by ChatInterface
  - Handles notifications: message.received|delta|complete, terminal.result, agent.analysis, room.participants, tool.call, tool.result
  - Provides tool helpers: serpapi.*, x.*, elevenlabs.tts, web.scrape(.pick)
*/

export type ChatRole = 'user' | 'assistant' | 'system' | 'terminal';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  streaming?: boolean;
  // Optional identity for assistant
  agentName?: string;
  agentAvatar?: string;
  // Optional identity for user
  userName?: string;
  userAvatar?: string;
  // Raw author identity passthrough from server
  authorId?: string;
  authorType?: string;
  // Terminal specific
  terminalResult?: {
    command: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  };
}

type JSONValue = unknown;

type OnMessage = (message: ChatMessage) => void;
type OnMessageDelta = (messageId: string, delta: string, authorId?: string, authorType?: string) => void;
type OnConnect = () => void;
type OnDisconnect = () => void;
type OnError = (err: unknown) => void;
type OnAgentAnalysis = (content: string, authorId?: string, authorType?: string) => void;
type OnParticipantsUpdate = (payload: { roomId: string; participants: Array<{ id: string; type: 'user'|'agent'; name: string; avatar?: string | null; status?: string }>; updatedAt: string }) => void;
type OnToolCall = (payload: { runId: string; toolCallId: string; tool: string; function: string; args: Record<string, JSONValue> }) => void;
type OnToolResult = (payload: { runId: string; toolCallId: string; result?: JSONValue; error?: string }) => void;
type OnTyping = (payload: { roomId: string; typing: Array<{ actorId: string; type?: 'user'|'agent' }>; updatedAt: string }) => void;
type OnReceipts = (payload: { roomId: string; messageId: string; actorIds: string[]; updatedAt: string }) => void;

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, JSONValue> | undefined;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string;
  result?: JSONValue;
  error?: { code: number; message: string; data?: unknown };
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, JSONValue>;
}

export class SuperAgentWebSocket {
  private url: string;
  private ws: WebSocket | null = null;
  private connected = false;
  private requestResolvers: Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }> = new Map();
  private dedupeInFlight: Map<string, Promise<unknown>> = new Map();
  private lastResultIdByRoom: Map<string, string> = new Map();
  private pendingResultWaiters: Map<string, Array<(rid: string) => void>> = new Map();

  private onMessage: OnMessage;
  private onMessageDelta: OnMessageDelta;
  private onConnect?: OnConnect;
  private onDisconnect?: OnDisconnect;
  private onError?: OnError;
  private onAgentAnalysis?: OnAgentAnalysis;
  private onParticipantsUpdate?: OnParticipantsUpdate;
  private onToolCall?: OnToolCall;
  private onToolResult?: OnToolResult;
  private onTyping?: OnTyping;
  private onReceipts?: OnReceipts;

  constructor(
    url: string,
    onMessage: OnMessage,
    onMessageDelta: OnMessageDelta,
    onConnect?: OnConnect,
    onDisconnect?: OnDisconnect,
    onError?: OnError,
    _onMessageReceived?: (payload: unknown) => void, // reserved, not used currently
    onAgentAnalysis?: OnAgentAnalysis,
    onParticipantsUpdate?: OnParticipantsUpdate,
    onToolCall?: OnToolCall,
    onToolResult?: OnToolResult,
    onTyping?: OnTyping,
    onReceipts?: OnReceipts,
  ) {
    this.url = url;
    this.onMessage = onMessage;
    this.onMessageDelta = onMessageDelta;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
    this.onError = onError;
    this.onAgentAnalysis = onAgentAnalysis;
    this.onParticipantsUpdate = onParticipantsUpdate;
    this.onToolCall = onToolCall;
    this.onToolResult = onToolResult;
    this.onTyping = onTyping;
    this.onReceipts = onReceipts;
  }

  // Expose latest stable resultId for the given room, if known
  getLastResultId(roomId: string): string | undefined {
    return this.lastResultIdByRoom.get(roomId);
  }

  isConnected(): boolean {
    return this.connected && !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;
    await new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => {
          this.connected = true;
          if (this.onConnect) this.onConnect();
          resolve();
        };
        this.ws.onclose = () => {
          this.connected = false;
          if (this.onDisconnect) this.onDisconnect();
        };
        this.ws.onerror = (ev: Event) => {
          const err: unknown = (ev as unknown as { error?: unknown })?.error || new Error(`WebSocket error (${this.url})`);
          if (this.onError) this.onError(err);
          try { this.ws?.close(); } catch {}
          this.connected = false;
          reject(err);
        };
        this.ws.onmessage = (evt: MessageEvent<string>) => {
          this.handleIncoming(evt.data);
        };
      } catch (e) {
        reject(e as unknown);
      }
    });
  }

  disconnect(): void {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    } catch {}
    this.connected = false;
  }

  private nextId(): string {
    try {
      // @ts-expect-error - crypto may be undefined in some environments
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch {}
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private sendRaw(obj: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not connected');
    this.ws.send(JSON.stringify(obj));
  }

  private async sendRequest(method: string, params?: Record<string, JSONValue>): Promise<unknown> {
    const id = this.nextId();
    const req: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      this.requestResolvers.set(id, { resolve, reject });
    });
    this.sendRaw(req);
    return promise;
  }

  // Dedupe by (method, params) key while an identical request is in flight
  private async sendRequestDedupe(method: string, params?: Record<string, JSONValue>): Promise<unknown> {
    const key = `${method}:${JSON.stringify(params || {})}`;
    const existing = this.dedupeInFlight.get(key);
    if (existing) return existing;
    const p = this.sendRequest(method, params).finally(() => this.dedupeInFlight.delete(key));
    this.dedupeInFlight.set(key, p);
    return p;
  }

  // Handle inbound JSON-RPC messages
  private handleIncoming(data: string): void {
    let obj: unknown;
    try { obj = JSON.parse(data); } catch { return; }

    // Response
    if (typeof obj === 'object' && obj && (obj as { jsonrpc?: string }).jsonrpc === '2.0' && (obj as { result?: unknown; error?: unknown }).result !== undefined || (obj as { error?: unknown }).error) {
      const res = obj as JSONRPCResponse;
      const pending = this.requestResolvers.get(res.id);
      if (pending) {
        this.requestResolvers.delete(res.id);
        if (res.error) {
          try {
            const msg = String(res.error.message || '');
            if (/No URL for index/i.test(msg)) {
              console.warn('[tool] web.scrape.pick error:', msg);
            }
          } catch {}
          pending.reject(new Error(res.error.message || 'JSON-RPC error'));
        }
        else pending.resolve(res.result);
      }
      return;
    }

    // Notification
    if (typeof obj === 'object' && obj && (obj as { jsonrpc?: string }).jsonrpc === '2.0' && (obj as { method?: string }).method) {
      const { method, params } = obj as { method: string; params?: Record<string, JSONValue> };
      const extractText = (m: JSONValue): string => {
        if (!m) return '';
        if (typeof m === 'string') return m;
        // OpenAI-style content array
        if (typeof (m as { content?: unknown }).content !== 'undefined' && Array.isArray((m as { content?: unknown[] }).content)) {
          try {
            return ((m as { content: Array<{ text?: string }> }).content).map((c) => (typeof c?.text === 'string' ? c.text : '')).join('');
          } catch { return ''; }
        }
        // Fallback: try common fields
        if (typeof (m as { text?: string }).text === 'string') return (m as { text?: string }).text as string;
        return '';
      };
      switch (method) {
        case 'message.received': {
          const m: ChatMessage = {
            id: params?.messageId || this.nextId(),
            role: params?.authorType === 'user' ? 'user' : 'assistant',
            content: extractText(params?.message),
            timestamp: new Date(),
            authorId: params?.authorId,
            authorType: params?.authorType,
            // passthrough user id so UI can label sender correctly in DMs
            ...(params?.authorUserId ? { authorUserId: params.authorUserId as string } : {}),
            ...(params?.authorName && params?.authorType === 'user' ? { userName: params.authorName as string } : {}),
            ...(params?.authorAvatar && params?.authorType === 'user' ? { userAvatar: params.authorAvatar as string } : {}),
            ...(params?.authorName && params?.authorType === 'agent' ? { agentName: params.authorName as string } : {}),
            ...(params?.authorAvatar && params?.authorType === 'agent' ? { agentAvatar: params.authorAvatar as string } : {}),
            streaming: false,
          };
          this.onMessage(m);
          break;
        }
        case 'message.delta': {
          const messageId: string = params?.messageId || this.nextId();
          const delta: string = String(params?.delta || '');
          const authorId: string | undefined = params?.authorId;
          const authorType: string | undefined = params?.authorType;
          this.onMessageDelta(messageId, delta, authorId, authorType);
          break;
        }
        case 'message.complete': {
          const m: ChatMessage = {
            id: params?.messageId || this.nextId(),
            role: params?.authorType === 'user' ? 'user' : 'assistant',
            content: extractText(params?.finalMessage ?? params?.message),
            timestamp: new Date(),
            authorId: params?.authorId,
            authorType: params?.authorType,
            streaming: false,
          };
          if (params?.authorType === 'user') {
            if (typeof params?.authorName === 'string') m.userName = params.authorName;
            if (typeof params?.authorAvatar === 'string') m.userAvatar = params.authorAvatar;
          } else if (params?.authorType === 'agent') {
            if (typeof params?.authorName === 'string') m.agentName = params.authorName;
            if (typeof params?.authorAvatar === 'string') m.agentAvatar = params.authorAvatar;
          }
          this.onMessage(m);
          break;
        }
        case 'terminal.result': {
          const res = params || {};
          const term: ChatMessage = {
            id: res.messageId || this.nextId(),
            role: 'terminal',
            content: `$ ${res?.command || ''}`.trim(),
            timestamp: new Date(),
            terminalResult: {
              command: String(res?.command || ''),
              stdout: typeof res?.stdout === 'string' ? res.stdout : undefined,
              stderr: typeof res?.stderr === 'string' ? res.stderr : undefined,
              exitCode: typeof res?.exitCode === 'number' ? res.exitCode : undefined,
            },
          };
          this.onMessage(term);
          break;
        }
        case 'agent.analysis': {
          if (this.onAgentAnalysis) this.onAgentAnalysis(String(params?.content || ''), params?.authorId, params?.authorType);
          break;
        }
        case 'room.participants': {
          const payload = params as Parameters<NonNullable<typeof this.onParticipantsUpdate>>[0];
          this.onParticipantsUpdate?.(payload);
          break;
        }
        case 'tool.call': {
          if (this.onToolCall) this.onToolCall(params);
          break;
        }
        case 'tool.result': {
          if (this.onToolResult) this.onToolResult(params);
          break;
        }
        case 'room.typing': {
          if (this.onTyping) this.onTyping(params);
          break;
        }
        case 'message.receipts': {
          if (this.onReceipts) this.onReceipts(params);
          break;
        }
        case 'search.results': {
          const rid = String(params?.resultId || '');
          const roomId = String(params?.roomId || '');
          if (rid && roomId) this.lastResultIdByRoom.set(roomId, rid);
          if (rid && roomId) {
            const arr = this.pendingResultWaiters.get(roomId);
            if (arr && arr.length) {
              this.pendingResultWaiters.set(roomId, []);
              for (const fn of arr) {
                try { fn(rid); } catch {}
              }
            }
          }
          break;
        }
        default:
          // ignore unknown notifications
          break;
      }
    }
  }

  // Public API used by ChatInterface
  async joinRoom(roomId: string, userId?: string): Promise<unknown> {
    return this.sendRequestDedupe('room.join', { roomId, userId });
  }

  async markMessageRead(roomId: string, messageId: string, actorId?: string): Promise<unknown> {
    return this.sendRequest('message.read', { roomId, messageId, ...(actorId ? { actorId } : {}) });
  }

  async typingStart(roomId: string, actorId?: string, ttlMs?: number): Promise<unknown> {
    return this.sendRequest('typing.start', { roomId, ...(actorId ? { actorId } : {}), ...(ttlMs ? { ttlMs } : {}) });
  }

  async typingStop(roomId: string, actorId?: string): Promise<unknown> {
    return this.sendRequest('typing.stop', { roomId, ...(actorId ? { actorId } : {}) });
  }

  async sendMessage(roomId: string, content: string, options?: Record<string, JSONValue>): Promise<unknown> {
    // Send as notification and rely on message.delta/message.complete for UI updates
    const message = {
      role: 'user',
      content: [{ type: 'text', text: content }],
    } as const;
    try {
      // Prefer notification to avoid waiting for ACKs
      this.sendRaw({
        jsonrpc: '2.0',
        method: 'message.create',
        params: { roomId, message, runOptions: options },
      });
      return Promise.resolve({ status: 'queued' });
    } catch {
      // Fallback to request if needed
      return this.sendRequest('message.create', { roomId, message, runOptions: options });
    }
  }

  async executeTerminalCommand(command: string, roomId: string): Promise<unknown> {
    return this.sendRequest('terminal.execute', { roomId, command });
  }

  async executeAgentCommand(command: string, roomId: string, reason?: string): Promise<unknown> {
    return this.sendRequest('agent.execute', { roomId, command, reason });
  }

  // ElevenLabs
  async elevenlabsTTS(text: string, voiceId?: string, format: 'mp3'|'wav'|'ogg'|'webm' = 'mp3'): Promise<{ contentType: string; base64: string }> {
    return this.sendRequest('tool.elevenlabs.tts', { text, voiceId, format });
  }

  // SerpAPI helpers
  async serpapiSearch(query: string, roomId: string, num = 5, agentId?: string): Promise<unknown> {
    return this.sendRequestDedupe('tool.serpapi.search', { roomId, query, num, ...(agentId ? { agentId } : {}) });
  }

  async serpapiImages(query: string, roomId: string, num = 6, agentId?: string): Promise<unknown> {
    return this.sendRequestDedupe('tool.serpapi.images', { roomId, query, num, ...(agentId ? { agentId } : {}) });
  }

  async serpapiRun(engine: string, query: string, roomId: string, extra?: Record<string, JSONValue>, agentId?: string): Promise<unknown> {
    return this.sendRequestDedupe('tool.serpapi.run', { roomId, engine, query, extra, ...(agentId ? { agentId } : {}) });
  }

  // Web scraper
  async webScrape(url: string, roomId: string, agentId?: string): Promise<unknown> {
    return this.sendRequest('tool.web.scrape', { roomId, url, ...(agentId ? { agentId } : {}) });
  }

  async webScrapePick(index: number, roomId: string, agentId?: string, resultId?: string): Promise<unknown> {
    const rid = resultId || this.lastResultIdByRoom.get(roomId);
    return this.sendRequest('tool.web.scrape.pick', { roomId, index, ...(rid ? { resultId: rid } : {}), ...(agentId ? { agentId } : {}) });
  }

  // Code search
  async codeSearch(
    pattern: string,
    roomId: string,
    options?: { path?: string; glob?: string; maxResults?: number; caseInsensitive?: boolean; regex?: boolean },
    agentId?: string,
  ): Promise<unknown> {
    const params: Record<string, JSONValue> = { roomId, pattern, ...(options || {}) };
    if (agentId) params.agentId = agentId;
    return this.sendRequest('tool.code.search', params);
  }

  // X/Twitter
  async xSearch(query: string, roomId: string, num = 5, agentId?: string): Promise<unknown> {
    return this.sendRequest('tool.x.search', { roomId, query, extra: { num }, ...(agentId ? { agentId } : {}) });
  }

  async xLists(handle: string, roomId: string, agentId?: string): Promise<unknown> {
    return this.sendRequest('tool.x.lists', { roomId, handle, ...(agentId ? { agentId } : {}) });
  }

  async xTweet(text: string, roomId: string, media?: { url: string }[], agentId?: string): Promise<unknown> {
    return this.sendRequest('tool.x.tweet', { roomId, text, media, ...(agentId ? { agentId } : {}) });
  }

  async xDm(handle: string, text: string, roomId: string, agentId?: string): Promise<unknown> {
    return this.sendRequest('tool.x.dm', { roomId, handle, text, ...(agentId ? { agentId } : {}) });
  }
}

// WebSocket client for SuperAgent JSON-RPC protocol

 

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

export interface MessageContent {
  role: 'user' | 'assistant' | 'system';
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

 

// Legacy client below (kept for reference). Disable duplicate export by renaming.
/* eslint-disable @typescript-eslint/no-explicit-any */
export class SuperAgentWebSocketLegacy {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private messageHandlers = new Map<string, (message: JSONRPCMessage) => void>();
  private pendingRequests = new Map<string, {
    resolve: (result: any) => void;
    reject: (error: any) => void;
  }>();
  // Dedupe in-flight tool calls by (method + normalized args)
  private inflightByKey = new Map<string, Promise<any>>();

  constructor(
    private url: string,
    private onMessage?: (message: ChatMessage) => void,
    private onMessageDelta?: (messageId: string, delta: string, authorId?: string, authorType?: string) => void,
    private onConnect?: () => void,
    private onDisconnect?: () => void,
    private onError?: (error: Event) => void,
    private onTerminalResult?: (result: any) => void,
    private onAgentAnalysis?: (content: string, authorId?: string, authorType?: string) => void,
    private onParticipantsUpdate?: (payload: { roomId: string; participants: Array<{ id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string }>; updatedAt: string }) => void,
    private onToolCall?: (payload: { runId: string; toolCallId: string; tool: string; function: string; args: Record<string, any> }) => void,
    private onToolResult?: (payload: { runId: string; toolCallId: string; result?: any; error?: string }) => void
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          this.onConnect?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: JSONRPCMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.onDisconnect?.();
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.onError?.(error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(message: JSONRPCMessage) {
    // Handle responses to requests
    if ('id' in message && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if ('error' in message && message.error) {
        pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      } else if ('result' in message) {
        pending.resolve(message.result);
      }
      return;
    }

    // Handle notifications
    if ('method' in message) {
      switch (message.method) {
        case 'message.received':
          this.handleMessageReceived(message.params);
          break;
        case 'message.delta':
          this.handleMessageDelta(message.params);
          break;
        case 'message.complete':
          this.handleMessageComplete(message.params);
          break;
        case 'run.status':
          console.log('Run status:', message.params);
          break;
        case 'terminal.result':
          this.handleTerminalResult(message.params);
          break;
        case 'agent.executed':
          this.handleAgentExecuted(message.params);
          break;
        case 'agent.analysis':
          this.onAgentAnalysis?.(message.params.content, message.params.authorId, message.params.authorType);
          break;
        case 'room.participants':
          console.log('WebSocket received room.participants:', message.params);
          {
            const payload = message.params as Parameters<NonNullable<typeof this.onParticipantsUpdate>>[0];
            this.onParticipantsUpdate?.(payload);
          }
          break;
        case 'tool.call':
          this.onToolCall?.(message.params as any);
          break;
        case 'tool.result':
          this.onToolResult?.(message.params as any);
          break;
        default:
          console.log('Unhandled notification:', message.method, message.params);
      }
    }
  }

  private handleMessageReceived(params: any) {
    if (params.authorType === 'user') {
      // User message echoed back
      const message: ChatMessage = {
        id: params.messageId,
        role: 'user',
        content: Array.isArray(params.message?.content)
          ? params.message.content.map((c: any) => c.text).join('')
          : (typeof params.message === 'string' ? params.message : ''),
        timestamp: new Date(),
      };
      this.onMessage?.(message);
      return;
    }

    // Accept assistant/tool/system messages pushed via message.received (e.g., SerpAPI, scraper, queue notices)
    if (params.authorType === 'assistant' || params.authorType === 'system' || params.authorType === 'agent') {
      const content = Array.isArray(params.message?.content)
        ? params.message.content.map((c: any) => c.text).join('')
        : (typeof params.message === 'string' ? params.message : '');
      const message: ChatMessage = {
        id: params.messageId,
        role: params.authorType === 'system' ? 'assistant' : 'assistant',
        content,
        timestamp: new Date(),
        streaming: false,
      } as any;
      (message as any).authorId = params.authorId;
      (message as any).authorType = params.authorType;
      this.onMessage?.(message);
      return;
    }
  }

  private handleMessageDelta(params: any) {
    this.onMessageDelta?.(params.messageId, params.delta, params.authorId, params.authorType);
  }

  private handleMessageComplete(params: any) {
    const message: ChatMessage = {
      id: params.messageId,
      role: 'assistant',
      content: params.finalMessage.content.map((c: any) => c.text).join(''),
      timestamp: new Date(),
      streaming: false,
    } as any;
    (message as any).authorId = params.authorId;
    (message as any).authorType = params.authorType;
    this.onMessage?.(message);
  }

  private handleTerminalResult(params: any) {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'terminal',
      content: `$ ${params.command}`,
      timestamp: new Date(),
      terminalResult: {
        command: params.command,
        stdout: params.stdout,
        stderr: params.stderr,
        exitCode: params.exitCode,
      },
    };
    this.onMessage?.(message);
    this.onTerminalResult?.(params);
  }

  private handleAgentExecuted(params: any) {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'terminal',
      content: `Agent executed: ${params.reason || 'Terminal command'}`,
      timestamp: new Date(),
      terminalResult: {
        command: params.command,
        stdout: params.stdout,
        stderr: params.stderr,
        exitCode: params.exitCode,
      },
    };
    this.onMessage?.(message);
    this.onTerminalResult?.(params);
  }

  private handleAgentAnalysis(params: any) {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: params.content,
      timestamp: new Date(),
    };
    this.onMessage?.(message);
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
  }

  async joinRoom(roomId: string, userId?: string): Promise<any> {
    // Fire-and-forget to avoid blocking UI on ACK
    this.sendNotification('room.join', { roomId, userId });
    return Promise.resolve({ status: 'queued' });
  }

  // Best-effort invite (backend may ignore if not implemented)
  inviteParticipant(roomId: string, participant: { type: 'user' | 'agent'; id: string }) {
    this.sendNotification('room.invite', { roomId, participant });
  }

  // Best-effort remove participant (backend may ignore if not implemented)
  removeParticipant(roomId: string, participantId: string, participantType: 'user' | 'agent') {
    this.sendNotification('room.remove', { roomId, participantId, participantType });
  }

  // Create a new conversation (room) with specific agents and optional users
  async createRoom(agentIds: string[], userIds?: string[], title?: string): Promise<{ roomId: string }> {
    return this.sendRequest('room.create', { agentIds, userIds, title, type: 'agent_chat' });
  }

  async sendMessage(roomId: string, content: string, options?: {
    model?: string;
    provider?: string;
    temperature?: number;
  }): Promise<any> {
    const message: MessageContent = {
      role: 'user',
      content: [{ type: 'text', text: content }],
    };

    // Send as notification. We rely on message.delta/message.complete events for UI.
    this.sendNotification('message.create', {
      roomId,
      message,
      runOptions: options,
    });
    return Promise.resolve({ status: 'queued' });
  }

  async executeTerminalCommand(command: string, roomId: string, agentId?: string): Promise<any> {
    return this.sendRequest('terminal.execute', {
      command,
      roomId,
      agentId,
    });
  }

  async executeAgentCommand(command: string, roomId: string, reason?: string): Promise<any> {
    return this.sendRequest('agent.execute', {
      command,
      roomId,
      reason,
    });
  }

  async serpapiSearch(query: string, roomId: string, num?: number, agentId?: string): Promise<any> {
    return this.sendRequest('tool.serpapi.search', {
      roomId,
      query,
      num,
      ...(agentId ? { agentId } : {}),
    });
  }

  async serpapiImages(query: string, roomId: string, num?: number, agentId?: string): Promise<any> {
    return this.sendRequest('tool.serpapi.images', {
      roomId,
      query,
      num,
      ...(agentId ? { agentId } : {}),
    });
  }

  async serpapiRun(engine: string, query: string, roomId: string, extra?: Record<string, any>, agentId?: string): Promise<any> {
    return this.sendRequestDedupe('tool.serpapi.run', {
      roomId,
      engine,
      query,
      extra,
      ...(agentId ? { agentId } : {}),
    });
  }

  async elevenlabsTTS(text: string, voiceId?: string, format: 'mp3' | 'wav' = 'mp3'): Promise<{ contentType: string; base64: string }> {
    return this.sendRequest('tool.elevenlabs.tts', {
      text,
      voiceId,
      format,
    });
  }

  async webScrape(url: string, roomId: string, agentId?: string): Promise<any> {
    return this.sendRequestDedupe('tool.web.scrape', {
      roomId,
      url,
      ...(agentId ? { agentId } : {}),
    });
  }

  async webScrapePick(index: number, roomId: string, agentId?: string, resultId?: string): Promise<any> {
    // Do not depend on legacy internals here; only pass resultId if provided
    return this.sendRequestDedupe('tool.web.scrape.pick', {
      roomId,
      index,
      ...(resultId ? { resultId } : {}),
      ...(agentId ? { agentId } : {}),
    });
  }

  // X (Twitter) tool methods
  async xSearch(query: string, roomId: string, max?: number, agentId?: string): Promise<any> {
    return this.sendRequestDedupe('tool.x.search', {
      roomId,
      query,
      max,
      ...(agentId ? { agentId } : {}),
    });
  }

  async xTweet(text: string, roomId: string, agentId?: string): Promise<any> {
    return this.sendRequest('tool.x.tweet', {
      roomId,
      text,
      ...(agentId ? { agentId } : {}),
    });
  }

  async xDm(recipientId: string, text: string, roomId: string, agentId?: string): Promise<any> {
    return this.sendRequest('tool.x.dm', {
      roomId,
      recipientId,
      text,
      ...(agentId ? { agentId } : {}),
    });
  }

  async xLists(usernameOrEmpty: string | undefined, roomId: string, agentId?: string): Promise<any> {
    return this.sendRequestDedupe('tool.x.lists', {
      roomId,
      ...(usernameOrEmpty ? { username: usernameOrEmpty } : {}),
      ...(agentId ? { agentId } : {}),
    });
  }

  private sendRequest(method: string, params: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = crypto.randomUUID();
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  // Normalized JSON stringify (sorted keys) to ensure stable dedupe keys
  private stableStringify(obj: any): string {
    const allKeys: string[] = [];
    JSON.stringify(obj, (key, value) => { allKeys.push(key); return value; });
    allKeys.sort();
    return JSON.stringify(obj, allKeys as any);
  }

  private sendRequestDedupe(method: string, params: Record<string, any>, windowMs: number = 5000): Promise<any> {
    const key = `${method}:${this.stableStringify(params)}`;
    const existing = this.inflightByKey.get(key);
    if (existing) {
      return existing;
    }
    const p = this.sendRequest(method, params)
      .finally(() => {
        // Clear dedupe after the window to block rapid double-fires
        setTimeout(() => this.inflightByKey.delete(key), windowMs);
      });
    this.inflightByKey.set(key, p);
    return p;
  }

  private sendNotification(method: string, params: Record<string, any>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.ws.send(JSON.stringify(notification));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
