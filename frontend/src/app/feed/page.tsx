"use client";
import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import { Search } from "lucide-react";

// Simple loading dots component
function LoadingDots() {
  return (
    <div className="flex items-center gap-1">
      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: '0ms', animationDuration: '1.4s' }} />
      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: '200ms', animationDuration: '1.4s' }} />
      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: '400ms', animationDuration: '1.4s' }} />
    </div>
  );
}

// Replace bare URLs with a short markdown link label to avoid overflow
function wrapBareUrlsWithView(text: string): string {
  try {
    // Replace standalone http(s) URLs not already in markdown links with [View](url)
    // Matches start-of-line or whitespace followed by URL, ending before whitespace
    return text.replace(/(^|[\s@])(https?:\/\/[^\s)]+)(?=$|\s)/g, (m, prefix, url) => {
      // If the prefix was an '@', drop it (treat as prefix hint) otherwise keep spacing
      const pre = prefix === '@' ? '' : prefix;
      return `${pre}[View](${url})`;
    });
  } catch {
    return text;
  }
}

// Extract sources from markdown text
function extractSources(text: string): { url: string; title: string }[] {
  const sources: { url: string; title: string }[] = [];
  const sourcesMatch = text.match(/Sources?:\s*([\s\S]*?)(?:\n\n|$)/i);
  if (sourcesMatch) {
    const sourcesText = sourcesMatch[1];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(sourcesText)) !== null) {
      sources.push({ title: match[1], url: match[2] });
    }
  }
  return sources;
}

// Remove sources section from markdown
function removeSources(text: string): string {
  return text.replace(/\n*Sources?:\s*[\s\S]*?(?=\n\n|$)/i, '').trim();
}

// Get favicon URL for a domain
function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}

// Extract URL from text (prioritize first URL found), supports [View](url)
function extractUrl(text: string): string | null {
  const str = String(text || '');
  // 1) markdown link
  const md = str.match(/\]\((https?:\/\/[^\s)]+)\)/);
  if (md) return md[1];
  // 2) bare url
  const match = str.match(/https?:\/\/[^\s)]+/);
  return match ? match[0] : null;
}

// Check if URL is an image
function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(url);
}

