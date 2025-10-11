import { JSONRPCNotification, JSONRPCResponse, JSONRPCError } from '../types/protocol.js';

export class WebSocketBus {
  private connections: Map<string, any>;
  private rooms: Map<string, Set<string>>;
  private connectionUserId: Map<string, string>;

  constructor(connections: Map<string, any>, rooms: Map<string, Set<string>>, connectionUserId: Map<string, string>) {
    this.connections = connections;
    this.rooms = rooms;
    this.connectionUserId = connectionUserId;
  }

  sendResponse(connectionId: string, id: string, result: any) {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    this.sendToConnection(connectionId, response);
  }

  sendError(connectionId: string, id: string | null, code: number, message: string, data?: any) {
    const error: JSONRPCError = { code: code as any, message, data };
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: id || 'unknown',
      error,
    };
    this.sendToConnection(connectionId, response);
  }

  sendToConnection(connectionId: string, message: any) {
    const connection = this.connections.get(connectionId) as any;
    const ws = connection?.socket ?? connection;
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(message));
      } catch (err) {
        console.error(`Failed to send WS message to ${connectionId}:`, err);
      }
    }
  }

  broadcastToRoom(roomId: string, notification: JSONRPCNotification) {
    const participants = this.rooms.get(roomId);
    if (!participants) return;
    for (const connectionId of participants) {
      this.sendToConnection(connectionId, notification);
    }
  }

  // Broadcast to every connected client
  broadcastToAll(notification: JSONRPCNotification) {
    try {
      for (const [connectionId] of this.connections.entries()) {
        this.sendToConnection(connectionId, notification);
      }
    } catch (e) {
      console.error('broadcastToAll failed', e);
    }
  }

  broadcastToolCall(roomId: string, runId: string, toolCallId: string, tool: string, func: string, args: Record<string, any>) {
    this.broadcastToRoom(roomId, {
      jsonrpc: '2.0',
      method: 'tool.call',
      params: { runId, toolCallId, tool, function: func, args },
    });
  }

  broadcastToolResult(roomId: string, runId: string, toolCallId: string, result: any) {
    this.broadcastToRoom(roomId, {
      jsonrpc: '2.0',
      method: 'tool.result',
      params: { runId, toolCallId, result },
    });
  }

  // Send notification to all connections belonging to a specific user
  emitToUser(userId: string, notification: JSONRPCNotification) {
    try {
      for (const [connectionId, connUserId] of this.connectionUserId.entries()) {
        if (connUserId === userId) {
          this.sendToConnection(connectionId, notification);
        }
      }
    } catch (e) {
      console.error('emitToUser failed', e);
    }
  }
}


