import type { ChatMessage } from '@/lib/websocket';

export type Participant = { id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string };

export interface PipelineContext {
  participants: Participant[];
  defaultAgentName?: string;
  defaultAgentAvatar?: string;
}

export function enrichAssistantIdentity(message: ChatMessage, ctx: PipelineContext): ChatMessage {
  if (message.role !== 'assistant') return message;
  const authorId = (message as any).authorId as string | undefined;
  const authorType = (message as any).authorType as string | undefined;
  const copy: any = { ...message };
  if (authorType === 'agent' && authorId) {
    const p = ctx.participants.find(p => p.type === 'agent' && p.id === authorId);
    if (p) {
      copy.agentName = p.name;
      copy.agentAvatar = p.avatar || undefined;
    }
  }
  if (!copy.agentName && (ctx.defaultAgentName || ctx.defaultAgentAvatar)) {
    copy.agentName = ctx.defaultAgentName;
    copy.agentAvatar = ctx.defaultAgentAvatar;
  }
  return copy;
}

export function upsertMessage(messages: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  // Helper to collapse accidental duplicated assistant text (e.g., sentence repeated twice)
  const normalizeAssistantText = (t: string): string => {
    const s = String(t || '').trim();
    if (!s) return s;
    // Exact half duplication: ABCABC -> ABC
    if (s.length % 2 === 0) {
      const mid = s.length / 2;
      const a = s.slice(0, mid);
      const b = s.slice(mid);
      if (a === b) return a;
    }
    return s;
  };
  // Replace placeholder terminal or assistant streaming when appropriate
  if (incoming.role === 'terminal' && (incoming as any).terminalResult) {
    const lastPendingIdx = [...messages].reverse().findIndex(m => m.role === 'terminal' && !(m as any).terminalResult);
    if (lastPendingIdx !== -1) {
      const idx = messages.length - 1 - lastPendingIdx;
      const updated = [...messages];
      updated[idx] = incoming as any;
      return updated;
    }
  }

  if (incoming.role === 'assistant') {
    // If the very last message is a streaming/ellipsis assistant placeholder, replace it
    if (messages.length > 0) {
      const last = messages[messages.length - 1] as any;
      if (last?.role === 'assistant') {
        const txt = String(last?.content || '').trim();
        const isPlaceholder = !!last?.streaming && txt.length === 0;
        const isEllipsis = txt === '…' || txt === '...' || txt === '‧‧‧';
        const sameAgent = (last?.authorType === 'agent') && (last?.authorId === (incoming as any)?.authorId);
        if (isPlaceholder || (isEllipsis && sameAgent)) {
          const updated = [...messages];
          updated[updated.length - 1] = { ...(incoming as any), content: normalizeAssistantText((incoming as any).content), streaming: false };
          return updated;
        }
      }
    }
    const existingIdx = messages.findIndex(m => m.id === incoming.id);
    if (existingIdx !== -1) {
      const updated = [...messages];
      updated[existingIdx] = { ...(incoming as any), content: normalizeAssistantText((incoming as any).content), streaming: false };
      return updated;
    }
    const lastStreamingIdx = [...messages].reverse().findIndex(m => m.role === 'assistant' && (m as any).streaming);
    if (lastStreamingIdx !== -1) {
      const idx = messages.length - 1 - lastStreamingIdx;
      const updated = [...messages];
      updated[idx] = { ...(incoming as any), content: normalizeAssistantText((incoming as any).content), streaming: false };
      return updated;
    }
    // Note: no content-based dedupe here to avoid accidentally overwriting earlier answers
  }

  // Generic upsert by id
  const filtered = messages.filter(m => m.id !== incoming.id);
  if ((incoming as any).role === 'assistant') {
    const fixed: any = { ...(incoming as any), content: normalizeAssistantText((incoming as any).content) };
    return [...filtered, fixed];
  }
  return [...filtered, incoming];
}


