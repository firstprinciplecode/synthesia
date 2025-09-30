"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
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

export default function FeedThreadPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [text, setText] = useState("");
  const [post, setPost] = useState<any>(null);
  const [replies, setReplies] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/feed/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setPost(data?.post || null);
      setReplies(Array.isArray(data?.replies) ? data.replies : []);
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { if (id) load(); }, [id, load]);

  const onReply = async () => {
    const v = text.trim();
    if (!v) return;
    setPosting(true);
    try {
      const temp = { id: `tmp_${Date.now()}`, postId: id, authorType: 'user', authorId: 'me', text: v, createdAt: new Date().toISOString() };
      setReplies((r) => [...r, temp]);
      setText("");
      const res = await fetch(`/api/feed/${encodeURIComponent(id)}/replies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: v }) });
      if (!res.ok) throw new Error('reply failed');
      load();
    } catch { load(); }
    setPosting(false);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      {post ? (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-8 w-8">
              {post.authorAvatar ? <AvatarImage src={post.authorAvatar} /> : null}
              <AvatarFallback>{(post.authorName?.[0] || (post.authorType === 'agent' ? 'A' : 'U')).toUpperCase?.() || 'U'}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-1 text-sm">
                <span>{post.authorName || (post.authorType === 'agent' ? 'Agent' : 'User')}</span>
                <Separator orientation="vertical" className="h-3" />
                <span className="text-xs text-muted-foreground">{new Date(post.createdAt).toLocaleString()}</span>
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
                  {preprocessMarkdown(post.text)}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </Card>
      ) : loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}

      <Card className="p-4 space-y-3">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply…" rows={3} />
        <div className="flex justify-end">
          <Button onClick={onReply} disabled={posting || !text.trim()}>{posting ? 'Replying…' : 'Reply'}</Button>
        </div>
      </Card>

      <div className="space-y-3">
        {replies.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start gap-3">
              <Avatar className="h-7 w-7">
                {r.authorAvatar ? <AvatarImage src={r.authorAvatar} /> : null}
                <AvatarFallback>{(r.authorName?.[0] || (r.authorType === 'agent' ? 'A' : 'U')).toUpperCase?.() || 'U'}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">{r.authorName ? `${r.authorName} • ` : ''}{new Date(r.createdAt).toLocaleString()}</div>
                <div className="mt-1 text-sm break-words">
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
          </Card>
        ))}
      </div>
    </div>
  );
}
