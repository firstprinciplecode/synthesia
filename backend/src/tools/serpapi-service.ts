export interface SerpApiResultItem {
  title: string;
  link: string;
  snippet?: string;
}

class SerpApiService {
  private apiKey: string | undefined;
  private enginesCache: { fetchedAt: number; data: any[] } | null = null;

  constructor() {
    this.apiKey = process.env.SERPAPI_KEY;
  }

  private resolveApiKey(): string | undefined {
    // Resolve at call-time to avoid early-import ordering issues
    return process.env.SERPAPI_KEY || this.apiKey;
  }

  private async fetchEngines(): Promise<any[]> {
    const now = Date.now();
    if (this.enginesCache && now - this.enginesCache.fetchedAt < 1000 * 60 * 30) {
      return this.enginesCache.data;
    }
    try {
      const res = await fetch('https://serpapi.com/engines.json');
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const list = Array.isArray(json) ? json : [];
      this.enginesCache = { fetchedAt: now, data: list };
      return list;
    } catch {
      return this.enginesCache?.data || [];
    }
  }

  private async detectQueryKey(engine: string, fallback: string, extra?: Record<string, string | number>): Promise<string> {
    if (extra && typeof extra.query_key === 'string' && (extra.query_key as string).length > 0) {
      return String(extra.query_key);
    }
    // Static known mappings
    const staticMap: Record<string, string> = {
      google: 'q',
      google_images: 'q',
      google_finance: 'q',
      bing_images: 'q',
      youtube: 'search_query',
      ebay: '_nkw',
      walmart: 'query',
      yelp: 'find_desc',
      patents: 'q',
      google_news: 'q',
      google_maps: 'q',
    };
    if (staticMap[engine]) return staticMap[engine];

    // Try dynamic metadata
    try {
      const engines = await this.fetchEngines();
      const meta = engines.find((e: any) => e.engine === engine);
      const params: any[] = Array.isArray(meta?.parameters) ? meta.parameters : [];
      const preferred = ['q', 'query', 'search_query', '_nkw', 'keyword', 'keywords', 'term', 'text', 'find_desc'];
      for (const key of preferred) {
        if (params.some((p: any) => p.name === key)) return key;
      }
      // fallback: first parameter including 'query'
      const queryLike = params.find((p: any) => typeof p.name === 'string' && p.name.toLowerCase().includes('query'));
      if (queryLike?.name) return queryLike.name;
    } catch {}
    return fallback;
  }

