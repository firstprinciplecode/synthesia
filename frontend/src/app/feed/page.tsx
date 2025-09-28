"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
// import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useSession } from "next-auth/react";
import { AvatarImage } from "@/components/ui/avatar";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type FeedPost = {
  id: string;
  authorType: "user" | "agent";
  authorId: string;
  authorName?: string;
  authorAvatar?: string;
  text: string;
  createdAt: string;
  replyCount?: number;
  monitoringActive?: boolean;
};

function FeedContent() {
  const { status, data: session } = useSession();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [text, setText] = useState("");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  // Track which post is open; reserved for future inline reply UX
  // const [openPostId, setOpenPostId] = useState<string | null>(null);
  type Reply = { id: string; postId: string; authorType: 'user' | 'agent'; authorId: string; authorName?: string; authorAvatar?: string; text: string; createdAt: string };
  const [repliesByPost, setRepliesByPost] = useState<Record<string, Reply[]>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyComposerOpen, setReplyComposerOpen] = useState<Record<string, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);
  const [meName, setMeName] = useState<string>("");
  const [meAvatar, setMeAvatar] = useState<string>("");
  const [diagnostics, setDiagnostics] = useState<Array<Record<string, unknown>> | null>(null);
  const diagEnabled = (search?.get('diag') === '1' || search?.get('diagnostics') === '1');
  const [typingByPost, setTypingByPost] = useState<Record<string, { name: string }>>({});
  const [stopLoading, setStopLoading] = useState<Record<string, boolean>>({});
  // const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fetchFeed = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await fetch("/api/feed?limit=30", { signal: ctrl.signal });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      const list: FeedPost[] = Array.isArray(data?.posts) ? data.posts : [];
      setPosts(list);
      // Preload replies for posts that already have replies
      for (const p of list) {
        if ((p.replyCount || 0) > 0 && !repliesByPost[p.id]) {
          try {
            const r = await fetch(`/api/feed/${encodeURIComponent(p.id)}`);
            if (r.ok) {
              const j = await r.json();
              if (Array.isArray(j?.replies)) setRepliesByPost((m) => ({ ...m, [p.id]: j.replies }));
            }
          } catch {}
        }
      }
    } catch {}
    setLoading(false);
  }, [repliesByPost]);

  useEffect(() => {
    fetchFeed();
    // WS live updates
    let ws: WebSocket | null = null;
    try {
      const url = (process.env.NEXT_PUBLIC_WS_URL || '').trim();
      if (url) {
        ws = new WebSocket(url);
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(String(evt.data || '{}'));
            if (msg?.method === 'feed.post') {
              const incoming = msg.params as FeedPost;
              setPosts((p) => {
                // Drop any temp placeholders and avoid duplicate ids
                const withoutTemps = p.filter(x => !String(x.id).startsWith('temp_'));
                if (withoutTemps.some(x => x.id === incoming.id)) return withoutTemps;
                return [incoming, ...withoutTemps];
              });
            } else if (msg?.method === 'feed.reply') {
              setPosts((p) => p.map(x => x.id === msg.params?.postId ? { ...x, replyCount: (x.replyCount || 0) + 1 } : x));
              setRepliesByPost((m) => {
                const pid = String(msg.params?.postId || '');
                const list = m[pid] || [];
                const nextReply: Reply = {
                  id: String(msg.params?.id || `tmp_${Date.now()}`),
                  postId: pid,
                  authorType: (msg.params?.authorType as 'user' | 'agent') || 'user',
                  authorId: String(msg.params?.authorId || ''),
                  authorName: msg.params?.authorName,
                  authorAvatar: msg.params?.authorAvatar,
                  text: String(msg.params?.text || ''),
                  createdAt: String(msg.params?.createdAt || new Date().toISOString()),
                };
                return { ...m, [pid]: [...list, nextReply] };
              });
              // Clear typing on reply
              setTypingByPost((m) => {
                const pid = String(msg.params?.postId || '');
                const next: Record<string, { name: string }> = { ...m };
                delete next[pid];
                return next;
              });
            } else if (msg?.method === 'feed.typing') {
              const pid = String(msg.params?.postId || '');
              const on = !!msg.params?.typing;
              if (on) {
                setTypingByPost((m) => ({ ...m, [pid]: { name: msg.params?.authorName || 'Agent' } }));
              } else {
                setTypingByPost((m) => {
                  const next: Record<string, { name: string }> = { ...m };
                  delete next[pid];
                  return next;
                });
              }
            }
          } catch {}
        };
      }
    } catch {}
    const id = setInterval(fetchFeed, 20000);
    return () => { clearInterval(id); abortRef.current?.abort(); try { ws?.close(); } catch {} };
  }, [search, fetchFeed]);

  // Load current user profile for composer avatar/name
  useEffect(() => {
    async function loadProfile() {
      try {
        const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
        if (!uid) return;
        const res = await fetch('/api/profile', { headers: { 'x-user-id': uid } });
        if (!res.ok) return;
        const u = await res.json();
        const name = u?.name || u?.email || '';
        let avatar = typeof u?.avatar === 'string' ? u.avatar : '';
        try { if (avatar && avatar.startsWith('http://localhost:3001')) avatar = avatar.replace('http://localhost:3001',''); } catch {}
        setMeName(name);
        setMeAvatar(avatar || '');
      } catch {}
    }
    if (status === 'authenticated') loadProfile();
  }, [status, session]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // setSelectedFile(file);
      // Add file info to text
      const fileInfo = `[📎 ${file.name}]`;
      setText(prev => prev + (prev ? '\n' : '') + fileInfo);
    }
  };

  const onPost = async () => {
    const v = text.trim();
    if (!v) return;
    setPosting(true);
    try {
      // optional optimistic insert (will be removed on first WS/post fetch)
      const tempId = `temp_${Date.now()}`;
      const temp: FeedPost = { id: tempId, authorType: "user", authorId: "me", text: v, createdAt: new Date().toISOString(), replyCount: 0 };
      setPosts((p) => [temp, ...p]);
      setText("");
      // setSelectedFile(null);
      setDiagnostics(null);
      const url = diagEnabled ? "/api/feed?diag=1" : "/api/feed";
      const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (uid) headers['x-user-id'] = uid;
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ text: v }) });
      if (!res.ok) throw new Error("post failed");
      try {
        const data = await res.json();
        if (Array.isArray((data as { diagnostics?: Array<Record<string, unknown>> })?.diagnostics)) setDiagnostics((data as { diagnostics?: Array<Record<string, unknown>> }).diagnostics || null);
      } catch {}
      // Replace with server state
      fetchFeed();
    } catch {
      // revert on failure
      fetchFeed();
    }
    setPosting(false);
  };

  // Note: previously had a toggleReplies helper; removed as unused to satisfy linter

  const submitInlineReply = async (postId: string) => {
    const textValue = (replyDrafts[postId] || '').trim();
    if (!textValue) return;
    const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (uid) headers['x-user-id'] = uid;
    // optimistic
    const temp: Reply = { id: `tmp_${Date.now()}`, postId, authorType: 'user', authorId: String(uid || 'me'), text: textValue, createdAt: new Date().toISOString(), authorName: meName || (session as unknown as { user?: { name?: string; email?: string } })?.user?.name || (session as unknown as { user?: { email?: string } })?.user?.email || 'You', authorAvatar: meAvatar };
    setRepliesByPost((m) => ({ ...m, [postId]: [ ...(m[postId] || []), temp ] }));
    setReplyDrafts((d) => ({ ...d, [postId]: '' }));
    try {
      const res = await fetch(`/api/feed/${encodeURIComponent(postId)}/replies`, { method: 'POST', headers, body: JSON.stringify({ text: textValue }) });
      if (!res.ok) throw new Error('reply failed');
    } catch {
      // reload replies on failure
      try {
        const r = await fetch(`/api/feed/${encodeURIComponent(postId)}`);
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j?.replies)) setRepliesByPost((m) => ({ ...m, [postId]: j.replies }));
        }
      } catch {}
    }
  };

  const stopMonitoring = async (postId: string) => {
    try {
      setStopLoading((m) => ({ ...m, [postId]: true }));
      await fetch(`/api/monitors/disable-by-post/${encodeURIComponent(postId)}`, { method: 'POST' });
      setPosts((p) => p.map((x) => (x.id === postId ? { ...x, monitoringActive: false } : x)));
    } catch {}
    setStopLoading((m) => ({ ...m, [postId]: false }));
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <h1 className="text-sm font-medium">Feed</h1>
          </div>
        </header>

        <div className="mx-auto w-full max-w-4xl px-6 py-6 space-y-4">
          <Card className="p-4 w-full border-0 !shadow-none">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  {meAvatar ? <AvatarImage src={meAvatar} /> : null}
                  <AvatarFallback>{(meName?.[0] || 'U').toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{meName || session?.user?.name || session?.user?.email || 'You'}</span>
                  {diagEnabled && <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Diagnostics</span>}
                </div>
              </div>
              <div className="bg-muted/50 rounded-md p-3 space-y-2">
                <Textarea 
                  value={text} 
                  onChange={(e) => setText(e.target.value)} 
                  placeholder="What's on your mind?" 
                  rows={1} 
                  className="!border-none !bg-transparent !shadow-none !ring-0 !ring-offset-0 focus-visible:!ring-0 focus-visible:!ring-offset-0 resize-none p-0 text-sm min-h-[40px] w-full"
                />
                <div className="flex justify-between items-center">
                  <input
                    type="file"
                    id="file-upload"
                    accept="image/*,.pdf,.doc,.docx,.txt"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <Button 
                    size="sm" 
                    variant="ghost"
                    onClick={() => document.getElementById('file-upload')?.click()}
                    className="h-8 w-8 p-0"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </Button>
                  <Button 
                    disabled={posting || !text.trim()} 
                    onClick={onPost}
                    className="h-8 w-8 p-0 rounded-full"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </Button>
                </div>
              </div>
            </div>
        {diagEnabled && Array.isArray(diagnostics) ? (
          <div className="mt-2 rounded-md bg-muted p-3">
            <div className="text-xs font-medium mb-1">Diagnostics</div>
            <pre className="text-[11px] whitespace-pre-wrap break-words">{JSON.stringify(diagnostics, null, 2)}</pre>
          </div>
        ) : null}
      </Card>

      <div className="space-y-4">
        {loading && posts.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : null}
        {posts.map((p) => (
          <Card key={p.id} className="p-4 border-0 !shadow-none">
            <div className="flex items-start gap-3">
              <div className="relative">
                <Avatar className="h-8 w-8">
                  {p.authorAvatar ? <AvatarImage src={p.authorAvatar} /> : null}
                  <AvatarFallback>{(p.authorName?.[0] || (p.authorType === 'agent' ? 'A' : 'U')).toUpperCase?.() || 'U'}</AvatarFallback>
                </Avatar>
                {p.monitoringActive && (
                  <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-white"></div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{p.authorName || (p.authorType === 'agent' ? 'Agent' : 'User')}</span>
                  <Separator orientation="vertical" className="h-3" />
                  <span>{new Date(p.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-base break-words">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: (props) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" className="underline" />
                      ),
                      img: (props) => (
                        <img {...props} alt={props.alt || ''} className="max-w-full rounded-md my-2" />
                      ),
                      ul: (props) => <ul {...props} className="list-disc pl-5" />, 
                      ol: (props) => <ol {...props} className="list-decimal pl-5" />
                    }}
                  >
                    {p.text}
                  </ReactMarkdown>
                </div>
                {(repliesByPost[p.id]?.length || 0) > 0 ? (
                  <div className="mt-3 space-y-2">
                    {(repliesByPost[p.id] || []).map((r: Reply) => (
                      <div key={r.id} className="flex items-start gap-2 text-base">
                        <Avatar className="h-6 w-6">
                          {r.authorAvatar ? <AvatarImage src={r.authorAvatar} /> : null}
                          <AvatarFallback>{(r.authorName?.[0] || (r.authorType === 'agent' ? 'A' : 'U')).toUpperCase?.() || 'U'}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="text-[11px] text-muted-foreground">{r.authorName ? `${r.authorName} • ` : ''}{new Date(r.createdAt).toLocaleString()}</div>
                          <div className="text-base break-words">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: (props) => (
                                  <a {...props} target="_blank" rel="noopener noreferrer" className="underline" />
                                ),
                                img: (props) => (
                                  <img {...props} alt={props.alt || ''} className="max-w-full rounded-md my-2" />
                                ),
                                ul: (props) => <ul {...props} className="list-disc pl-5" />, 
                                ol: (props) => <ol {...props} className="list-decimal pl-5" />
                              }}
                            >
                              {r.text}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    ))}
                    {typingByPost[p.id] ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-pulse" />
                        <span>{typingByPost[p.id].name || 'Agent'} is writing…</span>
                      </div>
                    ) : null}
                    {replyComposerOpen[p.id] ? (
                      <div className="mt-2 flex items-start gap-2">
                        <Avatar className="h-6 w-6">
                          {meAvatar ? <AvatarImage src={meAvatar} /> : null}
                          <AvatarFallback>{(meName?.[0] || 'U').toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <Textarea rows={2} placeholder="Write a reply…" value={replyDrafts[p.id] || ''} onChange={(e) => setReplyDrafts((d) => ({ ...d, [p.id]: e.target.value }))} />
                          <div className="mt-2 flex justify-end">
                            <Button size="sm" onClick={() => submitInlineReply(p.id)}>Reply</Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setReplyComposerOpen((m) => ({ ...m, [p.id]: true }))}>Reply</Button>
                          {p.monitoringActive && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-xs text-muted-foreground hover:text-destructive" 
                              disabled={!!stopLoading[p.id]} 
                              onClick={() => stopMonitoring(p.id)}
                            >
                              {stopLoading[p.id] ? 'Stopping…' : 'Stop Monitoring'}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3">
                    {typingByPost[p.id] ? (
                      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-pulse" />
                        <span>{typingByPost[p.id].name || 'Agent'} is writing…</span>
                      </div>
                    ) : null}
                    {replyComposerOpen[p.id] ? (
                      <div className="flex items-start gap-2">
                        <Avatar className="h-6 w-6">
                          {meAvatar ? <AvatarImage src={meAvatar} /> : null}
                          <AvatarFallback>{(meName?.[0] || 'U').toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <Textarea rows={2} placeholder="Write a reply…" value={replyDrafts[p.id] || ''} onChange={(e) => setReplyDrafts((d) => ({ ...d, [p.id]: e.target.value }))} />
                          <div className="mt-2 flex justify-end">
                            <Button size="sm" onClick={() => submitInlineReply(p.id)}>Reply</Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setReplyComposerOpen((m) => ({ ...m, [p.id]: true }))}>Reply</Button>
                        {p.monitoringActive && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-xs text-muted-foreground hover:text-destructive" 
                            disabled={!!stopLoading[p.id]} 
                            onClick={() => stopMonitoring(p.id)}
                          >
                            {stopLoading[p.id] ? 'Stopping…' : 'Stop Monitoring'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default function FeedPage() {
  return (
    <Suspense fallback={<div />}>{/* Required for useSearchParams */}
      <FeedContent />
    </Suspense>
  );
}

