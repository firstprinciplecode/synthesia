import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// === PROVIDER TYPES ===

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek';

export type LLMContentBlock = 
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | LLMContentBlock[];
}

// Helper to detect and extract image URLs from text
export function extractImageUrls(text: string): { text: string; imageUrls: string[] } {
  const imageUrlPattern = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp)(?:\?[^\s]*)?)/gi;
  const imageUrls: string[] = [];
  const matches = text.match(imageUrlPattern);
  
  if (matches) {
    imageUrls.push(...matches);
  }
  
  return { text, imageUrls };
}

// Helper to convert message to content blocks format
export function messageToContentBlocks(message: LLMMessage): LLMMessage {
  if (typeof message.content !== 'string') {
    return message; // Already in blocks format
  }
  
  const { text, imageUrls } = extractImageUrls(message.content);
  
  if (imageUrls.length === 0) {
    return message; // No images, keep as string
  }
  
  // Convert to blocks format
  const blocks: LLMContentBlock[] = [
    { type: 'text', text }
  ];
  
  for (const url of imageUrls) {
    blocks.push({
      type: 'image_url',
      image_url: { url }
    });
  }
  
  return {
    ...message,
    content: blocks
  };
}

// Convert our generic message content to Google Generative AI Part[] format
function toGoogleParts(content: string | LLMContentBlock[]): any[] {
  if (typeof content === 'string') {
    return [{ text: content }];
  }
  const parts: any[] = [];
  for (const block of content) {
    if ((block as any)?.type === 'text') {
      parts.push({ text: (block as any).text });
    } else if ((block as any)?.type === 'image_url') {
      const url = (block as any).image_url?.url;
      // Degrade image blocks to textual reference to maintain type compatibility
      // If needed, this can be upgraded to actual image parts supported by the SDK
      parts.push({ text: `Image: ${String(url || '')}` });
    }
  }
  if (parts.length === 0) return [{ text: '' }];
  return parts;
}

export interface LLMStreamChunk {
  delta: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: string;
}

export interface LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

// === PROVIDER IMPLEMENTATIONS ===

export class OpenAIProvider {
  protected client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async *stream(messages: LLMMessage[], config: LLMConfig): AsyncGenerator<LLMStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: config.model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      const finishReason = chunk.choices[0]?.finish_reason;
      
      yield {
        delta,
        finishReason: finishReason as any,
        usage: chunk.usage ? {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        } : undefined,
      };
    }
  }

  async complete(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: config.model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: false,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content || '',
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      model: response.model,
      finishReason: choice.finish_reason || 'stop',
    };
  }
}

export class AnthropicProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

async *stream(messages: LLMMessage[], config: LLMConfig): AsyncGenerator<LLMStreamChunk> {
    // Convert messages to Anthropic format
    const systemMessage = messages.find(m => m.role === 'system')?.content;
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const stream = await this.client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens || 4000,
      temperature: config.temperature,
      system: typeof systemMessage === 'string' ? systemMessage : undefined,
      messages: conversationMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : m.content as any,
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield {
          delta: chunk.delta.text,
        };
      } else if (chunk.type === 'message_stop') {
        yield {
          delta: '',
          finishReason: 'stop',
        };
      }
    }
  }

  async complete(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
    const systemMessage = messages.find(m => m.role === 'system')?.content;
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const response = await this.client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens || 4000,
      temperature: config.temperature,
      system: typeof systemMessage === 'string' ? systemMessage : undefined,
      messages: conversationMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : m.content as any,
      })),
    });

    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as any).text)
      .join('');

    return {
      content,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      finishReason: response.stop_reason || 'stop',
    };
  }
}

export class GoogleProvider {
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async *stream(messages: LLMMessage[], config: LLMConfig): AsyncGenerator<LLMStreamChunk> {
    const model = this.client.getGenerativeModel({ model: config.model });
    
    // Convert messages to Google format
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: toGoogleParts(m.content),
      })) as any;

    const systemInstruction = messages.find(m => m.role === 'system')?.content;
    
    const result = await model.generateContentStream({
      contents: contents as any,
      systemInstruction: systemInstruction ? { role: 'system', parts: toGoogleParts(systemInstruction as any) } as any : undefined,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      },
    });

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield { delta: text };
      }
    }

    // Final chunk with usage (if available)
    const finalResult = await result.response;
    yield {
      delta: '',
      finishReason: 'stop',
      usage: finalResult.usageMetadata ? {
        promptTokens: finalResult.usageMetadata.promptTokenCount || 0,
        completionTokens: finalResult.usageMetadata.candidatesTokenCount || 0,
        totalTokens: finalResult.usageMetadata.totalTokenCount || 0,
      } : undefined,
    };
  }

  async complete(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
    const model = this.client.getGenerativeModel({ model: config.model });
    
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: toGoogleParts(m.content),
      })) as any;

    const systemInstruction = messages.find(m => m.role === 'system')?.content;
    
    const result = await model.generateContent({
      contents: contents as any,
      systemInstruction: systemInstruction ? { role: 'system', parts: toGoogleParts(systemInstruction as any) } as any : undefined,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      },
    });

    const response = result.response;
    return {
      content: response.text(),
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      },
      model: config.model,
      finishReason: 'stop',
    };
  }
}

