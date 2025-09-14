import { AgentOrchestrator } from '../src/agents/agent-orchestrator.js';
import { LLMRouter, LLMProvider } from '../src/llm/providers.js';

// Minimal fake router streaming "Hello" in two chunks
class FakeRouter extends LLMRouter {
  constructor() { super(); }
  getProvider(provider: LLMProvider) { return { stream: async function* (): AsyncGenerator<any> { yield { delta: 'Hel' }; yield { delta: 'lo', finishReason: 'stop' }; } } as any; }
}

function assert(cond: any, msg: string) { if (!cond) throw new Error('Assertion failed: ' + msg); }

// Run as: npx tsx backend/tests/agent-orchestrator.test.ts
(async () => {
  const orch = new AgentOrchestrator({ llmRouter: new FakeRouter() as any });

  let collected = '';
  const result = await orch.streamPrimaryAgentResponse({
    roomId: 'r', activeUserId: 'u', connectionId: 'c', agentRecord: null, userProfile: { name: 'T' }, userMessage: 'Hi',
    onDelta: (d) => { collected += d; }, runOptions: { model: 'gpt-4o' as any }
  });
  assert(collected === 'Hello', 'delta collection equals Hello');
  assert(result.fullResponse === 'Hello', 'full response equals Hello');
  console.log('agent-orchestrator tests passed');
})();


