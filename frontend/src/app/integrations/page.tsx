'use client';

import Link from 'next/link';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import React from 'react';

const GROUPS: Array<{ name: string; engines: string[] }> = [
  { name: 'Web', engines: ['google', 'google_news', 'google_images', 'google_maps', 'bing_images'] },
  { name: 'Video', engines: ['youtube'] },
  { name: 'Commerce', engines: ['ebay', 'walmart'] },
  { name: 'Local', engines: ['yelp'] },
  { name: 'Research', engines: ['patents'] },
];

export default function IntegrationsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Integrations</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="p-4 space-y-6">
          <h1 className="text-base font-semibold">Tools & APIs</h1>
          <section>
            <h2 className="text-sm font-semibold">SerpAPI Engines</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {GROUPS.map((group) => (
                <div key={group.name} className="border rounded-md p-3">
                  <div className="text-xs font-semibold mb-2">{group.name}</div>
                  <ul className="space-y-1 text-sm">
                    {group.engines.map((e) => (
                      <li key={e} className="flex items-center justify-between">
                        <span className="font-medium">{e}</span>
                        <span className="text-xs text-muted-foreground">serpapi.{e}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Tip: Use <code className="px-1 py-0.5 rounded bg-muted">serpapi.&lt;engine&gt; "query"</code> or <code className="px-1 py-0.5 rounded bg-muted">@serpapi …</code> in chat.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-semibold mt-6">Audio (ElevenLabs)</h2>
            <div className="border rounded-md p-3 space-y-2 text-sm">
              <div className="text-xs text-muted-foreground">Text-to-Speech</div>
              <div className="flex items-center justify-between">
                <span className="font-medium">elevenlabs.tts</span>
                <span className="text-xs text-muted-foreground">tool.elevenlabs.tts</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Examples:
                <div className="mt-1">
                  <code className="px-1 py-0.5 rounded bg-muted">elevenlabs.tts "Hello world" voice=Rachel format=mp3</code>
                </div>
                <div className="mt-1">
                  <code className="px-1 py-0.5 rounded bg-muted">@elevenlabs "Read this aloud" voice=Rachel</code>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">Requires ELEVENLAB_API_KEY in backend .env</div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold mt-6">X (Twitter)</h2>
            <XIntegrationCard />
          </section>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function XIntegrationCard() {
  const [status, setStatus] = React.useState<{ connected: boolean; user?: any; scope?: string | null } | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const base = getBackendHttpBase();
    fetch(`${base}/api/integrations/x/status`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  function getBackendHttpBase() {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || '';
    try {
      const u = new URL(wsUrl);
      return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
    } catch {
      return 'http://127.0.0.1:3001';
    }
  }

  const connect = async () => {
    setLoading(true);
    try {
      const base = getBackendHttpBase();
      const res = await fetch(`${base}/api/integrations/x/start`);
      const json = await res.json();
      if (json.url) {
        const w = window.open(json.url, 'x-oauth', 'width=600,height=800');
        const timer = setInterval(async () => {
          if (w && w.closed) {
            clearInterval(timer);
            const st = await fetch(`${base}/api/integrations/x/status`).then((r) => r.json());
            setStatus(st);
            setLoading(false);
          }
        }, 800);
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    setLoading(true);
    try {
      const base = getBackendHttpBase();
      await fetch(`${base}/api/integrations/x/disconnect`, { method: 'POST' });
      const st = await fetch(`${base}/api/integrations/x/status`).then((r) => r.json());
      setStatus(st);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border rounded-md p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">X (Twitter)</div>
          <div className="text-xs text-muted-foreground">Per-user OAuth; scopes for tweets, lists, DMs</div>
        </div>
        {status?.connected ? (
          <button disabled={loading} onClick={disconnect} className="text-xs px-2 py-1 rounded bg-muted">
            {loading ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button disabled={loading} onClick={connect} className="text-xs px-2 py-1 rounded bg-muted">
            {loading ? 'Opening…' : 'Connect'}
          </button>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        Status: {status?.connected ? 'Connected' : 'Not connected'}
        {status?.user?.username ? ` — @${status.user.username}` : ''}
      </div>
    </div>
  );
}