// xAI and DeepSeek use OpenAI-compatible APIs
export class XAIProvider extends OpenAIProvider {
  constructor(apiKey: string) {
    super(''); // We'll override the baseURL
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
    });
  }
}

export class DeepSeekProvider extends OpenAIProvider {
  constructor(apiKey: string) {
    super(''); // We'll override the baseURL
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
    });
  }
}

// === PROVIDER REGISTRY ===

export class LLMRouter {
  private providers: Map<LLMProvider, any> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    if (process.env.OPENAI_API_KEY) {
      this.providers.set('openai', new OpenAIProvider(process.env.OPENAI_API_KEY));
    }
    
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.set('anthropic', new AnthropicProvider(process.env.ANTHROPIC_API_KEY));
    }
    
    if (process.env.GOOGLE_API_KEY) {
      this.providers.set('google', new GoogleProvider(process.env.GOOGLE_API_KEY));
    }
    
    if (process.env.XAI_API_KEY) {
      this.providers.set('xai', new XAIProvider(process.env.XAI_API_KEY));
    }
    
    if (process.env.DEEPSEEK_API_KEY) {
      this.providers.set('deepseek', new DeepSeekProvider(process.env.DEEPSEEK_API_KEY));
    }
  }

  getProvider(provider: LLMProvider) {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not available. Check API key configuration.`);
    }
    return providerInstance;
  }

  async *stream(
    provider: LLMProvider,
    messages: LLMMessage[],
    config: LLMConfig
  ): AsyncGenerator<LLMStreamChunk> {
    const providerInstance = this.getProvider(provider);
    yield* providerInstance.stream(messages, config);
  }

  async complete(
    provider: LLMProvider,
    messages: LLMMessage[],
    config: LLMConfig
  ): Promise<LLMResponse> {
    const providerInstance = this.getProvider(provider);
    return providerInstance.complete(messages, config);
  }

  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.providers.keys());
  }
}

// === MODEL CONFIGURATIONS ===

export const ModelConfigs = {
  // OpenAI
  'gpt-4o': { provider: 'openai' as LLMProvider, maxTokens: 128000 },
  'gpt-4o-mini': { provider: 'openai' as LLMProvider, maxTokens: 128000 },
  'gpt-4-turbo': { provider: 'openai' as LLMProvider, maxTokens: 128000 },
  // Additional OpenAI aliases (availability depends on account)
  'gpt-4.1': { provider: 'openai' as LLMProvider, maxTokens: 128000 },
  'gpt-4.1-mini': { provider: 'openai' as LLMProvider, maxTokens: 128000 },
  // gpt-5 family (availability may be gated by account)
  'gpt-5': { provider: 'openai' as LLMProvider, maxTokens: 200000 },
  'gpt-5-mini': { provider: 'openai' as LLMProvider, maxTokens: 200000 },
  
  // Anthropic
  'claude-3-5-sonnet-20241022': { provider: 'anthropic' as LLMProvider, maxTokens: 200000 },
  'claude-3-5-haiku-20241022': { provider: 'anthropic' as LLMProvider, maxTokens: 200000 },
  'claude-3-opus-20240229': { provider: 'anthropic' as LLMProvider, maxTokens: 200000 },
  // Latest-label convenience aliases
  'claude-3-5-sonnet-latest': { provider: 'anthropic' as LLMProvider, maxTokens: 200000 },
  'claude-3-5-haiku-latest': { provider: 'anthropic' as LLMProvider, maxTokens: 200000 },
  
  // Google
  'gemini-1.5-pro': { provider: 'google' as LLMProvider, maxTokens: 2000000 },
  'gemini-1.5-flash': { provider: 'google' as LLMProvider, maxTokens: 1000000 },
  'gemini-1.5-pro-latest': { provider: 'google' as LLMProvider, maxTokens: 2000000 },
  'gemini-1.5-flash-8b': { provider: 'google' as LLMProvider, maxTokens: 1000000 },
  
  // xAI
  'grok-beta': { provider: 'xai' as LLMProvider, maxTokens: 131072 },
  'grok-2': { provider: 'xai' as LLMProvider, maxTokens: 131072 },
  
  // DeepSeek
  'deepseek-chat': { provider: 'deepseek' as LLMProvider, maxTokens: 64000 },
  'deepseek-reasoner': { provider: 'deepseek' as LLMProvider, maxTokens: 64000 },
} as const;

export type SupportedModel = keyof typeof ModelConfigs;
