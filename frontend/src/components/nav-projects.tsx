"use client"

import { MoreHorizontal, Bot, Users, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useSession } from "next-auth/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useUnreadStore } from "@/stores/unread-store"

type Agent = { id: string; name: string; avatar?: string | null }
type Conversation = { id: string; title: string; type: string; participants: any[] }
type Room = { id: string; title?: string | null; kind?: string | null }
type Connection = { id: string; name?: string; displayName?: string; handle?: string; email?: string; avatar?: string; avatarUrl?: string; type?: string; dmRoomId?: string; ownerUserId?: string }

export function NavProjects() {
  const { isMobile } = useSidebar()
  const { status, data: session } = useSession()
  const [agents, setAgents] = useState<Agent[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [agentMap, setAgentMap] = useState<Map<string, Agent>>(new Map())
  const [rooms, setRooms] = useState<Room[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState("")
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [addPmOpen, setAddPmOpen] = useState(false)
  const [allActors, setAllActors] = useState<any[]>([])
  const [loadingActors, setLoadingActors] = useState(false)

  const loadData = useCallback(async () => {
    try {
      if (status !== 'authenticated') {
        setAgents([]); setConversations([]); setRooms([]); setAgentMap(new Map());
        return
      }
      const uid = (session as any)?.userId || (session as any)?.user?.email
      const headers = uid ? { 'x-user-id': uid } : undefined
      // Load agents (owned + accessible)
      const agentsRes = await fetch('/api/agents/accessible', { cache: 'no-store', headers })
      const agentsData = await agentsRes.json()
      const agentsList: Agent[] = Array.isArray(agentsData) ? agentsData : (Array.isArray(agentsData?.agents) ? agentsData.agents : [])
      setAgents(agentsList)
      
      // Create agent map for quick lookup
      const map = new Map<string, Agent>()
      agentsList.forEach(agent => map.set(agent.id, agent))
      setAgentMap(map)

      // Load conversations (multi-agent rooms)
      const convRes = await fetch('/api/conversations', { cache: 'no-store', headers })
      const convData = await convRes.json()
      const convList: Conversation[] = Array.isArray(convData) ? convData : (Array.isArray(convData?.conversations) ? convData.conversations : [])
      // Filter for multi-agent rooms
      const multiAgentRooms = convList.filter(conv => conv.type === 'multi-agent' && conv.participants && conv.participants.length > 1)
      setConversations(multiAgentRooms)

      // Load Social Core rooms
      try {
        const r = await fetch('/api/rooms', { cache: 'no-store', headers })
        if (r.ok) {
          const data = await r.json()
          const rs: Room[] = Array.isArray(data) ? data : (Array.isArray(data?.rooms) ? data.rooms : [])
          setRooms(rs)
        }
      } catch {}

      // Load approved user connections
      try {
        const cr = await fetch('/api/connections', { cache: 'no-store', headers })
        if (cr.ok) {
          const cj = await cr.json()
          const rawConnections: any[] = Array.isArray(cj?.connections) ? cj.connections : []
          let normalized: Connection[] = rawConnections.map((c) => {
            const id = String(c.id || c.actorId || c.email || c.handle || '').trim()
            const dmRoomId = c.dmRoomId || c.roomId || (Array.isArray(c.rooms) ? c.rooms.find((room: any) => room?.kind === 'dm')?.id : undefined)
            return {
              id,
              name: c.name,
              displayName: c.displayName,
              handle: c.handle,
              email: c.email,
              avatar: c.avatar,
              avatarUrl: c.avatarUrl,
              type: c.type,
              dmRoomId,
              ownerUserId: c.ownerUserId,
            }
          }).filter((c) => c.id)
          setConnections(normalized)
        } else {
          // Absolute fallback to preserve sidebar UX
          setConnections([])
        }
      } catch {
        setConnections([])
      }
    } catch {}
  }, [status, session])

  const deleteSocialRoom = async (roomId: string) => {
    if (!confirm('Delete this room?')) return
    try {
      const res = await fetch(`/api/rooms/${roomId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      await loadData()
    } catch (e) {
      alert('Failed to delete room')
    }
  }

  const loadActorsForAdd = async () => {
    if (status !== 'authenticated') return
    try {
      setLoadingActors(true)
      const uid = (session as any)?.userId || (session as any)?.user?.email
      const headers = uid ? { 'x-user-id': uid } : undefined
      const res = await fetch('/api/actors', { cache: 'no-store', headers })
      const j = await res.json()
      const list = Array.isArray(j?.actors) ? j.actors : (Array.isArray(j) ? j : [])
      setAllActors(list)
    } catch {}
    finally { setLoadingActors(false) }
  }

  const connectToUser = async (actorId: string) => {
    try {
      const uid = (session as any)?.userId || (session as any)?.user?.email
      await fetch('/api/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) },
        body: JSON.stringify({ toActorId: actorId, kind: 'follow' }),
      })
      try { window.dispatchEvent(new CustomEvent('connections-updated')) } catch {}
      await loadData()
    } catch {}
  }

  const requestAgentAccess = async (agentActor: any) => {
    try {
      const uid = (session as any)?.userId || (session as any)?.user?.email
      const agentId = agentActor?.settings?.agentId
      if (!agentId) return
      await fetch('/api/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) },
        body: JSON.stringify({ kind: 'agent_access', agentId, toActorId: agentActor.id }),
      })
      try { window.dispatchEvent(new CustomEvent('connections-updated')) } catch {}
      await loadData()
    } catch {}
  }

  useEffect(() => {
    loadData()
    function onUpdated() { loadData() }
    try { window.addEventListener('connections-updated', onUpdated) } catch {}
    return () => { try { window.removeEventListener('connections-updated', onUpdated) } catch {} }
  }, [loadData])

  const deleteRoom = async (roomId: string) => {
    if (!confirm('Are you sure you want to delete this room? This action cannot be undone.')) {
      return
    }
    
    try {
      const response = await fetch(`/api/conversations/${roomId}`, {
        method: 'DELETE',
      })
      
      if (response.ok) {
        // Reload the data to update the sidebar
        await loadData()
      } else {
        alert('Failed to delete room')
      }
    } catch (error) {
      console.error('Error deleting room:', error)
      alert('Failed to delete room')
    }
  }

  const getParticipantCount = (conv: Conversation) => {
    const participants = conv.participants || []
    const agentCount = participants.filter(p => p.type === 'agent').length
    const userCount = participants.filter(p => p.type === 'user').length
    return { agentCount, userCount, total: participants.length }
  }

  const getParticipantAvatars = (conv: Conversation) => {
    const participants = conv.participants || []
    const agentParticipants = participants.filter(p => p.type === 'agent')
    
    // Get the first two agent avatars
    const firstTwoAgents = agentParticipants.slice(0, 2)
    const remainingCount = Math.max(0, participants.length - 2)
    
    return { firstTwoAgents, remainingCount }
  }

  const dmRoomsByConnectionId = useMemo(() => {
    const map = new Map<string, string>()
    for (const room of rooms) {
      if ((room as any)?.kind !== 'dm') continue
      const myEntry = Array.isArray((room as any)?.participants)
        ? (room as any).participants.find((p: any) => p?.actorId && p?.isSelf)
        : null
      const myActorId = myEntry?.actorId
      const participants = Array.isArray((room as any)?.participants) ? (room as any).participants : []
      for (const participant of participants) {
        if (participant?.type !== 'user') continue
        if (participant?.actorId && participant.actorId === myActorId) continue
        const identifiers: Array<string | undefined> = [
          participant?.actorId,
          participant?.actor?.id,
          participant?.id,
          participant?.userId,
          participant?.handle,
          participant?.email,
          participant?.name,
          (participant as any)?.displayName,
          (participant as any)?.ownerUserId,
          (participant as any)?.actor?.ownerUserId,
        ]
        for (const identifier of identifiers) {
          if (!identifier) continue
          map.set(String(identifier).trim(), room.id)
        }
      }
    }
    // Expose for debugging
    if (typeof window !== 'undefined') {
      try { (window as any).__dmMap = Object.fromEntries(map.entries()) } catch {}
    }
    return map
  }, [rooms])
  console.debug('[nav-projects] dmRoomsByConnectionId', Array.from(dmRoomsByConnectionId.entries()))

  const actorAliasesByConnectionId = useMemo(() => {
    // Build reverse lookup from any connection key → connection.id
    const keyToConnId = new Map<string, string>()
    for (const c of connections) {
      const keys = [c.id, c.handle, c.email, c.displayName, c.name, c.ownerUserId]
        .filter(Boolean)
        .map((v) => String(v).trim())
      for (const k of keys) keyToConnId.set(k, c.id)
    }

    const aliases = new Map<string, Set<string>>()
    for (const room of rooms) {
      if ((room as any)?.kind !== 'dm') continue
      const parts = Array.isArray((room as any)?.participants) ? (room as any).participants : []
      for (const p of parts) {
        if (p?.type !== 'user') continue
        const identifiers: string[] = [
          p?.actorId,
          p?.actor?.id,
          p?.id,
          p?.userId,
          p?.handle,
          p?.email,
          p?.name,
        ]
          .filter(Boolean)
          .map((v: any) => String(v).trim())
        // If any identifier matches a connection key, attribute all of this participant's ids as aliases of that connection
        const matchedConnId = identifiers.map((k) => keyToConnId.get(k)).find(Boolean)
        if (!matchedConnId) continue
        const set = aliases.get(matchedConnId) || new Set<string>()
        for (const id of identifiers) set.add(id)
        // Ensure the canonical actor ids are included if present
        if (p?.actorId) set.add(String(p.actorId))
        if (p?.actor?.id) set.add(String(p.actor.id))
        aliases.set(matchedConnId, set)
      }
    }
    if (typeof window !== 'undefined') {
      try { (window as any).__dmAliases = Object.fromEntries([...aliases.entries()].map(([k,v]) => [k, Array.from(v)])) } catch {}
    }
    return aliases
  }, [rooms, connections])

  const unreadByRoom = useUnreadStore((state) => state.unreadByRoom)
  const dmByActor = useUnreadStore((state) => state.dmUnreadByActorId)
  // Expose rooms and connections for debugging to verify mapping and unread state
  useEffect(() => {
    try { (window as any).__rooms = rooms } catch {}
  }, [rooms])
  useEffect(() => {
    try { (window as any).__connections = connections } catch {}
  }, [connections])

  return (
    <>
      {/* Private Messages: combine agents and users */}
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>
          <div className="flex items-center justify-between w-full">
            <span>Private Messages</span>
            <button
              className="text-xs px-2 py-0.5 hover:bg-accent/30"
              onClick={(e) => { e.preventDefault(); setAddPmOpen(true); loadActorsForAdd() }}
              aria-label="Start private message"
            >
              +
            </button>
          </div>
        </SidebarGroupLabel>
        <SidebarMenu>
          {/* Users (DMs) */}
          {connections.map((connection) => {
            const label = connection.displayName || connection.handle || connection.name || connection.id.slice(0, 8)
            const avatarSrc = typeof connection.avatarUrl === 'string' ? connection.avatarUrl : connection.avatar
            const lookupKeys = [connection.dmRoomId, connection.id, connection.handle, connection.email, connection.name, connection.displayName, (connection as any).ownerUserId].filter(Boolean) as string[]
            const dmRoomId = (connection as any).dmRoomId || lookupKeys.map((key) => dmRoomsByConnectionId.get(String(key).trim())).find(Boolean)
            const aliasSet = actorAliasesByConnectionId.get(connection.id)
            const hasAliasUnread = aliasSet ? Array.from(aliasSet).some((aid) => dmByActor[aid] === true) : false
            const anyPingMatches = Object.entries(dmByActor).some(([aid, flag]) => {
              if (!flag) return false
              const roomForAid = dmRoomsByConnectionId.get(String(aid).trim())
              if (!roomForAid) return false
              if (dmRoomId && roomForAid === dmRoomId) return true
              const keys = [connection.dmRoomId, connection.id, connection.handle, connection.email, connection.displayName, connection.name, connection.ownerUserId].filter(Boolean).map((k) => String(k).trim())
              for (const k of keys) { const kr = dmRoomsByConnectionId.get(k); if (kr && kr === roomForAid) return true }
              return false
            })
            let hasUnread = (dmByActor[connection.id] === true) || hasAliasUnread || anyPingMatches || (dmRoomId ? (unreadByRoom[dmRoomId] ?? 0) > 0 : false)
            if (!hasUnread) {
              try {
                for (const [rid, cnt] of Object.entries(unreadByRoom)) {
                  if (!cnt || cnt <= 0) continue
                  const room = rooms.find(r => r.id === rid)
                  if (!room || (room as any)?.kind !== 'dm') continue
                  const parts = Array.isArray((room as any)?.participants) ? (room as any).participants : []
                  const match = parts.some((p: any) => {
                    const ids = [p?.actorId, p?.actor?.id, p?.id, p?.userId, p?.handle, p?.email, p?.name].filter(Boolean).map((v: any) => String(v).trim())
                    return ids.includes(String(connection.id).trim()) || (connection.handle && ids.includes(String(connection.handle).trim())) || (connection.email && ids.includes(String(connection.email).trim()))
                  })
                  if (match) { hasUnread = true; break }
                }
              } catch {}
            }
            const itemKey = `${connection.id}-${dmRoomId || 'no-room'}`
            return (
              <SidebarMenuItem key={`u-${itemKey}`}>
                <SidebarMenuButton asChild className="justify-start">
                  <a href="#" onClick={async (e) => { e.preventDefault(); try { const uid = (session as any)?.userId || (session as any)?.user?.email; const res = await fetch('/api/rooms/dm', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) }, body: JSON.stringify({ targetActorId: connection.id }) }); const json = await res.json(); const roomId = json?.roomId; if (roomId) window.location.href = `/c/${roomId}` } catch {} }}>
                    <div className="relative flex items-center gap-2">
                      <div className="relative">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={avatarSrc} />
                          <AvatarFallback className="text-xs">{label?.[0]?.toUpperCase?.() || 'U'}</AvatarFallback>
                        </Avatar>
                        {hasUnread ? (<span className="pointer-events-none absolute -top-1 -right-1 h-2 w-2 rounded-full bg-rose-500" aria-hidden />) : null}
                      </div>
                      <span className={"truncate " + (hasUnread ? "font-semibold" : "")}>{label}</span>
                    </div>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
          {/* Agents (1:1 agent chat) */}
          {agents.map(a => (
            <SidebarMenuItem key={`a-${a.id}`}>
              <SidebarMenuButton asChild>
                <a href="#" onClick={async (e) => { e.preventDefault(); try { const uid = (session as any)?.userId || (session as any)?.user?.email; const res = await fetch('/api/rooms/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) }, body: JSON.stringify({ agentId: a.id }) }); const json = await res.json(); const roomId = json?.roomId; if (roomId) window.location.href = `/c/${roomId}`; else window.location.href = `/c/${a.id}`; } catch { window.location.href = `/c/${a.id}`; } }}>
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={a.avatar ? (a.avatar.startsWith('/') ? a.avatar : a.avatar) : undefined} />
                    <AvatarFallback className="text-xs">{a.name?.[0]?.toUpperCase() || 'A'}</AvatarFallback>
                  </Avatar>
                  <span>{a.name}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>
          <div className="flex items-center justify-between w-full">
            <span>Rooms</span>
            <div className="flex items-center gap-2">
              <button
                className="text-xs px-2 py-0.5 hover:bg-accent/30"
                onClick={(e) => { e.preventDefault(); setCreateOpen(true) }}
                aria-label="Create room"
              >
                +
              </button>
            </div>
          </div>
        </SidebarGroupLabel>
          <SidebarMenu>
            {rooms.filter(r => (r as any).kind === 'group').map(r => (
              <SidebarMenuItem key={r.id}>
                <SidebarMenuButton asChild>
                  <a href={`/c/${r.id}`}>
                    <Users className="h-4 w-4" />
                    <span>{r.title || r.id.slice(0, 8)}</span>
                  </a>
                </SidebarMenuButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuAction showOnHover>
                      <MoreHorizontal />
                      <span className="sr-only">More</span>
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-40 rounded-lg" side={isMobile ? "bottom" : "right"} align={isMobile ? "end" : "start"}>
                    <DropdownMenuItem onClick={() => deleteSocialRoom(r.id)} className="text-red-600 focus:text-red-600">
                      <Trash2 className="text-muted-foreground" />
                      <span>Delete Room</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            ))}
            {rooms.filter(r => (r as any).kind === 'group').length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">No rooms yet</div>
            )}
          </SidebarMenu>
      </SidebarGroup>

      {/* Users section removed: covered by Private Messages */}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-none w-screen h-screen p-0 bg-transparent">
          <div className="w-full h-full flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-background border rounded-lg p-4 shadow-lg">
              <DialogHeader>
                <DialogTitle>Create a room</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <input
                  className="w-full border rounded px-2 py-1 text-sm bg-background"
                  placeholder="Room title (optional)"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                />
                <div>
                  <div className="text-xs font-medium mb-1">Users</div>
                  <div className="max-h-40 overflow-auto space-y-1 border rounded p-2">
                    {connections.map((c: any) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={selectedUsers.has(c.id)} onCheckedChange={(v) => {
                          const s = new Set(selectedUsers); if (v) s.add(c.id); else s.delete(c.id); setSelectedUsers(s);
                        }} />
                        <span>{c.displayName || c.handle || c.id.slice(0,8)}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium mb-1">Agents</div>
                  <div className="max-h-40 overflow-auto space-y-1 border rounded p-2">
                    {agents.map((a: any) => (
                      <label key={a.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={selectedAgents.has(a.id)} onCheckedChange={(v) => {
                          const s = new Set(selectedAgents); if (v) s.add(a.id); else s.delete(a.id); setSelectedAgents(s);
                        }} />
                        <span>{a.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <button
                  disabled={creating}
                  className="text-xs border rounded px-3 py-1"
                  onClick={async () => {
                    try {
                      setCreating(true);
                      const uid = (session as any)?.userId || (session as any)?.user?.email;
                      const headers = { 'Content-Type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) } as any;
                      const participants: string[] = Array.from(selectedUsers);
                      const agentIds: string[] = Array.from(selectedAgents);
                      const res = await fetch('/api/rooms', {
                        method: 'POST', headers, body: JSON.stringify({ kind: 'group', title: createTitle || null, participants, agentIds })
                      });
                      const json = await res.json();
                      setCreating(false);
                      if (res.ok && json?.id) {
                        setCreateOpen(false); setCreateTitle(''); setSelectedUsers(new Set()); setSelectedAgents(new Set());
                        await loadData();
                        window.location.href = `/c/${json.id}`;
                      }
                    } catch { setCreating(false); }
                  }}
                >Create</button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Private Message dialog (users + agents) */}
      <Dialog open={addPmOpen} onOpenChange={setAddPmOpen}>
        <DialogContent className="sm:max-w-none w-screen h-screen p-0 bg-transparent">
          <div className="w-full h-full flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-background border rounded-lg p-4 shadow-lg">
              <DialogHeader>
                <DialogTitle>Start a private message</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                {loadingActors && <div className="text-xs text-muted-foreground">Loading…</div>}
                {!loadingActors && (
                  <div className="max-h-64 overflow-auto space-y-1">
                    {[...allActors.filter(a => a.type === 'user'), ...allActors.filter(a => a.type === 'agent')].map(a => (
                      <div key={a.id} className="flex items-center justify-between border rounded px-2 py-1 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={typeof a.avatarUrl === 'string' ? a.avatarUrl : undefined} />
                            <AvatarFallback className="text-[10px]">{(a.displayName || a.handle || (a.type === 'agent' ? 'A' : 'U')).slice(0,1).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="truncate">{a.displayName || a.handle || a.id.slice(0,8)}</div>
                        </div>
                        {a.type === 'user' ? (
                          <button className="text-xs border rounded px-2 py-0.5" onClick={async () => { await connectToUser(a.id); setAddPmOpen(false); }}>Message</button>
                        ) : (
                          <button className="text-xs border rounded px-2 py-0.5" onClick={async () => { await requestAgentAccess(a); setAddPmOpen(false); }}>Message</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </>
  )
}
