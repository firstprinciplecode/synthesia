"use client"

import { MoreHorizontal, Bot, Users, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

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

export function NavProjects() {
  const { isMobile } = useSidebar()
  const [agents, setAgents] = useState<Agent[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [agentMap, setAgentMap] = useState<Map<string, Agent>>(new Map())

  const loadData = async () => {
    try {
      // Load agents
      const agentsRes = await fetch('http://localhost:3001/api/agents', { cache: 'no-store' })
      const agentsData = await agentsRes.json()
      const agentsList: Agent[] = Array.isArray(agentsData) ? agentsData : (Array.isArray(agentsData?.agents) ? agentsData.agents : [])
      setAgents(agentsList)
      
      // Create agent map for quick lookup
      const map = new Map<string, Agent>()
      agentsList.forEach(agent => map.set(agent.id, agent))
      setAgentMap(map)

      // Load conversations (multi-agent rooms)
      const convRes = await fetch('http://localhost:3001/api/conversations', { cache: 'no-store' })
      const convData = await convRes.json()
      const convList: Conversation[] = Array.isArray(convData) ? convData : (Array.isArray(convData?.conversations) ? convData.conversations : [])
      // Filter for multi-agent rooms
      const multiAgentRooms = convList.filter(conv => conv.type === 'multi-agent' && conv.participants && conv.participants.length > 1)
      setConversations(multiAgentRooms)
    } catch {}
  }

  useEffect(() => {
    let cancelled = false
    loadData()
    return () => { cancelled = true }
  }, [])

  const deleteRoom = async (roomId: string) => {
    if (!confirm('Are you sure you want to delete this room? This action cannot be undone.')) {
      return
    }
    
    try {
      const response = await fetch(`http://localhost:3001/api/conversations/${roomId}`, {
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
                <a href={`/c/${a.id}`}>
                  <Avatar className="h-4 w-4">
                    <AvatarImage src={a.avatar ? (a.avatar.startsWith('/') ? `http://localhost:3001${a.avatar}` : a.avatar) : undefined} />
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

      {conversations.length > 0 && (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Multi-Agent Rooms</SidebarGroupLabel>
          <SidebarMenu>
            {conversations.map(conv => {
              const { agentCount, userCount, total } = getParticipantCount(conv)
              const { firstTwoAgents, remainingCount } = getParticipantAvatars(conv)
              return (
                <SidebarMenuItem key={conv.id}>
                  <SidebarMenuButton asChild>
                    <a href={`/c/${conv.id}`}>
                      <div className="flex items-center gap-2">
                        {/* Participant avatars */}
                        <div className="relative flex items-center">
                          {firstTwoAgents.map((participant, index) => {
                            const agent = agentMap.get(participant.id)
                            return (
                              <Avatar 
                                key={participant.id} 
                                className="h-5 w-5 border border-background animate-glow"
                                style={{ animationDelay: `${index * 0.3}s` }}
                              >
                                <AvatarImage 
                                  src={agent?.avatar ? (agent.avatar.startsWith('/') ? `http://localhost:3001${agent.avatar}` : agent.avatar) : undefined} 
                                  className="object-cover"
                                />
                                <AvatarFallback className="text-xs bg-purple-500 text-white">
                                  {agent?.name?.[0]?.toUpperCase() || 'A'}
                                </AvatarFallback>
                              </Avatar>
                            )
                          })}
                          {remainingCount > 0 && (
                            <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 h-3 w-3 rounded-full bg-red-500 border border-background flex items-center justify-center z-10">
                              <span className="text-xs font-medium text-white">+{remainingCount}</span>
                            </div>
                          )}
                        </div>
                        
                        {/* Room info */}
                        <div className="flex flex-col items-start">
                          <span className="text-sm font-medium">{conv.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {agentCount} agent{agentCount !== 1 ? 's' : ''}
                            {userCount > 0 && ` + ${userCount} user${userCount !== 1 ? 's' : ''}`}
                          </span>
                        </div>
                      </div>
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
                      <DropdownMenuItem asChild>
                        <a href={`/c/${conv.id}`}>
                          <Users className="text-muted-foreground" />
                          <span>Open Room</span>
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => deleteRoom(conv.id)}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="text-muted-foreground" />
                        <span>Delete Room</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      )}
    </>
  )
}
