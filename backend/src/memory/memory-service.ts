import { Pinecone } from '@pinecone-database/pinecone';
import { db } from '../db/index.js';
import { agentProfiles, agentPreferences, agentProjects, agentContacts, conversationSummaries } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { embeddingService } from './embedding-service.js';
import { summarizationService } from './summarization-service.js';
import { randomUUID } from 'crypto';

export interface MemoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'terminal';
  content: string;
  timestamp: Date;
  conversationId: string;
  agentId: string;
  metadata?: Record<string, any>;
}

export interface ShortTermMemory {
  messages: MemoryMessage[];
  maxSize: number;
}

export interface LongTermMemory {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    agentId: string;
    conversationId: string;
    messageId: string;
    role: string;
    timestamp: string;
    messageType: 'conversation' | 'summary' | 'fact' | 'preference';
    userId?: string;
  };
}

export interface ConversationSummary {
  id: string;
  agentId: string;
  conversationId: string;
  summary: string;
  keyPoints: string[];
  decisions: string[];
  nextSteps: string[];
  level: number; // 1-5 (immediate to quarterly)
  createdAt: Date;
  updatedAt: Date;
}

export class MemoryService {
  private sanitizeText(input: string | undefined): string {
    if (!input) return ''
    // Remove lone surrogate halves to satisfy JSON/db encoders
    return input.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  }
  private pinecone: Pinecone | null = null;
  private shortTermMemories: Map<string, ShortTermMemory> = new Map();
  private readonly SHORT_TERM_SIZE = 10;

  constructor() {
    // Defer Pinecone initialization until needed to avoid crashing when
    // PINECONE_API_KEY is not configured. Long-term memory will be disabled
    // gracefully if no key is present.
  }

