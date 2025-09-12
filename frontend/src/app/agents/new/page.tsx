'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export default function AgentNewPage() {
  const router = useRouter();
  const [name, setName] = useState('New Agent');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [personality, setPersonality] = useState('');
  const [extra, setExtra] = useState('');
  const [autoExecuteTools, setAutoExecuteTools] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const getBackendHttpBase = () => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || '';
    try {
      const u = new URL(wsUrl);
      const proto = u.protocol === 'wss:' ? 'https:' : 'http:';
      return `${proto}//${u.host}`;
    } catch {
      return 'http://127.0.0.1:3001';
    }
  };

  async function onCreate() {
    const instructions = `Personality: ${personality}\n\nExtra instructions: ${extra}`;
    const base = getBackendHttpBase();
    // Convert to relative if it points to our backend
    let avatarToSave = avatarUrl;
    try {
      if (avatarToSave && avatarToSave.startsWith(base)) {
        avatarToSave = avatarToSave.slice(base.length);
      }
    } catch {}
    const res = await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, instructions, avatar: avatarToSave, autoExecuteTools }),
    });
    if (!res.ok) {
      setError('Failed to create agent');
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
      const res = await fetch(`${base}/api/uploads/avatar`, { method: 'POST', body: fd });
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
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/agents">My Agents</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Create</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="p-4 space-y-3 max-w-2xl">
          {error && <p className="text-sm text-red-500">{error}</p>}
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
            <button onClick={onCreate} className="text-sm font-semibold hover:underline">Create</button>
            <Link href="/agents" className="ml-4 text-sm text-muted-foreground hover:underline">Cancel</Link>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}


