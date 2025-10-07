'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Upload } from 'lucide-react';

type Agent = {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  defaultModel?: string;
  defaultProvider?: string;
  isPublic?: boolean;
  publicMatchThreshold?: number;
  interests?: string[];
  allowedPublicEngines?: string[];
  // Room config (server persists inside toolPreferences.roomConfig)
  roomInterestEnabled?: boolean;
  roomInterests?: string[];
  roomMatchThreshold?: number;
};

export default function AgentDetailPage() {
  const { status, data: session } = useSession();
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
  const [isPublic, setIsPublic] = useState(false);
  const [publicThreshold, setPublicThreshold] = useState(0.7);
  const [interests, setInterests] = useState<string>('');
  const [allowedEngine, setAllowedEngine] = useState<string>('yelp');
  // Room interests UI state
  const [roomEnabled, setRoomEnabled] = useState(false);
  const [roomInterests, setRoomInterests] = useState<string>('');
  const [roomThreshold, setRoomThreshold] = useState(0.7);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const getBackendHttpBase = () => '/';

  useEffect(() => {
    if (!id) return;
    async function load() {
      try {
        const uid = (session as any)?.userId;
        if (!uid) throw new Error('Not signed in');
        const res = await fetch(`/api/agents/${id}`, { cache: 'no-store', headers: { 'x-user-id': uid } });
        if (!res.ok) throw new Error(`Failed to load agent`);
        const data = await res.json();
        setAgent(data);
        setName(data.name || '');
        setDescription(data.description || '');
        const av = data.avatar as string | undefined;
        setAvatarUrl(av || '');
        setAutoExecuteTools(data.autoExecuteTools || false);
        setIsPublic(!!data.isPublic);
        setPublicThreshold(typeof data.publicMatchThreshold === 'number' ? data.publicMatchThreshold : 0.7);
        setInterests(Array.isArray(data.interests) ? data.interests.join(', ') : '');
        const engines = Array.isArray((data as any).allowedPublicEngines) ? (data as any).allowedPublicEngines : [];
        if (engines.length) setAllowedEngine(engines[0]);
        // Room config (may live under toolPreferences.roomConfig; backend exposes merged values when present)
        try {
          const rc = (data as any)?.toolPreferences?.roomConfig || {};
          const enabled = !!rc?.enabled;
          setRoomEnabled(enabled);
          setRoomInterests(Array.isArray(rc?.interests) ? rc.interests.join(', ') : '');
          setRoomThreshold(typeof rc?.matchThreshold === 'number' ? rc.matchThreshold : 0.7);
        } catch {}
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
    if (status === 'authenticated') load();
  }, [id, status, session]);

  async function onSave() {
    if (!id) return;
    const instructions = `Personality: ${personality}\n\nExtra instructions: ${extra}`;
    // Convert avatarUrl back to relative if it points to our backend
    let avatarToSave = avatarUrl;
    try {
      if (avatarToSave.startsWith('http://localhost:3001')) {
        avatarToSave = avatarToSave.replace('http://localhost:3001', '');
      } else if (avatarToSave.startsWith('https://agent.firstprinciple.co')) {
        avatarToSave = avatarToSave.replace('https://agent.firstprinciple.co', '');
      }
    } catch {}
    const interestsArr = interests.split(',').map(s => s.trim()).filter(Boolean).slice(0, 32);
    const payload = { name, description, instructions, avatar: avatarToSave, autoExecuteTools, isPublic, publicMatchThreshold: publicThreshold, interests: interestsArr, allowedEngines: allowedEngine ? [allowedEngine] : [] } as any;
    // Merge room config into toolPreferences.roomConfig via backend PUT handler
    payload.roomInterestEnabled = roomEnabled;
    payload.roomInterests = roomInterests.split(',').map(s => s.trim()).filter(Boolean).slice(0, 64);
    payload.roomMatchThreshold = roomThreshold;
    const uid = (session as any)?.userId;
    const res = await fetch(`/api/agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) },
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
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/agents/${id}/avatar`, { method: 'POST', body: fd });
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

        <div className="mx-auto w-full max-w-3xl px-6 py-6 space-y-4">
          {status !== 'authenticated' && (
            <div className="text-sm text-muted-foreground">Please sign in to edit agents.</div>
          )}
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && agent && (
            <>
              <Tabs defaultValue="profile">
                <TabsList className="mb-2">
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="public">Public</TabsTrigger>
                <TabsTrigger value="room">Room</TabsTrigger>
                </TabsList>

                <TabsContent value="profile">
                  <Card>
                    <CardHeader>
                      <CardTitle>Agent Profile</CardTitle>
                      <CardDescription>Identity and presentation.</CardDescription>
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
                      <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
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
                      <CardDescription>Personality and extra instructions.</CardDescription>
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
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" asChild><Link href="/agents">Cancel</Link></Button>
                    <Button onClick={onSave}>Save</Button>
                  </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="public">
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
                      <div className="space-y-2">
                        <Label>SerpAPI engine (max one)</Label>
                        <div className="grid grid-cols-2 gap-2 text-sm max-h-60 overflow-auto p-2 border rounded">
                          {[
                            'google','google_events','google_finance','google_flights','google_hotels','google_images','google_local','google_news','patents','google_shopping','google_scholar','google_trends','google_videos',
                            'baidu','bing_images','bing','ebay','home_depot','tripadvisor','walmart','yelp','youtube'
                          ].map((key) => (
                            <label key={key} className="flex items-center gap-2">
                              <input type="radio" name="allowedEngine" checked={allowedEngine===key} onChange={() => setAllowedEngine(key)} />
                              <span>serpapi.{key}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" asChild><Link href="/agents">Cancel</Link></Button>
                        <Button onClick={onSave}>Save</Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

              <TabsContent value="room">
                <Card>
                  <CardHeader>
                    <CardTitle>Room Participation</CardTitle>
                    <CardDescription>Control when the agent replies in rooms (multi-user chats).</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <Switch id="room-enabled" checked={roomEnabled} onCheckedChange={setRoomEnabled} />
                      <Label htmlFor="room-enabled" className="text-sm">Enable room interests</Label>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="room-interests">Room interests (comma-separated)</Label>
                      <Input id="room-interests" value={roomInterests} onChange={(e) => setRoomInterests(e.target.value)} placeholder="crypto, space, robotics, defense" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="room-threshold">Match threshold ({roomThreshold.toFixed(2)})</Label>
                      <input id="room-threshold" type="range" min={0.3} max={0.95} step={0.01} value={roomThreshold} onChange={(e) => setRoomThreshold(parseFloat(e.target.value))} className="w-full" />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" asChild><Link href="/agents">Cancel</Link></Button>
                      <Button onClick={onSave}>Save</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}


