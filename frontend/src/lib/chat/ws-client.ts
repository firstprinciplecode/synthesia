import { SuperAgentWebSocket, ChatMessage } from '@/lib/websocket';
import { enrichAssistantIdentity, upsertMessage } from './message-pipeline';

type Participant = { id: string; type: 'user'|'agent'; name: string; avatar?: string | null; status?: string };

export interface WSDependencies {
  wsUrl: string;
  getParticipants: () => Participant[];
  getDefaults: () => { name?: string; avatarUrl?: string };
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (err: any) => void;
  onMessage?: (m: ChatMessage) => void;
  onMessageDelta?: (messageId: string, delta: string, authorId?: string, authorType?: string) => void;
  onToolCall?: (payload: any) => void;
  onToolResult?: (payload: any) => void;
  onParticipants?: (payload: { roomId: string; participants: Participant[]; updatedAt: string }) => void;
}

export class WSClient {
  private client: SuperAgentWebSocket;
  constructor(private deps: WSDependencies) {
    const { wsUrl } = deps;
    this.client = new SuperAgentWebSocket(
      wsUrl,
      (m) => this.handleMessage(m),
      (id, delta, authorId, authorType) => deps.onMessageDelta?.(id, delta, authorId, authorType),
      () => deps.onConnected?.(),
      () => deps.onDisconnected?.(),
      (e) => deps.onError?.(e),
      undefined,
      undefined,
      (payload) => deps.onParticipants?.(payload),
      (payload) => deps.onToolCall?.(payload),
      (payload) => deps.onToolResult?.(payload),
    );
  }

  private handleMessage(m: ChatMessage) {
    if (m.role === 'assistant') {
      const withIdentity = enrichAssistantIdentity(m, {
        participants: this.deps.getParticipants(),
        defaultAgentName: this.deps.getDefaults().name,
        defaultAgentAvatar: this.deps.getDefaults().avatarUrl,
      });
      this.deps.onMessage?.(withIdentity);
      return;
    }
    this.deps.onMessage?.(m);
  }

  connect() { return this.client.connect(); }
  disconnect() { return this.client.disconnect(); }
  isConnected() { return this.client.isConnected(); }
  joinRoom(roomId: string, userId?: string) { return this.client.joinRoom(roomId, userId); }
  sendMessage(roomId: string, content: string, options?: Record<string, any>) { return this.client.sendMessage(roomId, content, options); }
  executeTerminalCommand(command: string, roomId: string) { return this.client.executeTerminalCommand(command, roomId); }
  executeAgentCommand(command: string, roomId: string, reason?: string) { return this.client.executeAgentCommand(command, roomId, reason); }
  elevenlabsTTS(text: string, voiceId?: string, format?: any) { return this.client.elevenlabsTTS(text, voiceId, format); }
  serpapiSearch(query: string, roomId: string, num?: number, agentId?: string) { return this.client.serpapiSearch(query, roomId, num, agentId); }
  serpapiImages(query: string, roomId: string, num?: number, agentId?: string) { return this.client.serpapiImages(query, roomId, num, agentId); }
  serpapiRun(engine: string, query: string, roomId: string, extra?: Record<string, any>, agentId?: string) { return this.client.serpapiRun(engine, query, roomId, extra, agentId); }
  webScrape(url: string, roomId: string, agentId?: string) { return this.client.webScrape(url, roomId, agentId); }
  webScrapePick(index: number, roomId: string, agentId?: string) { return this.client.webScrapePick(index, roomId, agentId); }
  xSearch(query: string, roomId: string, num?: number, agentId?: string) { return this.client.xSearch(query, roomId, num, agentId); }
  xLists(handle: string, roomId: string, agentId?: string) { return this.client.xLists(handle, roomId, agentId); }
  xTweet(text: string, roomId: string, media?: { url: string }[], agentId?: string) { return this.client.xTweet(text, roomId, media, agentId); }
  xDm(handle: string, text: string, roomId: string, agentId?: string) { return this.client.xDm(handle, text, roomId, agentId); }
}


