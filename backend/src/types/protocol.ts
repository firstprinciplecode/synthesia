// Loosen jsonrpc literal type to reduce friction when constructing objects
export type JSONRPCRequest = { jsonrpc: string; id: string; method: string; params?: any };
export type JSONRPCResponse = { jsonrpc: string; id: string; result?: any; error?: { code: number; message: string; data?: any } };
export type JSONRPCNotification = { jsonrpc: string; method: string; params?: any };

export enum ErrorCodes {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  // Custom application codes
  FORBIDDEN = -32000,
  LLM_ERROR = -32001,
}

export type JSONRPCError = { code: ErrorCodes; message: string; data?: any };

// Specializations aligned to JSON-RPC envelope shapes used in server
export type MessageCreateRequest = JSONRPCRequest & {
  method: 'message.create';
  params: {
    roomId: string;
    message: any;
    runOptions?: any;
  };
};

export type MessageDeltaNotification = JSONRPCNotification & {
  method: 'message.delta';
  params: { roomId: string; messageId: string; delta: string; authorId?: string; authorType?: string };
};

export type RunStatusNotification = JSONRPCNotification & {
  method: 'run.status';
  params: { runId: string; status: 'running' | 'completed' | 'succeeded' | 'failed'; startedAt?: string; completedAt?: string };
};


// Typing indicators
export type TypingStartRequest = JSONRPCRequest & {
  method: 'typing.start';
  params: { roomId: string; actorId?: string; type?: 'user' | 'agent'; ttlMs?: number };
};

export type TypingStopRequest = JSONRPCRequest & {
  method: 'typing.stop';
  params: { roomId: string; actorId?: string };
};

export type RoomTypingNotification = JSONRPCNotification & {
  method: 'room.typing';
  params: { roomId: string; typing: Array<{ actorId: string; type?: 'user' | 'agent' }>; updatedAt: string };
};

// Read receipts
export type MessageReadRequest = JSONRPCRequest & {
  method: 'message.read';
  params: { roomId: string; messageId: string; actorId?: string };
};

export type MessageReceiptsNotification = JSONRPCNotification & {
  method: 'message.receipts';
  params: { roomId: string; messageId: string; actorIds: string[]; updatedAt: string };
};


