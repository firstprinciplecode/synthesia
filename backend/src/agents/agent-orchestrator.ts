import { LLMRouter, ModelConfigs, SupportedModel } from '../llm/providers.js';
import { memoryService } from '../memory/memory-service.js';
import { randomUUID } from 'crypto';
import { buildMessagesFromShortTerm, buildSystemPrompt, parseAgentPersona, buildMemoryContextFromLongTerm, assembleConversationMessages } from './context-builder.js';

export type OrchestratorDeps = {
  llmRouter: LLMRouter;
};

export class AgentOrchestrator {
  private llmRouter: LLMRouter;

  constructor(deps: OrchestratorDeps) {
    this.llmRouter = deps.llmRouter;
  }

  async streamPrimaryAgentResponse(options: {
    roomId: string;
    activeUserId: string;
    connectionId: string;
    agentRecord: any | null;
    userProfile: any | null;
    userMessage: string;
    runOptions?: { model?: SupportedModel; temperature?: number; budget?: { maxTokens?: number } };
    onDelta: (delta: string) => void;
  }): Promise<{ fullResponse: string; model: SupportedModel }> {
    const { roomId, activeUserId, connectionId, agentRecord, userProfile, userMessage, runOptions, onDelta } = options;
    const shortTerm = memoryService.getShortTerm(activeUserId);
    const longTerm = await memoryService.searchLongTermByUser(activeUserId, userMessage, 3, { agentId: roomId as any, roomId: roomId as any });
    const memoryContext = buildMemoryContextFromLongTerm(longTerm);
    const { agentName, persona, autoExecuteTools } = agentRecord ? parseAgentPersona(agentRecord) : { agentName: '', persona: '', autoExecuteTools: false };
    const systemContent = buildSystemPrompt({
      userName: userProfile?.name || 'there',
      connectionId,
      persona,
      memoryContext,
      autoExecuteTools,
    });
    const shortTermMsgs = buildMessagesFromShortTerm(shortTerm);
    const messages = assembleConversationMessages(systemContent, shortTermMsgs, 'user', userMessage);
    const model = (runOptions?.model || 'gpt-4o') as SupportedModel;
    const modelConfig = ModelConfigs[model];
    let fullResponse = '';
    for await (const chunk of this.llmRouter.stream(
      modelConfig.provider,
      messages,
      { model, temperature: runOptions?.temperature || 0.7, maxTokens: runOptions?.budget?.maxTokens || 4000, stream: true }
    )) {
      if (chunk.delta) {
        fullResponse += chunk.delta;
        onDelta(chunk.delta);
      }
    }
    return { fullResponse, model };
  }
}


