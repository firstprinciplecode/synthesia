'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

type Agent = {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  defaultModel?: string;
  defaultProvider?: string;
};

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = useMemo(() => (params?.id as string) || '', [params]);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [personality, setPersonality] = useState('');
  const [extra, setExtra] = useState('');
  const [autoExecuteTools, setAutoExecuteTools] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const getBackendHttpBase = () => {
    // Prefer local dev server
    try {
      if (typeof window !== 'undefined') return 'http://localhost:3001';
    } catch {}
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || '';
    try {
      const u = new URL(wsUrl);
      const proto = u.protocol === 'wss:' ? 'https:' : 'http:';
      return `${proto}//${u.host}`;
    } catch {
      return 'http://localhost:3001';
    }
  };

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const base = getBackendHttpBase();
        const res = await fetch(`${base}/api/agents/${id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load agent`);
        const data = await res.json();
        setAgent(data);
        setName(data.name || '');
        setDescription(data.description || '');
        const av = data.avatar as string | undefined;
        setAvatarUrl(av ? (av.startsWith('/') ? `${base}${av}` : av) : '');
        setAutoExecuteTools(data.autoExecuteTools || false);
        // We encode Personality + Extra instructions inside instructions field for now
        // Keep existing instructions and allow editing split parts
        const instr: string = data.instructions || '';
        const personalityMatch = instr.match(/Personality:\s*([\s\S]*?)\n\n/);
        const extraMatch = instr.match(/Extra instructions:\s*([\s\S]*)$/);
        setPersonality(personalityMatch ? personalityMatch[1].trim() : '');
        setExtra(extraMatch ? extraMatch[1].trim() : '');
      } catch (e: any) {
        setError(e?.message || 'Failed to load agent');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function onSave() {
    if (!id) return;
    const instructions = `Personality: ${personality}\n\nExtra instructions: ${extra}`;
    // Convert avatarUrl back to relative if it points to our backend
    let avatarToSave = avatarUrl;
    try {
      const base = getBackendHttpBase();
      if (avatarToSave && avatarToSave.startsWith(base)) {
        avatarToSave = avatarToSave.slice(base.length);
      }
    } catch {}
    const payload = { name, description, instructions, avatar: avatarToSave, autoExecuteTools };
    const base = getBackendHttpBase();
    const res = await fetch(`${base}/api/agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setError('Failed to save agent');
      return;
    }
    router.push('/agents');
  }

  function randomizeAvatar() {
    const seed = Math.random().toString(36).slice(2);
    setAvatarUrl(`https://api.dicebear.com/7.x/shapes/svg?seed=${seed}`);
  }

  async function onAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      const base = getBackendHttpBase();
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${base}/api/agents/${id}/avatar`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      const url = data?.url as string;
      setAvatarUrl(url.startsWith('http') ? url : `${base}${url}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    }
  }

  function onClickUpload() {
    fileInputRef.current?.click();
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
                  <BreadcrumbLink href="/agents">My Agents</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Edit</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="p-4 space-y-3 max-w-2xl">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && agent && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1">Agent Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-transparent" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Avatar URL</label>
                <div className="flex items-center gap-2">
                  <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} className="flex-1 border rounded px-2 py-1 text-sm bg-transparent" placeholder="https://..." />
                  <button onClick={randomizeAvatar} className="text-xs font-semibold hover:underline">Generate</button>
                  <button onClick={onClickUpload} className="text-xs font-semibold hover:underline">Upload</button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarFileChange} />
                </div>
                {avatarUrl && (
                  <img src={avatarUrl} alt="avatar" className="mt-2 h-10 w-10 rounded" />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-transparent" rows={3} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Personality</label>
                <textarea value={personality} onChange={(e) => setPersonality(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-transparent" rows={3} placeholder="e.g., You speak like Gordon Ramsay" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Extra instructions</label>
                <textarea value={extra} onChange={(e) => setExtra(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-transparent" rows={4} placeholder="e.g., When asked about latest news, use @serpapi google_news" />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="auto-execute-tools"
                  checked={autoExecuteTools}
                  onCheckedChange={setAutoExecuteTools}
                />
                <Label htmlFor="auto-execute-tools" className="text-xs font-medium">
                  Auto-execute tools (SerpAPI, etc.) without asking for permission
                </Label>
              </div>
              <div className="pt-2">
                <button onClick={onSave} className="text-sm font-semibold hover:underline">Save</button>
                <Link href="/agents" className="ml-4 text-sm text-muted-foreground hover:underline">Cancel</Link>
              </div>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}


