const { memoryService } = require('./dist/memory/memory-service.js');

async function testMemory() {
  console.log('🧠 Testing Memory System...\n');

  const agentId = 'test-agent-123';
  const conversationId = 'test-conversation-456';

  try {
    // Test 1: Short-term memory
    console.log('1. Testing short-term memory...');
    const message1 = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello, my name is Thomas and I love React development',
      timestamp: new Date(),
      conversationId,
      agentId,
    };
    
    memoryService.addToShortTerm(agentId, message1);
    const shortTerm = memoryService.getShortTerm(agentId);
    console.log(`✅ Short-term memory: ${shortTerm.length} messages`);
    console.log(`   Latest: ${shortTerm[0]?.content}\n`);

    // Test 2: Agent profile
    console.log('2. Testing agent profile...');
    await memoryService.updateAgentProfile(agentId, {
      name: 'Thomas',
      email: 'thomas@example.com',
      interests: ['React', 'TypeScript', 'AI'],
      timezone: 'UTC',
    });
    
    const profile = await memoryService.getAgentProfile(agentId);
    console.log(`✅ Agent profile: ${profile.length > 0 ? 'Created' : 'Failed'}`);
    if (profile.length > 0) {
      console.log(`   Name: ${profile[0].name}`);
      console.log(`   Interests: ${JSON.stringify(profile[0].interests)}\n`);
    }

    // Test 3: Agent preferences
    console.log('3. Testing agent preferences...');
    await memoryService.updateAgentPreferences(agentId, {
      communicationStyle: 'detailed',
      technicalLevel: 'advanced',
      responseLength: 'medium',
      topics: ['programming', 'ai', 'web-development'],
    });
    
    const prefs = await memoryService.getAgentPreferences(agentId);
    console.log(`✅ Agent preferences: ${prefs.length > 0 ? 'Created' : 'Failed'}`);
    if (prefs.length > 0) {
      console.log(`   Style: ${prefs[0].communicationStyle}`);
      console.log(`   Level: ${prefs[0].technicalLevel}\n`);
    }

    // Test 4: Long-term memory (Pinecone)
    console.log('4. Testing long-term memory...');
    await memoryService.addToLongTerm(
      'I am working on a React project with TypeScript and Next.js',
      {
        agentId,
        conversationId,
        messageId: 'msg-2',
        role: 'user',
        timestamp: new Date().toISOString(),
        messageType: 'conversation',
      }
    );
    console.log('✅ Long-term memory: Message stored');

    // Test 5: Search long-term memory
    console.log('5. Testing memory search...');
    const searchResults = await memoryService.searchLongTerm(agentId, 'React TypeScript', 3);
    console.log(`✅ Memory search: Found ${searchResults.length} results`);
    if (searchResults.length > 0) {
      console.log(`   First result: ${searchResults[0].content.substring(0, 50)}...\n`);
    }

    // Test 6: Conversation summary
    console.log('6. Testing conversation summary...');
    const messages = [
      {
        role: 'user',
        content: 'I need help with React hooks',
        timestamp: new Date(),
      },
      {
        role: 'assistant',
        content: 'I can help you with React hooks! What specific hook are you working with?',
        timestamp: new Date(),
      },
    ];
    
    const summary = await memoryService.createConversationSummary(
      agentId,
      conversationId,
      messages.map(msg => ({ ...msg, id: 'test', conversationId, agentId })),
      1
    );
    console.log(`✅ Conversation summary: Created`);
    console.log(`   Summary: ${summary.summary.substring(0, 100)}...\n`);

    // Test 7: Reflection system
    console.log('7. Testing reflection system...');
    const shouldReflect = await memoryService.shouldReflect(agentId);
    console.log(`✅ Should reflect: ${shouldReflect}`);
    
    if (shouldReflect) {
      await memoryService.performReflection(agentId);
      console.log('✅ Reflection completed');
    }

    console.log('\n🎉 Memory system test completed successfully!');

  } catch (error) {
    console.error('❌ Memory system test failed:', error);
  }
}

testMemory();
