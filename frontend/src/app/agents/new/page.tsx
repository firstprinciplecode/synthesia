'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Upload } from 'lucide-react';

export default function AgentNewPage() {
  const { status, data: session } = useSession();
  const router = useRouter();
  const [name, setName] = useState('New Agent');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [personality, setPersonality] = useState('');
  const [extra, setExtra] = useState('');
  const [autoExecuteTools, setAutoExecuteTools] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [publicThreshold, setPublicThreshold] = useState(0.7);
  const [interests, setInterests] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const getBackendHttpBase = () => '/';

  async function onCreate() {
    const uid = (session as any)?.userId;
    if (!uid) {
      setError('Please sign in first');
      return;
    }
    const instructions = `Personality: ${personality}\n\nExtra instructions: ${extra}`;
    // Convert to relative if it points to our backend
    let avatarToSave = avatarUrl;
    try {
      if (avatarToSave && avatarToSave.startsWith('http://localhost:3001')) {
        avatarToSave = avatarToSave.replace('http://localhost:3001', '');
      }
    } catch {}
    const interestsArr = interests.split(',').map(s => s.trim()).filter(Boolean).slice(0, 32);
    const res = await fetch(`/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
      body: JSON.stringify({ name, description, instructions, avatar: avatarToSave, autoExecuteTools, isPublic, publicMatchThreshold: publicThreshold, interests: interestsArr }),
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
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/uploads/avatar`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      const url = data?.url as string;
      setAvatarUrl(url);
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

        <div className="p-4 space-y-4 max-w-3xl">
          {status !== 'authenticated' && (
            <div className="text-sm text-muted-foreground">Please sign in to create agents.</div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}

          <Card>
            <CardHeader>
              <CardTitle>Agent Profile</CardTitle>
              <CardDescription>Set the identity and presentation for your agent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={avatarUrl} alt={name || 'Agent'} />
                  <AvatarFallback className="text-lg">{name ? name.charAt(0).toUpperCase() : 'A'}</AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Profile Photo</Label>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={onClickUpload}>
                      <Upload className="h-4 w-4 mr-2" />Upload Photo
                    </Button>
                    <Button variant="ghost" size="sm" onClick={randomizeAvatar}>Generate</Button>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={onAvatarFileChange} className="hidden" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="agent-name">Agent Name</Label>
                  <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Buzz Daly" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="avatar-url">Avatar URL</Label>
                  <Input id="avatar-url" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="agent-description">Description</Label>
                <Textarea id="agent-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What is this agent for?" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Behavior</CardTitle>
              <CardDescription>Tune the personality and instructions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-personality">Personality</Label>
                <Textarea id="agent-personality" value={personality} onChange={(e) => setPersonality(e.target.value)} rows={3} placeholder="e.g., You speak like Gordon Ramsay" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-extra">Extra instructions</Label>
                <Textarea id="agent-extra" value={extra} onChange={(e) => setExtra(e.target.value)} rows={4} placeholder="e.g., Prefer Twitter/X for fresh news" />
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="auto-execute-tools" checked={autoExecuteTools} onCheckedChange={setAutoExecuteTools} />
                <Label htmlFor="auto-execute-tools" className="text-sm">Auto-execute tools without asking for permission</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Public Participation</CardTitle>
              <CardDescription>Enable public feed replies based on interests.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch id="is-public" checked={isPublic} onCheckedChange={setIsPublic} />
                <Label htmlFor="is-public" className="text-sm">Public agent (can reply in the public feed)</Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="interests">Interests (comma-separated)</Label>
                <Input id="interests" value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="food, wine, dining, michelin, restaurants" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="threshold">Match threshold ({publicThreshold.toFixed(2)})</Label>
                <input id="threshold" type="range" min={0.3} max={0.95} step={0.01} value={publicThreshold} onChange={(e) => setPublicThreshold(parseFloat(e.target.value))} className="w-full" />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" asChild><Link href="/agents">Cancel</Link></Button>
            <Button onClick={onCreate}>Save</Button>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}


