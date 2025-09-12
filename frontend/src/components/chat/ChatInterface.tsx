'use client';

import { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SuperAgentWebSocket, ChatMessage as ChatMessageType } from '@/lib/websocket';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatFooterBar } from './ChatFooterBar';
import { AgentTerminalSuggestion } from './AgentTerminalSuggestion';
import { Wifi, WifiOff, MessageSquare, Users, Globe2, Search, Mic, Wrench, Copy, X } from 'lucide-react';
import { JsonFormatter } from '@/components/ui/json-formatter';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/components/ui/sidebar';

function resolveWsUrl(): string {
  try {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname || '';
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || /^192\.168\./.test(host);
      if (isLocal) return 'ws://localhost:3001/ws';
    }
  } catch {}
  return (
    process.env.NEXT_PUBLIC_WS_URL ||
    (process.env.NODE_ENV === 'production' ? 'wss://your-domain.com/ws' : 'ws://localhost:3001/ws')
  );
}

const WEBSOCKET_URL = resolveWsUrl();

function getHealthUrlFromWs(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    const scheme = url.protocol === 'wss:' ? 'https:' : 'http:';
    return `${scheme}//${url.host}/health`;
  } catch {
    return 'http://localhost:3001/health';
  }
}

const DEFAULT_ROOM_ID = 'default-room';

