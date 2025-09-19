import { Tool, ToolDefinition, ToolFunction } from './tool-contract.js'

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  register(def: ToolDefinition) {
    const tool = new Tool(def)
    this.tools.set(tool.name, tool)
  }

  get(toolName: string): Tool | undefined {
    return this.tools.get(toolName)
  }

  list(): string[] {
    return Array.from(this.tools.keys())
  }

  // Return flattened capability catalog
  catalog(): Array<{ tool: string; func: string; description?: string; tags?: string[]; synonyms?: string[]; sideEffects?: boolean; approval?: 'auto'|'ask'; inputSchema?: Record<string, any> }> {
    const out: Array<{ tool: string; func: string; description?: string; tags?: string[]; synonyms?: string[]; sideEffects?: boolean; approval?: 'auto'|'ask'; inputSchema?: Record<string, any> }> = []
    for (const [name, tool] of this.tools.entries()) {
      for (const [fname, f] of Object.entries(tool.functions)) {
        const tf = f as ToolFunction
        out.push({ tool: name, func: fname, description: tf.description, tags: tf.tags, synonyms: tf.synonyms, sideEffects: tf.sideEffects, approval: tf.approval, inputSchema: tf.inputSchema })
      }
    }
    return out
  }
}

