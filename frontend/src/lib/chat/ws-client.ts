import { SuperAgentWebSocket, ChatMessage } from '@/lib/websocket';
import { enrichAssistantIdentity, upsertMessage } from './message-pipeline';
import type { useUnreadStore } from '@/stores/unread-store';

type Participant = { id: string; type: 'user'|'agent'; name: string; avatar?: string | null; status?: string };

export interface WSDependencies {
  wsUrl: string;
  getParticipants: () => Participant[];
  getDefaults: () => { name?: string; avatarUrl?: string };
  setUnread?: ReturnType<typeof useUnreadStore>['setUnread'];
  clearUnread?: ReturnType<typeof useUnreadStore>['clearUnread'];
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (err: unknown) => void;
  onMessage?: (m: ChatMessage) => void;
  onMessageDelta?: (messageId: string, delta: string, authorId?: string, authorType?: string) => void;
  onToolCall?: (payload: Record<string, unknown>) => void;
  onToolResult?: (payload: Record<string, unknown>) => void;
  onParticipants?: (payload: { roomId: string; participants: Participant[]; updatedAt: string }) => void;
  onTyping?: (payload: { roomId: string; typing: Array<{ actorId: string; type?: 'user'|'agent' }>; updatedAt: string }) => void;
  onReceipts?: (payload: { roomId: string; messageId: string; actorIds: string[]; updatedAt: string }) => void;
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
      (payload) => deps.onTyping?.(payload),
      (payload) => deps.onReceipts?.(payload),
      (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const roomId = String((payload as any)?.roomId || '');
        if (!roomId) return;
        const countRaw = (payload as any)?.unreadCount;
        const actorIdRaw = (payload as any)?.actorId;
        const count = typeof countRaw === 'number' ? countRaw : 0;
        const actorId = typeof actorIdRaw === 'string' ? actorIdRaw : undefined;
        // Debug log every unread event we receive on the client
        try { console.log('[ws][unread]', { roomId, actorId, count, meActor: (window as any).__superagent_actor, meUser: (window as any).__superagent_uid, aliases: (window as any).__superagent_actor_aliases }); } catch {}
        // Accept unread updates aimed at my primary actor, user id, or any alias actor id
        try {
          const meActor = String((window as any).__superagent_actor || '').trim();
          const meUser = String((window as any).__superagent_uid || '').trim();
          const aliases: string[] = Array.isArray((window as any).__superagent_actor_aliases)
            ? ((window as any).__superagent_actor_aliases as any[]).map((v) => String(v || '').trim()).filter(Boolean)
            : [];
          const isMe = (!actorId) || actorId === meActor || actorId === meUser || aliases.includes(String(actorId));
          if (!isMe) return;
        } catch {}
        if (count > 0) {
          deps.setUnread?.(roomId, count);
        } else {
          deps.clearUnread?.(roomId);
        }
        try {
          window.dispatchEvent(new CustomEvent('chat-room-unread', {
            detail: { roomId, count, actorId },
          }));
        } catch {}
      },
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
  sendMessage(roomId: string, content: string, options?: Record<string, unknown>) { return this.client.sendMessage(roomId, content, options); }
  typingStart(roomId: string, actorId?: string, ttlMs?: number) { return (this.client as unknown as { typingStart?: (roomId: string, actorId?: string, ttlMs?: number) => unknown }).typingStart?.(roomId, actorId, ttlMs); }
  typingStop(roomId: string, actorId?: string) { return (this.client as unknown as { typingStop?: (roomId: string, actorId?: string) => unknown }).typingStop?.(roomId, actorId); }
  markRead(roomId: string, messageId: string, actorId?: string) { return (this.client as unknown as { markMessageRead?: (roomId: string, messageId: string, actorId?: string) => unknown }).markMessageRead?.(roomId, messageId, actorId); }
  executeTerminalCommand(command: string, roomId: string) { return this.client.executeTerminalCommand(command, roomId); }
  executeAgentCommand(command: string, roomId: string, reason?: string) { return this.client.executeAgentCommand(command, roomId, reason); }
  elevenlabsTTS(text: string, voiceId?: string, format?: 'mp3'|'wav'|'ogg'|'webm') { return this.client.elevenlabsTTS(text, voiceId, format); }
  serpapiSearch(query: string, roomId: string, num?: number, agentId?: string) { return this.client.serpapiSearch(query, roomId, num, agentId); }
  serpapiImages(query: string, roomId: string, num?: number, agentId?: string) { return this.client.serpapiImages(query, roomId, num, agentId); }
  serpapiRun(engine: string, query: string, roomId: string, extra?: Record<string, unknown>, agentId?: string) { return this.client.serpapiRun(engine, query, roomId, extra, agentId); }
  webScrape(url: string, roomId: string, agentId?: string) { return this.client.webScrape(url, roomId, agentId); }
  webScrapePick(index: number, roomId: string, agentId?: string, resultId?: string) { return this.client.webScrapePick(index, roomId, agentId, resultId); }
  codeSearch(pattern: string, roomId: string, options?: { path?: string; glob?: string; maxResults?: number; caseInsensitive?: boolean; regex?: boolean }, agentId?: string) { return this.client.codeSearch(pattern, roomId, options, agentId); }
  xSearch(query: string, roomId: string, num?: number, agentId?: string) { return this.client.xSearch(query, roomId, num, agentId); }
  xLists(handle: string, roomId: string, agentId?: string) { return this.client.xLists(handle, roomId, agentId); }
  xTweet(text: string, roomId: string, media?: { url: string }[], agentId?: string) { return this.client.xTweet(text, roomId, media, agentId); }
  xDm(handle: string, text: string, roomId: string, agentId?: string) { return this.client.xDm(handle, text, roomId, agentId); }
  getLastResultId(roomId: string) { return (this.client as any).getLastResultId?.(roomId); }
}


