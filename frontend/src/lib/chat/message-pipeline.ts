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
    const existingIdx = messages.findIndex(m => m.id === incoming.id);
    if (existingIdx !== -1) {
      const updated = [...messages];
      updated[existingIdx] = { ...(incoming as any), streaming: false };
      return updated;
    }
    const lastStreamingIdx = [...messages].reverse().findIndex(m => m.role === 'assistant' && (m as any).streaming);
    if (lastStreamingIdx !== -1) {
      const idx = messages.length - 1 - lastStreamingIdx;
      const updated = [...messages];
      updated[idx] = { ...(incoming as any), streaming: false };
      return updated;
    }
  }

  // Generic upsert by id
  const filtered = messages.filter(m => m.id !== incoming.id);
  return [...filtered, incoming];
}


