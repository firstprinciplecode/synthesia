import { JSONRPCRequest, ErrorCodes } from '../../types/protocol.js';
import { WebSocketBus } from '../../websocket/bus.js';
import { ToolRunner } from '../../tools/tool-runner.js';
import { serpapiService } from '../../tools/serpapi-service.js';
import { formatSerpListAsMarkdown, formatGoogleNewsMarkdown } from '../../formatters/serpapi.js';
import { createResults } from '../../websocket/results-registry.js';
import { db, messages } from '../../db/index.js';

export type SerpHandlersContext = {
  bus: WebSocketBus;
  toolRunner: ToolRunner;
  getRoomForConnection: (connectionId: string) => string | undefined;
};

export async function handleSerpSearch(ctx: SerpHandlersContext, connectionId: string, request: JSONRPCRequest) {
  const { roomId, query, num, agentId } = request.params as any;
  if (!query) {
    ctx.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'query is required');
    return;
  }
  const room = roomId || ctx.getRoomForConnection(connectionId) || 'default-room';
  const runId = crypto.randomUUID();
  const toolCallId = crypto.randomUUID();
  ctx.bus.broadcastToolCall(room, runId, toolCallId, 'serpapi', 'search', { query, num });
  const { items } = await serpapiService.searchGoogle(query, { num });
  const md = serpapiService.formatAsMarkdown(items, query);
  const msg = {
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    content: md,
    timestamp: new Date(),
    conversationId: room,
    agentId: connectionId,
  };
  // Resolve agent identity for labeling
  let authorName: string | undefined;
  let authorAvatar: string | undefined;
  try {
    const id = (agentId || connectionId) as string;
    if (id && id.length > 0) {
      const { db, agents } = await import('../../db/index.js');
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(agents).where(eq(agents.id as any, id as any));
      if (rows && rows.length) {
        authorName = (rows[0] as any).name || undefined;
        authorAvatar = (rows[0] as any).avatar || undefined;
      }
    }
  } catch {}
  ctx.bus.broadcastToRoom(room, {
    jsonrpc: '2.0',
    method: 'message.received',
    params: {
      roomId: room,
      messageId: crypto.randomUUID(),
      authorId: (agentId || connectionId || 'agent') as any,
      authorType: 'agent',
      ...(authorName ? { authorName } : {}),
      ...(authorAvatar ? { authorAvatar } : {}),
      message: md,
    },
  });
  ctx.bus.broadcastToolResult(room, runId, toolCallId, { ok: true });
  // Persist tool summary to message history
  try {
    await db.insert(messages as any).values({
      id: crypto.randomUUID(),
      conversationId: room,
      authorId: room,
      authorType: 'agent',
      role: 'assistant',
      content: [{ type: 'text', text: md }] as any,
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  } catch {}
  ctx.bus.sendResponse(connectionId, request.id!, { ok: true });
}

export async function handleSerpImages(ctx: SerpHandlersContext, connectionId: string, request: JSONRPCRequest) {
  const { roomId, query, num, agentId } = request.params as any;
  if (!query) {
    ctx.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'query is required');
    return;
  }
  const room = roomId || ctx.getRoomForConnection(connectionId) || 'default-room';
  const runId = crypto.randomUUID();
  const toolCallId = crypto.randomUUID();
  ctx.bus.broadcastToolCall(room, runId, toolCallId, 'serpapi', 'images', { query, num });
  const { items } = await serpapiService.searchGoogleImages(query, { num });
  const md = serpapiService.formatImagesAsMarkdown(items, query);
  ctx.bus.broadcastToRoom(room, {
    jsonrpc: '2.0',
    method: 'agent.analysis',
    params: {
      roomId: room,
      content: md,
      model: 'tool.serpapi',
      timestamp: new Date().toISOString(),
      authorId: (agentId || connectionId || 'agent') as any,
      authorType: 'agent',
    },
  });
  ctx.bus.broadcastToolResult(room, runId, toolCallId, { ok: true });
  // Persist image results to message history (as assistant message)
  try {
    await db.insert(messages as any).values({
      id: crypto.randomUUID(),
      conversationId: room,
      authorId: room,
      authorType: 'agent',
      role: 'assistant',
      content: [{ type: 'text', text: md }] as any,
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  } catch {}
  ctx.bus.sendResponse(connectionId, request.id!, { ok: true });
}

export async function handleSerpRun(ctx: SerpHandlersContext, connectionId: string, request: JSONRPCRequest) {
  const params = (request.params || {}) as any;
  const engine = String(params.engine || '').trim();
  const query = String(params.query || '').trim();
  const attributedAgentId = String(params.agentId || '').trim();

  // Map deprecated/unsupported engines to first-party tools
  const engineNormalized = engine.replace(/^( ["'] )(.*)\1$/, '$2');
  const engineUse = engineNormalized === 'yahoo_finance' ? 'google_finance' : engineNormalized;
  if (engineUse === 'twitter') {
    const roomId = ctx.getRoomForConnection(connectionId) || 'default-room';
    const runId = crypto.randomUUID();
    const toolCallId = crypto.randomUUID();
    ctx.bus.broadcastToolCall(roomId, runId, toolCallId, 'x', 'search', { query });
    try {
      const result = await serpapiService.run(engineUse, query, params.extra || undefined);
      ctx.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: true });
      ctx.bus.sendResponse(connectionId, request.id!, { ok: true, result, used: 'x.search' });
    } catch (e: any) {
      ctx.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: false, error: e?.message || String(e) });
      ctx.bus.sendError(connectionId, request.id, ErrorCodes.INTERNAL_ERROR, e?.message || 'X search failed');
    }
    return;
  }

  // If engine is 'url' (or quoted) or the query itself looks like a URL, delegate to web scraper instead
  const engineIsUrl = engineUse === 'url';
  const queryLooksLikeUrl = /^https?:\/\//i.test(query);
  if (engineIsUrl || queryLooksLikeUrl) {
    const url = queryLooksLikeUrl ? query : engineUse;
    const runId = crypto.randomUUID();
    const toolCallId = crypto.randomUUID();
    const roomId = ctx.getRoomForConnection(connectionId) || 'default-room';
    ctx.bus.broadcastToolCall(roomId, runId, toolCallId, 'web', 'scrape', { url });
    const scrapeResult = await (await import('../../tools/web-scraper-service.js')).webScraperService.scrape(url);
    const preview = (scrapeResult.text || '').replace(/\s+/g, ' ').trim();
    const summary = `${scrapeResult.title ? `**${scrapeResult.title}**\n\n` : ''}- URL: ${scrapeResult.url}\n- Links: ${scrapeResult.links?.length || 0}, Images: ${scrapeResult.images?.length || 0}\n\n${preview.slice(0, 800)}`;
    ctx.bus.broadcastToRoom(roomId, {
      jsonrpc: '2.0',
      method: 'message.received',
      params: {
        roomId: roomId,
        messageId: crypto.randomUUID(),
        authorId: 'agent',
        authorType: 'assistant',
        message: summary,
      },
    });
    ctx.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: true });
    ctx.bus.sendResponse(connectionId, request.id!, { ok: true, result: scrapeResult, used: 'web.scrape' });
    return;
  }

  // Fallback to regular SerpAPI handler
  const result = await serpapiService.run(engineUse, query, params.extra || undefined);
  const roomId = ctx.getRoomForConnection(connectionId) || 'default-room';
  const runId = crypto.randomUUID();
  const toolCallId = crypto.randomUUID();
  ctx.bus.broadcastToolCall(roomId, runId, toolCallId, 'serpapi', 'run', { engine: engineUse, query, extra: params.extra });
  let messageMd = result.markdown || '';
  // Derive and broadcast stable search.results (top 10) with resultId for deterministic picks
  try {
    const raw: any = (result as any).raw || {};
    const urls: string[] = [];
    if (engineUse === 'google_news' && Array.isArray(raw.news_results) && raw.news_results.length) {
      for (const item of raw.news_results) {
        if (typeof item?.link === 'string') {
          urls.push(item.link);
        } else if (item?.highlight && typeof item.highlight.link === 'string') {
          urls.push(item.highlight.link);
        }
        if (urls.length >= 10) break;
      }
    }
    if (!urls.length && typeof result.markdown === 'string' && result.markdown) {
      const re = /\[View\]\((https?:\/\/[^)]+)\)/g;
      const md = String(result.markdown);
      let m: RegExpExecArray | null;
      while ((m = re.exec(md)) !== null) {
        urls.push(m[1]);
        if (urls.length >= 10) break;
      }
    }
    if (urls.length) {
      const items = urls.slice(0, 10).map((url, i) => ({ index: i + 1, url }));
      const rid = createResults(roomId, items);
      console.log('[serpapi.run:search.results] room=%s items=%d resultId=%s', roomId, items.length, rid);
      ctx.bus.broadcastToRoom(roomId, { jsonrpc: '2.0', method: 'search.results', params: { roomId, resultId: rid, items } });
    }
  } catch {}
  // If this is google_news and raw payload contains news_results, build rich cards with image + link
  try {
    const raw = (result as any).raw || {};
    if (engineUse === 'google_news' && Array.isArray(raw.news_results) && raw.news_results.length) {
      messageMd = formatGoogleNewsMarkdown(raw.news_results, `Google News for "${query}"`);
    }
  } catch {}
  if (!messageMd) messageMd = `SERPAPI ${engineUse} for "${query}": (no markdown available)`;

  // Resolve agent identity for labeling
  let authorName2: string | undefined; let authorAvatar2: string | undefined;
  try {
    const id = (attributedAgentId || connectionId) as string;
    if (id && id.length > 0) {
      const { db, agents } = await import('../../db/index.js');
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(agents).where(eq(agents.id as any, id as any));
      if (rows && rows.length) {
        authorName2 = (rows[0] as any).name || undefined;
        authorAvatar2 = (rows[0] as any).avatar || undefined;
      }
    }
  } catch {}
  ctx.bus.broadcastToRoom(roomId, {
    jsonrpc: '2.0',
    method: 'message.received',
    params: {
      roomId: roomId,
      messageId: crypto.randomUUID(),
      authorId: attributedAgentId || connectionId || 'agent',
      authorType: 'agent',
      ...(authorName2 ? { authorName: authorName2 } : {}),
      ...(authorAvatar2 ? { authorAvatar: authorAvatar2 } : {}),
      message: messageMd,
    },
  });
  ctx.bus.broadcastToolResult(roomId, runId, toolCallId, { ok: true });
  // Persist tool summary to message history
  try {
    await db.insert(messages as any).values({
      id: crypto.randomUUID(),
      conversationId: roomId,
      authorId: roomId,
      authorType: 'agent',
      role: 'assistant',
      content: [{ type: 'text', text: messageMd }] as any,
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  } catch {}
  ctx.bus.sendResponse(connectionId, request.id!, { ok: true, result });
}


