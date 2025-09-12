import { Tool, ToolDefinition } from './tool-contract.js'

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
}

