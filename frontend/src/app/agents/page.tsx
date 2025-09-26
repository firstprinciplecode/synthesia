'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { DataTableAgents, type AgentRow } from '@/components/data-table';
import { useSession } from 'next-auth/react';


type Agent = {
  id: string;
  name: string;
  description: string | null;
  defaultModel?: string;
  defaultProvider?: string;
};

export default function AgentsPage() {
  const { status, data: session } = useSession();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setError(null);
        const uid = (session as any)?.userId;
        if (!uid) {
          setAgents([]);
          setLoading(false);
          return;
        }
        const res = await fetch(`/api/agents`, { cache: 'no-store', headers: { 'x-user-id': uid } });
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        let data: any;
        try { data = await res.json(); } catch { throw new Error('Invalid JSON from /api/agents'); }
        const list = Array.isArray(data)
          ? data
          : (Array.isArray(data?.agents) ? data.agents : []);
        setAgents(list);
      } catch (e: any) {
        setError(e?.message || 'Failed to fetch');
      } finally {
        setLoading(false);
      }
    }
    if (status === 'authenticated') {
      load();
    } else if (status === 'unauthenticated') {
      setAgents([]);
      setLoading(false);
    }
  }, [status, session]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>My Agents</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-semibold">Agents</h1>
            {status === 'authenticated' ? (
              <Link href="/agents/new" className="text-sm font-semibold hover:underline">Create Agent</Link>
            ) : null}
          </div>
          {status !== 'authenticated' && (
            <div className="text-sm text-muted-foreground">
              You must be signed in to view your agents. <Link href="/signin" className="underline">Sign in</Link>
            </div>
          )}
          {status === 'authenticated' && loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {status === 'authenticated' && error && <p className="text-sm text-red-500">{error}</p>}
          {status === 'authenticated' && !loading && !error && (
            <DataTableAgents rows={agents.map((a): AgentRow => {
              const raw = (a as any).avatar as string | undefined;
              const avatarUrl = raw ? (raw.startsWith('/') ? raw : raw) : undefined;
              return {
                id: a.id,
                name: a.name,
                description: a.description,
                defaultModel: (a as any).defaultModel || '',
                defaultProvider: (a as any).defaultProvider || '',
                avatarUrl,
              };
            })} />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}


