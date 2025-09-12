import { randomUUID } from 'crypto'
import { ToolRegistry } from './tool-registry.js'
import { ToolContext } from './tool-contract.js'

export type ToolRunHooks = {
  onCall?: (roomId: string, runId: string, toolCallId: string, tool: string, func: string, args: Record<string, any>) => void
  onResult?: (roomId: string, runId: string, toolCallId: string, result: any) => void
  onError?: (roomId: string, runId: string, toolCallId: string, error: any) => void
}

export class ToolRunner {
  constructor(private registry: ToolRegistry, private hooks?: ToolRunHooks) {}

  async run(toolName: string, functionName: string, args: Record<string, any>, ctx: ToolContext & { roomId: string }): Promise<{ runId: string; toolCallId: string; result: any }> {
    const tool = this.registry.get(toolName)
    if (!tool) throw new Error(`Unknown tool: ${toolName}`)
    const func = tool.functions[functionName]
    if (!func) throw new Error(`Unknown tool function: ${toolName}.${functionName}`)
    const runId = randomUUID()
    const toolCallId = randomUUID()
    this.hooks?.onCall?.(ctx.roomId, runId, toolCallId, toolName, functionName, args)
    try {
      const result = await func.execute(args, ctx)
      this.hooks?.onResult?.(ctx.roomId, runId, toolCallId, result)
      return { runId, toolCallId, result }
    } catch (e) {
      this.hooks?.onError?.(ctx.roomId, runId, toolCallId, e)
      throw e
    }
  }
}

