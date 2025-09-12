export type ToolContext = {
  roomId: string
  connectionId: string
  agentId?: string
  userId?: string
}

export type ToolExecuteFn = (args: Record<string, any>, ctx: ToolContext) => Promise<any>

export interface ToolFunction {
  name: string
  execute: ToolExecuteFn
}

export interface ToolDefinition {
  name: string
  version?: string
  functions: Record<string, ToolFunction>
}

export class Tool implements ToolDefinition {
  name: string
  version?: string
  functions: Record<string, ToolFunction>

  constructor(def: ToolDefinition) {
    this.name = def.name
    this.version = def.version
    this.functions = def.functions
  }
}

