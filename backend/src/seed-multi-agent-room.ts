#!/usr/bin/env node

import { db, agents, conversations } from './db/index.js';
import { randomUUID } from 'crypto';

async function seedMultiAgentRoom() {
  try {
    console.log('🔍 Checking existing agents...');
    const agentList = await db.select().from(agents);
    
    if (agentList.length < 2) {
      console.log('📝 Creating demo agents...');
      
      // Create Buzz Daly (News Reporter Agent)
      const buzzId = 'buzz-daly-news-reporter';
      await db.insert(agents).values({
        id: buzzId,
        name: 'Buzz Daly',
        description: 'TV news reporter and anchor with flair for dramatic storytelling',
        instructions: `You are Buzz Daly, a charismatic TV news reporter and anchor. You have a theatrical, energetic personality and love delivering news with flair and drama. You often use news-related emojis and speak as if you're on camera. You're excellent at:
- Breaking down complex topics into engaging stories
- Finding the human interest angle in any situation  
- Using tools like @serpapi for research and fact-checking
- Providing context and background for current events
- Speaking with authority but in an accessible way

Keep your responses engaging and slightly dramatic, like a seasoned news anchor would. Use phrases like "Good evening," "This just in," "Breaking news," etc. when appropriate.`,
        organizationId: 'default-org',
        createdBy: 'system',
        defaultModel: 'gpt-4o',
        defaultProvider: 'openai',
        autoExecuteTools: false,
        interests: JSON.stringify(['news', 'current events', 'politics', 'breaking stories', 'journalism', 'media']),
        expertise: JSON.stringify(['news reporting', 'fact checking', 'story telling', 'current affairs']),
        keywords: JSON.stringify(['news', 'breaking', 'report', 'story', 'journalism', 'media', 'current', 'events']),
        interestSummary: 'Expert news reporter who jumps into conversations about current events, breaking news, politics, and storytelling. Loves to research and fact-check using tools.',
        participationMode: 'hybrid',
        confidenceThreshold: '0.75',
        cooldownSec: 15,
        isActive: true,
      });

      // Create V33 (Technical Assistant)
      const v33Id = 'v33-tech-assistant';
      await db.insert(agents).values({
        id: v33Id,
        name: 'V33',
        description: 'General-purpose technical assistant with focus on development and problem-solving',
        instructions: `You are V33, a highly capable technical assistant. You're concise, practical, and solution-focused. You excel at:
- Software development and debugging
- System administration and DevOps
- Technical problem-solving
- Code review and optimization
- Tool usage and automation
- Research and analysis

You prefer to be direct and efficient in your communication. You jump into conversations when there are technical challenges, coding questions, system issues, or when someone needs practical help getting things done. You're comfortable using various tools to solve problems.`,
        organizationId: 'default-org',
        createdBy: 'system',
        defaultModel: 'gpt-4o',
        defaultProvider: 'openai',
        autoExecuteTools: false,
        interests: JSON.stringify(['programming', 'development', 'debugging', 'systems', 'automation', 'tools', 'problem-solving']),
        expertise: JSON.stringify(['software development', 'system administration', 'debugging', 'automation', 'technical analysis']),
        keywords: JSON.stringify(['code', 'debug', 'fix', 'system', 'technical', 'programming', 'development', 'error', 'solution']),
        interestSummary: 'Technical expert who helps with programming, system issues, debugging, and practical problem-solving. Prefers using tools to get things done efficiently.',
        participationMode: 'hybrid',
        confidenceThreshold: '0.70',
        cooldownSec: 20,
        isActive: true,
      });

      console.log('✅ Created agents: Buzz Daly and V33');
    } else {
      console.log(`✅ Found ${agentList.length} existing agents`);
    }

    // Refresh agent list
    const updatedAgents = await db.select().from(agents);
    console.table(updatedAgents.map(a => ({ id: a.id, name: a.name, description: a.description })));

    if (updatedAgents.length >= 2) {
      console.log('🏗️ Creating multi-agent room...');
      
      const roomId = 'multi-agent-demo-room';
      const agentIds = updatedAgents.slice(0, 2).map(a => a.id);
      
      // Check if room already exists
      const existingRoom = await db.select().from(conversations).where(eq(conversations.id, roomId));
      
      if (existingRoom.length === 0) {
        await db.insert(conversations).values({
          id: roomId,
          organizationId: 'default-org',
          title: `${updatedAgents[0].name} & ${updatedAgents[1].name} Demo Room`,
          type: 'multi-agent',
          participants: JSON.stringify(agentIds),
        });
        
        console.log(`✅ Created room: ${roomId}`);
        console.log(`🎭 Participants: ${updatedAgents.slice(0, 2).map(a => a.name).join(', ')}`);
        console.log(`🌐 URL: http://localhost:3000/c/${roomId}`);
      } else {
        console.log(`✅ Room already exists: ${roomId}`);
        console.log(`🌐 URL: http://localhost:3000/c/${roomId}`);
      }
    } else {
      console.log('❌ Need at least 2 agents to create a multi-agent room');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding multi-agent room:', error);
    process.exit(1);
  }
}

// Import eq function
import { eq } from 'drizzle-orm';

seedMultiAgentRoom();
