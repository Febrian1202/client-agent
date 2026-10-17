import { describe, expect, it } from 'bun:test';
import {
  createDefaultToolRegistry,
  ToolRegistry,
  type AgentToolContext,
} from '../src/index';

describe('Agent Tool Registry & Executor', () => {
  const mockContext: AgentToolContext = {
    db: {
      findClient: async (username: string) => {
        if (username === 'erianosamu') {
          return { id: 10, username: 'erianosamu', displayName: 'Erian Osamu' };
        }
        return null;
      },
      getConversation: async (clientUsername: string) => {
        if (clientUsername === 'erianosamu') {
          return {
            id: 1,
            externalId: 'vgen-conv-123',
            clientUsername: 'erianosamu',
            messages: [
              {
                id: 101,
                direction: 'inbound',
                senderName: 'ErianOsamu',
                content: 'Halo, mau tanya choker dan badannya sudah beres belum ya?',
                sentAt: new Date('2026-10-17T12:00:00Z'),
              },
            ],
          };
        }
        return null;
      },
    },
    platform: {
      readVgenConversation: async (clientUsername: string) => {
        return {
          externalId: 'vgen-live-123',
          externalUrl: `https://vgen.co/inbox/${clientUsername}`,
          messages: [
            {
              externalId: 'msg-live-1',
              direction: 'inbound',
              senderName: clientUsername,
              content: 'Live message from VGen',
              sentAt: new Date(),
            },
          ],
        };
      },
    },
  };

  it('registers default tools with valid OpenAI tool specifications', () => {
    const registry = createDefaultToolRegistry(mockContext);
    const specs = registry.getToolSpecs();

    expect(specs.length).toBeGreaterThanOrEqual(3);
    const names = specs.map((s) => s.function.name);
    expect(names).toContain('find_client');
    expect(names).toContain('get_conversation');
    expect(names).toContain('read_vgen_conversation');

    const findClientSpec = specs.find((s) => s.function.name === 'find_client');
    expect(findClientSpec?.function.parameters.type).toBe('object');
    expect(findClientSpec?.function.parameters.required).toContain('username');
  });

  it('executes find_client tool with valid arguments', async () => {
    const registry = createDefaultToolRegistry(mockContext);
    const result = await registry.execute('find_client', { username: 'erianosamu' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 10, username: 'erianosamu', displayName: 'Erian Osamu' });
  });

  it('rejects invalid arguments for tools with validation error', async () => {
    const registry = createDefaultToolRegistry(mockContext);
    const result = await registry.execute('find_client', { invalidKey: 123 } as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Validation error');
  });

  it('executes get_conversation tool returning stored history', async () => {
    const registry = createDefaultToolRegistry(mockContext);
    const result = await registry.execute('get_conversation', { clientUsername: 'erianosamu' });

    expect(result.success).toBe(true);
    expect(result.data.externalId).toBe('vgen-conv-123');
    expect(result.data.messages.length).toBe(1);
  });

  it('executes read_vgen_conversation tool calling platform adapter', async () => {
    const registry = createDefaultToolRegistry(mockContext);
    const result = await registry.execute('read_vgen_conversation', { clientUsername: 'erianosamu' });

    expect(result.success).toBe(true);
    expect(result.data.externalId).toBe('vgen-live-123');
    expect(result.data.messages[0].content).toBe('Live message from VGen');
  });

  it('fails safely when executing unknown tool', async () => {
    const registry = createDefaultToolRegistry(mockContext);
    const result = await registry.execute('non_existent_tool', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool non_existent_tool not found');
  });
});
