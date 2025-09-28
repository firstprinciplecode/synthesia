'use client';

import { RefObject } from 'react';
import { JsonFormatter } from '@/components/ui/json-formatter';
import { Search, Globe2, Mic, Wrench, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { resolveWsUrl, getHttpBaseFromWs } from '@/lib/chat/net';

export function RightPanel({
  rightOpen,
  rightTab,
  setRightTab,
  setRightOpen,
  toolRuns,
  participants,
  agentMeta,
  onInvite,
  currentRoomId,
}: {
  rightOpen: boolean;
  rightTab: 'participants'|'tasks';
  setRightTab: (t: 'participants'|'tasks') => void;
  setRightOpen: (v: boolean) => void;
  toolRuns: Map<string, any>;
  participants: Array<{ id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string }>;
  agentMeta: { name?: string; avatarUrl?: string };
  onInvite?: (value: { actorId?: string; agentId?: string }) => Promise<void>;
  currentRoomId?: string;
}) {
  const [showInvite, setShowInvite] = useState(false);
  const [inviteId, setInviteId] = useState('');
  const [inviteType, setInviteType] = useState<'actor'|'agent'>('agent');
  const [agentList, setAgentList] = useState<Array<{ id: string; name: string; avatar?: string | null }>>([]);
  const [userList, setUserList] = useState<Array<{ id: string; name: string; avatar?: string | null }>>([]);
  const [agentSearch, setAgentSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [requestAgentId, setRequestAgentId] = useState('');

  const httpBase = getHttpBaseFromWs(resolveWsUrl());
  const resolveAvatarUrl = (src?: string | null) => {
    if (!src) return undefined as unknown as string;
    if (src.startsWith('http://') || src.startsWith('https://')) return src;
    if (src.startsWith('/')) return `${httpBase}${src}`;
    return src;
  };

  useEffect(() => {
    if (!showInvite) return;
    let cancelled = false;
    (async () => {
      try {
        // Always pass x-user-id so results are scoped correctly
        const uid = (typeof window !== 'undefined' ? (window as any).__superagent_uid : undefined) as string | undefined;
        const headers = uid ? { 'x-user-id': uid } as any : undefined;
        const [aRes, uRes, cRes] = await Promise.all([
          fetch('/api/agents/accessible', { cache: 'no-store', ...(headers ? { headers } : {}) }),
          fetch('/api/actors', { cache: 'no-store', ...(headers ? { headers } : {}) }),
          fetch('/api/connections', { cache: 'no-store', ...(headers ? { headers } : {}) }),
        ]);
        if (!cancelled) {
          try {
            const aData = await aRes.json();
            const agents = Array.isArray(aData) ? aData : (Array.isArray(aData?.agents) ? aData.agents : []);
            setAgentList((agents || []).map((x: any) => ({ id: x.id, name: x.name || 'Agent', avatar: x.avatar })));
          } catch {}
          try {
            // Prefer connections list for users you’re allowed to DM/invite
            const cData = await cRes.json();
            const conns = Array.isArray(cData?.connections) ? cData.connections : [];
            if (conns.length > 0) {
              setUserList(conns.map((x: any) => ({ id: x.id, name: x.displayName || x.handle || 'User', avatar: x.avatarUrl })));
            } else {
              const uData = await uRes.json();
              const actors = Array.isArray(uData) ? uData : (Array.isArray(uData?.actors) ? uData.actors : []);
              const users = (actors || []).filter((x: any) => String(x.type) === 'user');
              setUserList(users.map((x: any) => ({ id: x.id, name: x.displayName || 'User', avatar: x.avatarUrl })));
            }
          } catch {}
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [showInvite]);
  return (
    <div className={`hidden md:block fixed inset-y-0 right-0 z-10 border-l bg-background transition-transform duration-200 ease-linear ${rightOpen ? 'translate-x-0' : 'translate-x-full'}`} style={{ width: 'var(--sidebar-width)' }}>
      <div className="h-12 px-3 flex items-center justify-between border-b">
        <div className="flex items-center gap-2 text-sm">
          <button className={`px-2 py-1 rounded ${rightTab === 'participants' ? 'bg-accent' : ''}`} onClick={() => setRightTab('participants')}>Participants</button>
          <button className={`px-2 py-1 rounded ${rightTab === 'tasks' ? 'bg-accent' : ''}`} onClick={() => setRightTab('tasks')}>Tasks{toolRuns.size > 0 ? ` (${[...toolRuns.values()].filter((r:any) => r.status === 'running').length})` : ''}</button>
        </div>
        <div className="flex items-center gap-2">
          {rightTab === 'participants' && (
            <Button size="sm" variant="secondary" onClick={() => setShowInvite(true)}>+</Button>
          )}
          <button onClick={() => setRightOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>
      </div>
      <div className="p-3 space-y-2 overflow-y-auto h-[calc(100%-3rem)]">
        {rightTab === 'participants' ? (
          <>
            {participants.map((p) => (
              <div key={`${p.type}-${p.id}`} className="group flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                  {p.avatar ? (
                    <img src={p.avatar} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-medium">{p.name?.charAt(0)?.toUpperCase() || '?'}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.type === 'agent' ? 'Agent' : 'User'}</div>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`h-2 w-2 rounded-full ${p.status === 'online' ? 'bg-green-500' : p.status === 'away' ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                </div>
              </div>
            ))}
            {participants.length === 0 && (
              <div className="text-xs text-muted-foreground">No participants</div>
            )}
            {showInvite && (
              <CommandDialog open={showInvite} onOpenChange={(v) => setShowInvite(!!v)} title="Add participants" description="Pick users and agents to invite">
                <CommandInput placeholder="Search users or agents" />
                <CommandList>
                  <CommandEmpty>No results found</CommandEmpty>
                  <CommandGroup heading="Users">
                    {userList
                      .filter(u => (u.name || '').toLowerCase().includes(userSearch.toLowerCase()) || u.id.includes(userSearch))
                      .map(u => (
                        <CommandItem
                          key={`u-${u.id}`}
                          value={`user:${u.id}`}
                          onSelect={() => {
                            const next = new Set(selectedUsers);
                            if (next.has(u.id)) {
                              next.delete(u.id);
                            } else {
                              next.add(u.id);
                            }
                            setSelectedUsers(next);
                          }}
                        >
                          <Checkbox checked={selectedUsers.has(u.id)} />
                          <div className="h-6 w-6 rounded-full overflow-hidden bg-muted flex items-center justify-center">
                            {u.avatar ? (
                              <img src={resolveAvatarUrl(u.avatar)} alt={u.name} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-medium">{u.name?.charAt(0)?.toUpperCase() || 'U'}</span>
                            )}
                          </div>
                          <span className="truncate">{u.name}</span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup heading="Agents">
                    {agentList
                      .filter(a => (a.name || '').toLowerCase().includes(agentSearch.toLowerCase()) || a.id.includes(agentSearch))
                      .map(a => (
                        <CommandItem
                          key={`a-${a.id}`}
                          value={`agent:${a.id}`}
                          onSelect={() => {
                            const next = new Set(selectedAgents);
                            if (next.has(a.id)) {
                              next.delete(a.id);
                            } else {
                              next.add(a.id);
                            }
                            setSelectedAgents(next);
                          }}
                        >
                          <Checkbox checked={selectedAgents.has(a.id)} />
                          <div className="h-6 w-6 rounded-full overflow-hidden bg-muted flex items-center justify-center">
                            {a.avatar ? (
                              <img src={resolveAvatarUrl(a.avatar)} alt={a.name} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-medium">{a.name?.charAt(0)?.toUpperCase() || 'A'}</span>
                            )}
                          </div>
                          <span className="truncate">{a.name}</span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
                <div className="p-3 border-t flex items-center justify-end gap-2">
                  <div className="mr-auto flex items-center gap-2">
                    <Input placeholder="agent-id to request access" value={requestAgentId} onChange={(e) => setRequestAgentId(e.target.value)} className="h-8 w-[220px]" />
                    <Button size="sm" variant="secondary" onClick={async () => {
                      const aid = requestAgentId.trim();
                      if (!aid) return;
                      try {
                        const uid = (typeof window !== 'undefined' ? (window as any).__superagent_uid : undefined) as string | undefined;
                        const headers = { 'Content-Type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) } as any;
                        await fetch('/api/relationships', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent_access', agentId: aid }) });
                      } catch {}
                      setRequestAgentId('');
                    }}>Request access</Button>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setSelectedAgents(new Set()); setSelectedUsers(new Set()); setShowInvite(false); }}>Cancel</Button>
                  <Button size="sm" onClick={async () => {
                    try {
                      const base = '';
                      const tasks: Promise<any>[] = [];
                      selectedAgents.forEach(id => tasks.push(onInvite ? onInvite({ agentId: id }) : fetch(`/api/rooms/${currentRoomId}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: id }) })));
                      selectedUsers.forEach(id => tasks.push(onInvite ? onInvite({ actorId: id }) : fetch(`/api/rooms/${currentRoomId}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId: id }) })));
                      await Promise.allSettled(tasks);
                    } catch {}
                    setSelectedAgents(new Set());
                    setSelectedUsers(new Set());
                    setShowInvite(false);
                  }}>Invite</Button>
                </div>
              </CommandDialog>
            )}
          </>
        ) : (
          <>
            {[...toolRuns.values()].reverse().map((run: any) => {
              const icon = run.tool.startsWith('serpapi') || run.tool === 'serpapi' ? <Search className="h-3.5 w-3.5" /> : run.tool === 'web' ? <Globe2 className="h-3.5 w-3.5" /> : run.tool === 'elevenlabs' ? <Mic className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />;
              const meta: string[] = [];
              if (run.tool === 'serpapi') {
                const engine = (run.args?.engine || 'google');
                const q = (run.args?.query || '').toString();
                meta.push(`${engine}`);
                if (q) meta.push(q.slice(0, 60) + (q.length > 60 ? '…' : ''));
              } else if (run.tool === 'web' && run.args?.url) {
                try { const u = new URL(run.args.url); meta.push(u.hostname); } catch { meta.push(String(run.args.url)); }
              } else if (run.tool === 'elevenlabs') {
                if (run.args?.voiceId) meta.push(`voice=${run.args.voiceId}`);
              }
              const started = run.startedAt ? new Date(run.startedAt) : undefined;
              const duration = run.durationMs ? `${Math.max(1, Math.round(run.durationMs/1000))}s` : (run.status === 'running' && started ? `${Math.max(1, Math.round((Date.now()-run.startedAt)/1000))}s` : undefined);
              return (
                <div key={run.toolCallId} className="border rounded p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {icon}
                      <div className="font-medium">{run.tool}.{run.func}</div>
                    </div>
                    <div className={`px-1 rounded ${run.status === 'running' ? 'bg-yellow-500/20 text-yellow-500' : run.status === 'succeeded' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>{run.status}</div>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-muted-foreground">
                    <div className="truncate">{meta.join(' · ')}</div>
                    {duration && <div className="ml-2 whitespace-nowrap">{duration}</div>}
                  </div>
                  <div className="mt-2">
                    <JsonFormatter 
                      data={run.args} 
                      title="Arguments" 
                      className="text-xs"
                      defaultExpanded={false}
                      showCopyButton={true}
                    />
                  </div>
                  {run.error && <div className="mt-1 text-red-500">error: {run.error}</div>}
                </div>
              );
            })}
            {toolRuns.size === 0 && <div className="text-xs text-muted-foreground">No tasks yet</div>}
          </>
        )}
      </div>
    </div>
  );
}
