'use client';

import { RefObject } from 'react';
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
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {allMessages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50 animate-in fade-in-0 duration-700" style={{ animationDelay: '200ms' }} />
            <p className="text-lg font-medium animate-in fade-in-0 duration-700" style={{ animationDelay: '400ms' }}>Welcome to SuperAgent!</p>
            <p className="text-sm animate-in fade-in-0 duration-700" style={{ animationDelay: '600ms' }}>Start a conversation by typing a message below.</p>
          </div>
        </div>
      ) : (
        <Virtuoso
          className="h-full"
          style={{ height: '100%' }}
          totalCount={allMessages.length}
          data={allMessages}
          itemContent={(idx, message) => {
              const hasSeen = seenMessageIdsRef.current.has(message.id);
              if (!hasSeen) seenMessageIdsRef.current.add(message.id);
              const shouldAnimate = !hasSeen && !message.streaming;
              return (
                <div
                  key={message.id}
                  className={shouldAnimate ? 'animate-in fade-in-0 slide-in-from-bottom-2 duration-200' : ''}
                  style={shouldAnimate ? { animationDelay: `${Math.min(idx * 30, 200)}ms` } : undefined}
                >
                  <ChatMessage 
                    message={message} 
                    isStreaming={message.streaming}
                    agentNameOverride={agentMeta.name}
                    agentAvatarOverride={agentMeta.avatarUrl}
                    userNameOverride={userMeta.name}
                    userAvatarOverride={userMeta.avatarUrl}
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
                              const mentioned = participantsRef.current.find(p => p.type === 'agent' && new RegExp(`@${p.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '')}`, 'i').test(allMessages.find(m => m.id === message.id)?.content || ''));
                              await routeApprovedCommand(cmd, mentioned?.id);
                              handleRejectTerminalCommand(message.id, true);
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


