import { create } from 'zustand';
import type { ChatMessage } from '@/lib/websocket';

type ToolRun = { runId: string; toolCallId: string; tool: string; func: string; args: any; status: 'running'|'succeeded'|'failed'; error?: string; startedAt: number; completedAt?: number; durationMs?: number };

interface ChatState {
  roomId: string;
  messages: ChatMessage[];
  toolRuns: Map<string, ToolRun>;
  setRoom: (id: string) => void;
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  pushMessage: (m: ChatMessage) => void;
  replaceMessage: (id: string, m: Partial<ChatMessage>) => void;
  setToolRun: (id: string, run: ToolRun) => void;
  updateToolRun: (id: string, patch: Partial<ToolRun>) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  roomId: 'default-room',
  messages: [],
  toolRuns: new Map(),
  setRoom: (id) => set({ roomId: id, messages: [] }),
  setMessages: (updater) => set({ messages: updater(get().messages) }),
  pushMessage: (m) => set({ messages: [...get().messages, m] }),
  replaceMessage: (id, patch) => set({ messages: get().messages.map(x => x.id === id ? { ...(x as any), ...patch } : x) }),
  setToolRun: (id, run) => set({ toolRuns: new Map(get().toolRuns).set(id, run) }),
  updateToolRun: (id, patch) => {
    const next = new Map(get().toolRuns);
    const cur = next.get(id);
    if (cur) next.set(id, { ...cur, ...patch });
    set({ toolRuns: next });
  },
  clear: () => set({ messages: [], toolRuns: new Map() }),
}));