export function ChatInterface({ 
  currentConversation, 
  onConversationChange 
}: { 
  currentConversation?: string;
  onConversationChange?: (conversationId: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [streamingMessages, setStreamingMessages] = useState<Map<string, string>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [currentRoom, setCurrentRoom] = useState(currentConversation || DEFAULT_ROOM_ID);
  const [pendingTerminalSuggestions, setPendingTerminalSuggestions] = useState<Map<string, {command: string, reason: string}>>(new Map());
  const [agentMeta, setAgentMeta] = useState<{ name?: string; avatarUrl?: string }>({});
  const [userMeta, setUserMeta] = useState<{ name?: string; avatarUrl?: string }>({});
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [executedEleven, setExecutedEleven] = useState<Set<string>>(new Set());
  const [participants, setParticipants] = useState<Array<{ id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string }>>([]);
  const participantsRef = useRef<Array<{ id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string }>>([]);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'participants' | 'tasks'>('participants');
  const [toolRuns, setToolRuns] = useState<Map<string, { runId: string; toolCallId: string; tool: string; func: string; args: any; status: 'running' | 'succeeded' | 'failed'; error?: string; startedAt: number; completedAt?: number; durationMs?: number }>>(new Map());
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [allAgents, setAllAgents] = useState<Array<{ id: string; name: string; avatar?: string }>>([]);
  const [agentSearch, setAgentSearch] = useState('');
  
  const { state: sidebarState } = useSidebar();
  const wsRef = useRef<SuperAgentWebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const seenSuggestionIdsRef = useRef<Set<string>>(new Set());
  const streamBuffersRef = useRef<Map<string, string>>(new Map());
  const streamTimersRef = useRef<Map<string, any>>(new Map());

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    // Only scroll if we're not in the middle of streaming to prevent jarring movements
    const hasStreaming = Array.from(streamingMessages.values()).some(content => content.length > 0);
    if (!hasStreaming) {
      scrollToBottom();
    }
  }, [messages, streamingMessages]);

  // Console log the latest part of the conversation for quick visibility [[memory:8297405]]
  useEffect(() => {
    // Disabled console logging to prevent performance issues during streaming
    // try {
    //   const last = messages.slice(-12).map(m => ({
    //     time: m.timestamp.toLocaleTimeString(),
    //     role: m.role,
    //     content: (m as any).terminalResult ? `$ ${(m as any).terminalResult.command}` : (m.content || ''),
    //     streaming: !!m.streaming,
    //   }));
    //   console.groupCollapsed('Conversation (latest)');
    //   console.table(last);
    //   console.groupEnd();
    // } catch {}
  }, [messages]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      wsRef.current?.disconnect();
    };
  }, []);
  // Load agents when opening the add-agent modal
  useEffect(() => {
    if (!showAddAgent) return;
    let cancelled = false;
    (async () => {
      try {
        const base = getHttpBaseFromWs(WEBSOCKET_URL);
        const res = await fetch(`${base}/api/agents`);
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : (Array.isArray(data?.agents) ? data.agents : []);
        const mapped = list.map((a: any) => ({ id: a.id, name: a.name, avatar: a.avatar }));
        if (!cancelled) setAllAgents(mapped);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [showAddAgent]);


  // Global header trigger to toggle participants
  useEffect(() => {
    const handler = () => setRightOpen(o => !o);
    window.addEventListener('toggle-participants', handler as EventListener);
    return () => window.removeEventListener('toggle-participants', handler as EventListener);
  }, []);

  // Handle conversation changes
  useEffect(() => {
    if (currentConversation && currentConversation !== currentRoom) {
      setCurrentRoom(currentConversation);
      // Clear messages when switching conversations
      setMessages([]);
      setStreamingMessages(new Map());
      setPendingTerminalSuggestions(new Map());
      
      // Join new room if connected
      if (wsRef.current?.isConnected()) {
        wsRef.current.joinRoom(currentConversation).then(() => {
          console.log(`Joined room: ${currentConversation}`);
        }).catch((err) => {
          console.error('room.join failed:', err);
        });
      }
    }
  }, [currentConversation]);

  const getHttpBaseFromWs = (wsUrl: string): string => {
    try {
      if (typeof window !== 'undefined') {
        const host = window.location.hostname || '';
        const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || /^192\.168\./.test(host);
        if (isLocal) return 'http://127.0.0.1:3001';
      }
      const u = new URL(wsUrl);
      return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
    } catch {
      return 'http://127.0.0.1:3001';
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadMeta() {
      try {
        if (!currentRoom) return;
        const base = getHttpBaseFromWs(WEBSOCKET_URL);
        const res = await fetch(`${base}/api/agents/${currentRoom}`);
        if (!res.ok) { if (!cancelled) setAgentMeta({}); return; }
        const data = await res.json();
        const avatar = data.avatar as string | undefined;
        const resolvedAvatar = avatar ? (avatar.startsWith('/') ? `${base}${avatar}` : avatar) : undefined;
        if (!cancelled) setAgentMeta({ name: data.name, avatarUrl: resolvedAvatar });
      } catch {
        if (!cancelled) setAgentMeta({});
      }
    }
    loadMeta();
    return () => { cancelled = true; };
  }, [currentRoom]);

  // Load user profile data
  useEffect(() => {
    let cancelled = false;
    async function loadUserProfile() {
      try {
        const base = getHttpBaseFromWs(WEBSOCKET_URL);
        const res = await fetch(`${base}/api/profile`);
        if (!res.ok) { if (!cancelled) setUserMeta({}); return; }
        const data = await res.json();
        if (!cancelled) {
          setUserMeta({ name: data.name, avatarUrl: data.avatar });
          if (data?.id) setCurrentUserId(String(data.id));
        }
      } catch {
        if (!cancelled) setUserMeta({});
      }
    }
    loadUserProfile();
    return () => { cancelled = true; };
  }, []);

  // Backfill agent metadata onto any assistant messages missing it
  useEffect(() => {
    if (!agentMeta.name && !agentMeta.avatarUrl) return;
    setMessages(prev => {
      let changed = false;
      const next = prev.map(m => {
        if (m.role === 'assistant' && (!('agentName' in (m as any)) || !('agentAvatar' in (m as any)))) {
          changed = true;
          return { ...(m as any), agentName: agentMeta.name, agentAvatar: agentMeta.avatarUrl };
        }
        return m;
      });
      return changed ? next : prev;
    });
  }, [agentMeta]);

  // Handle TTS execution after messages are stable
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.streaming) {
      // Use a small delay to ensure the message is fully rendered before TTS
      const timeoutId = setTimeout(() => {
        maybeExecuteElevenlabs(lastMessage.id, lastMessage.content);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [messages]);

  const connectWebSocket = async () => {
    if (isConnecting) return;
    
    setIsConnecting(true);
    
    wsRef.current = new SuperAgentWebSocket(
      WEBSOCKET_URL,
      // onMessage
      (message) => {
        setMessages(prev => {
          // If a terminal result arrives, replace the latest placeholder instead of appending
          if (message.role === 'terminal' && (message as any).terminalResult) {
            const lastPlaceholderIdx = [...prev].reverse().findIndex(m => m.role === 'terminal' && !m.terminalResult);
            if (lastPlaceholderIdx !== -1) {
              const idx = prev.length - 1 - lastPlaceholderIdx;
              const updated = [...prev];
              updated[idx] = message as any;
              return updated;
            }
          }

          // Special handling for echoed user message: replace the local temp echo in-place
          if (message.role === 'user') {
            const revIdx = [...prev].reverse().findIndex(m => m.role === 'user' && (m as any).temp && m.content === message.content);
            if (revIdx !== -1) {
              const idx = prev.length - 1 - revIdx;
              const updated = [...prev];
              const preservedTs = updated[idx].timestamp;
              updated[idx] = { ...(message as any), timestamp: preservedTs };
              return updated;
            }
            // Fallback: upsert by id
            const filtered = prev.filter(m => m.id !== message.id);
            return [...filtered, message];
          }

          // If an assistant message arrives, try to attach author name/avatar if provided
          if (message.role === 'assistant') {
            const authorId = (message as any).authorId as string | undefined;
            const authorType = (message as any).authorType as string | undefined;
            let messageWithIdentity: any = { ...(message as any) };
            
            // Use ref for immediate access to participants data
            const currentParticipants = participantsRef.current;
            console.log('Processing assistant message:', { 
              authorId, 
              authorType, 
              participants: currentParticipants.length,
              participantsList: currentParticipants.map(p => ({ id: p.id, name: p.name, type: p.type })),
              searchingFor: authorId,
              foundMatch: currentParticipants.find(p => p.type === 'agent' && p.id === authorId)
            });
            
            if (authorType === 'agent' && authorId) {
              const p = currentParticipants.find(p => p.type === 'agent' && p.id === authorId);
              console.log('Found participant:', p);
              if (p) {
                messageWithIdentity.agentName = p.name;
                messageWithIdentity.agentAvatar = p.avatar || undefined;
                console.log('Applied agent identity:', { agentName: p.name, agentAvatar: p.avatar });
              } else {
                console.log('No matching participant found for authorId:', authorId);
              }
            } else {
              console.log('No authorId/authorType provided or not agent type');
            }
            
            // Always fallback to agentMeta if no specific agent found
            if (!messageWithIdentity.agentName && (agentMeta.name || agentMeta.avatarUrl)) {
              messageWithIdentity.agentName = agentMeta.name;
              messageWithIdentity.agentAvatar = agentMeta.avatarUrl;
            }

            // First try to find exact message by ID
            const existingIdx = prev.findIndex(m => m.id === message.id);
            if (existingIdx !== -1) {
              const updated = [...prev];
              updated[existingIdx] = { ...messageWithIdentity, streaming: false };
              const suggestion = extractTerminalSuggestions(message.content);
              if (suggestion) {
                setPendingTerminalSuggestions(prevMap => {
                  const map = new Map(prevMap);
                  map.set(message.id, suggestion);
                  return map;
                });
              }
              return updated;
            }

            // Otherwise, replace the most recent streaming assistant placeholder
            const lastAssistantPlaceholderIdx = [...prev].reverse().findIndex(m => m.role === 'assistant' && m.streaming);
            if (lastAssistantPlaceholderIdx !== -1) {
              const idx = prev.length - 1 - lastAssistantPlaceholderIdx;
              const updated = [...prev];
              updated[idx] = { ...messageWithIdentity, streaming: false };
              const suggestion = extractTerminalSuggestions(message.content);
              if (suggestion) {
                setPendingTerminalSuggestions(prevMap => {
                  const map = new Map(prevMap);
                  map.set(message.id, suggestion);
                  return map;
                });
              }
              return updated;
            }
          }

          // Otherwise, upsert by id
          const filtered = prev.filter(m => m.id !== message.id);
          const newMessages = [...filtered, message];

          // Check for terminal suggestions in assistant messages
          if (message.role === 'assistant') {
            const suggestion = extractTerminalSuggestions(message.content);
            if (suggestion) {
              setPendingTerminalSuggestions(prev => {
                const updated = new Map(prev);
                updated.set(message.id, suggestion);
                return updated;
              });
            }
          }

          return newMessages;
        });
        
        // Remove from streaming messages if it exists
        setStreamingMessages(prev => {
          const updated = new Map(prev);
          updated.delete(message.id);
          return updated;
        });
        // Clear any outstanding stream buffers/timers for this message
        streamBuffersRef.current.delete(message.id);
        const t = streamTimersRef.current.get(message.id);
        if (t) clearTimeout(t);
        streamTimersRef.current.delete(message.id);
      },
      // onMessageDelta
      (messageId, delta, authorId, authorType) => {
        // Buffer deltas to smooth rendering
        const current = streamBuffersRef.current.get(messageId) || '';
        streamBuffersRef.current.set(messageId, current + delta);

        // Start/refresh a short flush timer (~50ms)
        const existingTimer = streamTimersRef.current.get(messageId);
        if (existingTimer) clearTimeout(existingTimer);
        const timer = setTimeout(() => {
          const buffered = streamBuffersRef.current.get(messageId) || '';
          if (!buffered) return;
          streamBuffersRef.current.set(messageId, '');

          setStreamingMessages(prev => {
            const updated = new Map(prev);
            const prevText = updated.get(messageId) || '';
            updated.set(messageId, prevText + buffered);
            return updated;
          });

          setMessages(prev => {
            const existingIdx = prev.findIndex(m => m.id === messageId);
            if (existingIdx !== -1) {
              const updated = [...prev];
              const prevContent = (updated[existingIdx] as any).content || '';
              updated[existingIdx] = { ...(updated[existingIdx] as any), content: prevContent + buffered, streaming: true };
              return updated;
            }
            
            // If no existing message with this ID, try to update the most recent streaming placeholder
            const streamingPlaceholderIdx = [...prev].reverse().findIndex(m => m.role === 'assistant' && m.streaming && (!m.content || m.content.length === 0));
            if (streamingPlaceholderIdx !== -1) {
              const idx = prev.length - 1 - streamingPlaceholderIdx;
              const updated = [...prev];
              let agentName = agentMeta.name;
              let agentAvatar = agentMeta.avatarUrl;
              
              // Use ref for immediate access to participants data
              const currentParticipants = participantsRef.current;
              console.log('Delta processing:', { 
                authorId, 
                authorType, 
                participants: currentParticipants.length,
                participantsList: currentParticipants.map(p => ({ id: p.id, name: p.name, type: p.type }))
              });
              
              if (authorType === 'agent' && authorId) {
                const p = currentParticipants.find(p => p.type === 'agent' && p.id === authorId);
                console.log('Delta found participant:', p);
                if (p) {
                  agentName = p.name;
                  agentAvatar = p.avatar || undefined;
                  console.log('Delta applied agent identity:', { agentName: p.name, agentAvatar: p.avatar });
                } else {
                  console.log('Delta: No matching participant found for authorId:', authorId);
                }
              }
              updated[idx] = { 
                ...(updated[idx] as any), 
                id: messageId, // Update the ID to match the streaming message
                content: buffered, 
                streaming: true,
                agentName,
                agentAvatar,
              };
              return updated;
            }
            
            // Create new streaming message with immediate agent identity (no placeholder case)
            let initialAgentName = agentMeta.name;
            let initialAgentAvatar = agentMeta.avatarUrl;
            const currentParticipants = participantsRef.current;
            if (authorType === 'agent' && authorId) {
              const p = currentParticipants.find(p => p.type === 'agent' && p.id === authorId);
              if (p) {
                initialAgentName = p.name;
                initialAgentAvatar = p.avatar || undefined;
              }
            }
            return [
              ...prev,
              {
                id: messageId,
                role: 'assistant',
                content: buffered,
                timestamp: new Date(),
                streaming: true,
                agentName: initialAgentName,
                agentAvatar: initialAgentAvatar,
              } as any,
            ];
          });
        }, 50);
        streamTimersRef.current.set(messageId, timer);
      },
      // onConnect
      async () => {
        setIsConnected(true);
        setIsConnecting(false);
        toast.success('Connected to SuperAgent');
        
        try {
          // Resolve current user id for participant awareness
          let userId: string | undefined = undefined;
          try {
            const base = getHttpBaseFromWs(WEBSOCKET_URL);
            const prof = await fetch(`${base}/api/profile`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null);
            userId = prof?.id || 'default-user';
          } catch {}

          // Join the default room with userId (fire-and-forget)
          wsRef.current?.joinRoom(currentRoom, userId).then(() => {
            console.log(`Joined room: ${currentRoom}`);
          }).catch((err) => {
            console.error('room.join failed:', err);
          });
          
          // Get available providers
          const response = await fetch(getHealthUrlFromWs(WEBSOCKET_URL));
          const data = await response.json();
          setAvailableProviders(data.availableProviders || []);
        } catch (error) {
          console.error('Error joining room or fetching providers:', error);
        }
      },
      // onDisconnect
      () => {
        setIsConnected(false);
        setIsConnecting(false);
        toast.error('Disconnected from SuperAgent');
      },
      // onError
      (error) => {
        console.error('WebSocket error:', error);
        setIsConnecting(false);
        toast.error('Connection error');
      },
      undefined,
      // onAgentAnalysis: append analysis to existing assistant placeholder if present
      (content, authorId, authorType) => {
        setMessages(prev => {
          const lastAssistantIdx = [...prev].reverse().findIndex(m => m.role === 'assistant');
          if (lastAssistantIdx !== -1) {
            const idx = prev.length - 1 - lastAssistantIdx;
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              content: content,
              streaming: false,
              agentName: (() => { const p = participantsRef.current.find(p => p.type === 'agent' && p.id === authorId); return p?.name || agentMeta.name; })(),
              agentAvatar: (() => { const p = participantsRef.current.find(p => p.type === 'agent' && p.id === authorId); return (p?.avatar || undefined) ?? agentMeta.avatarUrl; })(),
            } as any;
            return updated;
          }
          return prev;
        });
      },
      // onParticipantsUpdate
      (payload: { roomId: string; participants: Array<{ id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string }>; updatedAt: string }) => {
        console.log('Received participants update:', payload);
        console.log('Current room:', currentRoom);
        console.log('Payload room:', payload.roomId);
        
        // Only update if this is for the current room
        if (payload.roomId === currentRoom) {
          // Normalize avatar URLs to absolute when needed
          const base = getHttpBaseFromWs(WEBSOCKET_URL);
          const mapped = (payload.participants || []).map((p: { id: string; type: 'user' | 'agent'; name: string; avatar?: string | null; status?: string }) => ({
            ...p,
            avatar: p.avatar && typeof p.avatar === 'string' && p.avatar.startsWith('/') ? `${base}${p.avatar}` : p.avatar,
          }));
          console.log('Setting participants for current room:', mapped);
          participantsRef.current = mapped; // Update ref immediately
          setParticipants(mapped);
        } else {
          console.log('Ignoring participants update for different room');
        }
      },
      // onToolCall
      (payload: { runId: string; toolCallId: string; tool: string; function: string; args: Record<string, any> }) => {
        setRightOpen(true);
        setRightTab('tasks');
        setToolRuns(prev => {
          const next = new Map(prev);
          next.set(payload.toolCallId, { runId: payload.runId, toolCallId: payload.toolCallId, tool: payload.tool, func: payload.function, args: payload.args, status: 'running', startedAt: Date.now() });
          return next;
        });
      },
      // onToolResult
      (payload: { runId: string; toolCallId: string; result?: any; error?: string }) => {
        setToolRuns(prev => {
          const next = new Map(prev);
          const existing = next.get(payload.toolCallId);
          if (existing) {
            existing.status = payload.error ? 'failed' : 'succeeded';
            existing.completedAt = Date.now();
            existing.durationMs = existing.startedAt ? (existing.completedAt - existing.startedAt) : undefined;
            if (payload.error) existing.error = String(payload.error);
            next.set(payload.toolCallId, { ...existing });
          }
          return next;
        });
      }
    );

    try {
      await wsRef.current.connect();
    } catch (error) {
      console.error('Failed to connect:', error);
      setIsConnecting(false);
      toast.error('Failed to connect to SuperAgent');
    }
  };

  function maybeExecuteElevenlabs(messageId: string, content: string) {
    // prevent duplicate execution
    if (executedEleven.has(messageId)) return;
    // Support normal, smart, and single quotes around the text argument
    const patterns = [
      /elevenlabs\.tts\s+\"([^\"]+)\"(.*)$/i,
      /elevenlabs\.tts\s+“([^”]+)”(.*)$/i,
      /elevenlabs\.tts\s+'([^']+)'(.*)$/i,
    ];
    let match: RegExpMatchArray | null = null;
    for (const p of patterns) { match = content.match(p); if (match) break; }
    if (!match) return;
    const text = match[1];
    const rest = match[2] || '';
    const params: Record<string, string> = {};
    rest.trim().split(/\s+/).forEach(p => {
      const mm = p.match(/^(\w+)=([^\s]+)$/);
      if (mm) params[mm[1]] = mm[2];
    });
    const voiceId = params.voice || params.voiceId;
    const format = (params.format as any) || 'mp3';
    console.log('[tts] detected elevenlabs.tts:', { textLen: text.length, voiceId, format });
    setExecutedEleven(prev => new Set(prev).add(messageId));
    const loaderId = crypto.randomUUID();
    const startedAt = new Date();
    const MIN_LOADER_MS = 900;
    // Insert a streaming loader while TTS is generated
    setMessages(prev => ([
      ...prev,
      {
        id: loaderId,
        role: 'assistant',
        content: 'Generating narration…',
        timestamp: startedAt,
        streaming: true,
        agentName: agentMeta.name,
        agentAvatar: agentMeta.avatarUrl,
      } as any,
    ]));
    wsRef.current!.elevenlabsTTS(text, voiceId, format).then((res) => {
      console.log('[tts] success:', { contentType: res.contentType, base64Len: res.base64?.length });
      const audioUrl = `data:${res.contentType};base64,${res.base64}`;
      const finalize = () => setMessages(prev => {
        const finalMsg = {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: `Narration generated. [Play audio](${audioUrl})`,
          timestamp: new Date(),
          agentName: agentMeta.name,
          agentAvatar: agentMeta.avatarUrl,
        } as any;
        const idx = prev.findIndex(m => m.id === loaderId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = finalMsg;
          return updated;
        }
        return [...prev, finalMsg];
      });
      const elapsed = Date.now() - startedAt.getTime();
      if (elapsed < MIN_LOADER_MS) {
        setTimeout(finalize, MIN_LOADER_MS - elapsed);
      } else {
        finalize();
      }
    }).catch((e) => {
      console.error('[tts] failed', e);
      toast.error('TTS failed');
      // Remove the loader on error
      setMessages(prev => prev.filter(m => m.id !== loaderId));
    });
  }

  const handleSendMessage = async (content: string, options?: any) => {
    if (!wsRef.current?.isConnected()) {
      toast.error('Not connected to server');
      return;
    }

    try {
      // Check if this is a terminal command
      if (content.startsWith('$')) {
        // Show immediate terminal placeholder
        // Insert a single terminal placeholder if not present
        setMessages(prev => {
          const hasPendingTerminal = prev.some(m => m.role === 'terminal' && !m.terminalResult);
          if (hasPendingTerminal) return prev;
          const tempId = crypto.randomUUID();
          return [
            ...prev,
            {
              id: tempId,
              role: 'terminal',
              content: content,
              timestamp: new Date(),
            } as ChatMessageType,
          ];
        });
        await wsRef.current.executeTerminalCommand(content, currentRoom);
      } else {
        // Check if user is approving a terminal command
        const isApproval = /^(y|yes)\b/i.test(content.trim());
        
        if (isApproval && pendingTerminalSuggestions.size > 0) {
          // Find the most recent suggestion
          const latestSuggestion = Array.from(pendingTerminalSuggestions.entries()).pop();
          if (latestSuggestion) {
            const [messageId, suggestion] = latestSuggestion;
            const normalized = normalizeSuggestedCommand(suggestion.command);
            // Route SerpAPI invocations vs terminal
            if (/^serpapi\.search\s+/.test(normalized)) {
              const query = normalized.replace(/^serpapi\.search\s+/, '').replace(/^"|"$/g, '');
              await wsRef.current.serpapiSearch(query, currentRoom, 5);
            } else if (/^serpapi\.images\s+/.test(normalized)) {
              const query = normalized.replace(/^serpapi\.images\s+/, '').replace(/^"|"$/g, '');
              await wsRef.current.serpapiImages(query, currentRoom, 6);
            } else if (/^serpapi\.run\s+/.test(normalized)) {
              const rest = normalized.replace(/^serpapi\.run\s+/, '');
              const parts = rest.match(/^(\S+)\s+\"([^\"]+)\"(.*)$/);
              if (parts) {
                const engine = parts[1];
                const query = parts[2];
                const extraStr = parts[3] || '';
                const extra: Record<string, any> = {};
                extraStr.trim().split(/\s+/).forEach(pair => {
                  const m = pair.match(/^(\w+)=([^\s]+)$/);
                  if (m) extra[m[1]] = m[2];
                });
                await wsRef.current.serpapiRun(engine, query, currentRoom, extra);
              } else {
                await wsRef.current.serpapiRun('google', rest.replace(/^\"|\"$/g, ''), currentRoom);
              }
            } else {
              await handleApproveTerminalCommand(normalized);
            }
            setPendingTerminalSuggestions(prev => {
              const updated = new Map(prev);
              updated.delete(messageId);
              return updated;
            });
            return;
          }
        }
        // Quick tool routing: run SerpAPI directly when the user asks with @serpapi or serpapi.<engine>
        const quickSerp = parseSerpapiFromText(content);
        if (quickSerp) {
          const nowQuick = new Date();
          const userEchoQuick = {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: content,
            timestamp: nowQuick,
            temp: true,
          };
          const assistantLoaderQuick = {
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: '',
            timestamp: nowQuick,
            streaming: true,
            agentName: agentMeta.name,
            agentAvatar: agentMeta.avatarUrl,
          } as any;
          setMessages(prev => [...prev, userEchoQuick, assistantLoaderQuick]);
          // If user mentioned a specific agent, pass the agentId so backend can attribute tool output
          const mentioned = participantsRef.current.find(p => p.type === 'agent' && new RegExp(`@${p.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '')}`, 'i').test(content));
          await wsRef.current.serpapiRun(quickSerp.engine, quickSerp.query, currentRoom, quickSerp.extra, mentioned?.id);
          return;
        }

        // Quick X routing: @x "query" or @x <free text> ; also support lists via @x.lists @username
        const quickX = content.trim().match(/^@x\s+"([^"]+)"$/i) || content.trim().match(/^@x\s+(.+)$/i);
        if (quickX) {
          const q = (quickX[1] || '').trim();
          const nowQuick = new Date();
          const userEchoQuick = {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: content,
            timestamp: nowQuick,
            temp: true,
          };
          const assistantLoaderQuick = {
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: '',
            timestamp: nowQuick,
            streaming: true,
            agentName: agentMeta.name,
            agentAvatar: agentMeta.avatarUrl,
          } as any;
          setMessages(prev => [...prev, userEchoQuick, assistantLoaderQuick]);
          const mentioned = participantsRef.current.find(p => p.type === 'agent' && new RegExp(`@${p.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '')}`, 'i').test(content));
          await wsRef.current.xSearch(q, currentRoom, 5, mentioned?.id);
          return;
        }

        const quickXLists = content.trim().match(/^@x\.lists\s+(@?\w+)$/i);
        if (quickXLists) {
          const handle = quickXLists[1];
          const nowQuick = new Date();
          const userEchoQuick = { id: crypto.randomUUID(), role: 'user' as const, content, timestamp: nowQuick, temp: true } as any;
          const assistantLoaderQuick = { id: crypto.randomUUID(), role: 'assistant' as const, content: '', timestamp: nowQuick, streaming: true, agentName: agentMeta.name, agentAvatar: agentMeta.avatarUrl } as any;
          setMessages(prev => [...prev, userEchoQuick, assistantLoaderQuick]);
          const mentioned = participantsRef.current.find(p => p.type === 'agent' && new RegExp(`@${p.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '')}`, 'i').test(content));
          await wsRef.current.xLists(handle, currentRoom, mentioned?.id);
          return;
        }

        // Alias: @twitter behaves like @x
        const quickTwitter = content.trim().match(/^@twitter\s+"([^"]+)"$/i) || content.trim().match(/^@twitter\s+(.+)$/i);
        if (quickTwitter) {
          const q = (quickTwitter[1] || '').trim();
          const nowQuick = new Date();
          const userEchoQuick = {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: content,
            timestamp: nowQuick,
            temp: true,
          };
          const assistantLoaderQuick = {
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: '',
            timestamp: nowQuick,
            streaming: true,
            agentName: agentMeta.name,
            agentAvatar: agentMeta.avatarUrl,
          } as any;
          setMessages(prev => [...prev, userEchoQuick, assistantLoaderQuick]);
          const mentioned = participantsRef.current.find(p => p.type === 'agent' && new RegExp(`@${p.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '')}`, 'i').test(content));
          await wsRef.current.xSearch(q, currentRoom, 5, mentioned?.id);
          return;
        }

        const quickTwitterLists = content.trim().match(/^@twitter\.lists\s+(@?\w+)$/i);
        if (quickTwitterLists) {
          const handle = quickTwitterLists[1];
          const nowQuick = new Date();
          const userEchoQuick = { id: crypto.randomUUID(), role: 'user' as const, content, timestamp: nowQuick, temp: true } as any;
          const assistantLoaderQuick = { id: crypto.randomUUID(), role: 'assistant' as const, content: '', timestamp: nowQuick, streaming: true, agentName: agentMeta.name, agentAvatar: agentMeta.avatarUrl } as any;
          setMessages(prev => [...prev, userEchoQuick, assistantLoaderQuick]);
          const mentioned = participantsRef.current.find(p => p.type === 'agent' && new RegExp(`@${p.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '')}`, 'i').test(content));
          await wsRef.current.xLists(handle, currentRoom, mentioned?.id);
          return;
        }

        // Quick TTS: @elevenlabs "text" voice=Rachel format=mp3
        const ttsMatch = content.trim().match(/^@elevenlabs\s+"([^"]+)"(.*)$/i);
        if (ttsMatch) {
          const text = ttsMatch[1];
          const rest = ttsMatch[2] || '';
          const params: Record<string, string> = {};
          rest.trim().split(/\s+/).forEach(p => {
            const m = p.match(/^(\w+)=([^\s]+)$/);
            if (m) params[m[1]] = m[2];
          });
          const voiceId = params.voice || params.voiceId;
          const format = (params.format as any) || 'mp3';
          try {
            const now = new Date();
            const loaderId = crypto.randomUUID();
            const MIN_LOADER_MS = 900;
            const userEcho = { id: crypto.randomUUID(), role: 'user' as const, content, timestamp: now } as any;
            const assistantLoader = {
              id: loaderId,
              role: 'assistant' as const,
              content: 'Generating narration…',
              timestamp: now,
              streaming: true,
              agentName: agentMeta.name,
              agentAvatar: agentMeta.avatarUrl,
            } as any;
            setMessages(prev => ([...prev, userEcho, assistantLoader]));
            const res = await wsRef.current!.elevenlabsTTS(text, voiceId, format);
            const audioUrl = `data:${res.contentType};base64,${res.base64}`;
            const finalize = () => setMessages(prev => {
              const finalMsg = {
                id: crypto.randomUUID(),
                role: 'assistant' as const,
                content: `Generated audio for: "${text}"\n\n[Play audio](${audioUrl})`,
                timestamp: new Date(),
                agentName: agentMeta.name,
                agentAvatar: agentMeta.avatarUrl,
              } as any;
              const idx = prev.findIndex(m => m.id === loaderId);
              if (idx !== -1) {
                const updated = [...prev];
                updated[idx] = finalMsg;
                return updated;
              }
              return [...prev, finalMsg];
            });
            const elapsed = Date.now() - now.getTime();
            if (elapsed < MIN_LOADER_MS) {
              setTimeout(finalize, MIN_LOADER_MS - elapsed);
            } else {
              finalize();
            }
          } catch (e) {
            toast.error('TTS failed');
          }
          return;
        }

        // Show immediate assistant typing placeholder
        // Immediately echo the user's message into the thread (before any assistant placeholder)
        const now = new Date();
        const userEcho = {
          id: crypto.randomUUID(),
          role: 'user' as const,
          content: content,
          timestamp: now,
          temp: true,
        };
        
        // Only add assistant placeholder if we have agent meta (single-agent room) or no agent mentions (generic response)
        // For multi-agent rooms with mentions, wait for the actual agent response to avoid placeholder
        const hasMentions = /@\w+/.test(content);
        const isMultiAgent = participantsRef.current.filter(p => p.type === 'agent').length > 1;
        const shouldShowPlaceholder = !isMultiAgent || !hasMentions || agentMeta.name;
        
        let assistantLoader = null;
        if (shouldShowPlaceholder) {
          assistantLoader = {
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: '',
            timestamp: now,
            streaming: true,
            agentName: agentMeta.name,
            agentAvatar: agentMeta.avatarUrl,
          } as any;
        }
        
        // Single atomic update to preserve order: user first, then assistant loader (if any)
        setMessages(prev => {
          // Check if there's already a streaming assistant message
          const hasStreamingAssistant = prev.some(m => m.role === 'assistant' && m.streaming);
          if (hasStreamingAssistant || !assistantLoader) {
            return [...prev, userEcho];
          }
          return [...prev, userEcho, assistantLoader];
        });

        await wsRef.current.sendMessage(currentRoom, content, options);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    }
  };

  const handleReconnect = () => {
    wsRef.current?.disconnect();
    setTimeout(() => connectWebSocket(), 1000);
  };

  const handleApproveTerminalCommand = async (command: string) => {
    if (!wsRef.current?.isConnected()) {
      toast.error('Not connected to server');
      return;
    }

    try {
      // Normalize and send raw command (no '$' prefix)
      const normalized = normalizeSuggestedCommand(command);
      // Insert a single terminal placeholder for immediate feedback
      setMessages(prev => ([
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'terminal',
          content: `$ ${normalized}`,
          timestamp: new Date(),
        } as any,
      ]));
      await wsRef.current.executeAgentCommand(normalized, currentRoom, 'User approved terminal command');
      toast.success('Command approved and executing...');
    } catch (error) {
      console.error('Error executing approved command:', error);
      toast.error('Failed to execute command');
    }
  };

  // Route approved suggestions to SerpAPI tools or terminal
  const routeApprovedCommand = async (raw: string, attributedAgentId?: string) => {
    const normalized = normalizeSuggestedCommand(raw);
    // Generic engine form: serpapi.<engine> "query" (but not 'run')
    const m = normalized.match(/^serpapi\.(\w+)\s+(.+)$/);
    if (m && m[1] !== 'run') {
      const engine = m[1];
      const query = m[2].replace(/^\"|\"$/g, '');
      await wsRef.current!.serpapiRun(engine, query, currentRoom, undefined, attributedAgentId);
      return;
    }
    if (/^serpapi\.search\s+/.test(normalized)) {
      const query = normalized.replace(/^serpapi\.search\s+/, '').replace(/^\"|\"$/g, '');
      await wsRef.current!.serpapiSearch(query, currentRoom, 5, attributedAgentId);
      return;
    }
    if (/^serpapi\.images\s+/.test(normalized)) {
      const query = normalized.replace(/^serpapi\.images\s+/, '').replace(/^\"|\"$/g, '');
      await wsRef.current!.serpapiImages(query, currentRoom, 6, attributedAgentId);
      return;
    }
    if (/^serpapi\.run\s+/.test(normalized)) {
      const rest = normalized.replace(/^serpapi\.run\s+/, '');
      const parts = rest.match(/^(\S+)\s+\"([^\"]+)\"(.*)$/);
      if (parts) {
        const engine = parts[1];
        const query = parts[2];
        const extraStr = parts[3] || '';
        const extra: Record<string, any> = {};
        extraStr.trim().split(/\s+/).forEach(pair => {
          const m = pair.match(/^(\w+)=([^\s]+)$/);
          if (m) extra[m[1]] = m[2];
        });
        await wsRef.current!.serpapiRun(engine, query, currentRoom, extra, attributedAgentId);
        return;
      }
      await wsRef.current!.serpapiRun('google', rest.replace(/^\"|\"$/g, ''), currentRoom, undefined, attributedAgentId);
      return;
    }
    // X tools via approval: x.search, x.lists, x.dm, x.tweet
    const xSearch = normalized.match(/^x\.search\s+\"([^\"]+)\"$/i) || normalized.match(/^x\.search\s+(.+)$/i);
    if (xSearch) {
      const q = (xSearch[1] || '').trim();
      await wsRef.current!.xSearch(q, currentRoom, 5, attributedAgentId);
      return;
    }
    const xListsJson = normalized.match(/^x\.lists\s*\{\s*username:\s*\"([^\"]+)\"\s*\}$/i);
    const xListsAt = normalized.match(/^x\.lists\s+(@?\w+)$/i);
    if (xListsJson) {
      const handle = xListsJson[1];
      await wsRef.current!.xLists(handle, currentRoom, attributedAgentId);
      return;
    }
    if (xListsAt) {
      const handle = xListsAt[1];
      await wsRef.current!.xLists(handle, currentRoom, attributedAgentId);
      return;
    }
    const xTweet = normalized.match(/^x\.tweet\s+\"([^\"]+)\"$/i) || normalized.match(/^x\.tweet\s+(.+)$/i);
    if (xTweet) {
      const text = (xTweet[1] || '').trim();
      await wsRef.current!.xTweet(text, currentRoom, undefined, attributedAgentId);
      return;
    }
    const xDmJson = normalized.match(/^x\.dm\s*\{\s*recipientId:\s*\"([^\"]+)\"\s*,\s*text:\s*\"([^\"]+)\"\s*\}$/i);
    if (xDmJson) {
      const recipientId = xDmJson[1];
      const text = xDmJson[2];
      await wsRef.current!.xDm(recipientId, text, currentRoom, attributedAgentId);
      return;
    }
    // ElevenLabs TTS approval
    const tts = normalized.match(/^elevenlabs\.tts\s+\"([^\"]+)\"(.*)$/i) || normalized.match(/^elevenlabs\.tts\s+'([^']+)'(.*)$/i);
    if (tts) {
      const text = tts[1];
      const rest = (tts[2] || '').trim();
      const params: Record<string, string> = {};
      rest.split(/\s+/).forEach(p => { const mm = p.match(/^(\w+)=([^\s]+)$/); if (mm) params[mm[1]] = mm[2]; });
      const voiceId = params.voice || params.voiceId;
      const format = (params.format as any) || 'mp3';
      console.log('[tts][approval] running elevenlabs.tts:', { textLen: text.length, voiceId, format });
      // Quick run without adding a user echo (approval already given)
      try {
        const now = new Date();
        const loaderId = crypto.randomUUID();
        const MIN_LOADER_MS = 900;
        const assistantLoader = {
          id: loaderId,
          role: 'assistant' as const,
          content: 'Generating narration…',
          timestamp: now,
          streaming: true,
          agentName: agentMeta.name,
          agentAvatar: agentMeta.avatarUrl,
        } as any;
        setMessages(prev => ([...prev, assistantLoader]));
        const res = await wsRef.current!.elevenlabsTTS(text, voiceId, format);
        console.log('[tts][approval] success:', { contentType: res.contentType, base64Len: res.base64?.length });
        const audioUrl = `data:${res.contentType};base64,${res.base64}`;
        const finalize = () => setMessages(prev => {
          const finalMsg = {
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: `Generated audio for: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"

[Play audio](${audioUrl})`,
            timestamp: new Date(),
            agentName: agentMeta.name,
            agentAvatar: agentMeta.avatarUrl,
          } as any;
          const idx = prev.findIndex(m => m.id === loaderId);
          if (idx !== -1) { const updated = [...prev]; updated[idx] = finalMsg; return updated; }
          return [...prev, finalMsg];
        });
        const elapsed = Date.now() - now.getTime();
        if (elapsed < MIN_LOADER_MS) { setTimeout(finalize, MIN_LOADER_MS - elapsed); } else { finalize(); }
      } catch (e) {
        console.error('[tts][approval] failed', e);
        toast.error('TTS failed');
      }
      return;
    }
    // Web scraper tools
    const wsPick = normalized.match(/^tool\.web\.scrape\.pick\s*\{\s*index:\s*(\d+)\s*\}$/i) || normalized.match(/^tool\.web\.scrape\.pick\s+(\d+)$/i);
    if (wsPick) {
      const idx = parseInt(wsPick[1], 10);
      if (!Number.isNaN(idx)) {
        await wsRef.current!.webScrapePick(idx, currentRoom, attributedAgentId);
        return;
      }
    }
    const wsScrape = normalized.match(/^tool\.web\.scrape\s*\{\s*url:\s*\"([^\"]+)\"\s*\}$/i) || normalized.match(/^tool\.web\.scrape\s+([\S]+)$/i);
    if (wsScrape) {
      const url = wsScrape[1];
      await wsRef.current!.webScrape(url, currentRoom, attributedAgentId);
      return;
    }
    await handleApproveTerminalCommand(normalized);
  };

  const handleRejectTerminalCommand = (messageId: string, approved?: boolean) => {
    setPendingTerminalSuggestions(prev => {
      const updated = new Map(prev);
      updated.delete(messageId);
      return updated;
    });
    if (approved) {
      toast.success('Command approved');
    } else {
      toast.info('Command rejected');
    }
  };

  // Normalize suggested command strings from the assistant by removing
  // code formatting/backticks/quotes and any number of leading prompt symbols.
  const normalizeSuggestedCommand = (raw: string): string => {
    let result = raw;
    let prev = '';
    while (result !== prev) {
      prev = result;
      result = result.trim();
      // Strip surrounding backticks/quotes repeatedly
      result = result.replace(/^[`\"'“”‘’]+/, '').replace(/[`\"'“”‘’]+$/, '');
      // Remove any number of leading prompt tokens like $, #, > with spaces
      result = result.replace(/^(?:[$#>]+\s*)+/, '');
    }
    // Remove trailing code fences/punctuation
    result = result.replace(/[`\"'“”‘’\s]*[\?\.!`]*$/, '').trim();
    // Heuristic: strip trailing natural-language clause starting with " to "
    const toIdx = result.toLowerCase().indexOf(' to ');
    if (toIdx > -1) {
      const tail = result.slice(toIdx + 4);
      if (/^[a-z\s.,'“”‘’`-]+$/.test(tail)) {
        result = result.slice(0, toIdx).trim();
      }
    }
    // Auto-balance simple unmatched quotes so approvals like \"serpapi.search \"space images\"\" won't break
    const dq = (result.match(/\"/g) || []).length;
    if (dq % 2 === 1) result = result + '"';
    const sq = (result.match(/'/g) || []).length;
    if (sq % 2 === 1) result = result + "'";
    // Collapse internal whitespace
    result = result.replace(/\s+/g, ' ');
    return result;
  };

  const extractTerminalSuggestions = (content: string): {command: string, reason: string} | null => {
    // Prefer explicit ask patterns first
    const askPatterns = [
      /Should I run:\s*\$?\s*(.+?)(?:\?|$)/i,
      /Should I proceed(?: with)?:\s*\$?\s*(.+?)(?:\?|$)/i,
      /Should I read:\s*\$?\s*(.+?)(?:\?|$)/i,
      /Proceed(?:ing)? with:\s*\$?\s*(.+?)(?:\?|$)/i,
      /Shall I run:\s*\$?\s*(.+?)(?:\?|$)/i,
      /Let me run:\s*\$?\s*(.+?)(?:\?|$)/i,
      /I'll run:\s*\$?\s*(.+?)(?:\?|$)/i,
      /Running:\s*\$?\s*(.+?)(?:\?|$)/i,
    ];
    for (const pattern of askPatterns) {
      const match = content.match(pattern);
      if (match) {
        // If the matched text contains a tool invocation inside, prefer that substring
        const innerTool = match[1].match(/(tool\.web\.scrape(?:\.pick)?[^\{\n]*\{[^\n]*\}|serpapi\.[^\s\n]+\s+.+|x\.(?:search|lists|tweet|dm)[^\n]*)$/i);
        const rawCmd = innerTool ? innerTool[1] : match[1];
        const command = normalizeSuggestedCommand(rawCmd);
        const reason = content.split('$')[0].trim();
        return { command, reason };
      }
    }

    // Fallback: detect commands embedded in lines: "$ <command>", or starting with serpapi.* / tool.web.scrape* / x.*
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      let command: string | null = null;
      // match $ command at start OR anywhere in the line after some prose
      const mShell = line.match(/\$\s+(.+)$/);
      if (mShell) {
        command = normalizeSuggestedCommand(mShell[1]);
      } else {
        // Prefer extracting just the tool invocation substring rather than the whole line
        const toolSub = line.match(/(tool\.web\.scrape(?:\.pick)?[^\{\n]*\{[^\n]*\})/i);
        const serpSub = line.match(/(serpapi\.[^\s\n]+\s+.+)$/i);
        const xSub = line.match(/(x\.(?:search|lists|tweet|dm)[^\n]*)$/i);
        if (toolSub) {
          command = normalizeSuggestedCommand(toolSub[1]);
        } else if (serpSub) {
          command = normalizeSuggestedCommand(serpSub[1]);
        } else if (xSub) {
          command = normalizeSuggestedCommand(xSub[1]);
        }
      }
      if (command) {
        const reason = lines.slice(0, i).join(' ').trim();
        return { command, reason };
      }
    }
    return null;
  };

  // Parse free-form text to detect a SerpAPI intent and infer engine/query
  const parseSerpapiFromText = (text: string): { engine: string; query: string; extra?: Record<string, any> } | null => {
    const trimmed = text.trim();
    let m = trimmed.match(/^serpapi\.(\w+)\s+\"([^\"]+)\"$/i) || trimmed.match(/^serpapi\.(\w+)\s+(.+)$/i);
    if (m && m[1].toLowerCase() !== 'run') {
      const engine = m[1].toLowerCase();
      const query = (m[2] || '').trim();
      return { engine, query };
    }
    m = trimmed.match(/^@serpapi\s+(.+)$/i);
    if (m) {
      const rest = m[1].toLowerCase();
      if (rest.includes('bing') && rest.includes('images')) {
        const q = trimmed.replace(/.*images/i, '').trim();
        return { engine: 'bing_images', query: q };
      }
      if (rest.includes('google') && rest.includes('images')) {
        const q = trimmed.replace(/.*images/i, '').trim();
        return { engine: 'google_images', query: q };
      }
      if (rest.startsWith('yelp') || rest.includes(' yelp ')) {
        const q = trimmed.replace(/@serpapi/i, '').replace(/yelp/i, '').trim();
        return { engine: 'yelp', query: q };
      }
      if (rest.includes('news')) {
        const q = trimmed.replace(/@serpapi/i, '').replace(/news/i, '').trim();
        return { engine: 'google_news', query: q };
      }
      if (rest.includes('youtube')) {
        const q = trimmed.replace(/@serpapi/i, '').replace(/youtube/i, '').trim();
        return { engine: 'youtube', query: q };
      }
      const qDefault = trimmed.replace(/@serpapi/i, '').trim();
      if (qDefault) return { engine: 'google', query: qDefault };
    }
    return null;
  };

  // Use messages directly since streaming is now handled in the main messages array
  const allMessages = [...messages];
  
  // We render streaming via the main messages list only (no temporary overlays)

  // Sort by timestamp; if equal, ensure user appears before assistant
  allMessages.sort((a, b) => {
    const dt = a.timestamp.getTime() - b.timestamp.getTime();
    if (dt !== 0) return dt;
    if (a.role === 'user' && b.role !== 'user') return -1;
    if (b.role === 'user' && a.role !== 'user') return 1;
    return 0;
  });

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      <div className={cn(
        "flex-1 w-full pt-2 gap-2 pb-20 flex flex-col overflow-hidden",
        rightOpen ? "md:pr-[var(--sidebar-width)]" : "md:pr-0"
      )}>

        {/* Messages */}
        <div className="flex-1 flex flex-col min-h-0">
          <ScrollArea className="flex-1">
          {allMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50 animate-in fade-in-0 duration-700" style={{ animationDelay: '200ms' }} />
                <p className="text-lg font-medium animate-in fade-in-0 duration-700" style={{ animationDelay: '400ms' }}>Welcome to SuperAgent!</p>
                <p className="text-sm animate-in fade-in-0 duration-700" style={{ animationDelay: '600ms' }}>Start a conversation by typing a message below.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-0">
              {allMessages.map((message, idx) => {
                const hasSeen = seenMessageIdsRef.current.has(message.id);
                if (!hasSeen) {
                  seenMessageIdsRef.current.add(message.id);
                }
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
                          const mentioned = participantsRef.current.find(p => p.type === 'agent' && new RegExp(`@${p.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '')}`, 'i').test(messages.find(m => m.id === message.id)?.content || ''));
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
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
          </ScrollArea>
        </div>
      </div>


      {/* Right participants panel (fixed column; width mirrors ShadCN variable) */}
      <div className={`hidden md:block fixed inset-y-0 right-0 z-10 border-l bg-background transition-transform duration-200 ease-linear ${rightOpen ? 'translate-x-0' : 'translate-x-full'}`} style={{ width: 'var(--sidebar-width)' }}>
        <div className="h-12 px-3 flex items-center justify-between border-b">
          <div className="flex items-center gap-2 text-sm">
            <button className={`px-2 py-1 rounded ${rightTab === 'participants' ? 'bg-accent' : ''}`} onClick={() => setRightTab('participants')}>Participants</button>
            <button className={`px-2 py-1 rounded ${rightTab === 'tasks' ? 'bg-accent' : ''}`} onClick={() => setRightTab('tasks')}>Tasks{toolRuns.size > 0 ? ` (${[...toolRuns.values()].filter(r => r.status === 'running').length})` : ''}</button>
          </div>
          <div className="flex items-center gap-2">
            {rightTab === 'participants' && (
              <button
                aria-label="Add participant"
                onClick={() => setShowAddAgent(true)}
                className="size-6 inline-flex items-center justify-center rounded-md border bg-background hover:bg-accent text-foreground"
              >
                +
              </button>
            )}
            <button onClick={() => setRightOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
          </div>
        </div>
        <div className="p-3 space-y-2 overflow-y-auto h-[calc(100%-3rem)]">
          {rightTab === 'participants' ? (
            <>
              {participants.map((p) => (
                <div key={`${p.type}-${p.id}`} className="group flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                    {p.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs font-medium">{p.name?.charAt(0)?.toUpperCase() || '?'}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.type === 'agent' ? 'Agent' : 'User'}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className={`h-2 w-2 rounded-full ${p.status === 'online' ? 'bg-green-500' : p.status === 'away' ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                    {p.type === 'agent' && (
                      <button
                        onClick={() => {
                          // TODO: implement removeParticipant on socket; update local state for now
                          setParticipants(prev => prev.filter(participant => !(participant.type === 'agent' && participant.id === p.id)));
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-700 p-1"
                        title="Remove agent"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {participants.length === 0 && (
                <div className="text-xs text-muted-foreground">No participants</div>
              )}
              {/* Add Agent Modal */}
              <AddAgentModal
                open={showAddAgent}
                onClose={() => setShowAddAgent(false)}
                agents={allAgents}
                existingIds={new Set(participants.filter(p => p.type === 'agent').map(p => p.id))}
                onInvite={async (agentId) => {
                  const isChannel = !!agentMeta.name; // if currentRoom looks like an agent id
                  if (isChannel) {
                    // Navigate to multi-agent room with both agents
                    const multiRoomId = `${currentRoom}-${agentId}`;
                    window.location.href = `/c/${multiRoomId}`;
                    return;
                  }
                  // TODO: implement inviteParticipant on socket when we enable multi-agent rooms
                  // Optimistically add to participants list (for existing group rooms)
                  (async () => {
                    try {
                      const base = getHttpBaseFromWs(WEBSOCKET_URL);
                      const res = await fetch(`${base}/api/agents/${agentId}`);
                      if (res.ok) {
                        const data = await res.json();
                        const avatar = data.avatar as string | undefined;
                        const resolvedAvatar = avatar ? (avatar.startsWith('/') ? `${base}${avatar}` : avatar) : undefined;
                        setParticipants(prev => {
                          if (prev.some(p => p.type === 'agent' && p.id === agentId)) return prev;
                          return [...prev, { id: agentId, type: 'agent', name: data.name || 'Agent', avatar: resolvedAvatar, status: 'online' }];
                        });
                      }
                    } catch {}
                  })();
                  setShowAddAgent(false);
                }}
                search={agentSearch}
                setSearch={setAgentSearch}
                httpBase={getHttpBaseFromWs(WEBSOCKET_URL)}
              />
            </>
          ) : (
            <>
              {[...toolRuns.values()].reverse().map(run => {
                const icon = run.tool.startsWith('serpapi') || run.tool === 'serpapi' ? <Search className="h-3.5 w-3.5" /> : run.tool === 'web' ? <Globe2 className="h-3.5 w-3.5" /> : run.tool === 'elevenlabs' ? <Mic className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />;
                const meta: string[] = [];
                if (run.tool === 'serpapi') {
                  const engine = (run.args?.engine || 'google');
                  const q = (run.args?.query || '').toString();
                  meta.push(`${engine}`);
                  if (q) meta.push(q.slice(0, 60) + (q.length > 60 ? '…' : ''));
                } else if (run.tool === 'web' && run.args?.url) {
                  try { const u = new URL(run.args.url); meta.push(u.hostname); } catch { meta.push(String(run.args.url)); }
                } else if (run.tool === 'elevenlabs') {
                  if (run.args?.voiceId) meta.push(`voice=${run.args.voiceId}`);
                }
                const started = run.startedAt ? new Date(run.startedAt) : undefined;
                const duration = run.durationMs ? `${Math.max(1, Math.round(run.durationMs/1000))}s` : (run.status === 'running' && started ? `${Math.max(1, Math.round((Date.now()-run.startedAt)/1000))}s` : undefined);
                return (
                  <div key={run.toolCallId} className="border rounded p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {icon}
                        <div className="font-medium">{run.tool}.{run.func}</div>
                      </div>
                      <div className={`px-1 rounded ${run.status === 'running' ? 'bg-yellow-500/20 text-yellow-500' : run.status === 'succeeded' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>{run.status}</div>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-muted-foreground">
                      <div className="truncate">{meta.join(' · ')}</div>
                      {duration && <div className="ml-2 whitespace-nowrap">{duration}</div>}
                    </div>
                    <div className="mt-2">
                      <JsonFormatter 
                        data={run.args} 
                        title="Arguments" 
                        className="text-xs"
                        defaultExpanded={false}
                        showCopyButton={true}
                      />
                    </div>
                    {run.error && <div className="mt-1 text-red-500">error: {run.error}</div>}
                  </div>
                );
              })}
              {toolRuns.size === 0 && <div className="text-xs text-muted-foreground">No tasks yet</div>}
            </>
          )}
        </div>
      </div>

      {/* Footer input fixed to viewport bottom, responsive to both sidebars */}
      <ChatFooterBar
        rightOpen={rightOpen}
        onSendMessage={handleSendMessage}
        disabled={!isConnected}
        availableProviders={availableProviders}
      />
    </div>
  );
}

// Modal for selecting and adding agents to the room
function AddAgentModal({
  open,
  onClose,
  agents,
  existingIds,
  onInvite,
  search,
  setSearch,
  httpBase,
}: {
  open: boolean;
  onClose: () => void;
  agents: Array<{ id: string; name: string; avatar?: string }>;
  existingIds: Set<string>;
  onInvite: (agentId: string) => void;
  search: string;
  setSearch: (v: string) => void;
  httpBase: string;
}) {
  if (!open) return null;
  const filtered = agents
    .filter(a => !existingIds.has(a.id))
    .filter(a => (a.name || '').toLowerCase().includes(search.toLowerCase()) || a.id.includes(search));
  const resolveAvatar = (src?: string) => (src && src.startsWith('/') ? `${httpBase}${src}` : src);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] max-w-[92vw] bg-background border rounded-lg shadow-lg">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="text-sm font-medium">Add agent</div>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>
        <div className="p-3">
          <Input placeholder="Search agents…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-3 max-h-[360px] overflow-auto">
            <div className="space-y-1">
              {filtered.map(a => (
                <button key={a.id} onClick={() => onInvite(a.id)} className="w-full text-left border rounded p-2 hover:bg-accent">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      {a.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveAvatar(a.avatar)} alt={a.name} className="h-5 w-5 rounded-full object-cover" />
                      ) : (
                        <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
                          <span className="text-[10px] font-medium">{a.name?.charAt(0)?.toUpperCase() || '?'}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">{a.name || '(unnamed)'}</span>
                        <span className="text-[11px] text-muted-foreground">agent</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{a.id}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="text-xs text-muted-foreground">No agents available</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
