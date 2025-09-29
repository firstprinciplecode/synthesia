"use client"

import * as React from "react"
import { Bot, User, Circle, Users } from "lucide-react"
import { useUnreadStore } from '@/stores/unread-store'

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavConversations({
  conversations,
  currentConversation,
  onConversationChange,
}: {
  conversations: Array<{
    id: string
    name: string
    type: "agent" | "user" | "multi-agent"
    status: "online" | "offline" | "away"
    lastMessage: string
    timestamp: string
    avatarUrl?: string
  }>
  currentConversation?: string
  onConversationChange?: (conversationId: string) => void
}) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "online":
        return "text-green-500"
      case "away":
        return "text-yellow-500"
      case "offline":
        return "text-gray-400"
      default:
        return "text-gray-400"
    }
  }

  const unreadByRoom = useUnreadStore((state) => state.unreadByRoom)

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        Conversations
      </SidebarGroupLabel>
      <SidebarMenu>
        {conversations.map((conversation) => {
          const unreadCount = unreadByRoom[conversation.id] ?? 0
          const isActive = currentConversation === conversation.id;
          return (
            <SidebarMenuItem key={conversation.id}>
              <SidebarMenuButton
                asChild
                size="lg"
                className="w-full justify-start"
              >
                <a href={`/c/${conversation.id}`}>
                  <div className="flex items-center gap-2 w-full">
                    <div className="relative">
                      {conversation.avatarUrl ? (
                        <img src={conversation.avatarUrl} alt={conversation.name} className="h-5 w-5 rounded-full object-cover" />
                      ) : conversation.type === "multi-agent" ? (
                        <Users className="h-5 w-5 text-purple-500" />
                      ) : conversation.type === "agent" ? (
                        <Bot className="h-5 w-5 text-blue-500" />
                      ) : (
                        <User className="h-5 w-5 text-gray-500" />
                      )}
                      <Circle
                        className={`absolute -bottom-1 -right-1 h-3 w-3 ${getStatusColor(conversation.status)}`}
                        fill="currentColor"
                      />
                      {unreadCount > 0 && !isActive ? (
                        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-rose-500" aria-hidden />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm truncate ${isActive ? 'font-bold' : 'font-medium'}`}>
                          {conversation.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {conversation.timestamp}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {conversation.lastMessage}
                      </p>
                    </div>
                  </div>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
