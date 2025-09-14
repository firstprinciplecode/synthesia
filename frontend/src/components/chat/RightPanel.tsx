'use client';

import { RefObject } from 'react';
import { JsonFormatter } from '@/components/ui/json-formatter';
import { Search, Globe2, Mic, Wrench, X } from 'lucide-react';

export function RightPanel({
  rightOpen,
  rightTab,
  setRightTab,
  setRightOpen,
  toolRuns,
  participants,
  agentMeta,
}: {
  rightOpen: boolean;
  rightTab: 'participants'|'tasks';
  setRightTab: (t: 'participants'|'tasks') => void;
  setRightOpen: (v: boolean) => void;
  toolRuns: Map<string, any>;
  participants: Array<{ id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string }>;
  agentMeta: { name?: string; avatarUrl?: string };
}) {
  return (
    <div className={`hidden md:block fixed inset-y-0 right-0 z-10 border-l bg-background transition-transform duration-200 ease-linear ${rightOpen ? 'translate-x-0' : 'translate-x-full'}`} style={{ width: 'var(--sidebar-width)' }}>
      <div className="h-12 px-3 flex items-center justify-between border-b">
        <div className="flex items-center gap-2 text-sm">
          <button className={`px-2 py-1 rounded ${rightTab === 'participants' ? 'bg-accent' : ''}`} onClick={() => setRightTab('participants')}>Participants</button>
          <button className={`px-2 py-1 rounded ${rightTab === 'tasks' ? 'bg-accent' : ''}`} onClick={() => setRightTab('tasks')}>Tasks{toolRuns.size > 0 ? ` (${[...toolRuns.values()].filter((r:any) => r.status === 'running').length})` : ''}</button>
        </div>
        <div className="flex items-center gap-2">
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
                    // eslint-disable-next-line @next/next/no-img-element
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


