export type ToolContext = {
  roomId: string
  connectionId: string
  agentId?: string
  userId?: string
}

export type ToolExecuteFn = (args: Record<string, any>, ctx: ToolContext) => Promise<any>

export interface ToolFunction {
  name: string
  /**
   * Human-readable description of what this function does.
   */
  description?: string
  /**
   * Generic capability tags (e.g., 'search', 'news', 'scrape', 'tts', 'summarize').
   */
  tags?: string[]
  /**
   * Helpful alternative phrases the planner may use (e.g., 'narrate','voiceover' → tts).
   */
  synonyms?: string[]
  /**
   * JSON Schema (or loose shape) for expected args; used only for validation hints.
   */
  inputSchema?: Record<string, any>
  /**
   * True if this action has side effects and may require approval.
   */
  sideEffects?: boolean
  /**
   * Approval policy for UI. 'auto' (default) or 'ask'.
   */
  approval?: 'auto' | 'ask'
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

