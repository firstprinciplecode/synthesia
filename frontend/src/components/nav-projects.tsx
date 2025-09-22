"use client"

import { MoreHorizontal, Bot, Users, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
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

type Agent = { id: string; name: string; avatar?: string | null }
type Conversation = { id: string; title: string; type: string; participants: any[] }
type Room = { id: string; title?: string | null; kind?: string | null }

export function NavProjects() {
  const { isMobile } = useSidebar()
  const { status, data: session } = useSession()
  const [agents, setAgents] = useState<Agent[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [agentMap, setAgentMap] = useState<Map<string, Agent>>(new Map())
  const [rooms, setRooms] = useState<Room[]>([])
  const [connections, setConnections] = useState<any[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState("")
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  const loadData = async () => {
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
          setConnections(Array.isArray(cj?.connections) ? cj.connections : [])
        } else {
          setConnections([])
        }
      } catch { setConnections([]) }
    } catch {}
  }

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

  useEffect(() => {
    let cancelled = false
    loadData()
    function onUpdated() { loadData() }
    try { window.addEventListener('connections-updated', onUpdated) } catch {}
    return () => { cancelled = true }
  }, [status])

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

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Agents</SidebarGroupLabel>
        <SidebarMenu>
          {agents.map(a => (
            <SidebarMenuItem key={a.id}>
              <SidebarMenuButton asChild>
                <a href="#" onClick={async (e) => { e.preventDefault(); try { const uid = (session as any)?.userId || (session as any)?.user?.email; const res = await fetch('/api/rooms/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) }, body: JSON.stringify({ agentId: a.id }) }); const json = await res.json(); const roomId = json?.roomId; if (roomId) window.location.href = `/c/${roomId}`; else window.location.href = `/c/${a.id}`; } catch { window.location.href = `/c/${a.id}`; } }}>
                  <Avatar className="h-4 w-4">
                    <AvatarImage src={a.avatar ? (a.avatar.startsWith('/') ? a.avatar : a.avatar) : undefined} />
                    <AvatarFallback className="text-xs">{a.name?.[0]?.toUpperCase() || 'A'}</AvatarFallback>
                  </Avatar>
                  <span>{a.name}</span>
                </a>
              </SidebarMenuButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuAction showOnHover>
                    <MoreHorizontal />
                    <span className="sr-only">More</span>
                  </SidebarMenuAction>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-48 rounded-lg" side={isMobile ? "bottom" : "right"} align={isMobile ? "end" : "start"}>
                  <DropdownMenuItem>
                    <Bot className="text-muted-foreground" />
                    <span>Chat with {a.name}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>
          <div className="flex items-center justify-between w-full">
            <span>Rooms</span>
            <button
              className="text-xs border rounded px-2 py-0.5 hover:bg-accent"
              onClick={(e) => { e.preventDefault(); setCreateOpen(true) }}
              aria-label="Create room"
            >
              +
            </button>
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

      {connections.length > 0 && (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Connections</SidebarGroupLabel>
          <SidebarMenu>
                  {connections.map((c: any) => (
                    <SidebarMenuItem key={c.id}>
                      <SidebarMenuButton asChild>
                        <a href="#" onClick={async (e) => { e.preventDefault(); try { const uid = (session as any)?.userId || (session as any)?.user?.email; const res = await fetch('/api/rooms/dm', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) }, body: JSON.stringify({ targetActorId: c.id }) }); const json = await res.json(); const roomId = json?.roomId; if (roomId) window.location.href = `/c/${roomId}`; } catch {} }}>
                          <Avatar className="h-4 w-4">
                            <AvatarImage src={typeof c.avatarUrl === 'string' ? c.avatarUrl : undefined} />
                            <AvatarFallback className="text-xs">{(c.displayName || c.handle || 'U')[0]?.toUpperCase?.() || 'U'}</AvatarFallback>
                          </Avatar>
                          <span>{c.displayName || c.handle || c.id.slice(0,8)}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
          </SidebarMenu>
        </SidebarGroup>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
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
        </DialogContent>
      </Dialog>
      </>
  )
}
