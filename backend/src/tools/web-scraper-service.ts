import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

export type ScrapeResult = {
  url: string;
  contentType: string;
  title?: string;
  text?: string;
  html?: string;
  links?: Array<{ href: string; text?: string }>;
  images?: Array<{ src: string; alt?: string }>;
  meta?: Record<string, string>;
};

function absoluteUrl(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

async function toTextFromPDF(buffer: Buffer): Promise<string | undefined> {
  try {
    // lazy import to avoid bundling when unused
    const pdfParse = (await import('pdf-parse')).default as (b: Buffer) => Promise<{ text: string }>;
    const out = await pdfParse(buffer);
    return out.text?.trim() || undefined;
  } catch (e) {
    console.error('[scraper] pdf-parse error:', e);
    return undefined;
  }
}

class WebScraperService {
  private defaultHeaders: Record<string, string> = {
    // Mimic a modern browser more closely to reduce simple blocks
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
  };

  async scrape(url: string): Promise<ScrapeResult> {
    const fetchWithTimeout = async (resource: string, options: any, timeoutMs: number): Promise<Response> => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(resource, { ...(options || {}), signal: controller.signal });
        return res as any;
      } finally {
        clearTimeout(id);
      }
    };

    // Helper: fallback via readable proxy when sites send oversized headers or block bots
    const fallbackViaJina = async (): Promise<ScrapeResult> => {
      try {
        const jinaUrl = `https://r.jina.ai/${url.startsWith('http') ? url : `http://${url}`}`;
        const jres = await fetch(jinaUrl, { headers: { 'user-agent': this.defaultHeaders['user-agent'] } as any });
        if (jres.ok) {
          const jtext = await jres.text();
          const lines = jtext.split(/\n+/);
          const titleLine = (lines[0] || '').trim();
          return {
            url,
            contentType: 'text/plain; proxy=r.jina.ai',
            title: titleLine && titleLine.length < 120 ? titleLine : undefined,
            text: jtext.trim(),
            html: undefined,
            links: [],
            images: [],
            meta: { proxy: 'r.jina.ai' },
          };
        }
      } catch {}
      throw new Error('Fetch failed and proxy fallback unavailable');
    };

    // Attempt 1: normal fetch with browsery headers
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { headers: this.defaultHeaders as any, redirect: 'follow' }, 12000);
    } catch (e: any) {
      // Some sites (e.g., Yahoo Finance) return extremely large headers causing undici to throw before a response exists
      if (e?.name === 'AbortError' || e?.code === 'UND_ERR_HEADERS_OVERFLOW' || /Headers\s+Overflow/i.test(String(e?.message || e))) {
        return await fallbackViaJina();
      }
      throw e;
    }
    let contentType = (res.headers.get('content-type') || '').toLowerCase();

    // If blocked, Attempt 2: retry with additional headers (referer)
    if (!res.ok && [403, 406, 451].includes(res.status)) {
      try {
        const retryHeaders = {
          ...this.defaultHeaders,
          referer: new URL(url).origin + '/',
        } as any;
        try {
          res = await fetchWithTimeout(url, { headers: retryHeaders, redirect: 'follow' }, 12000);
          contentType = (res.headers.get('content-type') || '').toLowerCase();
        } catch (e: any) {
          if (e?.name === 'AbortError' || e?.code === 'UND_ERR_HEADERS_OVERFLOW' || /Headers\s+Overflow/i.test(String(e?.message || e))) {
            return await fallbackViaJina();
          }
          throw e;
        }
      } catch {}
    }

    // If still blocked, Attempt 3: use readable proxy (r.jina.ai)
    if (!res.ok && [403, 406, 451].includes(res.status)) {
      try { return await fallbackViaJina(); } catch {}
    }

    // If slow 301/302 chains or non-OK statuses persist, fallback to proxy to avoid hanging the UI
    try {
      if (!res.ok) return await fallbackViaJina();
    } catch {}

    if (!res.ok) {
      throw new Error(`Fetch failed (${res.status}) for ${url}`);
    }

    // PDFs
    if (contentType.includes('application/pdf')) {
      const buf = Buffer.from(await res.arrayBuffer());
      const text = await toTextFromPDF(buf);
      return {
        url,
        contentType,
        title: undefined,
        text,
        html: undefined,
        links: [],
        images: [],
        meta: {},
      };
    }

    // HTML
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      const html = await res.text();
      // Metadata and fallbacks via cheerio
      const $ = cheerio.load(html);
      const meta: Record<string, string> = {};
      $('meta').each((_, el) => {
        const name = $(el).attr('name') || $(el).attr('property');
        const content = $(el).attr('content');
        if (name && content) meta[name.toLowerCase()] = content;
      });
      const ogTitle = meta['og:title'] || $('title').text().trim();

      // Readability main content via JSDOM
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      const mainText = article?.textContent?.trim();
      const mainHTML = article?.content || undefined;

      // Links and images
      const links: Array<{ href: string; text?: string }> = [];
      $('a[href]').slice(0, 200).each((_, a) => {
        const href = absoluteUrl(url, $(a).attr('href') || '');
        const t = $(a).text().trim();
        if (href) links.push({ href, text: t || undefined });
      });
      const images: Array<{ src: string; alt?: string }> = [];
      $('img').slice(0, 100).each((_, img) => {
        const src = absoluteUrl(url, $(img).attr('src') || '');
        const alt = ($(img).attr('alt') || '').trim();
        if (src) images.push({ src, alt: alt || undefined });
      });

      return {
        url,
        contentType,
        title: article?.title || ogTitle || undefined,
        text: mainText || undefined,
        html: mainHTML,
        links,
        images,
        meta,
      };
    }

    // Plain text or other
    const text = await res.text();
    return {
      url,
      contentType,
      title: undefined,
      text: text?.trim() || undefined,
      html: undefined,
      links: [],
      images: [],
      meta: {},
    };
  }
}

export const webScraperService = new WebScraperService();
