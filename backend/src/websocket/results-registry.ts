import { randomUUID } from 'crypto'

export type ResultItem = { index: number; url: string; title?: string; source?: string; date?: string }
export type StoredResults = { roomId: string; items: ResultItem[]; createdAt: number }

const store = new Map<string, StoredResults>()
const latestByRoom = new Map<string, string>()

const TTL_MS = 10 * 60 * 1000 // 10 minutes

export function createResults(roomId: string, items: ResultItem[]): string {
  const id = randomUUID()
  const now = Date.now()
  store.set(id, { roomId, items, createdAt: now })
  latestByRoom.set(roomId, id)
  return id
}

export function getResults(resultId: string): StoredResults | undefined {
  const r = store.get(resultId)
  if (!r) return undefined
  if (Date.now() - r.createdAt > TTL_MS) {
    store.delete(resultId)
    return undefined
  }
  return r
}

export function getLatestResultId(roomId: string): string | null {
  const id = latestByRoom.get(roomId)
  if (!id) return null
  const r = getResults(id)
  if (!r) return null
  return id
}

export function cleanupExpired(): void {
  const now = Date.now()
  for (const [id, r] of store) {
    if (now - r.createdAt > TTL_MS) store.delete(id)
  }
}


