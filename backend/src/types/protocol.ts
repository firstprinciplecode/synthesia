export type JSONRPCRequest = { jsonrpc: '2.0'; id: string; method: string; params?: any };
export type JSONRPCResponse = { jsonrpc: '2.0'; id: string; result?: any; error?: { code: number; message: string; data?: any } };
export type JSONRPCNotification = { jsonrpc: '2.0'; method: string; params?: any };

export enum ErrorCodes {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
}

export type JSONRPCError = { code: ErrorCodes; message: string; data?: any };

export type MessageCreateRequest = { roomId: string; content: string; options?: any };
export type MessageDeltaNotification = { roomId: string; messageId: string; delta: string; authorId?: string; authorType?: string };
export type RunStatusNotification = { runId: string; status: 'running' | 'succeeded' | 'failed'; startedAt?: string; completedAt?: string };


