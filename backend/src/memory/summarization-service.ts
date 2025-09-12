// Minimal fallback summarization service. Replace with a real LLM-backed
// summarizer when available. The interface matches memory-service usage.

import type { MemoryMessage } from './memory-service';

export const summarizationService = {
  async generateSummary(messages: MemoryMessage[], level: number = 1): Promise<{
    content: string;
    keyPoints: string[];
    decisions: string[];
    nextSteps: string[];
  }> {
    const last = messages.slice(-Math.min(8, messages.length));
    const content = last.map(m => `${m.role}: ${m.content}`).join('\n');
    const keyPoints = last.slice(-3).map(m => m.content.slice(0, 80));
    return {
      content: content || 'No conversation content to summarize.',
      keyPoints,
      decisions: [],
      nextSteps: [],
    };
  },
};

export default summarizationService;


