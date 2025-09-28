'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';

type Actor = {
  id: string;
  type: 'user' | 'agent';
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  settings?: any;
};

export default function InboxPage() {
  const { status, data: session } = useSession();
  const uid = useMemo(() => (session as any)?.userId || (session as any)?.user?.email || '', [session]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actors, setActors] = useState<Actor[]>([]);
  const [actorMap, setActorMap] = useState<Record<string, Actor>>({});
  const [incomingPending, setIncomingPending] = useState<any[]>([]);
  const [incomingAgentAccess, setIncomingAgentAccess] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  const load = useCallback(async function load() {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const headers = { 'x-user-id': uid } as any;
      const [actorsRes, incomingRes, incomingAgentAccessRes, histInFollow, histOutFollow, histInAgent, histOutAgent] = await Promise.all([
        fetch('/api/actors', { cache: 'no-store', headers }),
        fetch('/api/relationships?direction=incoming&status=pending', { cache: 'no-store', headers }),
        fetch('/api/relationships?direction=incoming&kind=agent_access&status=pending', { cache: 'no-store', headers }),
        // History (all statuses)
        fetch('/api/relationships?direction=incoming&kind=follow', { cache: 'no-store', headers }),
        fetch('/api/relationships?direction=outgoing&kind=follow', { cache: 'no-store', headers }),
        fetch('/api/relationships?direction=incoming&kind=agent_access', { cache: 'no-store', headers }),
        fetch('/api/relationships?direction=outgoing&kind=agent_access', { cache: 'no-store', headers }),
      ]);
      const actorsJson = await actorsRes.json();
      const incomingJson = await incomingRes.json();
      const baseActors: Actor[] = Array.isArray(actorsJson?.actors) ? actorsJson.actors : [];
      setActors(baseActors);
      // Dedupe pending incoming by latest fromActorId+kind
      const incRaw: any[] = Array.isArray(incomingJson?.relationships) ? incomingJson.relationships : [];
      const incSorted = [...incRaw].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      const seenPending = new Set<string>();
      const inc: any[] = [];
      for (const r of incSorted) {
        const key = `${r.fromActorId}|${r.kind || 'follow'}`;
        if (seenPending.has(key)) continue;
        seenPending.add(key);
        inc.push(r);
      }
      setIncomingPending(inc);
      let incAg: any[] = [];
      try {
        const incomingAgentJson = await incomingAgentAccessRes.json();
        incAg = Array.isArray(incomingAgentJson?.relationships) ? incomingAgentJson.relationships : [];
        setIncomingAgentAccess(incAg);
      } catch {}

      // Build history list
      let hist: any[] = [];
      try {
        const [h1, h2, h3, h4] = await Promise.all([histInFollow.json(), histOutFollow.json(), histInAgent.json(), histOutAgent.json()]);
        const list = ([] as any[])
          .concat(Array.isArray(h1?.relationships) ? h1.relationships : [])
          .concat(Array.isArray(h2?.relationships) ? h2.relationships : [])
          .concat(Array.isArray(h3?.relationships) ? h3.relationships : [])
          .concat(Array.isArray(h4?.relationships) ? h4.relationships : []);
        const dedup = new Map<string, any>();
        for (const r of list) { dedup.set(r.id, r); }
        hist = Array.from(dedup.values()).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        setHistory(hist);
      } catch {}

      // Build an id->actor map, and ensure we have entries for any actors referenced by pending requests
      const map: Record<string, Actor> = {};
      for (const a of baseActors) map[a.id] = a;
      const needed = new Set<string>();
      const addIf = (id?: string) => { if (id && !map[id]) needed.add(id); };
      for (const r of inc) {
        addIf(r?.fromActor?.id || r?.fromActorId);
        addIf(r?.toActor?.id || r?.toActorId);
        if (r?.fromActor && r.fromActor.id) map[r.fromActor.id] = r.fromActor as any;
        if (r?.toActor && r.toActor.id) map[r.toActor.id] = r.toActor as any;
      }
      for (const r of incAg) {
        addIf(r?.fromActor?.id || r?.fromActorId);
        addIf(r?.toActor?.id || r?.toActorId);
        if (r?.fromActor && r.fromActor.id) map[r.fromActor.id] = r.fromActor as any;
        if (r?.toActor && r.toActor.id) map[r.toActor.id] = r.toActor as any;
      }
      // Include actors referenced in history
      for (const r of hist) {
        addIf(r?.fromActor?.id || r?.fromActorId);
        addIf(r?.toActor?.id || r?.toActorId);
        if (r?.fromActor && r.fromActor.id) map[r.fromActor.id] = r.fromActor as any;
        if (r?.toActor && r.toActor.id) map[r.toActor.id] = r.toActor as any;
      }
      if (needed.size) {
        const fetched = await Promise.all(Array.from(needed).map(async (id) => {
          try {
            const res = await fetch(`/api/actors/${encodeURIComponent(id)}`, { cache: 'no-store', headers });
            if (!res.ok) return null;
            const a = await res.json();
            return a && a.id ? a as Actor : null;
          } catch { return null; }
        }));
        for (const a of fetched) { if (a && a.id) map[a.id] = a; }
      }
      setActorMap(map);
    } catch (e: any) {
      setError(e?.message || 'Failed to load inbox');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { if (status === 'authenticated') load(); }, [status, uid, load]);

  function resolveName(a: Actor): string {
    return (a.displayName || a.handle || a.id);
  }
  function resolveAvatar(a: Actor): string | undefined {
    return a.avatarUrl || undefined;
  }

  function formatStatus(s?: string): string {
    const v = (s || 'accepted').toLowerCase();
    if (v === 'pending') return 'Pending';
    if (v === 'rejected') return 'Rejected';
    return 'Accepted';
  }

  function emailLine(r: any): { title: string; snippet: string; left: Actor | null } {
    const from: Actor | undefined = (r?.fromActor && r.fromActor.id && actorMap[r.fromActor.id]) ? actorMap[r.fromActor.id] : r.fromActor;
    const to: Actor | undefined = (r?.toActor && r.toActor.id && actorMap[r.toActor.id]) ? actorMap[r.toActor.id] : r.toActor;
    const fromName = from ? resolveName(from) : String(r.fromActorId || '');
    const toName = to ? resolveName(to) : String(r.toActorId || '');
    const status = formatStatus(r?.metadata?.status);
    if (r.kind === 'agent_access') {
      return {
        title: `${fromName} → Agent access`,
        snippet: `${status}: Request to access ${toName}`,
        left: from || null,
      };
    }
    // follow
    return {
      title: `${fromName} → ${toName}`,
      snippet: `${status}: Connection request`,
      left: from || null,
    };
  }

  async function approve(fromActorId: string, kind: 'follow'|'agent_access' = 'follow') {
    if (!uid) return;
    try {
      console.log('[Inbox] Approve clicked', { fromActorId, kind, uid });
      await fetch('/api/relationships/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
        body: JSON.stringify({ fromActorId, kind }),
      }).then(async (res) => {
        console.log('[Inbox] Approve response', { status: res.status, ok: res.ok });
        try { const j = await res.json(); console.log('[Inbox] Approve json', j); } catch (e) { console.log('[Inbox] Approve json parse failed'); }
      });
      console.log('[Inbox] Reloading inbox after approve');
      await load();
    } catch {}
  }

  async function reject(fromActorId: string, kind: 'follow'|'agent_access' = 'follow') {
    if (!uid) return;
    try {
      console.log('[Inbox] Deny clicked', { fromActorId, kind, uid });
      await fetch('/api/relationships/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
        body: JSON.stringify({ fromActorId, kind }),
      }).then(async (res) => {
        console.log('[Inbox] Deny response', { status: res.status, ok: res.ok });
        try { const j = await res.json(); console.log('[Inbox] Deny json', j); } catch (e) { console.log('[Inbox] Deny json parse failed'); }
      });
      console.log('[Inbox] Reloading inbox after deny');
      await load();
    } catch {}
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
                  <BreadcrumbLink href="/">Inbox</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>All Messages</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="p-4 space-y-4">
          {status !== 'authenticated' ? (
            <div className="text-sm text-muted-foreground">You must be signed in to view your inbox.</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Inbox</div>
                <button className="text-xs border rounded px-2 py-1" onClick={load}>Refresh</button>
              </div>
              {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
              {error && <div className="text-sm text-red-500">{error}</div>}

              {/* Connection requests as message cards */}
              {incomingPending.length > 0 ? (
                <div className="space-y-2">
                  {incomingPending.map((r) => {
                    const a = (actorMap[r.fromActorId] as Actor | undefined) || (r.fromActor as Actor | undefined) || actors.find(x => x.id === r.fromActorId);
                    if (!a) return null;
                    return (
                      <div key={r.id} className="border rounded p-3">
                        <div className="flex items-start gap-3">
                          <img src={resolveAvatar(a) || ''} alt={resolveName(a)} className="h-8 w-8 rounded object-cover" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm"><span className="font-medium">{resolveName(a)}</span> wants to connect</div>
                            <div className="mt-2 flex items-center gap-2">
                              <button onClick={() => approve(a.id, 'follow')} className="text-xs border rounded px-2 py-1">Approve</button>
                              <button disabled className="text-xs border rounded px-2 py-1 opacity-50 cursor-not-allowed">Dismiss</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No new connection requests.</div>
              )}

              {/* Agent access requests */}
              {incomingAgentAccess.length > 0 && (
                <div className="space-y-2 mt-4">
                  <div className="text-xs text-muted-foreground">Agent access requests</div>
                  {incomingAgentAccess.map((r) => {
                    const requester = actorMap[r.fromActorId];
                    const target = actorMap[r.toActorId];
                    const requesterName = requester ? resolveName(requester) : (r.fromActorId as string);
                    const requesterAvatar = requester ? resolveAvatar(requester) : undefined;
                    return (
                      <div key={`agent-${r.id}`} className="border rounded p-3">
                        <div className="flex items-start gap-3">
                          {requesterAvatar ? (
                            <img src={requesterAvatar} alt={requesterName} className="h-8 w-8 rounded object-cover" />
                          ) : (
                            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">{requesterName?.slice(0,1) || '?'}</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm">
                              <span className="font-medium">{requesterName}</span>
                              {' '}requested access to your agent{' '}
                              <span className="font-medium">{target ? resolveName(target) : ''}</span>
                            </div>
                            {target && target.avatarUrl ? (
                              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <img src={target.avatarUrl} alt={resolveName(target)} className="h-5 w-5 rounded object-cover" />
                                <span>{resolveName(target)}</span>
                              </div>
                            ) : null}
                            <div className="mt-2 flex items-center gap-2">
                              <button onClick={async () => { await approve(r.fromActorId, 'agent_access'); try { window.dispatchEvent(new CustomEvent('connections-updated')); } catch {} }} className="text-xs border rounded px-2 py-1">Approve</button>
                              <button onClick={() => reject(r.fromActorId, 'agent_access')} className="text-xs border rounded px-2 py-1">Deny</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* History */}
              <div className="space-y-2 mt-6">
                <div className="text-xs text-muted-foreground">History</div>
                {history.length === 0 && (
                  <div className="text-sm text-muted-foreground">No history yet.</div>
                )}
                <div className="grid gap-2">
                  {history.map((r) => {
                    const line = emailLine(r);
                    const avatar = line.left ? resolveAvatar(line.left) : undefined;
                    const when = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
                    return (
                      <div key={`hist-${r.id}`} className="border rounded p-3">
                        <div className="flex items-start gap-3">
                          {avatar ? (
                            <img src={avatar} alt={line.title} className="h-8 w-8 rounded object-cover" />
                          ) : (
                            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">{line.title.slice(0,1)}</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium truncate">{line.title}</div>
                              <div className="text-[11px] text-muted-foreground whitespace-nowrap">{when}</div>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{line.snippet}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