// Preprocess markdown to clean up mixed list formats
function preprocessMarkdown(text: string): string {
  // First, normalize bare URLs into short "View" links to prevent overflow
  text = wrapBareUrlsWithView(text);
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
  // Search UI state
  const [searchOpen, setSearchOpen] = useState(true);
  useEffect(() => {
    try {
      const tab = (search?.get('tab') || '').toLowerCase();
      if (tab && tab !== 'search') setSearchOpen(false);
      if (tab === 'search') setSearchOpen(true);
    } catch {}
  }, [search]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNotes, setSearchNotes] = useState<string[]>([]);
  const [searchPostId, setSearchPostId] = useState<string | null>(null);
  type AgentThread = { agentId: string; agentName?: string; agentAvatar?: string; initialReply: string; conversation: Reply[] };
  const [searchThread, setSearchThread] = useState<{ question: string; agentThreads: AgentThread[]; imageDescription?: string } | null>(null);
  const [searchReplyOpenForAgent, setSearchReplyOpenForAgent] = useState<string | null>(null);
  const [waitingForAgentReply, setWaitingForAgentReply] = useState<Record<string, boolean>>({});
  // Track which post is open; reserved for future inline reply UX
  // const [openPostId, setOpenPostId] = useState<string | null>(null);
  type Reply = { id: string; postId: string; authorType: 'user' | 'agent'; authorId: string; authorName?: string; authorAvatar?: string; text: string; createdAt: string };
  const [repliesByPost, setRepliesByPost] = useState<Record<string, Reply[]>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyComposerOpen, setReplyComposerOpen] = useState<Record<string, boolean>>({});
  const [replyingToPost, setReplyingToPost] = useState<Record<string, boolean>>({});
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
    setReplyingToPost((prev) => ({ ...prev, [postId]: true }));
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
    } finally {
      setReplyingToPost((prev) => ({ ...prev, [postId]: false }));
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

  async function runSearch() {
    try {
      setSearching(true);
      setSearchError(null);
      setSearchNotes([]);
      const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (uid) headers['x-user-id'] = uid;
      const question = searchQuery.trim();
      if (!question) { setSearching(false); return; }
      
      // Immediately show the search card with empty agent threads
      const tempPostId = `search-${Date.now()}`;
      setSearchPostId(tempPostId);
      setSearchThread({ question, agentThreads: [] });
      setSearchQuery('');
      
      // Send to backend private search
      const res = await fetch('/api/feed/search', { method: 'POST', headers, body: JSON.stringify({ query: question }) });
      if (!res.ok) throw new Error('search failed');
      const j = await res.json();
      const pid: string | undefined = j?.postId;
      setSearchPostId(pid || tempPostId);
      
      // Extract image description from first agent response and strip it from display
      let imageDescription: string | undefined;
      const agentThreads: AgentThread[] = Array.isArray(j?.results) ? j.results.map((r: any, idx: number) => {
        let displayText = r.text;
        // For the first agent response about an image, extract description
        if (idx === 0 && /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|bmp)(?:\?\S*)?/i.test(question)) {
          const match = displayText.match(/^(The image (?:shows|features|depicts)[^.!?]*[.!?])\s*/i);
          if (match) {
            imageDescription = match[1];
            displayText = displayText.substring(match[0].length).trim();
          }
        }
        return {
          agentId: r.authorId,
          agentName: r.authorName,
          agentAvatar: r.authorAvatar,
          initialReply: displayText,
          conversation: []
        };
      }) : [];
      setSearchThread({ question, agentThreads, imageDescription });
    } catch (e: any) {
      setSearchError(e?.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  // Listen for live agent replies to the search postId and append to the correct agent's thread
  useEffect(() => {
    if (!searchPostId || !searchThread) return;
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL || '');
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(String(evt.data || '{}'));
        console.log('[Search WS] Received:', msg);
        if (msg?.method === 'feed.reply' && msg.params?.postId === searchPostId) {
          console.log('[Search WS] Matched postId, adding reply');
          const newReply: Reply = {
            id: String(msg.params?.id || `tmp_${Date.now()}`),
            postId: searchPostId,
            authorType: (msg.params?.authorType as 'user' | 'agent') || 'agent',
            authorId: String(msg.params?.authorId || ''),
            authorName: msg.params?.authorName,
            authorAvatar: msg.params?.authorAvatar,
            text: String(msg.params?.text || ''),
            createdAt: String(msg.params?.createdAt || new Date().toISOString()),
          };
          // Append to the correct agent's conversation thread
          setSearchThread((prev) => {
            if (!prev) return null;
            const agentThreads = prev.agentThreads.map(thread => {
              if (thread.agentId === newReply.authorId) {
                return { ...thread, conversation: [...thread.conversation, newReply] };
              }
              return thread;
            });
            return { ...prev, agentThreads };
          });
          // Clear waiting state for this agent
          setWaitingForAgentReply((prev) => {
            const next = { ...prev };
            delete next[newReply.authorId];
            return next;
          });
        }
      } catch (e) {
        console.error('[Search WS] Error:', e);
      }
    };
    return () => { try { ws.close(); } catch {} };
  }, [searchPostId, searchThread]);

  async function submitSearchFollowup() {
    if (!searchPostId || !searchThread || !searchReplyOpenForAgent) return;
    const textValue = (replyDrafts[searchPostId] || '').trim();
    if (!textValue) return;
    const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (uid) headers['x-user-id'] = uid;
    // Optimistic update: add user's question to the specific agent's conversation
    const temp: Reply = { 
      id: `tmp_${Date.now()}`, 
      postId: searchPostId, 
      authorType: 'user', 
      authorId: String(uid || 'me'), 
      text: textValue, 
      createdAt: new Date().toISOString(), 
      authorName: meName || 'You', 
      authorAvatar: meAvatar 
    };
    setSearchThread((prev) => {
      if (!prev) return null;
      const agentThreads = prev.agentThreads.map(thread => {
        if (thread.agentId === searchReplyOpenForAgent) {
          return { ...thread, conversation: [...thread.conversation, temp] };
        }
        return thread;
      });
      return { ...prev, agentThreads };
    });
    setReplyDrafts((d) => ({ ...d, [searchPostId]: '' }));
    setSearchReplyOpenForAgent(null); // Close the reply field
    setWaitingForAgentReply((prev) => ({ ...prev, [searchReplyOpenForAgent]: true }));
    try {
      // Only send the specific agent ID, not all engaged agents
      const body: any = { text: textValue, engagedAgentIds: [searchReplyOpenForAgent], originalSearchQuery: searchThread.question };
      console.log('[Search Follow-up] Sending:', { postId: searchPostId, body });
      const res = await fetch(`/api/feed/${encodeURIComponent(searchPostId)}/replies`, { method: 'POST', headers, body: JSON.stringify(body) });
      console.log('[Search Follow-up] Response status:', res.status);
      if (!res.ok) {
        console.error('[Search Follow-up] Failed:', await res.text());
      }
    } catch (e) {
      console.error('[Search Follow-up] Error:', e);
    } finally {
      // Will be cleared when agent response comes via WebSocket
    }
  }

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          {/* Left: sidebar trigger */}
          <div className="px-4">
            <SidebarTrigger className="-ml-1" />
          </div>
          {/* Center: pill group fixed in the middle */}
          <div className="flex-1 flex justify-center">
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-muted dark:bg-black/30 dark:border-zinc-800/80 px-1 py-0.5 shadow-sm">
              <Button
                aria-label="Search feed"
                size="sm"
                variant={searchOpen ? 'default' : 'ghost'}
                className="!rounded-full !size-7 !p-0 flex items-center justify-center"
                onClick={() => setSearchOpen((v) => !v)}
              >
                <Search className="h-4 w-4" />
              </Button>
              <Button
                variant={!searchOpen && feedMode==='all' ? 'default' : 'ghost'}
                size="sm"
                className="!rounded-full h-7 px-3"
                onClick={()=>{ setSearchOpen(false); setFeedMode('all'); }}
            >
              Everyone
              </Button>
              <Button
                variant={!searchOpen && feedMode==='following' ? 'default' : 'ghost'}
                size="sm"
                className="!rounded-full h-7 px-3"
                onClick={()=>{ setSearchOpen(false); setFeedMode('following'); }}
              >
                Following
              </Button>
            </div>
          </div>
          {/* Right: spacer to balance layout */}
          <div className="px-4" />
        </header>
        {searchOpen ? (
          searchThread ? (
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-4xl px-6 pt-4 pb-6 space-y-4">
                {/* Search result card at top */}
                <Card className="relative border shadow-sm py-0">
                  <button 
                    onClick={() => { setSearchThread(null); setSearchPostId(null); }} 
                    className="absolute top-2 right-2 size-6 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                  >
                    <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span className="sr-only">Close</span>
            </button>
                  <div className="px-3 py-2">
                    <div className="flex gap-3">
                      {(() => {
                        const qUrl = extractUrl(searchThread.question);
                        const imageMatch = qUrl && isImageUrl(qUrl) ? [qUrl] as any : null;
                        return imageMatch ? (
                          <div className="flex-shrink-0">
                            <img 
                              src={imageMatch[0]} 
                              alt={searchThread.imageDescription || "Fashion image"} 
                              className="max-h-[120px] w-auto rounded-md" 
                            />
                          </div>
                        ) : null;
                      })()}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Avatar className="h-6 w-6">
                            {meAvatar ? <AvatarImage src={meAvatar} /> : null}
                            <AvatarFallback>{(meName?.[0] || 'U').toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium">{meName || 'You'}</span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" className="underline" />,
                              img: (props) => <img {...props} alt={props.alt || ''} className="max-w-full rounded-md my-2" />,
                              ul: (props) => <ul {...props} className="list-disc pl-5 space-y-1" />,
                              ol: (props) => <ol {...props} className="list-decimal pl-5 space-y-1" />,
                              li: (props) => <li {...props} className="leading-relaxed" />,
                              p: (props) => <p {...props} className="leading-relaxed mb-0" />,
                            }}
                          >
                            {preprocessMarkdown(searchThread.question)}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
                
                {/* Agent threads - each agent has their own conversation */}
                <div className="space-y-3">
                  {searchThread.agentThreads.map((thread) => (
                    <Card key={thread.agentId} className="p-4 border-0 !shadow-none">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-8 w-8">
                          {thread.agentAvatar ? <AvatarImage src={thread.agentAvatar} /> : null}
                          <AvatarFallback>{(thread.agentName?.[0] || 'A').toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="text-sm font-medium">{thread.agentName || 'Agent'}</div>
                          <div className="mt-1 text-sm break-words">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" className="underline" />,
                                img: (props) => <img {...props} alt={props.alt || ''} className="max-w-full rounded-md my-2" />,
                                ul: (props) => <ul {...props} className="list-disc pl-5 space-y-1" />,
                                ol: (props) => <ol {...props} className="list-decimal pl-5 space-y-1" />,
                                li: (props) => <li {...props} className="leading-relaxed" />,
                                p: (props) => <p {...props} className="leading-relaxed mb-2 last:mb-0" />,
                                strong: (props) => <strong {...props} className="font-semibold" />,
                                em: (props) => <em {...props} className="italic" />
                              }}
                            >
                              {preprocessMarkdown(removeSources(thread.initialReply))}
                            </ReactMarkdown>
                            {/* Source favicons */}
                            {(() => {
                              const sources = extractSources(thread.initialReply);
                              if (sources.length === 0) return null;
                              return (
                                <div className="mt-2 flex items-center">
                                  {sources.map((source, idx) => (
                                    <a
                                      key={idx}
                                      href={source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={source.title}
                                      className="inline-block w-6 h-6 rounded-full bg-white border-2 border-background shadow-sm hover:z-10 hover:scale-110 transition-transform"
                                      style={{ marginLeft: idx === 0 ? 0 : '-8px' }}
                                    >
                                      <img 
                                        src={getFaviconUrl(source.url)} 
                                        alt={source.title}
                                        className="w-full h-full rounded-full"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement;
                                          target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
                                        }}
                                      />
                                    </a>
                                  ))}
                                </div>
                              );
                            })()}
                            {/* Action buttons under source icons for alignment */}
                            <div className="mt-2 flex items-center gap-3 text-xs">
            <button
                                className="text-muted-foreground hover:underline" 
                                onClick={() => setSearchReplyOpenForAgent(searchReplyOpenForAgent === thread.agentId ? null : thread.agentId)}
                              >
                                Reply
                              </button>
                              <button
                                className="text-muted-foreground hover:underline"
                                onClick={async () => {
                                  try {
                                    const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
                                    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                                    if (uid) headers['x-user-id'] = uid as string;
                                    await fetch('/api/relationships', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent_access', agentId: thread.agentId, toActorId: thread.agentId }) });
                                  } catch {}
                                }}
                              >
                                Connect
                              </button>
                              <button
                                className="text-muted-foreground hover:underline"
                                onClick={async () => {
                                  try {
                                    if (!searchPostId) return;
                                    await fetch('/api/monitors/create-for-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: searchPostId, agentId: thread.agentId }) });
                                  } catch {}
                                }}
                              >
                                Follow
            </button>
          </div>
                          </div>
                          
                          {/* Conversation thread with this agent */}
                          {thread.conversation.length > 0 && (
                            <div className="mt-3 space-y-3">
                              {thread.conversation.map((reply) => {
                                const rUrl = reply.authorType === 'user' ? extractUrl(reply.text) : null;
                                const imageMatch = rUrl && isImageUrl(rUrl) ? [rUrl] as any : null;
                                return (
                                  <div key={reply.id} className="flex items-start gap-3">
                                    <Avatar className="h-8 w-8">
                                      {reply.authorAvatar ? <AvatarImage src={reply.authorAvatar} /> : null}
                                      <AvatarFallback>{(reply.authorName?.[0] || (reply.authorType === 'user' ? 'U' : 'A')).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1">
                                      <div className="text-sm font-medium">{reply.authorName || (reply.authorType === 'user' ? 'You' : 'Agent')}</div>
                                      {imageMatch && reply.authorType === 'user' ? (
                                        <div className="mt-2 mb-2">
                                          <img src={imageMatch[0]} alt="Follow-up" className="max-h-[120px] w-auto rounded-md" />
                                        </div>
                                      ) : null}
                                      <div className="mt-1 text-sm break-words">
                                        <ReactMarkdown
                                          remarkPlugins={[remarkGfm]}
                                          components={{
                                            a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" className="underline" />,
                                            img: (props) => <img {...props} alt={props.alt || ''} className="max-w-full rounded-md my-2" />,
                                            ul: (props) => <ul {...props} className="list-disc pl-5 space-y-1" />,
                                            ol: (props) => <ol {...props} className="list-decimal pl-5 space-y-1" />,
                                            li: (props) => <li {...props} className="leading-relaxed" />,
                                            p: (props) => <p {...props} className="leading-relaxed mb-2 last:mb-0" />,
                                            strong: (props) => <strong {...props} className="font-semibold" />,
                                            em: (props) => <em {...props} className="italic" />
                                          }}
                                        >
                                          {preprocessMarkdown(removeSources(reply.text))}
                                        </ReactMarkdown>
                                      </div>
                                      
                                      {/* Source favicons for follow-up agent replies */}
                                      {reply.authorType === 'agent' && (() => {
                                        const sources = extractSources(reply.text);
                                        if (sources.length === 0) return null;
                                        return (
                                          <div className="mt-2 flex items-center">
                                            {sources.map((source, idx) => (
                                              <a
                                                key={idx}
                                                href={source.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title={source.title}
                                                className="inline-block w-6 h-6 rounded-full bg-white border-2 border-background shadow-sm hover:z-10 hover:scale-110 transition-transform"
                                                style={{ marginLeft: idx === 0 ? 0 : '-8px' }}
                                              >
                                                <img 
                                                  src={getFaviconUrl(source.url)} 
                                                  alt={source.title}
                                                  className="w-full h-full rounded-full"
                                                  onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    target.src = 'data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4M12 8h.01\"/></svg>';
                                                  }}
                                                />
                                              </a>
                                            ))}
                                          </div>
                                        );
                                      })()}

                                      {/* Actions for agent reply - aligned with text container */}
                                      {reply.authorType === 'agent' && reply.authorId ? (
                                        <div className="mt-2 flex items-center gap-3 text-xs">
                                          <button 
                                            className="text-muted-foreground hover:underline" 
                                            onClick={() => setSearchReplyOpenForAgent(searchReplyOpenForAgent === thread.agentId ? null : thread.agentId)}
                                          >
                                            Reply
                                          </button>
                                          <button
                                            className="text-muted-foreground hover:underline"
                                            onClick={async () => {
                                              try {
                                                const uid = (session as unknown as { userId?: string; user?: { email?: string } })?.userId || (session as unknown as { user?: { email?: string } })?.user?.email;
                                                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                                                if (uid) headers['x-user-id'] = uid as string;
                                                await fetch('/api/relationships', { method: 'POST', headers, body: JSON.stringify({ kind: 'agent_access', agentId: reply.authorId, toActorId: reply.authorId }) });
                                              } catch {}
                                            }}
                                          >
                                            Connect
                                          </button>
                                          <button
                                            className="text-muted-foreground hover:underline"
                                            onClick={async () => {
                                              try {
                                                if (!searchPostId) return;
                                                await fetch('/api/monitors/create-for-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: searchPostId, agentId: reply.authorId }) });
                                              } catch {}
                                            }}
                                          >
                                            Follow
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          
                          {/* Loading indicator for agent response */}
                          {waitingForAgentReply[thread.agentId] ? (
                            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                              <LoadingDots />
                              <span>Waiting for response...</span>
                            </div>
                          ) : null}
                          
                          {/* Action buttons moved above */}
                          
                          {/* Reply composer */}
                          {searchReplyOpenForAgent === thread.agentId ? (
                            <div className="mt-3">
                              <div className="flex-1">
                                <Textarea 
                                  rows={2} 
                                  placeholder="Ask a follow-up…" 
                                  value={replyDrafts[searchPostId || ''] || ''} 
                                  onChange={(e) => setReplyDrafts((d) => ({ ...d, [searchPostId || '']: e.target.value }))} 
                                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitSearchFollowup(); } }}
                                />
                                <div className="mt-2 flex justify-end gap-2">
                                  <Button size="sm" variant="ghost" onClick={() => setSearchReplyOpenForAgent(null)}>Cancel</Button>
                                  <Button size="sm" onClick={submitSearchFollowup}>Send</Button>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  ))}
                  {searching && searchThread.agentThreads.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground px-4 py-4">
                      <LoadingDots />
                      <span>Finding interested agents...</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-start justify-center px-4 pt-60">
              <div className="w-full max-w-xl">
                <div className="flex justify-center mb-6">
                  <img src="/geese.svg" alt="Geese" className="w-32 h-32 invert dark:invert-0" />
                </div>
                <div className="flex items-center gap-2 border rounded-full px-3 py-2 bg-background/70">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={(e)=>setSearchQuery(e.target.value)}
                    onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); runSearch(); } if(e.key==='Escape'){ setSearchOpen(false); setSearchThread(null); } }}
                    placeholder="What would you like to know?"
                    className="flex-1 bg-transparent outline-none text-sm"
                  />
                  <button 
                    className="h-9 w-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center flex-shrink-0 transition-colors"
                    style={{ borderRadius: '50%' }}
                    onClick={runSearch} 
                    disabled={searching || !searchQuery.trim()}
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>
                {searchError ? <div className="mt-2 text-xs text-red-500 text-center">{searchError}</div> : null}
              </div>
            </div>
          )
        ) : (
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

      {posting ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground px-4 py-3">
          <LoadingDots />
          <span>Posting...</span>
        </div>
      ) : null}

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
                  {(() => {
                    try {
                      const url = extractUrl(p.text);
                      if (!url) return null;
                      
                      if (isImageUrl(url)) {
                        return (
                          <div className="mt-2 mb-1">
                            <img src={url} alt="Linked image" className="max-h-[120px] w-auto rounded-md" />
                          </div>
                        );
                      }
                      
                      // Link preview for non-image URLs
                      return (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 mb-1 block">
                          <div className="border rounded-md p-3 hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <img src={getFaviconUrl(url)} alt="" className="w-4 h-4 flex-shrink-0" />
                              <span className="truncate">{new URL(url).hostname}</span>
                            </div>
                            <div className="mt-1 text-sm font-medium break-all">{url}</div>
                          </div>
                        </a>
                      );
                    } catch { return null; }
                  })()}
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
                            {(() => {
                              try {
                                const url = extractUrl(r.text);
                                if (!url) return null;
                                
                                if (isImageUrl(url)) {
                                  return (
                                    <div className="mt-2 mb-2">
                                      <img src={url} alt="Linked image" className="max-h-[120px] w-auto rounded-md" />
                                    </div>
                                  );
                                }
                                
                                // Link preview for non-image URLs
                                return (
                                  <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 mb-2 block">
                                    <div className="border rounded-md p-3 hover:bg-muted/50 transition-colors">
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <img src={getFaviconUrl(url)} alt="" className="w-4 h-4 flex-shrink-0" />
                                        <span className="truncate">{new URL(url).hostname}</span>
                                      </div>
                                      <div className="mt-1 text-sm font-medium break-all">{url}</div>
                                    </div>
                                  </a>
                                );
                              } catch { return null; }
                            })()}
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
                    {replyingToPost[p.id] ? (
                      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                        <LoadingDots />
                        <span>Waiting for agent response...</span>
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
                    ) : null}
                    {replyingToPost[p.id] ? (
                      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                        <LoadingDots />
                        <span>Waiting for agent response...</span>
                      </div>
                    ) : null}
                    {!replyComposerOpen[p.id] && !replyingToPost[p.id] ? (
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
                    ) : null}
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
        )}
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

