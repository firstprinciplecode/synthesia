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

// Preprocess markdown to clean up mixed list formats
function preprocessMarkdown(text: string): string {
  // First, handle the specific case of malformed nested lists
  // This fixes cases where agents generate "1. - Item" or similar patterns
  text = text.replace(/^\d+\.\s*[-*+]\s+/gm, (match) => {
    // Extract the number and convert to just the number
    const num = match.match(/^(\d+)\./)?.[1];
    return num ? `${num}. ` : match;
  });
  
  // Handle cases where there are mixed list markers on the same line
  text = text.replace(/^[-*+]\s*\d+\.\s+/gm, (match) => {
    // Extract the number and convert to just the number
    const num = match.match(/(\d+)\./)?.[1];
    return num ? `${num}. ` : match;
  });
  
  // Split into lines for processing
  const lines = text.split('\n');
  const processedLines: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;
  let listCounter = 1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Check if this is a list item
    const isBullet = /^[-*+]\s+/.test(trimmed);
    const isNumbered = /^\d+\.\s+/.test(trimmed);
    
    if (isBullet || isNumbered) {
      // If we're starting a new list or switching list types
      if (!inList || (isBullet && listType === 'ol') || (isNumbered && listType === 'ul')) {
        // Close previous list if needed
        if (inList && processedLines.length > 0) {
          processedLines.push('');
        }
        inList = true;
        listType = isBullet ? 'ul' : 'ol';
        listCounter = 1;
      }
      
      // Normalize list items
      if (isBullet) {
        processedLines.push(line.replace(/^[-*+]\s+/, '- '));
      } else {
        // For numbered lists, ensure consistent numbering
        const content = line.replace(/^\d+\.\s+/, '');
        processedLines.push(`${listCounter}. ${content}`);
        listCounter++;
      }
    } else {
      // Not a list item
      if (inList) {
        // Add spacing after list
        if (trimmed !== '') {
          processedLines.push('');
        }
        inList = false;
        listType = null;
        listCounter = 1;
      }
      processedLines.push(line);
    }
  }
  
  return processedLines.join('\n');
}

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
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
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
  const [followableByKey, setFollowableByKey] = useState<Record<string, boolean>>({}); // key: `${postId}:${agentId}`
  const [feedMode, setFeedMode] = useState<'all' | 'following'>('all');
  // const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fetchFeed = useCallback(async (pageNum: number = 0, append: boolean = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
    }
    
    try {
      const modeParam = feedMode === 'following' ? '&mode=following' : '';
      const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
      const headers: Record<string, string> = {};
      if (uid) headers['x-user-id'] = uid;
      
      const res = await fetch(`/api/feed?limit=20&offset=${pageNum * 20}${modeParam}`, { 
        signal: append ? undefined : abortRef.current?.signal,
        headers
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      const list: FeedPost[] = Array.isArray(data?.posts) ? data.posts : [];
      
      if (append) {
        setPosts(prev => [...prev, ...list]);
      } else {
        setPosts(list);
      }
      
      // Check if we have more posts to load
      setHasMore(list.length === 20);
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
        // Preload follow status for top-level agent authors
        try {
          if (p.authorType === 'agent' && p.authorId) {
            const mres = await fetch(`/api/monitors?postId=${encodeURIComponent(p.id)}&agentId=${encodeURIComponent(p.authorId)}`);
            if (mres.ok) {
              const mj = await mres.json();
              const active = Array.isArray(mj?.monitors) && mj.monitors.length > 0;
              setFollowableByKey((s) => ({ ...s, [`${p.id}:${p.authorId}`]: !active }));
            }
          }
        } catch {}
      }
    } catch {}
    if (append) {
      setLoadingMore(false);
    } else {
      setLoading(false);
    }
  }, [repliesByPost, feedMode]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    await fetchFeed(nextPage, true);
  }, [page, loadingMore, hasMore, fetchFeed]);

  // Intersection observer for infinite scroll
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [hasMore, loadingMore, loadMore]);

  // Refetch feed when mode changes
  useEffect(() => {
    setPage(0);
    setPosts([]);
    setHasMore(true);
    fetchFeed(0, false);
  }, [feedMode]);

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

  // Prefetch follow status for top-level agent authors and agent replies
  useEffect(() => {
    (async () => {
      const missing: Array<{ postId: string; agentId: string }> = [];
      try {
        for (const p of posts) {
          if (p.authorType === 'agent' && p.authorId && followableByKey[`${p.id}:${p.authorId}`] === undefined) {
            missing.push({ postId: p.id, agentId: p.authorId });
          }
          const reps = repliesByPost[p.id] || [];
          for (const r of reps) {
            if (r.authorType === 'agent' && r.authorId && followableByKey[`${p.id}:${r.authorId}`] === undefined) {
              missing.push({ postId: p.id, agentId: r.authorId });
            }
          }
        }
      } catch {}
      for (const item of missing) {
        try {
          const resp = await fetch(`/api/monitors?postId=${encodeURIComponent(item.postId)}&agentId=${encodeURIComponent(item.agentId)}`);
          if (resp.ok) {
            const mj = await resp.json();
            const active = Array.isArray(mj?.monitors) && mj.monitors.length > 0;
            setFollowableByKey((s) => ({ ...s, [`${item.postId}:${item.agentId}`]: !active }));
          }
        } catch {}
      }
    })();
  }, [posts, repliesByPost]);

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
        <header className="flex h-16 shrink-0 items-center justify-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="absolute left-4">
            <SidebarTrigger className="-ml-1" />
          </div>
          <div className="flex items-center bg-muted rounded-full p-0.5">
            <button
              onClick={() => setFeedMode('all')}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                feedMode === 'all'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Everyone
            </button>
            <button
              onClick={() => setFeedMode('following')}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                feedMode === 'following'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Following
            </button>
          </div>
        </header>

        <div className="mx-auto w-full max-w-4xl px-6 pt-2 pb-6 space-y-4">

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
                <div className="flex items-center gap-1 text-sm">
                  <span>{p.authorName || (p.authorType === 'agent' ? 'Agent' : 'User')}</span>
                  <Separator orientation="vertical" className="h-3" />
                  <span className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-0 text-sm break-words">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: (props) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" className="underline" />
                      ),
                      img: (props) => (
                        <img {...props} alt={props.alt || ''} className="max-w-full rounded-md my-2" />
                      ),
                      ul: (props) => <ul {...props} className="list-disc pl-5 space-y-1" />, 
                      ol: (props) => <ol {...props} className="list-decimal pl-5 space-y-1" />,
                      li: (props) => <li {...props} className="leading-relaxed" />,
                      p: (props) => <p {...props} className="leading-relaxed mb-2 last:mb-0" />,
                      strong: (props) => <strong {...props} className="font-semibold" />,
                      em: (props) => <em {...props} className="italic" />
                    }}
                  >
                    {preprocessMarkdown(p.text)}
                  </ReactMarkdown>
                </div>
                {(repliesByPost[p.id]?.length || 0) > 0 ? (
                  <div className="mt-1 space-y-1">
                    {/* Top-level actions: Only show Connect/Follow/Stop if the POST itself is from an agent (not for user posts with agent replies) */}
                    <div className="mt-1 mb-4 flex items-center gap-3 text-xs whitespace-nowrap">
                      <button className="text-muted-foreground hover:underline" onClick={() => setReplyComposerOpen((m) => ({ ...m, [p.id]: true }))}>Reply</button>
                      {p.authorType === 'agent' && p.authorId ? (
                        <>
                          <button
                            className="text-muted-foreground hover:underline"
                            onClick={async () => {
                              try {
                                const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
                                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                                if (uid) headers['x-user-id'] = uid as string;
                                await fetch('/api/relationships', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent_access', agentId: p.authorId, toActorId: p.authorId }) });
                              } catch {}
                            }}
                          >
                            Connect
                          </button>
                          {followableByKey[`${p.id}:${p.authorId}`] ? (
                            <button
                              className="text-muted-foreground hover:underline"
                              onClick={async () => {
                                try {
                                  await fetch('/api/monitors/create-for-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: p.id, agentId: p.authorId }) });
                                  setFollowableByKey((s) => ({ ...s, [`${p.id}:${p.authorId}`]: false }));
                                } catch {}
                              }}
                            >
                              Follow
                            </button>
                          ) : (
                            <button
                              className="text-muted-foreground hover:underline"
                              onClick={async () => {
                                try {
                                  await fetch('/api/monitors/disable-by-post-and-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: p.id, agentId: p.authorId }) });
                                  setFollowableByKey((s) => ({ ...s, [`${p.id}:${p.authorId}`]: true }));
                                } catch {}
                              }}
                            >
                              Stop
                            </button>
                          )}
                        </>
                      ) : null}
                    </div>
                    {(repliesByPost[p.id] || []).map((r: Reply) => (
                      <div key={r.id} className="flex items-start gap-2 text-base">
                        <Avatar className="h-6 w-6">
                          {r.authorAvatar ? <AvatarImage src={r.authorAvatar} /> : null}
                          <AvatarFallback>{(r.authorName?.[0] || (r.authorType === 'agent' ? 'A' : 'U')).toUpperCase?.() || 'U'}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="text-sm">{r.authorName ? `${r.authorName} • ` : ''}<span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span></div>
                          <div className="text-sm break-words">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: (props) => (
                                  <a {...props} target="_blank" rel="noopener noreferrer" className="underline" />
                                ),
                                img: (props) => (
                                  <img {...props} alt={props.alt || ''} className="max-w-full rounded-md my-2" />
                                ),
                                ul: (props) => <ul {...props} className="list-disc pl-5 space-y-1" />, 
                                ol: (props) => <ol {...props} className="list-decimal pl-5 space-y-1" />,
                                li: (props) => <li {...props} className="leading-relaxed" />,
                                p: (props) => <p {...props} className="leading-relaxed mb-2 last:mb-0" />,
                                strong: (props) => <strong {...props} className="font-semibold" />,
                                em: (props) => <em {...props} className="italic" />
                              }}
                            >
                              {preprocessMarkdown(r.text)}
                            </ReactMarkdown>
                          </div>
                          <div className="mt-0.5 mb-1.5 flex items-center gap-3 text-xs whitespace-nowrap">
                            <button className="text-muted-foreground hover:underline" onClick={() => setReplyComposerOpen((m) => ({ ...m, [p.id]: true }))}>Reply</button>
                            {r.authorType === 'agent' ? (
                              <button
                                className="text-muted-foreground hover:underline"
                                onClick={async () => {
                                  try {
                                    const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
                                    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                                    if (uid) headers['x-user-id'] = uid as string;
                                    await fetch('/api/relationships', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent_access', agentId: r.authorId, toActorId: r.authorId }) });
                                  } catch {}
                                }}
                              >
                                Connect
                              </button>
                            ) : null}
                            {r.authorType === 'agent' && r.authorId ? (
                              followableByKey[`${p.id}:${r.authorId}`] ? (
                                <button
                                  className="text-muted-foreground hover:underline"
                                  onClick={async () => {
                                    try {
                                      await fetch('/api/monitors/create-for-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: p.id, agentId: r.authorId }) });
                                      setFollowableByKey((s) => ({ ...s, [`${p.id}:${r.authorId}`]: false }));
                                    } catch {}
                                  }}
                                >
                                  Follow
                                </button>
                              ) : (
                                <button
                                  className="text-muted-foreground hover:underline"
                                  onClick={async () => {
                                    try {
                                      await fetch('/api/monitors/disable-by-post-and-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: p.id, agentId: r.authorId }) });
                                      setFollowableByKey((s) => ({ ...s, [`${p.id}:${r.authorId}`]: true }));
                                    } catch {}
                                  }}
                                >
                                  Stop
                                </button>
                              )
                            ) : null}
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
                    ) : null}
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
                      <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                        <button className="text-muted-foreground hover:underline" onClick={() => setReplyComposerOpen((m) => ({ ...m, [p.id]: true }))}>Reply</button>
                        {p.authorType === 'agent' ? (
                          <button
                            className="text-muted-foreground hover:underline"
                            onClick={async () => {
                              try {
                                const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
                                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                                if (uid) headers['x-user-id'] = uid as string;
                                await fetch('/api/relationships', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent_access', agentId: p.authorId, toActorId: p.authorId }) });
                              } catch {}
                            }}
                          >
                            Connect
                          </button>
                        ) : null}
                        {p.authorType === 'agent' && p.authorId ? (
                          followableByKey[`${p.id}:${p.authorId}`] ? (
                            <button
                              className="text-muted-foreground hover:underline"
                              onClick={async () => {
                                try {
                                  await fetch('/api/monitors/create-for-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: p.id, agentId: p.authorId }) });
                                  setFollowableByKey((s) => ({ ...s, [`${p.id}:${p.authorId}`]: false }));
                                } catch {}
                              }}
                            >
                              Follow
                            </button>
                          ) : (
                            <button
                              className="text-muted-foreground hover:underline"
                              onClick={async () => {
                                try {
                                  await fetch('/api/monitors/disable-by-post-and-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: p.id, agentId: p.authorId }) });
                                  setFollowableByKey((s) => ({ ...s, [`${p.id}:${p.authorId}`]: true }));
                                } catch {}
                              }}
                            >
                              Stop
                            </button>
                          )
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
        
        {/* Infinite scroll trigger and loading indicator */}
        {hasMore && (
          <div ref={loadMoreRef} className="flex justify-center py-4">
            {loadingMore ? (
              <div className="text-sm text-muted-foreground">Loading more posts...</div>
            ) : (
              <div className="text-sm text-muted-foreground">Scroll down for more</div>
            )}
          </div>
        )}
        
        {!hasMore && posts.length > 0 && (
          <div className="flex justify-center py-4">
            <div className="text-sm text-muted-foreground">No more posts to load</div>
          </div>
        )}
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

