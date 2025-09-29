'use client';

import React, { useEffect, useMemo, useState } from 'react';

type UnfurlData = {
  url: string;
  host: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
};

export function LinkPreview({ url }: { url: string }) {
  const [data, setData] = useState<UnfurlData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [_loading, setLoading] = useState(false);

  const safeUrl = useMemo(() => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
      return null;
    } catch {
      return null;
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!safeUrl) return;
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/unfurl?url=${encodeURIComponent(safeUrl)}`, { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled) {
          if (res.ok && json?.ok) setData(json as UnfurlData);
          else setError(json?.error || 'Failed to unfurl');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to unfurl');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [safeUrl]);

  if (!safeUrl) return null;
  if (error) return null;

  const title = data?.title || safeUrl;
  const description = data?.description;
  const image = data?.image;
  const host = data?.host || new URL(safeUrl).host;

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noreferrer"
      className="block border rounded-md p-3 mt-2 hover:bg-muted/60 transition-colors"
    >
      <div className="flex gap-3 items-start">
        {image ? (
          <img src={image} alt={title} className="w-16 h-16 rounded object-cover flex-shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">
            {host.replace(/^www\./, '')}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium line-clamp-1">{title}</div>
          {description && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{description}</div>
          )}
          <div className="text-xs text-muted-foreground mt-0.5">{host}</div>
        </div>
      </div>
    </a>
  );
}
