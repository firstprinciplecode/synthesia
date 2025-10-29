import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { db, users, actors, agents } from '../db/index.js'

// Check if user is admin (kept for parity)
export function isAdmin(userId: string): boolean {
  return userId === 'b7c026f5-44b4-4033-bb75-f46af54db3d0'
}

export function getUserIdFromRequest(request: any): string {
  try {
    const hdr = String((request.headers['x-user-id'] as string) || '').trim()
    if (hdr) return hdr
  } catch {}
  try {
    const cookie = String(request.headers['cookie'] || '')
    const m = cookie.match(/(?:^|;\s*)x-user-id=([^;]+)/)
    if (m) return decodeURIComponent(m[1])
  } catch {}
  return 'default-user'
}

export async function normalizeUserId(userId: string): Promise<string> {
  try {
    if (userId && userId.includes('@')) {
      const rows = await db.select().from(users).where(eq(users.email as any, userId as any))
      if (rows && rows.length) return (rows[0] as any).id as string
    }
  } catch {}
  return userId
}

export async function getOrCreateUserActor(userId: string): Promise<string> {
  const canonical = await normalizeUserId(userId)
  let existing: any[] = []
  try {
    const all = await db.select().from(actors)
    existing = (all as any[]).filter(a => a.type === 'user' && (a.ownerUserId === canonical || a.ownerUserId === userId))
  } catch {}
  if (existing.length > 0) {
    const preferred = existing.find(a => a.ownerUserId === canonical) || existing[0]
    if (preferred.ownerUserId !== canonical) {
      try { await db.update(actors as any).set({ ownerUserId: canonical, updatedAt: new Date() } as any).where(eq(actors.id as any, preferred.id as any)) } catch {}
    }
    for (const dup of existing) {
      if (dup.id !== preferred.id && dup.ownerUserId !== canonical) {
        try { await db.update(actors as any).set({ ownerUserId: canonical, updatedAt: new Date() } as any).where(eq(actors.id as any, dup.id as any)) } catch {}
      }
    }
    return preferred.id as string
  }
  const id = randomUUID()
  try {
    await db.insert(actors as any).values({
      id,
      type: 'user',
      handle: null,
      displayName: null,
      avatarUrl: null,
      ownerUserId: canonical,
      orgId: null,
      capabilityTags: null,
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)
  } catch {}
  return id
}

export async function getOrCreateAgentActor(agentId: string): Promise<string> {
  try {
    const actorRows = await db.select().from(actors)
    const existing = (actorRows as any[]).find(a => a.type === 'agent' && a?.settings?.agentId === agentId)
    if (existing) return existing.id as string
  } catch {}
  let ownerUserId: string | null = null
  try {
    const arows = await db.select().from(agents).where(eq(agents.id as any, agentId as any))
    if (arows && arows.length) ownerUserId = (arows[0] as any).createdBy || null
  } catch {}
  const id = randomUUID()
  try {
    await db.insert(actors as any).values({
      id,
      type: 'agent',
      handle: null,
      displayName: null,
      avatarUrl: null,
      ownerUserId,
      orgId: null,
      capabilityTags: null,
      settings: { agentId } as any,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)
  } catch {}
  return id
}

export async function getMyActorIdsForUser(uid: string): Promise<Set<string>> {
  const meId = await getOrCreateUserActor(uid)
  const actorRows = await db.select().from(actors)
  let userEmail: string | null = null
  try {
    const urows = await db.select().from(users).where(eq(users.id as any, await normalizeUserId(uid) as any))
    if (urows && urows.length) userEmail = (urows[0] as any).email || null
  } catch {}
  const meActor = (actorRows as any[]).find(a => a.id === meId)
  const ownerId = meActor?.ownerUserId || null
  const ids = new Set<string>((actorRows as any[])
    .filter(a => a.type === 'user' && (
      (ownerId && a.ownerUserId === ownerId) ||
      (userEmail && a.ownerUserId === userEmail)
    ))
    .map(a => a.id))
  if (!ids.size) ids.add(meId)
  return ids
}

