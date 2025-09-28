// Command router parses input text and returns a structured intent

export type Intent =
  | { type: 'terminal'; command: string }
  | { type: 'serpapi'; engine: string; query: string; extra?: Record<string, any> }
  | { type: 'x.search'; query: string }
  | { type: 'x.lists'; handle: string }
  | { type: 'tts'; text: string; voiceId?: string; format?: 'mp3'|'wav'|'ogg'|'webm' }
  | { type: 'message'; content: string };

export function parseInput(text: string): Intent {
  const content = text.trim();
  if (content.startsWith('$')) return { type: 'terminal', command: content };

  const m = content.match(/^serpapi\.(\w+)\s+"([^"]+)"$/i) || content.match(/^serpapi\.(\w+)\s+(.+)$/i);
  if (m && m[1].toLowerCase() !== 'run') {
    return { type: 'serpapi', engine: m[1].toLowerCase(), query: (m[2] || '').trim() };
  }

  const quickSerp = content.match(/^@serpapi\s+(.+)$/i);
  if (quickSerp) return { type: 'serpapi', engine: 'google', query: quickSerp[1].trim() };

  const x1 = content.match(/^@x\s+"([^"]+)"$/i) || content.match(/^@x\s+(.+)$/i);
  if (x1) return { type: 'x.search', query: (x1[1] || '').trim() };

  const xl = content.match(/^@x\.lists\s+(@?\w+)$/i);
  if (xl) return { type: 'x.lists', handle: xl[1] };

  const tts = content.match(/^@elevenlabs\s+"([^"]+)"(.*)$/i);
  if (tts) {
    const text = tts[1];
    const rest = (tts[2] || '').trim();
    const params: Record<string, string> = {};
    rest.split(/\s+/).forEach(p => { const m = p.match(/^(\w+)=([^\s]+)$/); if (m) params[m[1]] = m[2]; });
    const voiceId = params.voice || params.voiceId;
    const format = (params.format as any) || 'mp3';
    return { type: 'tts', text, voiceId, format };
  }

  return { type: 'message', content };
}

