'use client';

import { RefObject, useEffect, useRef, useState } from 'react';
// Removed ScrollArea here; Virtuoso manages its own scroll container
import { Virtuoso } from 'react-virtuoso';
import { MessageSquare } from 'lucide-react';
import { ChatMessage as ChatMessageType } from '@/lib/websocket';
import { ChatMessage } from './ChatMessage';
import { AgentTerminalSuggestion } from './AgentTerminalSuggestion';

export function MessagesPanel({
  allMessages,
  pendingTerminalSuggestions,
  seenMessageIdsRef,
  seenSuggestionIdsRef,
  messagesEndRef,
  agentMeta,
  userMeta,
  participantsRef,
  routeApprovedCommand,
  handleRejectTerminalCommand,
  currentUserId,
  onLoadMore,
  hasMore,
  loadingMore,
  receipts,
}: {
  allMessages: ChatMessageType[];
  pendingTerminalSuggestions: Map<string, { command: string; reason: string }>;
  seenMessageIdsRef: RefObject<Set<string>> | { current: Set<string> };
  seenSuggestionIdsRef: RefObject<Set<string>> | { current: Set<string> };
  messagesEndRef: RefObject<HTMLDivElement>;
  agentMeta: { name?: string; avatarUrl?: string };
  userMeta: { name?: string; avatarUrl?: string };
  participantsRef: RefObject<Array<{ id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string }>> | { current: Array<{ id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string }> };
  routeApprovedCommand: (cmd: string, attributedAgentId?: string) => Promise<void>;
  handleRejectTerminalCommand: (messageId: string, approved?: boolean) => void;
  currentUserId?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  receipts?: Map<string, Set<string>>;
}) {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setHasMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const seenHeaderKeysRef = useRef<Set<string>>(new Set());
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {allMessages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className={"text-center transition-opacity duration-300 " + (hasMounted ? "opacity-100" : "opacity-0") }>
            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Welcome to SuperAgent!</p>
            <p className="text-sm">Start a conversation by typing a message below.</p>
          </div>
        </div>
      ) : (
        <Virtuoso
          className="h-full"
          style={{ height: '100%' }}
          totalCount={allMessages.length}
          data={allMessages}
          startReached={() => { if (hasMore && !loadingMore && onLoadMore) onLoadMore(); }}
          itemContent={(idx, message) => {
              const stableKey = ((message as any).clientId || (message as any).tempId || message.id) as string;
              const hasSeen = seenMessageIdsRef.current.has(stableKey);
              if (!hasSeen) seenMessageIdsRef.current.add(stableKey);
              const shouldAnimate = !hasSeen && !message.streaming;
              const prev = idx > 0 ? allMessages[idx - 1] : undefined;
              const isGroupStart = !prev || prev.role !== message.role || (
                (prev as any).agentName !== (message as any).agentName ||
                (prev as any).userName !== (message as any).userName
              );
              // Animate agent header once per assistant message on first render (streaming or not)
              const headerKey = stableKey;
              const animateHeader = message.role === 'assistant' && !seenHeaderKeysRef.current.has(headerKey);
              if (animateHeader) seenHeaderKeysRef.current.add(headerKey);
              // Compute read receipts for this message
              let readByOthers = false;
              let readByCount = 0;
              try {
                const actorIds = receipts?.get(message.id);
                if (actorIds && actorIds.size > 0) {
                  // Map user participants (by id) and exclude the sender themself
                  const senderUserId = (message as any).authorUserId as string | undefined;
                  const others = [...actorIds].filter(id => !senderUserId || id !== senderUserId);
                  readByCount = others.length;
                  readByOthers = others.length > 0;
                }
              } catch {}
              return (
                <div
                  key={stableKey}
                  className={shouldAnimate ? 'animate-in fade-in-0 slide-in-from-bottom-2 duration-200' : ''}
                  style={shouldAnimate ? { animationDelay: `${Math.min(idx * 30, 200)}ms` } : undefined}
                >
                  <ChatMessage 
                    message={message} 
                    isStreaming={message.streaming}
                    animateHeader={animateHeader}
                    agentNameOverride={agentMeta.name}
                    agentAvatarOverride={agentMeta.avatarUrl}
                    userNameOverride={(message as any).role === 'user'
                      ? ((message as any).userName
                          || (participantsRef.current as any)?.find?.((p: any) => p.type === 'user' && (p.id === (message as any).authorId || p.id === (message as any).authorUserId))?.name)
                      : userMeta.name}
                    userAvatarOverride={(message as any).role === 'user'
                      ? ((message as any).userAvatar
                          || (participantsRef.current as any)?.find?.((p: any) => p.type === 'user' && (p.id === (message as any).authorId || p.id === (message as any).authorUserId))?.avatar)
                      : userMeta.avatarUrl}
                    currentUserId={currentUserId}
                    readByOthers={readByOthers}
                    readByCount={readByCount}
                  />
                  {message.role === 'assistant' && pendingTerminalSuggestions.has(message.id) && (
                    (() => {
                      const suggSeen = seenSuggestionIdsRef.current.has(message.id);
                      if (!suggSeen) seenSuggestionIdsRef.current.add(message.id);
                      const suggAnimate = !suggSeen;
                      return (
                        <div
                          className={`pl-16 pr-3 pb-2 ${suggAnimate ? 'animate-in fade-in-0 duration-200' : ''}`}
                          style={suggAnimate ? { animationDelay: '120ms' } : undefined}
                        >
                          <AgentTerminalSuggestion
                            command={pendingTerminalSuggestions.get(message.id)!.command}
                            reason={pendingTerminalSuggestions.get(message.id)!.reason}
                            onApprove={async (cmd) => {
                              try {
                                const mentioned = participantsRef.current.find(p => p.type === 'agent' && new RegExp(`@${p.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '')}`, 'i').test(allMessages.find(m => m.id === message.id)?.content || ''));
                                await routeApprovedCommand(cmd, mentioned?.id);
                                handleRejectTerminalCommand(message.id, true);
                                // Mark this suggestion as handled so it doesn't reappear on re-renders
                                try { (window as any)._superagent_handled = (window as any)._superagent_handled || new Set(); (window as any)._superagent_handled.add(message.id); } catch {}
                              } catch (e) {
                                console.error('[approval] command failed', e);
                                handleRejectTerminalCommand(message.id, false);
                              }
                            }}
                            onReject={() => handleRejectTerminalCommand(message.id, false)}
                          />
                        </div>
                      );
                    })()
                  )}
                </div>
              );
          }}
          followOutput={'smooth'}
        />
      )}
    </div>
  );
}


