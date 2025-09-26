import { db, users, agents, actors, roomMembers } from '../db/index.js';
import * as DBSchema from '../db/schema.js';
import { eq } from 'drizzle-orm';

export type Participant = { id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status: string };

export class RoomRegistry {
  private rooms: Map<string, Set<string>>;
  private connectionUserId: Map<string, string>;
  private roomAgents: Map<string, Set<string>>;

  constructor(
    rooms: Map<string, Set<string>>,
    connectionUserId: Map<string, string>,
    roomAgents: Map<string, Set<string>>,
  ) {
    this.rooms = rooms;
    this.connectionUserId = connectionUserId;
    this.roomAgents = roomAgents;
  }

  addConnection(roomId: string, connectionId: string, userId?: string) {
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId)!.add(connectionId);
    if (userId) this.connectionUserId.set(connectionId, userId);
  }

  removeConnection(roomId: string, connectionId: string) {
    if (this.rooms.has(roomId)) this.rooms.get(roomId)!.delete(connectionId);
    this.connectionUserId.delete(connectionId);
  }

  getRoomForConnection(connectionId: string): string | undefined {
    for (const [roomId, participants] of this.rooms.entries()) {
      if (participants.has(connectionId)) return roomId;
    }
    return undefined;
  }

  inviteAgent(roomId: string, agentId: string) {
    if (!this.roomAgents.has(roomId)) this.roomAgents.set(roomId, new Set());
    const set = this.roomAgents.get(roomId)!;
    set.add(agentId);
    this.roomAgents.set(roomId, set);
  }

  removeAgent(roomId: string, agentId: string) {
    if (this.roomAgents.has(roomId)) {
      this.roomAgents.get(roomId)!.delete(agentId);
    }
  }

  listConnections(roomId: string): string[] {
    return Array.from(this.rooms.get(roomId) || []);
  }

  isUserInRoom(connectionId: string, roomId: string): boolean {
    return this.rooms.get(roomId)?.has(connectionId) || false;
  }

  getConnectionUserId(connectionId: string): string | undefined {
    return this.connectionUserId.get(connectionId);
  }

  async buildParticipants(roomId: string): Promise<Participant[]> {
    const participantsConns = this.listConnections(roomId);
    const userIds = participantsConns.map((cid) => this.connectionUserId.get(cid) || 'default-user');
    const uniqueUserIds = Array.from(new Set(userIds));

    // Fetch user profiles for connected users
    const userProfiles: any[] = [];
    for (const uid of uniqueUserIds) {
      try {
        const rows = await db.select().from(users).where(eq(users.id, uid));
        if (rows.length > 0) userProfiles.push(rows[0]);
      } catch {}
    }

    // Try to fetch agents from conversation participants in DB
    let agentIds: string[] = [];
    try {
      const conv = await db.select().from(DBSchema.conversations).where(eq(DBSchema.conversations.id as any, roomId as any));
      if (conv.length && Array.isArray((conv[0] as any).participants)) {
        const participants = (conv[0] as any).participants as any[];
        agentIds = participants
          .map((p) => {
            if (typeof p === 'string') return p;
            if (p && p.type === 'agent' && typeof p.id === 'string') return p.id;
            return null;
          })
          .filter((id): id is string => id !== null);
      }
    } catch {}

    // Fallback to legacy: main agent = roomId + invited
    if (agentIds.length === 0) {
      agentIds = [roomId, ...Array.from(this.roomAgents.get(roomId) || [])];
    }

    const agentProfiles: any[] = [];
    for (const aid of Array.from(new Set(agentIds))) {
      try {
        const rows = await db.select().from(agents).where(eq(agents.id as any, aid as any));
        if (rows.length > 0) agentProfiles.push(rows[0]);
      } catch {}
    }

    // Include Social Core room members as participants (users and agents mapped via actors)
    const socialParticipants: Participant[] = [];
    try {
      const members = await db.select().from(roomMembers).where(eq(roomMembers.roomId as any, roomId as any));
      for (const m of members as any[]) {
        try {
          const aRows = await db.select().from(actors).where(eq(actors.id as any, m.actorId as any));
          if (aRows.length === 0) continue;
          const act: any = aRows[0];
          if (String(act.type) === 'user') {
            // Map to real user profile if available
            let name = act.displayName || 'User';
            let avatar = act.avatarUrl || null;
            if (act.ownerUserId) {
              const uRows = await db.select().from(users).where(eq(users.id, act.ownerUserId));
              if (uRows.length) {
                name = uRows[0].name || uRows[0].email || name;
                avatar = uRows[0].avatar || avatar;
              }
            }
            socialParticipants.push({ id: act.id, type: 'user', name, avatar, status: 'online' });
          } else if (String(act.type) === 'agent') {
            // Try to enrich from agents table if settings.agentId present
            let name = act.displayName || 'Agent';
            let avatar = act.avatarUrl || null;
            const settings = (act.settings || {}) as any;
            const agentId = settings?.agentId;
            if (agentId) {
              const agRows = await db.select().from(agents).where(eq(agents.id as any, agentId as any));
              if (agRows.length) {
                name = agRows[0].name || name;
                avatar = agRows[0].avatar || avatar;
              }
            }
            // Important: expose participant id as the agents.id so frontend can match authorId
            socialParticipants.push({ id: agentId || act.id, type: 'agent', name, avatar, status: 'online' });
          }
        } catch {}
      }
    } catch {}

    // Deduplicate by semantic identity: users by ownerUserId (if present) else id; agents by agentId (if present) else id
    const byKey = new Map<string, Participant>();
    const push = (p: Participant, key: string) => { if (!byKey.has(key)) byKey.set(key, p); };

    // Direct agents (canonical by agent id)
    for (const a of agentProfiles) {
      push({ id: a.id, type: 'agent', name: a.name || 'Agent', avatar: a.avatar || null, status: 'online' }, `agent:${a.id}`);
    }

    // Connected users (canonical by user id)
    for (const u of userProfiles) {
      push({ id: u.id, type: 'user', name: u.name || u.email || 'User', avatar: u.avatar || null, status: 'online' }, `user:${u.id}`);
    }

    // Social Core members
    for (const sp of socialParticipants) {
      let key = `${sp.type}:${sp.id}`;
      // Try to normalize user actor -> underlying user id if we can infer it from avatar/name match against connected users
      if (sp.type === 'user') {
        // Find a connected user with the same avatar or name; not perfect but avoids duplicates for default-user
        const match = userProfiles.find(u => (u.avatar && sp.avatar && String(u.avatar) === String(sp.avatar)) || (u.name && sp.name && String(u.name) === String(sp.name)) || u.id === sp.id);
        if (match) key = `user:${match.id}`;
      }
      push(sp, key);
    }

    const participants: Participant[] = Array.from(byKey.values());

    return participants;
  }
}
