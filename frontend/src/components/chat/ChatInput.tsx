'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Send, Settings, Mic, ArrowUp, MoreHorizontal, Plus, Terminal } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface ChatInputProps {
  onSendMessage: (content: string, options?: {
    model?: string;
    provider?: string;
    temperature?: number;
  }) => void;
  disabled?: boolean;
  availableProviders?: string[];
  availableModels?: Array<{ name: string; provider: string; maxTokens: number }>;
  onTyping?: (event: 'start' | 'stop') => void;
  placeholderOverride?: string;
}

// Fallback static options if backend list is unavailable
const MODEL_OPTIONS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4.1', 'gpt-4.1-mini'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
  google: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro-latest', 'gemini-1.5-flash-8b'],
  xai: ['grok-beta', 'grok-2'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
};

export function ChatInput({ onSendMessage, disabled, availableProviders = [], availableModels = [], onTyping, placeholderOverride }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const [temperature, setTemperature] = useState([0.7]);
  const [terminalMode, setTerminalMode] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Keep the textarea one-line by default and auto-grow when needed
  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || disabled) return;

    const finalMessage = terminalMode && !message.startsWith('$') 
      ? `$${message.trim()}` 
      : message.trim();

    onSendMessage(finalMessage, {
      provider: selectedProvider,
      model: selectedModel,
      temperature: temperature[0],
    });
    
    setMessage('');
    setShowMentionMenu(false);
    setMentionQuery('');
    setMentionIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Mention menu navigation
    if (showMentionMenu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => i + 1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        insertSelectedMention();
        return;
      }
      if (e.key === 'Escape') { setShowMentionMenu(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const MENTION_ITEMS = [
    { id: 'terminal', label: '@terminal' },
    { id: 'mysql', label: '@mysql' },
    { id: 'postgres', label: '@postgres' },
    { id: 'pinecone', label: '@pinecone' },
    { id: 'serpapi', label: '@serpapi' },
    { id: 'elevenlabs', label: '@elevenlabs' },
    { id: 'twitter', label: '@twitter' },
    { id: 'gmail', label: '@gmail' },
    { id: 'contacts', label: '@contacts' },
    { id: 'files', label: '@files' },
  ];

  const filteredMentions = MENTION_ITEMS.filter(item =>
    item.label.slice(1).toLowerCase().startsWith(mentionQuery.toLowerCase())
  );

  const insertSelectedMention = () => {
    const item = filteredMentions[Math.min(mentionIndex, filteredMentions.length - 1)];
    if (!item) return;
    const idx = message.lastIndexOf('@');
    if (idx >= 0) {
      const next = message.slice(0, idx) + item.label + ' ' + message.slice(idx + 1 + mentionQuery.length);
      setMessage(next);
      setShowMentionMenu(false);
      setMentionQuery('');
      setMentionIndex(0);
    }
  };

  const onChangeMessage = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessage(val);
    resizeTextarea();
    try { if (val.trim().length > 0) onTyping?.('start'); else onTyping?.('stop'); } catch {}
    const caret = e.target.selectionStart ?? val.length;
    const atIdx = val.lastIndexOf('@', Math.max(0, caret - 1));
    if (atIdx >= 0) {
      const segment = val.slice(atIdx, caret);
      // Active mention only if no whitespace/newline between @ and caret
      if (!/\s/.test(segment)) {
        const before = val.slice(Math.max(0, atIdx - 1), atIdx);
        const validTrigger = atIdx === 0 || before === ' ' || before === '$';
        const query = segment.slice(1);
        const matches = MENTION_ITEMS.filter(item =>
          item.label.slice(1).toLowerCase().startsWith(query.toLowerCase())
        );
        // Show only when typing (query>=1) and either multiple options or not an exact single match
        const shouldShow = validTrigger && query.length >= 1 && matches.length > 0 && !(matches.length === 1 && matches[0].label.slice(1).toLowerCase() === query.toLowerCase());
        setShowMentionMenu(shouldShow);
        setMentionQuery(query);
        setMentionIndex(0);
        return;
      }
    }
    setShowMentionMenu(false);
    setMentionQuery('');
  };

  const providerModels = availableModels
    .filter(m => m.provider === selectedProvider)
    .map(m => m.name);

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={onChangeMessage}
              onKeyDown={handleKeyDown}
              placeholder={placeholderOverride || (terminalMode ? "Enter terminal command..." : "Ask anything")}
              rows={1}
              className="min-h-[40px] resize-none pr-20 pl-20 py-2 rounded-xl border border-border focus:border-ring focus:ring-0 text-[15px] leading-6 bg-background animate-glow"
              disabled={disabled}
            />

            {showMentionMenu && filteredMentions.length > 0 && (
              <div className="absolute left-20 bottom-12 z-20 w-56 rounded-md border bg-popover text-popover-foreground shadow-md">
                <ul className="max-h-60 overflow-auto py-1 text-sm">
                  {filteredMentions.map((item, i) => (
                    <li
                      key={item.id}
                      className={`px-3 py-1.5 cursor-pointer ${i === mentionIndex ? 'bg-muted' : ''}`}
                      onMouseEnter={() => setMentionIndex(i)}
                      onMouseDown={(e) => { e.preventDefault(); insertSelectedMention(); }}
                    >
                      <span className="font-semibold">{item.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* Plus button on the left */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-7 w-7 p-0 hover:bg-muted rounded-full transition-all duration-200"
            >
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>

            {/* Terminal mode toggle */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute left-11 top-1/2 -translate-y-1/2 h-7 w-7 p-0 hover:bg-muted rounded-full"
              onClick={() => setTerminalMode(!terminalMode)}
            >
              <Terminal className={`h-3.5 w-3.5 ${terminalMode ? 'text-purple-500' : 'text-muted-foreground'}`} />
            </Button>
            
            {/* LLM info and send button inside the input - only show when no text */}
            {!message.trim() && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-[11px] font-semibold text-muted-foreground hover:text-foreground p-0 h-auto"
                    >
                      {selectedModel}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="end">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Provider</Label>
                        <Select 
                          value={selectedProvider} 
                          onValueChange={(value) => {
                            setSelectedProvider(value);
                            const dynamic = availableModels.filter(m => m.provider === value).map(m => m.name);
                            const models = dynamic.length > 0 ? dynamic : (MODEL_OPTIONS[value as keyof typeof MODEL_OPTIONS] || []);
                            if (models && models.length > 0) setSelectedModel(models[0]);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {availableProviders.map((provider) => (
                              <SelectItem key={provider} value={provider}>
                                {provider.charAt(0).toUpperCase() + provider.slice(1)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Model</Label>
                        <Select value={selectedModel} onValueChange={setSelectedModel}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(providerModels.length > 0 ? providerModels : MODEL_OPTIONS[selectedProvider as keyof typeof MODEL_OPTIONS] || []).map((model) => (
                              <SelectItem key={model} value={model}>{model}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Temperature: {temperature[0]}</Label>
                        <Slider
                          value={temperature}
                          onValueChange={setTemperature}
                          min={0}
                          max={2}
                          step={0.1}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                
                <Button
                  type="submit"
                  disabled={disabled}
                  className="w-7 h-7 p-0 bg-primary hover:bg-primary/90 rounded-full transition-all duration-200"
                >
                  <ArrowUp className="h-3.5 w-3.5 text-primary-foreground" />
                </Button>
              </div>
            )}
          </div>
          
          {/* Send button - only show when there's text */}
          {message.trim() && (
            <Button 
              type="submit" 
              disabled={disabled}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 p-0 bg-primary hover:bg-primary/90 rounded-full z-10 transition-all duration-200 hover:scale-105 animate-in fade-in-0 duration-200"
            >
              <ArrowUp className="h-3.5 w-3.5 text-primary-foreground" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