  async searchGoogle(query: string, opts?: { num?: number; location?: string; }): Promise<{ items: SerpApiResultItem[]; raw: any; }> {
    const key = this.resolveApiKey();
    if (!key) {
      throw new Error('Missing SERPAPI_KEY');
    }

    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: key,
      num: String(opts?.num ?? 5),
    });
    if (opts?.location) params.set('location', opts.location);

    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SerpAPI error ${res.status}: ${text}`);
    }
    const json: any = await res.json();

    const organic: any[] = Array.isArray(json.organic_results) ? json.organic_results : [];
    const items: SerpApiResultItem[] = organic.slice(0, opts?.num ?? 5).map((r: any) => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet,
    }));

    return { items, raw: json };
  }

  async searchGoogleImages(query: string, opts?: { num?: number; }): Promise<{ items: { title: string; image: string; source: string; }[]; raw: any; }> {
    const key = this.resolveApiKey();
    if (!key) {
      throw new Error('Missing SERPAPI_KEY');
    }

    const params = new URLSearchParams({
      engine: 'google_images',
      q: query,
      api_key: key,
      num: String(opts?.num ?? 6),
    });

    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SerpAPI error ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    const images: any[] = Array.isArray(json.images_results) ? json.images_results : [];
    const items = images.slice(0, opts?.num ?? 6).map((r: any) => ({
      title: r.title || r.source || 'Image',
      image: r.original || r.thumbnail,
      source: r.link || r.source,
    }));
    return { items, raw: json };
  }

  formatAsMarkdown(items: SerpApiResultItem[], query: string): string {
    if (!items.length) return `No results for "${query}".`;
    const lines = items.map((it, idx) => `- ${idx + 1}. [${it.title}](${it.link})${it.snippet ? ` — ${it.snippet}` : ''}`);
    return lines.join('\n');
  }

  formatImagesAsMarkdown(items: { title: string; image: string; source: string; }[], query: string): string {
    if (!items.length) return `No images found for "${query}".`;
    const lines = items.map((it, idx) => `- ${idx + 1}. ${it.title}\n\n![${it.title}](${it.image})\n\n[Source](${it.source})`);
    return lines.join('\n\n');
  }

  private formatGoogleFinanceMarkdown(raw: any, query: string): string | null {
    try {
      const buckets = raw?.markets;
      let markets: any[] = [];
      if (Array.isArray(buckets)) {
        markets = buckets;
      } else if (buckets && typeof buckets === 'object') {
        // Flatten region/category buckets like { us: [...], crypto: [...], ... }
        for (const val of Object.values(buckets)) {
          if (Array.isArray(val)) markets.push(...val);
          else if (val && typeof val === 'object') {
            for (const v of Object.values(val)) {
              if (Array.isArray(v)) markets.push(...v);
            }
          }
        }
      }
      if (!markets.length) return null;
      // Pick the first market block that matches query loosely
      const m = markets.find((mk: any) => {
        const n = (mk?.name || mk?.ticker || mk?.title || '').toLowerCase();
        const ql = String(query || '').toLowerCase();
        return n.includes(ql) || /\bbtc\b|bitcoin/.test(ql) && (n.includes('btc') || n.includes('bitcoin'))
          || /\beth\b|ethereum/.test(ql) && (n.includes('eth') || n.includes('ethereum'))
          || /solana|\bsol\b/.test(ql) && (n.includes('sol') || n.includes('solana'))
          || /doge|dogecoin/.test(ql) && (n.includes('doge') || n.includes('dogecoin'));
      }) || markets[0];
      const name = m?.name || m?.title || 'Instrument';
      const ticker = m?.ticker || m?.symbol || m?.stock || '';
      const price = m?.price || m?.last || m?.regular_market_price || m?.current_price || m?.price_last || m?.price_now || '';
      const currency = m?.currency || m?.price_currency || '';
      const change = m?.change || m?.price_change || m?.regular_market_change || m?.price_movement?.value || '';
      const changePct = m?.change_percent || m?.price_change_percent || m?.regular_market_change_percent || (m?.price_movement?.percentage != null ? (m.price_movement.percentage*100).toFixed(2) + '%' : '');
      const time = m?.price_time || m?.timestamp || m?.updated || m?.last_trade_time || '';

      const fmt = (v: any) => (v === undefined || v === null || v === '') ? '-' : String(v);
      const title = `${name}${ticker ? ` (${ticker})` : ''}`;
      const rows = [
        `| Metric | Value |`,
        `|---|---|`,
        `| Price | ${fmt(price)} ${currency ? currency : ''} |`,
        `| Change | ${fmt(change)} |`,
        `| Change % | ${fmt(changePct)} |`,
        `| Time | ${fmt(time)} |`,
      ];
      return `Google Finance for "${query}":\n\n**${title}**\n\n${rows.join('\n')}`;
    } catch {
      return null;
    }
  }

  private formatProductsMarkdown(raw: any, query: string): string | null {
    const collect = (arr: any[]) => arr
      .filter(Boolean)
      .map((r: any) => ({
        title: r.title || r.name || r.product_title || 'Item',
        link: r.link || r.product_link || r.url,
        image: r.thumbnail || r.image || r.product_photos?.[0]?.link,
        price: r.price || r.extracted_price || r.price_str || r.current_price,
        rating: r.rating || r.stars,
        source: r.source || r.seller || r.store || r.domain,
      }))
      .filter((r: any) => r.title && r.link && r.image);

    const pools: any[] = [];
    if (Array.isArray(raw.shopping_results)) pools.push(...raw.shopping_results);
    if (Array.isArray(raw.organic_results)) pools.push(...raw.organic_results);
    if (Array.isArray(raw.results)) pools.push(...raw.results);
    if (Array.isArray(raw.items)) pools.push(...raw.items);
    const items = collect(pools).slice(0, 6);
    if (!items.length) return null;
    const lines = items.map((it: any, idx: number) => {
      const meta: string[] = [];
      if (it.price) meta.push(String(it.price));
      if (it.rating) meta.push(`${it.rating}★`);
      if (it.source) meta.push(String(it.source));
      const metaStr = meta.length ? ` — ${meta.join(' · ')}` : '';
      return `- ${idx + 1}. [${it.title}](${it.link})${metaStr}\n\n![${it.title}](${it.image})`;
    });
    return `Results for "${query}":\n\n${lines.join('\n\n')}`;
  }

  async run(engine: string, query: string, extra?: Record<string, string | number>): Promise<{ markdown: string; raw: any; }> {
    const key = this.resolveApiKey();
    if (!key) {
      throw new Error('Missing SERPAPI_KEY');
    }
    // Determine engine-specific query key
    const queryKey = await this.detectQueryKey(engine, 'q', extra);

    // Engine-specific query normalization
    let q = query;
    const localParams: Record<string, string> = {};
    if (engine === 'yelp') {
      // Yelp needs `find_loc`. Try to infer location from phrasing or final capitalized tokens.
      // Normalize trailing punctuation for matching.
      const qTrim = q.trim();
      const qNoPunctEnd = qTrim.replace(/[?!.,]+\s*$/,'');
      // Support "in|near|for <location>" at end
      const m = qNoPunctEnd.match(/\s(?:in|near|for)\s+([A-Za-z0-9 ,.'\-]+)$/i);
      if (m && !String(extra?.find_loc || '').trim()) {
        const loc = m[1].trim();
        if (loc) {
          localParams['find_loc'] = loc;
          q = qNoPunctEnd.slice(0, m.index).trim();
        }
      }
      // If still no location, try naive city extraction by last capitalized token(s), allowing punctuation at end
      if (!localParams['find_loc']) {
        const m2 = qNoPunctEnd.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)$/);
        const cityGuess = m2 ? m2[1] : undefined;
        if (cityGuess) {
          localParams['find_loc'] = cityGuess;
          q = qNoPunctEnd.replace(cityGuess, '').trim();
        }
      }
    } else if (engine === 'google_finance') {
      // Normalize common crypto names to tickers to improve hit rate
      const ql = q.toLowerCase();
      if (/\bbitcoin\b|\bbtc\b/.test(ql)) q = 'BTC';
      else if (/\bethereum\b|\beth\b/.test(ql)) q = 'ETH';
      else if (/solana|\bsol\b/.test(ql)) q = 'SOL';
      else if (/dogecoin|\bdoge\b/.test(ql)) q = 'DOGE';
    }

    const params = new URLSearchParams({ engine, api_key: key });
    params.set(queryKey, q);
    // Also include a generic 'q' when the engine expects something else, for safety
    if (queryKey !== 'q') params.set('q', q);
    for (const [k, v] of Object.entries(localParams)) {
      params.set(k, v);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
    }
    const url = `https://serpapi.com/search.json?${params.toString()}`;
    // Console output: mask api_key in logs
    const safeUrl = url.replace(/(api_key=)[^&]+/i, '$1***');
    const safeParams = Object.fromEntries(params.entries());
    if (safeParams.api_key) safeParams.api_key = '***';
    console.log('[serpapi] URL:', safeUrl);
    console.log('[serpapi] Params:', safeParams);
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SerpAPI error ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    // Console output: small raw payload summary for diffing
    try {
      const keys = Object.keys(json || {});
      console.log('[serpapi] Response keys:', keys.slice(0, 12));
      if (Array.isArray(json.organic_results)) console.log('[serpapi] organic_results:', json.organic_results.length);
      if (Array.isArray(json.images_results)) console.log('[serpapi] images_results:', json.images_results.length);
      if (Array.isArray(json.news_results)) console.log('[serpapi] news_results:', json.news_results.length);
      if (Array.isArray(json.video_results)) console.log('[serpapi] video_results:', json.video_results.length);
      if (Array.isArray(json.shopping_results)) console.log('[serpapi] shopping_results:', json.shopping_results.length);
    } catch {}
    // Optional HTML/snippet logging for debugging parity
    try {
      if (Array.isArray(json.organic_results)) {
        const sample = json.organic_results.slice(0, 2).map((r: any) => ({ title: r.title, link: r.link, snippet: r.snippet, rich_snippet: r.rich_snippet }));
        console.log('[serpapi] organic sample:', JSON.stringify(sample, null, 2));
      }
      if (Array.isArray(json.inline_images) && json.inline_images.length) {
        console.log('[serpapi] inline_images sample:', JSON.stringify(json.inline_images.slice(0, 2), null, 2));
      }
      if (json.html && typeof json.html === 'string') {
        console.log('[serpapi] html length:', json.html.length);
      }
    } catch {}
    let markdown = '';
    // Yelp-specific normalization (local results) with optional images
    if (engine === 'yelp') {
      const pools: any[] = [];
      if (Array.isArray(json.search_results)) pools.push(...json.search_results);
      if (Array.isArray(json.local_results)) pools.push(...json.local_results);
      if (Array.isArray(json.results)) pools.push(...json.results);
      if (json.local_results && Array.isArray(json.local_results.places)) pools.push(...json.local_results.places);
      const rich = pools
        .filter(Boolean)
        .map((r: any) => {
          const title = r.title || r.name || r.business_name || r.alias || 'Result';
          const link = r.link || r.url || r.website || r.share_link || '';
          const parts: string[] = [];
          const rating = r.rating || r.rating_score || r.stars;
          const reviews = r.reviews || r.review_count;
          const price = r.price || r.price_level;
          const address = r.address || r.address_full || r.location || r.address_line || '';
          if (rating) parts.push(`${rating}★${reviews ? ` (${reviews})` : ''}`);
          if (price) parts.push(String(price));
          if (address) parts.push(String(address));
          const snippet = parts.join(' · ');
          const image = r.thumbnail || r.image || r.photo || (Array.isArray(r.photos) ? (r.photos[0]?.thumbnail || r.photos[0]?.image) : undefined) || '';
          return link ? { title, link, snippet, image } : null;
        })
        .filter(Boolean) as Array<{ title: string; link: string; snippet?: string; image?: string }>;
      if (rich.length) {
        const n = Number(extra?.num ?? 5);
        const lines = rich.slice(0, n).map((it, idx) => `- ${idx + 1}. [${it.title}](${it.link})${it.snippet ? ` — ${it.snippet}` : ''}${it.image ? `\n\n![${it.title}](${it.image})` : ''}`);
        markdown = lines.join('\n');
        return { markdown, raw: json };
      }
    }
    // Engine-specific product formatting (eBay, shopping, etc.)
    if (engine.includes('ebay') || Array.isArray(json.shopping_results)) {
      const md = this.formatProductsMarkdown(json, query);
      if (md) return { markdown: md, raw: json };
    }

    if (engine === 'google_finance') {
      const md = this.formatGoogleFinanceMarkdown(json, query);
      if (md) return { markdown: md, raw: json };
    }
    if (Array.isArray(json.organic_results) && json.organic_results.length) {
      const items = json.organic_results.slice(0, Number(extra?.num ?? 5)).map((r: any) => ({ title: r.title, link: r.link, snippet: r.snippet }));
      markdown = this.formatAsMarkdown(items, query);
    } else if (Array.isArray(json.images_results) && json.images_results.length) {
      const items = json.images_results.slice(0, Number(extra?.num ?? 6)).map((r: any) => ({ title: r.title || r.source || 'Image', image: r.original || r.thumbnail, source: r.link || r.source }));
      markdown = this.formatImagesAsMarkdown(items, query);
    } else if (Array.isArray(json.news_results) && json.news_results.length) {
      const norm = (v: any) => typeof v === 'string' ? v : (v && typeof v.name === 'string' ? v.name : '');
      const pickDate = (n: any) => {
        const d = n.date || n.published_at || n.date_published || n.date_utc || n.updated_at;
        return typeof d === 'string' ? d : '';
      };
      const lines = json.news_results
        .slice(0, Number(extra?.num ?? 5))
        .map((n: any, idx: number) => {
          const title = n.title || n.heading || 'Untitled';
          const link = n.link || n.url || '';
          const source = norm(n.source);
          const dateStr = pickDate(n);
          const suffix = [source, dateStr ? `(${dateStr})` : ''].filter(Boolean).join(' ');
          return `- ${idx + 1}. [${title}](${link})${suffix ? ` — ${suffix}` : ''}`;
        });
      markdown = `SERPAPI news for "${query}":\n\n${lines.join('\n')}`;
    } else if (Array.isArray(json.video_results) && json.video_results.length) {
      const vids = json.video_results.slice(0, Number(extra?.num ?? 10));
      const lines = vids.map((v: any, idx: number) => {
        const thumb = v.thumbnail || v.rich_thumbnail || v.rich_snippet?.top?.extensions?.find?.((x: any) => typeof x === 'string' && x.startsWith('http')) || '';
        const title = v.title || 'Video';
        const link = v.link || v.url || v.channel?.link || '';
        const platform = v.platform || '';
        const thumbLine = thumb ? `\n\n![${title}](${thumb})` : '';
        return `- ${idx + 1}. [${title}](${link}) — ${platform}${thumbLine}`;
      });
      markdown = `SERPAPI videos for "${query}":\n\n${lines.join('\n\n')}`;
    } else if (Array.isArray(json.shopping_results) && json.shopping_results.length) {
      const lines = json.shopping_results.slice(0, Number(extra?.num ?? 5)).map((s: any, idx: number) => `- ${idx + 1}. ${s.title} — ${s.price ? s.price : ''} ${s.link ? `[link](${s.link})` : ''}`);
      markdown = `SERPAPI shopping for "${query}":\n\n${lines.join('\n')}`;
    } else {
      markdown = 'No structured results; showing raw JSON summary.';
    }
    return { markdown, raw: json };
  }
}

export const serpapiService = new SerpApiService();


