import { JSONRPCRequest, ErrorCodes } from '../../types/protocol.js';
import { WebSocketBus } from '../../websocket/bus.js';
import { ToolRunner } from '../../tools/tool-runner.js';
import { formatXSearchMarkdown } from '../../formatters/x.js';
import { randomUUID } from 'crypto';

export type XHandlersContext = {
  bus: WebSocketBus;
  toolRunner: ToolRunner;
  getRoomForConnection: (connectionId: string) => string | undefined;
  getUserRequireApproval: (connectionId: string) => Promise<boolean>;
};

export async function handleXSearch(ctx: XHandlersContext, connectionId: string, request: JSONRPCRequest) {
  const { roomId, query, max } = (request.params || {}) as any;
  if (!query) {
    ctx.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'query is required');
    return;
  }
  const room = roomId || ctx.getRoomForConnection(connectionId) || 'default-room';
  const runId = randomUUID();
  const toolCallId = randomUUID();
  ctx.bus.broadcastToolCall(room, runId, toolCallId, 'x', 'search', { query, max });
  const res = await ctx.toolRunner.run('x', 'search', { query, max }, { roomId: room, connectionId });
  const md = formatXSearchMarkdown(res.result, query);
  ctx.bus.broadcastToRoom(room, {
    jsonrpc: '2.0',
    method: 'message.received',
    params: {
      roomId: room,
      messageId: randomUUID(),
      authorId: 'agent',
      authorType: 'assistant',
      message: md,
    },
  });
  ctx.bus.broadcastToolResult(room, runId, toolCallId, { ok: true });
  ctx.bus.sendResponse(connectionId, request.id!, { ok: true, result: res.result });
}

export async function handleXLists(ctx: XHandlersContext, connectionId: string, request: JSONRPCRequest) {
  const { roomId, username } = (request.params || {}) as any;
  const room = roomId || ctx.getRoomForConnection(connectionId) || 'default-room';
  const runId = randomUUID();
  const toolCallId = randomUUID();
  const args = username ? { username } : {};
  ctx.bus.broadcastToolCall(room, runId, toolCallId, 'x', 'lists', args);
  const res = await ctx.toolRunner.run('x', 'lists', args, { roomId: room, connectionId });
  const lists: any[] = Array.isArray(res.result?.data) ? res.result.data : [];
  let markdown: string;
  if (!lists.length) {
    markdown = username ? `No lists found for ${username}.` : 'No lists found.';
  } else {
    const safe = (s: any) => String(s ?? '').replace(/\|/g, '\\|');
    const rows = lists.map((l: any, idx: number) => `| ${idx + 1} | ${safe(l.name || '(unnamed)')} | ${safe(l.id)} |`);
    const title = username ? `X lists owned by ${username}` : 'X lists (owned)';
    markdown = `${title}:\n\n| # | Name | ID |\n|---:|---|---|\n${rows.join('\n')}`;
  }
  ctx.bus.broadcastToRoom(room, {
    jsonrpc: '2.0',
    method: 'message.received',
    params: {
      roomId: room,
      messageId: randomUUID(),
      authorId: 'agent',
      authorType: 'assistant',
      message: markdown,
    },
  });
  ctx.bus.broadcastToolResult(room, runId, toolCallId, { ok: true });
  ctx.bus.sendResponse(connectionId, request.id!, { ok: true, result: res.result });
}

export async function handleXListTweets(ctx: XHandlersContext, connectionId: string, request: JSONRPCRequest) {
  const { roomId, listId, max } = (request.params || {}) as any;
  if (!listId) {
    ctx.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'listId is required');
    return;
  }
  const room = roomId || ctx.getRoomForConnection(connectionId) || 'default-room';
  const runId = randomUUID();
  const toolCallId = randomUUID();
  ctx.bus.broadcastToolCall(room, runId, toolCallId, 'x', 'listTweets', { listId, max });
  const res = await ctx.toolRunner.run('x', 'listTweets', { listId, max }, { roomId: room, connectionId });
  ctx.bus.broadcastToRoom(room, {
    jsonrpc: '2.0',
    method: 'message.received',
    params: {
      roomId: room,
      messageId: randomUUID(),
      authorId: 'agent',
      authorType: 'assistant',
      message: `X list ${listId} tweets:\n\n\`\`\`json\n${JSON.stringify(res.result?.data || [], null, 2)}\n\`\`\``,
    },
  });
  ctx.bus.broadcastToolResult(room, runId, toolCallId, { ok: true });
  ctx.bus.sendResponse(connectionId, request.id!, { ok: true, result: res.result });
}

export async function handleXTweet(ctx: XHandlersContext, connectionId: string, request: JSONRPCRequest) {
  const { roomId, text } = (request.params || {}) as any;
  if (!text) {
    ctx.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'text is required');
    return;
  }
  const room = roomId || ctx.getRoomForConnection(connectionId) || 'default-room';
  const requireApproval = await ctx.getUserRequireApproval(connectionId);
  if (requireApproval) {
    ctx.bus.broadcastToRoom(room, {
      jsonrpc: '2.0',
      method: 'message.received',
      params: {
        roomId: room,
        messageId: randomUUID(),
        authorId: 'agent',
        authorType: 'assistant',
        message: `Should I post this on X?\n\n${text}`,
      },
    });
    ctx.bus.sendResponse(connectionId, request.id!, { ok: true, awaitingApproval: true });
    return;
  }
  const runId = randomUUID();
  const toolCallId = randomUUID();
  ctx.bus.broadcastToolCall(room, runId, toolCallId, 'x', 'tweet', { text });
  const res = await ctx.toolRunner.run('x', 'tweet', { text }, { roomId: room, connectionId });
  ctx.bus.broadcastToolResult(room, runId, toolCallId, { ok: true });
  ctx.bus.sendResponse(connectionId, request.id!, { ok: true, result: res.result });
}

export async function handleXDm(ctx: XHandlersContext, connectionId: string, request: JSONRPCRequest) {
  const { roomId, recipientId, text } = (request.params || {}) as any;
  if (!recipientId || !text) {
    ctx.bus.sendError(connectionId, request.id, ErrorCodes.INVALID_PARAMS, 'recipientId and text are required');
    return;
  }
  const room = roomId || ctx.getRoomForConnection(connectionId) || 'default-room';
  const requireApproval = await ctx.getUserRequireApproval(connectionId);
  if (requireApproval) {
    ctx.bus.broadcastToRoom(room, {
      jsonrpc: '2.0',
      method: 'message.received',
      params: {
        roomId: room,
        messageId: randomUUID(),
        authorId: 'agent',
        authorType: 'assistant',
        message: `Should I send this DM on X to ${recipientId}?\n\n${text}`,
      },
    });
    ctx.bus.sendResponse(connectionId, request.id!, { ok: true, awaitingApproval: true });
    return;
  }
  const runId = randomUUID();
  const toolCallId = randomUUID();
  ctx.bus.broadcastToolCall(room, runId, toolCallId, 'x', 'dm', { recipientId, text });
  const res = await ctx.toolRunner.run('x', 'dm', { recipientId, text }, { roomId: room, connectionId });
  ctx.bus.broadcastToolResult(room, runId, toolCallId, { ok: true });
  ctx.bus.sendResponse(connectionId, request.id!, { ok: true, result: res.result });
}


