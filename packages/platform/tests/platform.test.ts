import { describe, expect, test } from 'bun:test';
import type { ConversationResult, PlatformAdapter } from '@client-agent/platform';

describe('PlatformAdapter contracts', () => {
  test('getConversation returns conversation shape with null sentAt message', async () => {
    const conversation: ConversationResult = {
      externalId: 't1',
      externalUrl: 'u',
      clientUsername: 'me',
      messages: [
        {
          externalId: 'm1',
          direction: 'inbound',
          senderName: 'me',
          content: 'hello',
          sentAt: null,
        },
      ],
    };

    const adapter: PlatformAdapter = {
      findClient: () => {
        throw new Error('not implemented');
      },
      getConversation: () => Promise.resolve(conversation),
      getMessages: () => {
        throw new Error('not implemented');
      },
      sendMessage: () => {
        throw new Error('not implemented');
      },
    };

    const result = await adapter.getConversation({ clientUsername: 'me' });

    expect(result.externalId).toBe('t1');
    expect(result.clientUsername).toBe('me');
    expect(result.messages[0]?.sentAt).toBeNull();
  });
});