  private ensurePinecone(): Pinecone | null {
    if (this.pinecone) return this.pinecone;
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      return null;
    }
    try {
      this.pinecone = new Pinecone({ apiKey });
      return this.pinecone;
    } catch (err) {
      console.error('Failed to initialize Pinecone client:', err);
      this.pinecone = null;
      return null;
    }
  }

  // Short-term memory management
  addToShortTerm(agentId: string, message: MemoryMessage): void {
    if (!this.shortTermMemories.has(agentId)) {
      this.shortTermMemories.set(agentId, {
        messages: [],
        maxSize: this.SHORT_TERM_SIZE,
      });
    }

    const memory = this.shortTermMemories.get(agentId)!;
    const safeMsg = { ...message, content: this.sanitizeText(message.content) }
    memory.messages.push(safeMsg);

    // Keep only last N messages
    if (memory.messages.length > memory.maxSize) {
      memory.messages = memory.messages.slice(-memory.maxSize);
    }
  }

  getShortTerm(agentId: string): MemoryMessage[] {
    return this.shortTermMemories.get(agentId)?.messages || [];
  }

  // Long-term memory (Pinecone)
  async addToLongTerm(content: string, metadata: Omit<LongTermMemory['metadata'], 'content'>): Promise<void> {
    try {
      const pc = this.ensurePinecone();
      if (!pc) return; // gracefully skip if Pinecone not configured
      const index = pc.index(process.env.PINECONE_INDEX_NAME || 'superagent');
      const safe = this.sanitizeText(content)
      const embedding = await embeddingService.generateEmbedding(safe);
      
      await index.upsert([{
        id: metadata.messageId,
        values: embedding,
        metadata: {
          ...metadata,
          content: safe,
        },
      }]);
    } catch (error) {
      console.error('Error storing in Pinecone:', error);
      // Don't throw - continue without long-term memory if Pinecone fails
    }
  }

  async searchLongTerm(
    agentId: string, 
    query: string, 
    limit: number = 5,
    messageType?: string
  ): Promise<LongTermMemory[]> {
    try {
      const pc = this.ensurePinecone();
      if (!pc) return [];
      const index = pc.index(process.env.PINECONE_INDEX_NAME || 'superagent');
      
      // Generate embedding for query
      const queryEmbedding = await embeddingService.generateEmbedding(query);
      
      const filter: any = { agentId };
      if (messageType) {
        filter.messageType = messageType;
      }

      const results = await index.query({
        vector: queryEmbedding,
        topK: limit,
        filter,
        includeMetadata: true,
      });

      return results.matches?.map((match: any) => ({
        id: match.id,
        content: match.metadata?.content as string,
        embedding: match.values || [],
        metadata: match.metadata as any,
      })) || [];
    } catch (error) {
      console.error('Error searching Pinecone:', error);
      return [];
    }
  }

  // Preferred: search by user identity, optionally narrowed by agent/room
  async searchLongTermByUser(
    userId: string,
    query: string,
    limit: number = 5,
    options?: { agentId?: string; roomId?: string; messageType?: string }
  ): Promise<LongTermMemory[]> {
    try {
      const pc = this.ensurePinecone();
      if (!pc) return [];
      const index = pc.index(process.env.PINECONE_INDEX_NAME || 'superagent');

      const queryEmbedding = await embeddingService.generateEmbedding(query);

      const filter: any = { userId };
      if (options?.agentId) filter.agentId = options.agentId;
      if (options?.roomId) filter.conversationId = options.roomId;
      if (options?.messageType) filter.messageType = options.messageType;

      const results = await index.query({
        vector: queryEmbedding,
        topK: limit,
        filter,
        includeMetadata: true,
      });

      return results.matches?.map((match: any) => ({
        id: match.id,
        content: match.metadata?.content as string,
        embedding: match.values || [],
        metadata: match.metadata as any,
      })) || [];
    } catch (error) {
      console.error('Error searching Pinecone (by user):', error);
      return [];
    }
  }

  // Structured memory (MySQL)
  async getAgentProfile(agentId: string) {
    return await db.select().from(agentProfiles).where(eq(agentProfiles.agentId, agentId)).limit(1);
  }

  async updateAgentProfile(agentId: string, profile: {
    name?: string;
    email?: string;
    birthday?: Date;
    interests?: string[];
    timezone?: string;
  }) {
    const existing = await this.getAgentProfile(agentId);
    
    if (existing.length > 0) {
      await db.update(agentProfiles)
        .set({ ...profile, updatedAt: new Date() })
        .where(eq(agentProfiles.agentId, agentId));
    } else {
      await db.insert(agentProfiles).values({
        id: randomUUID(),
        agentId,
        ...profile,
      });
    }
  }

  async getAgentPreferences(agentId: string) {
    return await db.select().from(agentPreferences).where(eq(agentPreferences.agentId, agentId)).limit(1);
  }

  async updateAgentPreferences(agentId: string, preferences: {
    communicationStyle?: string;
    technicalLevel?: string;
    responseLength?: string;
    topics?: string[];
  }) {
    const existing = await this.getAgentPreferences(agentId);
    
    if (existing.length > 0) {
      await db.update(agentPreferences)
        .set({ ...preferences, updatedAt: new Date() })
        .where(eq(agentPreferences.agentId, agentId));
    } else {
      await db.insert(agentPreferences).values({
        id: randomUUID(),
        agentId,
        ...preferences,
      });
    }
  }

  // Conversation summarization
  async createConversationSummary(
    agentId: string,
    conversationId: string,
    messages: MemoryMessage[],
    level: number = 1
  ): Promise<ConversationSummary> {
    const summary = await summarizationService.generateSummary(messages, level);
    
    const summaryData = {
      id: randomUUID(),
      agentId,
      conversationId,
      summary: summary.content,
      keyPoints: summary.keyPoints,
      decisions: summary.decisions,
      nextSteps: summary.nextSteps,
      level,
    };

    // Ensure summaries are isolated per agent and conversation
    const result = await db.insert(conversationSummaries).values(summaryData).returning();
    return result[0] as ConversationSummary;
  }

  async getConversationSummaries(agentId: string, conversationId?: string) {
    if (conversationId) {
      return await db.select()
        .from(conversationSummaries)
        .where(and(
          eq(conversationSummaries.agentId, agentId),
          eq(conversationSummaries.conversationId, conversationId)
        ))
        .orderBy(desc(conversationSummaries.createdAt));
    }
    
    return await db.select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.agentId, agentId))
      .orderBy(desc(conversationSummaries.createdAt));
  }

  // Reflection system
  async shouldReflect(agentId: string): Promise<boolean> {
    // Get recent activity
    const recentMessages = await this.getRecentActivity(agentId);
    const activityLevel = this.calculateActivityLevel(recentMessages);
    
    // Determine reflection frequency based on activity
    const reflectionThreshold = this.getReflectionThreshold(activityLevel);
    
    return recentMessages.length >= reflectionThreshold;
  }

  async performReflection(agentId: string): Promise<void> {
    const recentMessages = this.getShortTerm(agentId);
    const patterns = await this.analyzePatterns(agentId, recentMessages);
    
    // Update agent preferences based on patterns
    await this.updateAgentPreferences(agentId, patterns.preferences);
    
    // Create or update conversation summary
    const conversationId = recentMessages[0]?.conversationId;
    if (conversationId) {
      await this.createConversationSummary(agentId, conversationId, recentMessages, 1);
    }
  }

  // Agent-to-agent memory sharing
  async queryOtherAgent(requesterAgentId: string, targetAgentId: string, query: string) {
    // Search target agent's long-term memory
    const results = await this.searchLongTerm(targetAgentId, query, 3);
    
    // Filter out sensitive information
    const filteredResults = results.filter(result => 
      result.metadata.messageType !== 'preference' && 
      !result.content.includes('password') &&
      !result.content.includes('api_key')
    );
    
    return filteredResults;
  }

  // Helper methods

  private async getRecentActivity(agentId: string): Promise<MemoryMessage[]> {
    // Get recent messages from short-term memory
    return this.getShortTerm(agentId);
  }

  private calculateActivityLevel(messages: MemoryMessage[]): 'high' | 'medium' | 'low' {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentMessages = messages.filter(msg => msg.timestamp > oneDayAgo);
    
    if (recentMessages.length >= 20) return 'high';
    if (recentMessages.length >= 5) return 'medium';
    return 'low';
  }

  private getReflectionThreshold(activityLevel: 'high' | 'medium' | 'low'): number {
    switch (activityLevel) {
      case 'high': return 1; // Reflect after every conversation
      case 'medium': return 3; // Reflect after 3 conversations
      case 'low': return 1; // Reflect after each conversation
    }
  }

  private async analyzePatterns(agentId: string, messages: MemoryMessage[]) {
    // TODO: Implement pattern analysis
    return {
      preferences: {
        communicationStyle: 'detailed',
        technicalLevel: 'intermediate',
        responseLength: 'medium',
      }
    };
  }
}

export const memoryService = new MemoryService();
