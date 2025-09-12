'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { Users, PanelRight } from 'lucide-react';

export default function ConversationPage() {
  const params = useParams();
  const conversationId = (params?.conversationId as string) || 'default-room';
  const [currentConversation, setCurrentConversation] = useState(conversationId);
  const [agentName, setAgentName] = useState<string>('');

  useEffect(() => {
    setCurrentConversation(conversationId);
  }, [conversationId]);

  // Fetch agent name for breadcrumb
  useEffect(() => {
    async function fetchAgentName() {
      try {
        if (!conversationId) return;
        
        // Check if this is a compound conversation ID (contains multiple agent IDs)
        if (conversationId.includes('-') && conversationId.length > 36) {
          // This is likely a multi-agent conversation, try to fetch conversation details
          const res = await fetch(`http://localhost:3001/api/conversations`);
          if (res.ok) {
            const data = await res.json();
            const conversation = data.conversations.find((c: any) => c.id === conversationId);
            if (conversation) {
              setAgentName(conversation.name || 'Multi-Agent Room');
              return;
            }
          }
        }
        
        // Try to fetch as single agent
        const res = await fetch(`http://localhost:3001/api/agents/${conversationId}`);
        if (res.ok) {
          const data = await res.json();
          setAgentName(data.name || conversationId);
        } else {
          setAgentName(conversationId);
        }
      } catch {
        setAgentName(conversationId);
      }
    }
    fetchAgentName();
  }, [conversationId]);

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


