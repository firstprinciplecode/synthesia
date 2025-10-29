import { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { db, actors, agents, relationships, users } from '../db/index.js'
import { randomUUID } from 'crypto'
import { getOrCreateAgentActor, getOrCreateUserActor, getMyActorIdsForUser, getUserIdFromRequest, normalizeUserId } from '../lib/actors.js'

export async function registerRelationshipsRoutes(fastify: FastifyInstance) {
  // Create relationship (follow | block | mute | agent_access)
  fastify.post('/api/relationships', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request)
      const meId = await getOrCreateUserActor(uid)
      const body = (request.body || {}) as any
      let toActorId = String(body.toActorId || '').trim()
      const agentIdForAccess = String(body.agentId || '').trim()
      const kind = String(body.kind || 'follow').trim()
      if (!toActorId && agentIdForAccess) {
        toActorId = await getOrCreateAgentActor(agentIdForAccess)
      }
      if (!toActorId) { reply.code(400); return { error: 'toActorId or agentId required' } }
      if (!['follow','block','mute','agent_access'].includes(kind)) { reply.code(400); return { error: 'invalid kind' } }
      if (toActorId === meId) { reply.code(400); return { error: 'Cannot create relationship with yourself' } }
      const targetRows = await db.select().from(actors).where(eq(actors.id as any, toActorId as any))
      const target = (targetRows && targetRows[0]) as any
      let status: 'pending' | 'accepted' = 'accepted'
      if (kind === 'agent_access') {
        let ownerUserId: string | undefined = undefined
        try {
          const agId = target?.settings?.agentId || agentIdForAccess || null
          if (agId) {
            const arows = await db.select().from(agents).where(eq(agents.id as any, agId as any))
            if (arows && arows.length) ownerUserId = (arows[0] as any).createdBy as string
          }
        } catch {}
        const myCanonical = await normalizeUserId(uid)
        status = ownerUserId && myCanonical === ownerUserId ? 'accepted' : 'pending'
      } else {
        status = (target?.type === 'user' ? 'pending' : 'accepted')
      }
      const metadata = { status } as any
      const existing = await db.select().from(relationships as any).where(
        and(
          eq(relationships.fromActorId as any, meId as any) as any,
          eq(relationships.toActorId as any, toActorId as any) as any,
          eq(relationships.kind as any, kind as any) as any,
        ) as any
      )
      if (!existing.length) {
        await (db.insert(relationships as any) as any)
          .values({ id: randomUUID(), fromActorId: meId, toActorId, kind, metadata, createdAt: new Date() } as any)
          .onConflictDoNothing({ target: [relationships.fromActorId as any, relationships.toActorId as any, relationships.kind as any] } as any)
      }
      reply.code(201); return { ok: true }
    } catch (e: any) {
      request.server.log.error(e); reply.code(500); return { error: 'Failed to create relationship' }
    }
  })

  // Delete relationship or cancel/purge agent_access
  fastify.delete('/api/relationships', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request)
      const myActorIds = await getMyActorIdsForUser(uid)
      const { toActorId, kind, agentId } = (request.query || {}) as any
      const toId = String(toActorId || '').trim()
      const k = String(kind || 'follow').trim()
      if (!toId && !agentId) { reply.code(400); return { error: 'toActorId or agentId required' } }
      const actorRows = await db.select().from(actors)
      const toActor = toId ? (actorRows as any[]).find(a => String(a.id) === toId) : undefined
      const targetOwnerUserId: string | null = (toActor && toActor.type === 'user' && toActor.ownerUserId) ? String(toActor.ownerUserId) : null
      const theirActorIds = new Set<string>()
      if (targetOwnerUserId) {
        for (const a of actorRows as any[]) {
          if (a.type === 'user' && String(a.ownerUserId || '') === targetOwnerUserId) theirActorIds.add(String(a.id))
        }
      }
      if (theirActorIds.size === 0 && toId) theirActorIds.add(toId)
      if (k === 'agent_access' && agentId) {
        try {
          const aid = String(agentId)
          const existingAgentActor = (actorRows as any[]).find(a => a.type === 'agent' && String(a?.settings?.agentId || '') === aid)
          if (existingAgentActor && existingAgentActor.id) theirActorIds.add(String(existingAgentActor.id))
        } catch {}
      }
      const all = await db.select().from(relationships)
      const toDelete = (all as any[]).filter(r => {
        if (r.kind !== k) return false
        const fromMy = myActorIds.has(String(r.fromActorId))
        const toMy = myActorIds.has(String(r.toActorId))
        const fromTheirs = theirActorIds.has(String(r.fromActorId))
        const toTheirs = theirActorIds.has(String(r.toActorId))
        return (fromMy && toTheirs) || (fromTheirs && toMy)
      })
      for (const r of toDelete) { try { await db.delete(relationships as any).where(eq(relationships.id as any, r.id as any) as any) } catch {} }
      return { ok: true, deleted: toDelete.length } as any
    } catch (e: any) {
      request.server.log.error(e); reply.code(500); return { error: 'Failed to delete relationship' }
    }
  })

  // List relationships
  fastify.get('/api/relationships', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request)
      const { direction = 'outgoing', kind = 'follow', status } = (request.query || {}) as any
      const all = await db.select().from(relationships)
      const myActorIds = await getMyActorIdsForUser(uid)
      const canonicalUid = await normalizeUserId(uid)
      const actorRows = await db.select().from(actors)
      const agentRows = await db.select().from(agents)
      const userRows = await db.select().from(users)
      const agentIdByActorId: Record<string, string> = {}
      for (const a of actorRows as any[]) { if (a.type === 'agent' && a?.settings?.agentId) agentIdByActorId[a.id] = String(a.settings.agentId) }
      const agentOwnerByAgentId: Record<string, string> = {}
      for (const ag of agentRows as any[]) agentOwnerByAgentId[ag.id] = String(ag.createdBy || '')
      const normalizedAgentOwnerByAgentId: Record<string, string> = {}
      for (const agId in agentOwnerByAgentId) {
        const owner = agentOwnerByAgentId[agId]
        if (owner) { normalizedAgentOwnerByAgentId[agId] = await normalizeUserId(owner) }
      }
      const isAgentOwnedByMeByActorId = (actorId: string): boolean => {
        const aid = agentIdByActorId[actorId]; if (!aid) return false
        const normalizedOwner = normalizedAgentOwnerByAgentId[aid]
        return !!normalizedOwner && normalizedOwner === canonicalUid
      }
      const filtered = (all as any[]).filter(r => {
        if (r.kind !== kind) return false
        let dirOk = false
        if (direction === 'incoming') {
          if (kind === 'agent_access') { dirOk = isAgentOwnedByMeByActorId(r.toActorId) } else { dirOk = myActorIds.has(r.toActorId) }
        } else { dirOk = myActorIds.has(r.fromActorId) }
        if (!dirOk) return false
        if (status) return (r.metadata?.status || 'accepted') === status
        return true
      })
      const actorById: Record<string, any> = {}; for (const a of actorRows as any[]) actorById[a.id] = a
      const usersById: Record<string, any> = {}; const usersByEmail: Record<string, any> = {}
      for (const u of userRows as any[]) { usersById[u.id] = u; if (u.email) usersByEmail[String(u.email)] = u }
      const agentById: Record<string, any> = {}; for (const ag of agentRows as any[]) agentById[ag.id] = ag
      const toUploads = (v?: string | null) => { if (!v || typeof v !== 'string') return null; const idx = v.indexOf('/uploads/'); return idx !== -1 ? v.slice(idx) : v }
      const enrichActor = (actorId: string) => {
        const a = actorById[actorId]; if (!a) return { id: actorId, type: 'unknown', displayName: actorId, avatarUrl: null }
        const out: any = { id: a.id, type: a.type, displayName: a.displayName || null, avatarUrl: a.avatarUrl || null }
        if (a.type === 'user') {
          let owner = a.ownerUserId as string | undefined
          if (owner && owner.includes && owner.includes('@')) owner = usersByEmail[String(owner)]?.id || owner
          const u = owner ? usersById[String(owner)] : undefined
          if (!out.displayName) out.displayName = u?.name || u?.email || a.handle || a.id
          if (!out.avatarUrl) out.avatarUrl = toUploads(u?.avatar || null)
        } else if (a.type === 'agent') {
          const aid = a?.settings?.agentId as string | undefined
          const ag = aid ? agentById[aid] : undefined
          if (!out.displayName) out.displayName = ag?.name || out.displayName || a.handle || a.id
          if (!out.avatarUrl) out.avatarUrl = toUploads(ag?.avatar || a.avatarUrl || null)
          if (aid) out.agentId = aid
        }
        return out
      }
      const enriched = filtered.map((r: any) => ({ ...r, fromActor: enrichActor(r.fromActorId), toActor: enrichActor(r.toActorId) }))
      return { relationships: enriched }
    } catch (e: any) {
      request.server.log.error(e); reply.code(500); return { error: 'Failed to list relationships' }
    }
  })

  // Approve pending
  fastify.post('/api/relationships/approve', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request)
      const { fromActorId, kind = 'follow' } = (request.body || {}) as any
      const fromId = String(fromActorId || '').trim()
      if (!fromId) { reply.code(400); return { error: 'fromActorId required' } }
      const all = await db.select().from(relationships)
      const myActorIds = await getMyActorIdsForUser(uid)
      if (kind === 'agent_access') {
        const actorRows = await db.select().from(actors)
        const agentRows = await db.select().from(agents)
        const agentIdByActorId: Record<string, string> = {}
        for (const a of actorRows as any[]) { if (a.type === 'agent' && a?.settings?.agentId) agentIdByActorId[a.id] = String(a.settings.agentId) }
        const normalizedOwnerByAgentId: Record<string, string> = {}
        for (const ag of agentRows as any[]) { if (ag.id && ag.createdBy) { normalizedOwnerByAgentId[ag.id] = await normalizeUserId(String(ag.createdBy)) } }
        const ownerOfAgentActor = (agentActorId: string): string | undefined => { const aid = agentIdByActorId[agentActorId]; if (!aid) return undefined; return normalizedOwnerByAgentId[aid] }
        const myCanonical = await normalizeUserId(uid)
        const candidates = (all as any[]).filter(r => r.kind === 'agent_access' && r.fromActorId === fromId)
        for (const r of candidates) {
          const owner = ownerOfAgentActor(r.toActorId)
          const isMine = !!owner && owner === myCanonical
          if (!isMine) continue
          try { await db.update(relationships as any).set({ metadata: { status: 'accepted' } as any }).where(eq(relationships.id as any, r.id as any)) } catch {}
        }
        return { ok: true }
      } else {
        const pending = (all as any[]).find(r => r.kind === kind && r.fromActorId === fromId && myActorIds.has(r.toActorId))
        if (pending) { try { await db.update(relationships as any).set({ metadata: { status: 'accepted' } as any }).where(eq(relationships.id as any, pending.id as any)) } catch {} }
        const myPrimary = Array.from(myActorIds)[0]
        const reciprocal = (all as any[]).find(r => r.kind === kind && myActorIds.has(r.fromActorId) && r.toActorId === fromId)
        if (!reciprocal) {
          await (db.insert(relationships as any) as any)
            .values({ id: randomUUID(), fromActorId: myPrimary, toActorId: fromId, kind, metadata: { status: 'accepted' } as any, createdAt: new Date() } as any)
            .onConflictDoNothing({ target: [relationships.fromActorId as any, relationships.toActorId as any, relationships.kind as any] } as any)
        }
        return { ok: true }
      }
    } catch (e: any) {
      request.server.log.error(e); reply.code(500); return { error: 'Failed to approve relationship' }
    }
  })

  // Reject pending
  fastify.post('/api/relationships/reject', async (request, reply) => {
    try {
      const uid = getUserIdFromRequest(request)
      const { fromActorId, kind = 'follow' } = (request.body || {}) as any
      const fromId = String(fromActorId || '').trim()
      if (!fromId) { reply.code(400); return { error: 'fromActorId required' } }
      const all = await db.select().from(relationships)
      const myActorIds = await getMyActorIdsForUser(uid)
      if (kind === 'agent_access') {
        const actorRows = await db.select().from(actors)
        const agentRows = await db.select().from(agents)
        const agentIdByActorId: Record<string, string> = {}
        for (const a of actorRows as any[]) { if (a.type === 'agent' && a?.settings?.agentId) agentIdByActorId[a.id] = String(a.settings.agentId) }
        const normalizedOwnerByAgentId: Record<string, string> = {}
        for (const ag of agentRows as any[]) { if (ag.id && ag.createdBy) { normalizedOwnerByAgentId[ag.id] = await normalizeUserId(String(ag.createdBy)) } }
        const ownerOfAgentActor = (agentActorId: string): string | undefined => { const aid = agentIdByActorId[agentActorId]; if (!aid) return undefined; return normalizedOwnerByAgentId[aid] }
        const myCanonical = await normalizeUserId(uid)
        const candidates = (all as any[]).filter(r => r.kind === 'agent_access' && r.fromActorId === fromId)
        for (const r of candidates) {
          const owner = ownerOfAgentActor(r.toActorId)
          const isMine = !!owner && owner === myCanonical
          if (!isMine) continue
          try { await db.update(relationships as any).set({ metadata: { status: 'rejected' } as any }).where(eq(relationships.id as any, r.id as any)) } catch {}
        }
        return { ok: true }
      } else {
        const pending = (all as any[]).find(r => r.kind === kind && r.fromActorId === fromId && myActorIds.has(r.toActorId))
        if (pending) { try { await db.update(relationships as any).set({ metadata: { status: 'rejected' } as any }).where(eq(relationships.id as any, pending.id as any)) } catch {} }
        return { ok: true }
      }
    } catch (e: any) {
      request.server.log.error(e); reply.code(500); return { error: 'Failed to reject relationship' }
    }
  })
}

