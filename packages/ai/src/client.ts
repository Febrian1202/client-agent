import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  OpenAIClientOptions,
  TokenUsage,
  ToolCall,
} from './types';

export class OpenAICompatibleClient {
  private baseURL: string;
  private apiKey?: string;
  private defaultModel: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(options: OpenAIClientOptions = {}) {
    this.baseURL = (options.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel || 'gpt-4o';
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async createChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const model = options.model || this.defaultModel;
    const url = `${this.baseURL}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const payload: Record<string, unknown> = {
      model,
      messages: options.messages,
    };
    if (typeof options.temperature === 'number') {
      payload.temperature = options.temperature;
    }
    if (typeof options.maxTokens === 'number') {
      payload.max_tokens = options.maxTokens;
    }
    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
      if (options.toolChoice) {
        payload.tool_choice = options.toolChoice;
      }
    }

    let attempt = 0;
    const startTime = Date.now();

    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const status = response.status;
          let errorMessage = `HTTP error ${status}`;
          try {
            const errorBody = (await response.json()) as any;
            if (errorBody?.error?.message) {
              errorMessage = errorBody.error.message;
            } else if (errorBody?.message) {
              errorMessage = errorBody.message;
            }
          } catch {
            // body wasn't JSON
          }

          // Retriable: 429 and 5xx
          const isRetriable = status === 429 || status >= 500;
          if (isRetriable && attempt <= this.maxRetries) {
            const delay = Math.min(100 * Math.pow(2, attempt), 2000);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          throw new Error(errorMessage);
        }

        const data = (await response.json()) as any;
        const durationMs = Date.now() - startTime;

        const choice = data.choices?.[0];
        const content: string | null = choice?.message?.content ?? null;
        const finishReason: string = choice?.finish_reason || 'stop';
        const rawToolCalls = choice?.message?.tool_calls;

        let toolCalls: ToolCall[] | undefined = undefined;
        if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
          toolCalls = rawToolCalls.map((tc: any) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function?.name,
              arguments: tc.function?.arguments,
            },
          }));
        }

        const usage: TokenUsage = {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        };

        return {
          content,
          toolCalls,
          usage,
          durationMs,
          model: data.model || model,
          finishReason,
        };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error(`Request timed out after ${this.timeoutMs}ms`);
        }
        if (attempt > this.maxRetries || err.message === 'Invalid API key provided' || !err.message.includes('429')) {
          // If it's a non-retriable error or out of retries, rethrow
          if (err.message && !err.message.includes('429') && !err.message.includes('500') && !err.message.includes('HTTP error 5')) {
            throw err;
          }
        }
        if (attempt <= this.maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt), 2000);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }

    throw new Error('Chat completion failed after retries');
  }
}
