'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { Users, PanelRight } from 'lucide-react';
import { useSession } from 'next-auth/react';

export default function ConversationPage() {
  const params = useParams();
  const conversationId = decodeURIComponent(((params?.conversationId as string) || 'default-room'));
  const [currentConversation, setCurrentConversation] = useState(conversationId);
  const [agentName, setAgentName] = useState<string>('');
  const [agentAvatar, setAgentAvatar] = useState<string | undefined>(undefined);
  const { data: session, status } = useSession();

  useEffect(() => {
    async function ensureRoom() {
      setCurrentConversation(conversationId);
      // If param looks like an agentId (uuid) and not an existing room, try to resolve per-user room
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId);
        if (!isUuid) return; // Only try for UUID-looking IDs
        // Probe /api/rooms/:id; if 404, attempt /api/rooms/agent
        const uid = (session as any)?.userId || (session as any)?.user?.email;
        if (!uid) return;
        const probe = await fetch(`/api/rooms/${conversationId}`, { cache: 'no-store', headers: { 'x-user-id': uid } });
        if (probe.status === 404) {
          const res = await fetch('/api/rooms/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': uid }, body: JSON.stringify({ agentId: conversationId }) });
          const json = await res.json();
          const rid = json?.roomId;
          if (rid && rid !== conversationId) {
            window.location.replace(`/c/${rid}`);
          }
        }
      } catch {}
    }
    ensureRoom();
  }, [conversationId]);

  // Fetch agent/room name for breadcrumb (uses authenticated relative API with x-user-id)
  useEffect(() => {
    async function fetchAgentName() {
      try {
        if (!conversationId) return;
        if (status !== 'authenticated') { setAgentName(''); return; }
        const uid = (session as any)?.userId || (session as any)?.user?.email;
        if (!uid) { setAgentName(''); return; }
        
        // Check if this is a compound conversation ID (contains multiple agent IDs)
        if (conversationId.includes('-') && conversationId.length > 36) {
          // This is likely a multi-agent conversation, try to fetch conversation details
          const res = await fetch(`/api/conversations`, { cache: 'no-store', headers: { 'x-user-id': uid } });
          if (res.ok) {
            const data = await res.json();
            const conversation = data.conversations.find((c: any) => c.id === conversationId);
            if (conversation) {
              setAgentName(conversation.name || 'Multi-Agent Room');
              return;
            }
          }
        }
        
        // Try to fetch room metadata first (dm or agent_chat)
        const rm = await fetch(`/api/rooms/${conversationId}`, { cache: 'no-store', headers: { 'x-user-id': uid } });
        if (rm.ok) {
          const data = await rm.json();
          if ((data?.room?.kind === 'dm' || data?.room?.kind === 'agent_chat')) {
            if (data.dm?.title) setAgentName(data.dm.title);
            else if (data?.room?.title) setAgentName(data.room.title);
            if (data.dm?.avatar) setAgentAvatar(data.dm.avatar);
            return;
          }
        }

        // Fallback: treat as agent room
        const res = await fetch(`/api/agents/${conversationId}`, { cache: 'no-store', headers: { 'x-user-id': uid } });
        if (res.ok) {
          const data = await res.json();
          setAgentName(data.name || conversationId);
          setAgentAvatar(data.avatar || undefined);
        } else {
          setAgentName(conversationId);
          setAgentAvatar(undefined);
        }
      } catch {
        setAgentName(conversationId);
      }
    }
    fetchAgentName();
  }, [conversationId, status, session]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/">Chat</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{agentName || currentConversation}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto px-4">
            <button
              onClick={() => {
                const evt = new CustomEvent('toggle-participants');
                window.dispatchEvent(evt);
              }}
              className="flex items-center justify-center rounded-md bg-background hover:bg-accent text-foreground size-8 -mr-1"
              aria-label="Toggle participants"
            >
              <PanelRight className="h-4 w-4 scale-x-[-1]" />
            </button>
          </div>
        </header>
        <div className="flex flex-1 flex-col h-full">
          <ChatInterface 
            currentConversation={currentConversation}
            onConversationChange={(id) => {
              window.location.href = `/c/${id}`;
            }}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}


