import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { OpenAICompatibleClient, type ChatMessage } from '../src/index';

describe('OpenAICompatibleClient', () => {
  let mockServer: ReturnType<typeof Bun.serve>;
  let mockBaseUrl: string;
  let requestLog: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  let responseGenerator: (req: Request) => Promise<Response> | Response;

  beforeAll(() => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = req.url;
        const headers: Record<string, string> = {};
        req.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const bodyText = await req.text();
        let body: any = null;
        try {
          body = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          body = bodyText;
        }
        requestLog.push({ url, headers, body });
        return responseGenerator(req);
      },
    });
    mockBaseUrl = `http://localhost:${mockServer.port}/v1`;
  });

  afterAll(() => {
    mockServer.stop(true);
  });

  it('sends chat completion to custom baseURL with bearer token and parses result', async () => {
    requestLog = [];
    responseGenerator = () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl-test-1',
          object: 'chat.completion',
          model: 'custom-combo-v1',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Tentu, choker sudah selesai dan file Google Drive sudah diupdate.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 25,
            total_tokens: 145,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const client = new OpenAICompatibleClient({
      baseURL: mockBaseUrl,
      apiKey: 'test-9router-key',
      defaultModel: 'custom-combo-v1',
      timeoutMs: 5000,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Status choker?' },
    ];

    const result = await client.createChatCompletion({
      messages,
      temperature: 0.7,
    });

    expect(requestLog.length).toBe(1);
    expect(requestLog[0]!.url).toBe(`http://localhost:${mockServer.port}/v1/chat/completions`);
    expect(requestLog[0]!.headers['authorization']).toBe('Bearer test-9router-key');
    expect(requestLog[0]!.body.model).toBe('custom-combo-v1');
    expect(requestLog[0]!.body.messages.length).toBe(2);

    expect(result.content).toBe('Tentu, choker sudah selesai dan file Google Drive sudah diupdate.');
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('custom-combo-v1');
    expect(result.usage.promptTokens).toBe(120);
    expect(result.usage.completionTokens).toBe(25);
    expect(result.usage.totalTokens).toBe(145);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('supports tool calling and returns tool_calls', async () => {
    requestLog = [];
    responseGenerator = () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl-test-tool',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: {
                      name: 'get_conversation',
                      arguments: '{"clientUsername":"erianosamu"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 15, total_tokens: 95 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const client = new OpenAICompatibleClient({
      baseURL: mockBaseUrl,
      apiKey: 'test-9router-key',
    });

    const result = await client.createChatCompletion({
      messages: [{ role: 'user', content: 'Check messages for erianosamu' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_conversation',
            description: 'Get conversation history',
            parameters: {
              type: 'object',
              properties: { clientUsername: { type: 'string' } },
              required: ['clientUsername'],
            },
          },
        },
      ],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls?.length).toBe(1);
    expect(result.toolCalls![0]!.id).toBe('call_123');
    expect(result.toolCalls![0]!.function.name).toBe('get_conversation');
    expect(result.toolCalls![0]!.function.arguments).toBe('{"clientUsername":"erianosamu"}');
  });

  it('retries on 429 and succeeds on subsequent attempt', async () => {
    requestLog = [];
    let attempts = 0;
    responseGenerator = () => {
      attempts++;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'Success after rate limit' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new OpenAICompatibleClient({
      baseURL: mockBaseUrl,
      apiKey: 'test-key',
      maxRetries: 2,
    });

    const result = await client.createChatCompletion({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(attempts).toBe(2);
    expect(result.content).toBe('Success after rate limit');
  });

  it('throws descriptive error on 401 Unauthorized without retrying', async () => {
    requestLog = [];
    let attempts = 0;
    responseGenerator = () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Invalid API key provided' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new OpenAICompatibleClient({
      baseURL: mockBaseUrl,
      apiKey: 'invalid-key',
      maxRetries: 3,
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    ).rejects.toThrow('Invalid API key provided');

    // 401 is not retriable
    expect(attempts).toBe(1);
  });

  it('aborts and throws descriptive error when timeout is exceeded', async () => {
    requestLog = [];
    responseGenerator = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'slow' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new OpenAICompatibleClient({
      baseURL: mockBaseUrl,
      timeoutMs: 50,
      maxRetries: 0,
    });

    await expect(
      client.createChatCompletion({
        messages: [{ role: 'user', content: 'hello' }],
      })
    ).rejects.toThrow('Request timed out after 50ms');
  });
});
