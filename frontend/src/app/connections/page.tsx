'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AppSidebar } from '@/components/app-sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';

type Actor = {
  id: string;
  type: 'user' | 'agent';
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  settings?: any;
  ownerUserId?: string | null;
};

export default function ConnectionsPage() {
  const { status, data: session } = useSession();
  const uid = useMemo(() => (session as any)?.userId || (session as any)?.user?.email || '', [session]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actors, setActors] = useState<Actor[]>([]);
  const [connections, setConnections] = useState<Actor[]>([]);
  const [incomingPending, setIncomingPending] = useState<any[]>([]);
  const [outgoingPending, setOutgoingPending] = useState<any[]>([]);
  const [outgoingAgentAccessPending, setOutgoingAgentAccessPending] = useState<any[]>([]);
  const [myActorId, setMyActorId] = useState<string>('');
  const [myOwnerUserId, setMyOwnerUserId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [agentMap, setAgentMap] = useState<Record<string, any>>({});
  const [accessibleAgentIds, setAccessibleAgentIds] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async function loadAll() {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const headers = { 'x-user-id': uid } as any;
      const [actorsRes, connRes, agentsRes, incomingRes, outgoingRes, outgoingAgentAccessRes, accessibleAgentsRes] = await Promise.all([
        fetch('/api/actors', { cache: 'no-store', headers }),
        fetch('/api/connections', { cache: 'no-store', headers }),
        fetch('/api/agents', { cache: 'no-store', headers }),
        fetch('/api/relationships?direction=incoming&status=pending', { cache: 'no-store', headers }),
        fetch('/api/relationships?direction=outgoing&status=pending', { cache: 'no-store', headers }),
        fetch('/api/relationships?direction=outgoing&kind=agent_access&status=pending', { cache: 'no-store', headers }),
        fetch('/api/agents/accessible', { cache: 'no-store', headers }),
      ]);
      const actorsJson = await actorsRes.json();
      const conJson = await connRes.json();
      const agentsJson = await agentsRes.json();
      const incomingJson = await incomingRes.json();
      const outgoingJson = await outgoingRes.json();
      const list = Array.isArray(actorsJson?.actors) ? actorsJson.actors : (Array.isArray(actorsJson) ? actorsJson : []);
      setActors(list);
      const conns = Array.isArray(conJson?.connections) ? conJson.connections : [];
      setConnections(conns);
      setIncomingPending(Array.isArray(incomingJson?.relationships) ? incomingJson.relationships : []);
      setOutgoingPending(Array.isArray(outgoingJson?.relationships) ? outgoingJson.relationships : []);
      try {
        const outAgent = await outgoingAgentAccessRes.json();
        setOutgoingAgentAccessPending(Array.isArray(outAgent?.relationships) ? outAgent.relationships : []);
      } catch {}
      try {
        const meRes = await fetch('/api/actors/me', { cache: 'no-store', headers });
        const me = await meRes.json();
        if (me?.id) setMyActorId(me.id as string);
        if (typeof me?.ownerUserId === 'string') setMyOwnerUserId(me.ownerUserId);
      } catch {}
      const allAgents = Array.isArray(agentsJson?.agents) ? agentsJson.agents : (Array.isArray(agentsJson) ? agentsJson : []);
      const m: Record<string, any> = {};
      for (const a of allAgents) m[a.id] = a;
      try {
        const acc = await accessibleAgentsRes.json();
        const arr = Array.isArray(acc?.agents) ? acc.agents : [];
        // Merge accessible agents into the agent map so names/avatars resolve
        for (const ag of arr) {
          m[ag.id] = { ...(m[ag.id] || {}), ...ag };
        }
        setAccessibleAgentIds(new Set(arr.map((ag: any) => ag.id)));
      } catch {}
      setAgentMap(m);
    } catch (e: any) {
      setError(e?.message || 'Failed to load connections');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { if (status === 'authenticated') loadAll(); }, [status, uid, loadAll]);

  const connectionIds = useMemo(() => new Set(connections.map(c => c.id)), [connections]);
  const outgoingPendingIds = useMemo(() => new Set(outgoingPending.map(r => r.toActorId)), [outgoingPending]);
  const outgoingAgentAccessPendingIds = useMemo(() => new Set(outgoingAgentAccessPending.map(r => r.toActorId)), [outgoingAgentAccessPending]);
  const myAgentIds = useMemo(() => {
    const ids: string[] = [];
    for (const [aid, ag] of Object.entries(agentMap)) ids.push(aid);
    return new Set(ids);
  }, [agentMap]);

  // Choose a single preferred actor per agentId (prefer Owned > Accessible > other)
  const preferredActorIdByAgentId = useMemo(() => {
    const map: Record<string, string> = {};
    const weightFor = (agentId: string) => (myAgentIds.has(agentId) ? 2 : (accessibleAgentIds.has(agentId) ? 1 : 0));
    for (const a of actors) {
      if (a.type !== 'agent') continue;
      const agentId = a?.settings?.agentId as string | undefined;
      if (!agentId) continue;
      const w = weightFor(agentId);
      const prevId = map[agentId];
      if (!prevId) { map[agentId] = a.id; continue; }
      const prev = actors.find(x => x.id === prevId);
      const prevW = prev && prev.type === 'agent' && prev.settings?.agentId ? weightFor(prev.settings.agentId) : 0;
      if (w > prevW) map[agentId] = a.id;
    }
    return map;
  }, [actors, myAgentIds, accessibleAgentIds]);

  async function connect(a: Actor) {
    if (!uid) return;
    try {
      if (a.type === 'agent' && a.settings?.agentId) {
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
          body: JSON.stringify({ kind: 'agent_access', agentId: a.settings.agentId, toActorId: a.id }),
        });
      } else {
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
          body: JSON.stringify({ toActorId: a.id, kind: 'follow' }),
        });
      }
      await loadAll();
      try { window.dispatchEvent(new CustomEvent('connections-updated')); } catch {}
    } catch {}
  }

  async function unfollow(actorId: string) {
    if (!uid) return;
    try {
      const url = `/api/relationships?toActorId=${encodeURIComponent(actorId)}&kind=follow`;
      await fetch(url, { method: 'DELETE', headers: { 'x-user-id': uid } });
      await loadAll();
      try { window.dispatchEvent(new CustomEvent('connections-updated')); } catch {}
    } catch {}
  }

  async function cancelRequest(a: Actor) {
    if (!uid) return;
    try {
      const kind = a.type === 'agent' ? 'agent_access' : 'follow';
      const url = `/api/relationships?toActorId=${encodeURIComponent(a.id)}&kind=${encodeURIComponent(kind)}`;
      await fetch(url, { method: 'DELETE', headers: { 'x-user-id': uid } });
      await loadAll();
      try { window.dispatchEvent(new CustomEvent('connections-updated')); } catch {}
    } catch {}
  }

  async function approve(fromActorId: string) {
    if (!uid) return;
    try {
      await fetch('/api/relationships/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
        body: JSON.stringify({ fromActorId }),
      });
      await loadAll();
      try { window.dispatchEvent(new CustomEvent('connections-updated')); } catch {}
    } catch {}
  }

  async function message(actorId: string) {
    if (!uid) return;
    try {
      const res = await fetch('/api/rooms/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
        body: JSON.stringify({ targetActorId: actorId }),
      });
      const json = await res.json();
      const roomId = json?.roomId as string | undefined;
      if (roomId) window.location.href = `/c/${roomId}`;
    } catch {}
  }

  function resolveName(a: Actor): string {
    if (a.type === 'agent') {
      const aid = a?.settings?.agentId as string | undefined;
      if (aid && agentMap[aid]?.name) return agentMap[aid].name as string;
    }
    return (a.displayName || a.handle || a.id);
  }

  function resolveAvatar(a: Actor): string | undefined {
    if (a.type === 'agent') {
      const aid = a?.settings?.agentId as string | undefined;
      const av = aid ? (agentMap[aid]?.avatar as string | undefined) : undefined;
      if (av) return av;
    }
    return a.avatarUrl || undefined;
  }

  const filtered = actors.filter(a => {
    // Drop orphans/default-user in UI defensively
    if (a.type === 'user' && (!a.ownerUserId || a.ownerUserId === 'default-user' || !a.displayName)) return false;
    // Hide bare agent placeholders that lack both displayName and a resolvable agent name
    if (a.type === 'agent') {
      const aid = a?.settings?.agentId as string | undefined;
      const name = aid && agentMap[aid]?.name ? agentMap[aid].name as string : (a.displayName || '');
      if (!name) return false;
    }
    if (!query) return true;
    const q = query.toLowerCase();
    const name = resolveName(a).toLowerCase();
    const handle = (a.handle || '').toLowerCase();
    return name.includes(q) || handle.includes(q) || a.id.toLowerCase().includes(q);
  });

  // Deduplicate agents: keep only the preferred actor per agentId
  const filteredDeduped = useMemo(() => {
    const out: Actor[] = [];
    const seenAgentIds = new Set<string>();
    for (const a of filtered) {
      if (a.type === 'agent') {
        const agentId = a?.settings?.agentId as string | undefined;
        if (!agentId) continue;
        if (seenAgentIds.has(agentId)) continue;
        const preferredId = preferredActorIdByAgentId[agentId];
        if (preferredId && preferredId !== a.id) continue;
        seenAgentIds.add(agentId);
        out.push(a);
      } else {
        out.push(a);
      }
    }
    return out;
  }, [filtered, preferredActorIdByAgentId]);

  function initialFor(a: Actor): string {
    const n = resolveName(a);
    const ch = (n || 'U').trim().charAt(0).toUpperCase();
    return ch || 'U';
  }

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
                  <BreadcrumbPage>Connections</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="p-4 space-y-4">
          {status !== 'authenticated' ? (
            <div className="text-sm text-muted-foreground">You must be signed in to manage connections.</div>
          ) : (
            <>
              <div className="flex gap-2 items-center">
                <input
                  className="border rounded px-2 py-1 text-sm bg-transparent flex-1"
                  placeholder="Search people and agents"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button onClick={loadAll} className="text-sm border rounded px-2 py-1">Refresh</button>
              </div>
              {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
              {error && <div className="text-sm text-red-500">{error}</div>}
              {/* Incoming requests */}
              {incomingPending.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Incoming requests</div>
                  <div className="grid gap-2">
                    {incomingPending.map((r) => {
                      const a = actors.find(x => x.id === r.fromActorId);
                      if (!a) return null;
                      return (
                        <div key={`in-${r.id}`} className="flex items-center justify-between border rounded px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={resolveAvatar(a)} />
                              <AvatarFallback className="text-xs">{initialFor(a)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{resolveName(a)}</div>
                              <div className="text-xs text-muted-foreground truncate">wants to connect</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => approve(a.id)} className="text-xs border rounded px-2 py-1">Approve</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                {filteredDeduped.map(a => (
                  <div key={a.id} className="flex items-center justify-between border rounded px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={resolveAvatar(a)} />
                        <AvatarFallback className="text-xs">{initialFor(a)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{resolveName(a)}</div>
                        <div className="text-xs text-muted-foreground truncate">{a.type === 'agent' ? 'agent' : 'user'}{a.handle ? ` · @${a.handle}` : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(a.id === myActorId) || (a.type === 'user' && a.ownerUserId && a.ownerUserId === myOwnerUserId) ? (
                        <button className="text-xs border rounded px-2 py-1 opacity-50 cursor-not-allowed" disabled>You</button>
                      ) : a.type === 'agent' && a.settings?.agentId && myAgentIds.has(a.settings.agentId) ? (
                        <button className="text-xs border rounded px-2 py-1 opacity-50 cursor-not-allowed" disabled>Owned</button>
                      ) : a.type === 'agent' && a.settings?.agentId && accessibleAgentIds.has(a.settings.agentId) ? (
                        <button className="text-xs border rounded px-2 py-1 opacity-50 cursor-not-allowed" disabled>Accessible</button>
                      ) : connectionIds.has(a.id) ? (
                        <>
                          <button onClick={() => message(a.id)} className="text-xs border rounded px-2 py-1">Message</button>
                          <button onClick={() => unfollow(a.id)} className="text-xs border rounded px-2 py-1">Disconnect</button>
                        </>
                      ) : (a.type === 'agent' ? outgoingAgentAccessPendingIds.has(a.id) : outgoingPendingIds.has(a.id)) ? (
                        <button onClick={() => cancelRequest(a)} className="text-xs border rounded px-2 py-1">Cancel</button>
                      ) : (
                        <button onClick={() => connect(a)} className="text-xs border rounded px-2 py-1">Connect</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
