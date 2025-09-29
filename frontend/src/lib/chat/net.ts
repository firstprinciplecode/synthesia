// Networking helpers for resolving SuperAgent endpoints

export function resolveWsUrl(): string {
  try {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname || '';
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || /^192\.168\./.test(host);
      const uid = (window as any).__superagent_uid as string | undefined;
      if (isLocal) return `ws://localhost:3001/ws${uid ? `?uid=${encodeURIComponent(uid)}` : ''}`;
    }
  } catch {}
  // Prefer explicit env when provided
  const envUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envUrl && typeof window !== 'undefined') {
    const uid = (window as any).__superagent_uid as string | undefined;
    try {
      const u = new URL(envUrl);
      if (uid) u.searchParams.set('uid', uid);
      return u.toString();
    } catch {
      return envUrl;
    }
  }
  // Otherwise derive from current origin (works with ngrok)
  try {
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const uid = (window as any).__superagent_uid as string | undefined;
      return `${proto}://${window.location.host}/ws${uid ? `?uid=${encodeURIComponent(uid)}` : ''}`;
    }
  } catch {}
  return process.env.NODE_ENV === 'production' ? 'wss://your-domain.com/ws' : 'ws://localhost:3001/ws';
}

export function getHealthUrlFromWs(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    const scheme = url.protocol === 'wss:' ? 'https:' : 'http:';
    return `${scheme}//${url.host}/health`;
  } catch {
    return 'http://localhost:3001/health';
  }
}

export function getHttpBaseFromWs(wsUrl: string): string {
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
}


