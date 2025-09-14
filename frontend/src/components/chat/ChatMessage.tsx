'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChatMessage as ChatMessageType } from '@/lib/websocket';
import { User, Bot, Terminal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TerminalOutput } from '@/components/chat/TerminalOutput';
import { TypingDots } from './TypingDots';
import { JsonMarkdownRenderer } from './JsonMarkdownRenderer';

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
  agentNameOverride?: string;
  agentAvatarOverride?: string;
  userNameOverride?: string;
  userAvatarOverride?: string;
}

export function ChatMessage({ message, isStreaming, agentNameOverride, agentAvatarOverride, userNameOverride, userAvatarOverride }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isTerminal = message.role === 'terminal';
  const agentName = ((message as any).agentName as string | undefined) || agentNameOverride;
  const agentAvatar = ((message as any).agentAvatar as string | undefined) || agentAvatarOverride;
  const userName = ((message as any).userName as string | undefined) || userNameOverride;
  const userAvatar = ((message as any).userAvatar as string | undefined) || userAvatarOverride;
  
  // ASCII spinner for terminal placeholders
  const [spinner, setSpinner] = useState('|');
  useEffect(() => {
    if (!(isTerminal && !message.terminalResult)) return;
    const frames = ['|', '/', '-', '\\'];
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % frames.length;
      setSpinner(frames[i]);
    }, 120);
    return () => clearInterval(id);
  }, [isTerminal, message.terminalResult]);

  // ASCII fading loader for assistant "typing" state
  const [assistFrameIdx, setAssistFrameIdx] = useState(0);
  const assistFrames = ['.oO0Oo.', 'oO0Oo..', 'O0Oo..o', '0Oo..oO', 'Oo..oO0', 'o..oO0O', '..oO0Oo'];
  useEffect(() => {
    const waitingForAssistant = !isUser && !isTerminal && isStreaming && (!message.content || message.content.trim().length === 0);
    if (!waitingForAssistant) return;
    const id = setInterval(() => {
      setAssistFrameIdx((i) => (i + 1) % assistFrames.length);
    }, 120);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUser, isTerminal, isStreaming, message.content]);

  // Buffered streaming display like Perplexity
  const [displayContent, setDisplayContent] = useState(message.content || '');
  const [lastRenderedLen, setLastRenderedLen] = useState((message.content || '').length);
  const [fadeActive, setFadeActive] = useState(false);
  const latestContentRef = useRef(message.content || '');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When message id changes, reset display content
  useEffect(() => {
    setDisplayContent(message.content || '');
    latestContentRef.current = message.content || '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  // Buffer incoming content and flush at a controlled cadence
  useEffect(() => {
    latestContentRef.current = message.content || '';

    if (!isTerminal && !isUser && isStreaming) {
      // If no timer running, start a short cadence flush
      if (!flushTimerRef.current) {
        const flush = () => {
          setDisplayContent((prev) => {
            const next = latestContentRef.current;
            if (next !== prev) {
              setFadeActive(true);
              setTimeout(() => setFadeActive(false), 220);
              return next;
            }
            return prev;
          });
          flushTimerRef.current = setTimeout(flush, 140); // ~7 fps perception
        };
        flush();
      }
    } else {
      // Stream ended or not applicable → final flush and clear
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setDisplayContent(latestContentRef.current);
      setFadeActive(false);
    }

    return () => {
      if (flushTimerRef.current && (!isStreaming || isTerminal || isUser)) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [isStreaming, isTerminal, isUser, message.content]);
  
  const renderWithMentions = (text: string) => {
    const parts = text.split(/(\B@[a-zA-Z0-9_:\/\.\-]+)/g);
    return parts.map((part, idx) =>
      /\B@[a-zA-Z0-9_:\/\.\-]+/.test(part) ? (
        <span key={idx} className="font-semibold">{part}</span>
      ) : (
        <span key={idx}>{part}</span>
      )
    );
  };
  
  const boldMentionsInMarkdown = (text?: string) => {
    if (!text) return '';
    return text.replace(/(\B@[a-zA-Z0-9_:\/\.\-]+)/g, '**$1**');
  };
  
  // Allow data:audio links to render inline while keeping others safe
  const urlTransform = (uri: string) => {
    try {
      if (typeof uri !== 'string') return uri as any;
      if (uri.startsWith('data:audio')) return uri;
      if (uri.startsWith('http:') || uri.startsWith('https:') || uri.startsWith('/')) return uri;
      return '#';
    } catch {
      return '#';
    }
  };
  
  const markdownComponents = {
    img: (props: any) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...props}
        alt={props.alt || ''}
        className={`mt-2 max-w-full rounded-md border ${props.className || ''}`}
      />
    ),
    a: (props: any) => {
      const href = props.href as string | undefined;
      if (href && href.startsWith('data:audio')) {
        return (
          <audio controls className="mt-2 w-full">
            <source src={href} />
            Your browser does not support the audio element.
          </audio>
        );
      }
      return <a {...props} target="_blank" rel="noreferrer" className="underline hover:no-underline" />
    },
  } as any;
  
  return (
    <div className="flex gap-3 p-3 hover:bg-muted/50 group animate-in fade-in-50 duration-150 ease-out">
      <Avatar className="h-10 w-10 flex-shrink-0">
        {isUser && userAvatar ? (
          <AvatarImage src={userAvatar} alt={userName || 'User'} />
        ) : !isUser && !isTerminal && agentAvatar ? (
          <AvatarImage src={agentAvatar} alt={agentName || 'Agent'} />
        ) : null}
        <AvatarFallback className={`${
          isUser ? 'bg-blue-500' : 
          isTerminal ? 'bg-purple-500' : 
          'bg-green-500'
        } text-white font-semibold`}>
          {isUser ? (userName ? userName.charAt(0).toUpperCase() : 'U') : isTerminal ? 'T' : (agentName ? agentName.charAt(0).toUpperCase() : 'A')}
        </AvatarFallback>
      </Avatar>
      
      <div className="flex flex-col gap-0 flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span 
            className="font-semibold text-sm text-foreground"
            title={isTerminal && message.terminalResult ? `$ ${message.terminalResult.command}` : undefined}
          >
            {isUser ? 'You' : isTerminal ? 'Terminal' : (agentName || 'Agent')}
          </span>
          <span className="text-xs text-muted-foreground">
            {message.timestamp.toLocaleTimeString()}
          </span>
          {isStreaming && (!displayContent || displayContent.trim().length === 0) && (
            <TypingDots width={24} height={8} />
          )}
        </div>
        
        <div
          key={isStreaming ? `${message.id}-${(displayContent || '').length}` : undefined}
          className={`text-sm leading-relaxed text-foreground transition-opacity duration-200 ${isStreaming ? 'streaming-reveal' : ''}`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap m-0">{renderWithMentions(displayContent)}</p>
          ) : isTerminal ? (
            <div className="font-mono">
              {message.terminalResult ? (
                <TerminalOutput
                  command={message.terminalResult.command}
                  stdout={message.terminalResult.stdout}
                  stderr={message.terminalResult.stderr}
                  exitCode={message.terminalResult.exitCode}
                />
              ) : (
                <div className="text-xs text-muted-foreground italic">Running {spinner}</div>
              )}
            </div>
          ) : (
            <div>
              {/* grid + lightbox render */}
              {(() => {
                const raw = boldMentionsInMarkdown(displayContent) || '';
                const isInlineCards = /^(X search for|Google News for)/m.test(raw);
                const lines = raw.split('\n');
                const imgRegex = /!\[([^\]]*)\]\(([^\)]+)\)/;
                type ImgItem = { src: string; alt: string; caption?: string };
                const imgs: ImgItem[] = [];
                for (let i = 0; i < lines.length; i++) {
                  const m = lines[i].match(imgRegex);
                  if (m) {
                    const alt = (m[1] || '').trim();
                    const src = (m[2] || '').trim();
                    let caption = '';
                    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
                      const lj = lines[j]?.trim();
                      if (lj && !imgRegex.test(lj) && !/^\[Source\]/i.test(lj)) { caption = lj; break; }
                    }
                    imgs.push({ src, alt, caption });
                  }
                }
                const nonImageText = lines.filter(l => !imgRegex.test(l)).join('\n');

                const [selected, setSelected] = React.useState<null | ImgItem>(null);

                return (
                  <>
                    {isInlineCards ? (
                      <div className="mt-0">
                        <JsonMarkdownRenderer content={raw} />
                      </div>
                    ) : (
                      imgs.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                        {imgs.map((it, i) => (
                          <div key={i} className="group cursor-zoom-in" onClick={() => setSelected(it)}>
                            <div className="w-full h-36 sm:h-40 md:h-48 bg-muted rounded overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={it.src} alt={it.alt} className="w-full h-full object-cover" />
                            </div>
                            {(it.caption || it.alt) && (
                              <div className="mt-1 text-xs text-muted-foreground line-clamp-2" title={`${it.caption || it.alt}`}>
                                {it.caption || it.alt}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      )
                    )}
                    {!isInlineCards && nonImageText && (
                      <div className="mt-0 streaming-reveal">
                        <span className="stream-chunk">
                          <JsonMarkdownRenderer content={nonImageText.slice(0, lastRenderedLen)} />
                        </span>
                        {nonImageText.length > lastRenderedLen && (
                          <span className="stream-chunk new">
                            <JsonMarkdownRenderer content={nonImageText.slice(lastRenderedLen)} />
                          </span>
                        )}
                        {isStreaming && lastRenderedLen !== nonImageText.length && (
                          <span style={{ display: 'none' }}
                            aria-hidden
                            ref={(el) => {
                              if (el) setLastRenderedLen(nonImageText.length)
                            }}
                          />
                        )}
                      </div>
                    )}
                    {selected && (
                      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
                        <div className="max-w-screen-md w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={selected.src} alt={selected.alt} className="w-full h-auto rounded shadow" />
                          {(selected.caption || selected.alt) && (
                            <div className="mt-2 text-sm text-white/90">{selected.caption || selected.alt}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
              {isStreaming && (
                <span className="inline-block w-1 h-4 bg-current animate-pulse ml-1" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
