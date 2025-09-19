const lastLinks = new Map<string, string[]>();

export function setLastLinks(connectionId: string, links: string[]) {
  if (!connectionId || !Array.isArray(links)) return;
  lastLinks.set(connectionId, links);
}

export function getLastLinks(connectionId: string): string[] {
  return lastLinks.get(connectionId) || [];
}


