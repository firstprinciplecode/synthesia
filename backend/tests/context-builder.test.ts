import { buildUserProfileContext, buildMemoryContextFromLongTerm, parseAgentPersona, buildSystemPrompt, buildMessagesFromShortTerm, assembleConversationMessages } from '../src/agents/context-builder.js';

function assert(cond: any, msg: string) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

// Run as: npx tsx backend/tests/context-builder.test.ts
(async () => {
  const profile = { name: 'Alice', email: 'a@example.com', phone: '123', location: 'NYC', company: 'ACME', website: 'https://acme.com', bio: 'Founder' };
  const profileCtx = buildUserProfileContext(profile);
  assert(profileCtx.includes('Alice'), 'profile includes name');
  assert(profileCtx.includes('a@example.com'), 'profile includes email');

  const memCtx = buildMemoryContextFromLongTerm([{ content: 'Prior note 1' }, { content: 'Prior note 2' }]);
  assert(memCtx.includes('Prior note 1') && memCtx.includes('Prior note 2'), 'memory context includes items');

  const agent = { name: 'Buzz', description: 'Space helper', instructions: 'Personality: Friendly\n\nExtra instructions: Prefer X first' };
  const parsed = parseAgentPersona(agent);
  assert(parsed.agentName === 'Buzz', 'persona name parsed');
  assert(parsed.persona.includes('Friendly'), 'persona includes personality');

  const sys = buildSystemPrompt({ userName: 'Thomas', connectionId: 'conn-1', persona: parsed.persona, memoryContext: profileCtx + memCtx, autoExecuteTools: false });
  assert(sys.includes('Hello Thomas'), 'system prompt greets user');
  assert(sys.includes('AGENT PERSONA'), 'system prompt includes persona');

  const shortMsgs = buildMessagesFromShortTerm([
    { role: 'terminal', content: '$ ls', timestamp: new Date(), id: '1', conversationId: 'r', agentId: 'a' },
    { role: 'assistant', content: 'Hi', timestamp: new Date(), id: '2', conversationId: 'r', agentId: 'a' },
  ] as any);
  assert(shortMsgs.length === 2, 'short term messages mapped');
  assert(shortMsgs[0].role === 'system', 'terminal becomes system');

  const assembled = assembleConversationMessages(sys, shortMsgs, 'user', 'Hello');
  assert(assembled[0].role === 'system', 'first is system');
  assert(assembled[assembled.length - 1].content === 'Hello', 'last is user message');

  console.log('context-builder tests passed');
})();


