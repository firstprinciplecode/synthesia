// Networking helpers for resolving SuperAgent endpoints

export function resolveWsUrl(): string {
  try {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname || '';
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || /^192\.168\./.test(host);
      if (isLocal) return 'ws://localhost:3001/ws';
    }
  } catch {}
  return (
    process.env.NEXT_PUBLIC_WS_URL ||
    (process.env.NODE_ENV === 'production' ? 'wss://your-domain.com/ws' : 'ws://localhost:3001/ws')
  );
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


