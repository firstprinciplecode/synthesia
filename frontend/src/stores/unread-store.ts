import { create } from 'zustand'

function loadPersisted<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined') return fallback
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const data = JSON.parse(raw)
    return (data && typeof data === 'object') ? data as T : fallback
  } catch { return fallback }
}

interface UnreadState {
  unreadByRoom: Record<string, number>
  setUnread: (roomId: string, count: number) => void
  clearUnread: (roomId: string) => void
  reset: () => void
  setMany: (entries: Array<{ roomId: string; count: number }>) => void
  mergeFrom: (data: Record<string, number>) => void
  totalUnread: () => number
  hasUnread: (roomId: string) => boolean
  // actor-based DM pings
  dmUnreadByActorId: Record<string, boolean>
  setDmPing: (fromActorId: string, value: boolean) => void
  clearDmPingForRoom: (roomId: string, participants?: string[]) => void
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  unreadByRoom: loadPersisted<Record<string, number>>('sa_unreadByRoom', {}),
  dmUnreadByActorId: loadPersisted<Record<string, boolean>>('sa_dmUnreadByActorId', {}),
  setUnread: (roomId, count) => set((state) => {
    const next = { ...state.unreadByRoom }
    if (count > 0) next[roomId] = count
    else delete next[roomId]
    return { unreadByRoom: next }
  }),
  clearUnread: (roomId) => set((state) => {
    if (!(roomId in state.unreadByRoom)) return state
    const next = { ...state.unreadByRoom }
    delete next[roomId]
    return { unreadByRoom: next }
  }),
  reset: () => set({ unreadByRoom: {}, dmUnreadByActorId: {} }),
  setMany: (entries) => set((state) => {
    const next = { ...state.unreadByRoom }
    for (const { roomId, count } of entries) {
      if (count > 0) next[roomId] = count
      else delete next[roomId]
    }
    return { unreadByRoom: next }
  }),
  mergeFrom: (data) => set((state) => {
    const next = { ...state.unreadByRoom }
    for (const [roomId, count] of Object.entries(data)) {
      if (count > 0) next[roomId] = count
      else delete next[roomId]
    }
    return { unreadByRoom: next }
  }),
  totalUnread: () => {
    const state = get()
    return Object.values(state.unreadByRoom).reduce((acc, count) => acc + count, 0)
  },
  hasUnread: (roomId: string) => {
    const state = get()
    return (state.unreadByRoom[roomId] ?? 0) > 0
  },
  setDmPing: (fromActorId, value) => set((state) => {
    const next = { ...state.dmUnreadByActorId }
    if (value) next[fromActorId] = true
    else delete next[fromActorId]
    return { dmUnreadByActorId: next }
  }),
  clearDmPingForRoom: (roomId, participants) => set((state) => {
    if (!participants || participants.length === 0) return state
    const next = { ...state.dmUnreadByActorId }
    for (const pid of participants) delete next[pid]
    return { dmUnreadByActorId: next }
  }),
}))

// Expose store for devtools/diagnostics
try {
  // @ts-ignore
  if (typeof window !== 'undefined') (window as any).__unreadStore = useUnreadStore
} catch {}

// Persist on change so unread survives reloads until the user visits the DM/room
try {
  if (typeof window !== 'undefined') {
    useUnreadStore.subscribe((state) => {
      try { window.localStorage.setItem('sa_unreadByRoom', JSON.stringify(state.unreadByRoom)) } catch {}
      try { window.localStorage.setItem('sa_dmUnreadByActorId', JSON.stringify(state.dmUnreadByActorId)) } catch {}
    })
  }
} catch {}
