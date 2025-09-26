export type CapabilityEntry = {
  tool: string;
  func: string;
  description?: string;
  tags?: string[];
  synonyms?: string[];
  sideEffects?: boolean;
  approval?: 'auto' | 'ask';
};

export type CapabilityRequest = {
  tags?: string[];
  synonyms?: string[];
  hint?: string;
  allowSideEffects?: boolean;
};

function toSet(arr?: string[]) {
  return new Set((arr || []).map((s) => s.toLowerCase()));
}

export function resolveCapability(
  catalog: CapabilityEntry[],
  req: CapabilityRequest,
  options?: { prefer?: Array<{ capability?: string[]; prefer?: string[]; approval?: 'auto'|'ask' }> }
): { tool: string; func: string } | null {
  const wantTags = toSet(req.tags);
  const wantSyn = toSet(req.synonyms);
  const hint = (req.hint || '').toLowerCase();

  let best: { entry: CapabilityEntry; score: number } | null = null;
  for (const entry of catalog) {
    if (!req.allowSideEffects && entry.sideEffects) continue;
    const entryTags = toSet(entry.tags);
    const entrySyn = toSet(entry.synonyms);

    let score = 0;
    // tag overlap
    for (const t of wantTags) if (entryTags.has(t)) score += 3;
    // synonym overlap
    for (const s of wantSyn) if (entrySyn.has(s)) score += 2;
    // hint substring matches
    if (hint) {
      if (entry.description && entry.description.toLowerCase().includes(hint)) score += 1;
      for (const t of entryTags) if (t.includes(hint)) score += 1;
      for (const s of entrySyn) if (s.includes(hint)) score += 1;
    }

    // Preference boost: if agent provided preferences and this tool appears under matching capability tags
    if (options?.prefer && options.prefer.length) {
      for (const pref of options.prefer) {
        const cap = toSet(pref.capability);
        const capsMatch = !cap.size || [...cap].some(c => entryTags.has(c));
        const preferList = (pref.prefer || []).map(s => s.toLowerCase());
        const ref = `${entry.tool}.${entry.func}`.toLowerCase();
        if (capsMatch && preferList.includes(ref)) score += 10; // strong preference boost
      }
    }

    if (!best || score > best.score) best = { entry, score };
  }

  if (!best || best.score <= 0) return null;
  return { tool: best.entry.tool, func: best.entry.func };
}


