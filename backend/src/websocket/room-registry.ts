import { db, users, agents } from '../db/index.js';
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

    // Fetch user profiles
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

    const participants: Participant[] = [
      ...agentProfiles.map((a) => ({ id: a.id, type: 'agent' as const, name: a.name || 'Agent', avatar: a.avatar || null, status: 'online' })),
      ...userProfiles.map((u) => ({ id: u.id, type: 'user' as const, name: u.name || u.email || 'User', avatar: u.avatar || null, status: 'online' })),
    ];

    return participants;
  }
}
