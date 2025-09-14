export function formatSerpListAsMarkdown(items: any[], title: string): string {
  const safe = (s: any) => String(s ?? '').replace(/\|/g, '\\|');
  if (!Array.isArray(items) || items.length === 0) return `${title}: No results.`;
  const rows = items.map((it: any, idx: number) => `| ${idx + 1} | ${safe(it.title || it.name || '(untitled)')} | ${safe(it.link || it.url || '')} |`);
  return `${title}:\n\n| # | Title | Link |\n|---:|---|---|\n${rows.join('\n')}`;
}

export function formatGoogleNewsMarkdown(newsItems: any[], sectionTitle = 'Google News'): string {
  if (!Array.isArray(newsItems) || newsItems.length === 0) return `${sectionTitle}: No results.`;

  const escapeMd = (s: any) => String(s ?? '')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\|/g, '\\|');

  const toStringSafe = (v: any): string => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
      // Common SERP shapes
      if (v.name) return String(v.name);
      if (v.publisher) return String(v.publisher);
      if (v.text) return String(v.text);
    }
    return '';
  };

  const toImageUrl = (n: any): string | undefined => {
    const th = toStringSafe(n.thumbnail);
    if (th) return th;
    if (Array.isArray(n.images) && n.images.length) {
      const first = n.images[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && first.src) return String(first.src);
      if (first && typeof first === 'object' && first.url) return String(first.url);
    }
    if (toStringSafe(n.image)) return String(n.image);
    return undefined;
  };

  const blocks = newsItems.slice(0, 10).map((n: any) => {
    const title = escapeMd(toStringSafe(n.title) || '(untitled)');
    const url = toStringSafe(n.link) || toStringSafe(n.url) || toStringSafe(n.redirect_link) || '';
    const source = escapeMd(toStringSafe(n.source) || toStringSafe(n.displayed_link) || toStringSafe(n.author) || '');
    const when = toStringSafe(n.date) || toStringSafe(n.date_ago) || toStringSafe(n.published) || toStringSafe(n.time) || '';
    const dateStr = when ? ` — ${escapeMd(when)}` : '';
    const snippet = escapeMd(toStringSafe(n.snippet) || toStringSafe(n.description) || '');
    const image = toImageUrl(n);

    // Create side-by-side layout: image on left, content on right
    const contentLines: string[] = [];
    contentLines.push(`**${title}**`);
    if (source || dateStr) contentLines.push(`${source}${dateStr}`.trim());
    if (url) contentLines.push(`[View](${url})`);
    
    const contentBlock = contentLines.join('\n\n');
    
    if (image) {
      return `![image](${image})\n${contentBlock}`;
    } else {
      return contentBlock;
    }
  });

  return `${sectionTitle}:\n\n${blocks.join('\n\n---\n\n')}`;
}


