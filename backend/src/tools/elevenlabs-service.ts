export class ElevenLabsService {
  private apiKey: string | undefined;
  private voicesCache: { fetchedAt: number; byName: Map<string,string>; list: Array<{ voice_id: string; name: string }>; } | null = null;

  constructor() {
    this.apiKey = process.env.ELEVENLAB_API_KEY || process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_KEY || process.env.ELEVEN_LABS_API_KEY;
  }

  private getKey(): string {
    const k = process.env.ELEVENLAB_API_KEY || process.env.ELEVENLABS_API_KEY || this.apiKey;
    if (!k) throw new Error('Missing ELEVENLAB_API_KEY');
    return k;
  }

  private sanitize(input?: string): string | undefined {
    if (!input) return input;
    let s = input.trim();
    // normalize smart quotes
    s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, '\'');
    // strip surrounding quotes
    s = s.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
    return s.trim();
  }

  private async fetchVoices(): Promise<Array<{ voice_id: string; name: string }>> {
    const now = Date.now();
    if (this.voicesCache && now - this.voicesCache.fetchedAt < 1000 * 60 * 30) {
      return this.voicesCache.list;
    }
    const key = this.getKey();
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': key },
    } as any);
    if (!res.ok) {
      // fallback to empty; tts will use default voice name when voices cannot be fetched
      this.voicesCache = { fetchedAt: now, byName: new Map(), list: [] };
      return [];
    }
    const json: any = await res.json();
    const list: Array<{ voice_id: string; name: string }> = Array.isArray(json?.voices) ? json.voices.map((v: any) => ({ voice_id: v.voice_id, name: v.name })) : [];
    const byName = new Map<string,string>();
    list.forEach(v => byName.set(v.name.toLowerCase(), v.voice_id));
    this.voicesCache = { fetchedAt: now, byName, list };
    return list;
  }

  private async resolveVoiceId(input?: string): Promise<string> {
    const cleaned = this.sanitize(input);
    // Known aliases mapping to common voices
    const KNOWN_VOICES: Record<string,string> = {
      // common public demo voice IDs from ElevenLabs docs/examples
      'rachel': '21m00Tcm4TlvDq8ikWAM',
      'antoni': 'ErXwobaYiN019PkySvjV',
      'brian': 'nPczCjzI2devNBz1zQrb',
      'adam': 'pNInz6obpgDQGcFmaJgB',
    };
    const aliases: Record<string,string> = {
      'dark_voice': 'antoni',
      'deep_male': 'antoni',
      'deep_voice': 'antoni',
      'deep': 'antoni',
      'dark': 'antoni',
      'baritone': 'antoni',
      'bass': 'antoni',
      'male_deep': 'antoni',
      'male_deep_voice': 'antoni',
      'male': 'antoni',
      'female': 'rachel',
      'news_anchor': 'brian',
      'anchor': 'brian',
      'narrator': 'adam',
    };
    const nameOrAlias = cleaned ? cleaned.toLowerCase() : '';
    const normalizedAliasKey = nameOrAlias.replace(/\s+/g, '_').replace(/-/g, '_');
    const aliasKey = aliases[nameOrAlias] || aliases[normalizedAliasKey];
    if (aliasKey && KNOWN_VOICES[aliasKey]) return KNOWN_VOICES[aliasKey];
    if (KNOWN_VOICES[nameOrAlias]) return KNOWN_VOICES[nameOrAlias];
    if (KNOWN_VOICES[normalizedAliasKey]) return KNOWN_VOICES[normalizedAliasKey];
    let candidate = cleaned;
    if (!candidate) return KNOWN_VOICES['antoni'];
    // If candidate looks like a UUID, return as-is
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) {
      return candidate;
    }
    // Try match by name from voices list
    const voices = await this.fetchVoices();
    if (voices.length) {
      // exact (case-insensitive)
      const exact = voices.find(v => v.name.toLowerCase() === candidate!.toLowerCase());
      if (exact) return exact.voice_id;
      // partial contains
      const partial = voices.find(v => v.name.toLowerCase().includes(candidate!.toLowerCase()));
      if (partial) return partial.voice_id;
    }
    // Fallback to a sensible default (prefer deep voice)
    return KNOWN_VOICES['antoni'];
  }

  async tts(text: string, voiceId: string = 'Antoni', format: 'mp3' | 'wav' = 'mp3'): Promise<{ buffer: Buffer; contentType: string }>
  {
    const key = this.getKey();
    const resolvedVoiceId = await this.resolveVoiceId(voiceId);
    try { console.log(`[elevenlabs] requestedVoice=${voiceId} resolvedVoiceId=${resolvedVoiceId}`); } catch {}
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolvedVoiceId)}`;
    const body = {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      output_format: format,
    } as any;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        'Accept': format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      },
      body: JSON.stringify(body),
    } as any);
    if (!res.ok) {
      const textErr = await res.text();
      throw new Error(`ElevenLabs error ${res.status}: ${textErr}`);
    }
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const contentType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
    return { buffer, contentType };
  }
}

export const elevenLabsService = new ElevenLabsService();


