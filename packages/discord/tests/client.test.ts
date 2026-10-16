import { describe, expect, it } from 'bun:test';
import { VGenEventType } from '@client-agent/domain';
import { createDiscordNotifier, type DiscordRestLike } from '../src/client';

function stubRest() {
  const calls: Array<{ method: 'post' | 'get'; route: string; body?: unknown }> = [];
  const rest: DiscordRestLike = {
    post: async (route, options) => { calls.push({ method: 'post', route, body: options.body }); return { id: 'msg-99' }; },
    get: async (route) => { calls.push({ method: 'get', route }); return { id: 'chan-1', name: 'vgen-alerts' }; },
  };
  return { rest, calls };
}

const event = {
  eventType: VGenEventType.NEW_MESSAGE, clientUsername: 'ErianOsamu', commissionId: null,
  subject: '@ErianOsamu sent you a new message!', receivedAt: new Date('2026-10-16T14:32:11.000Z'),
};

describe('Discord notifier', () => {
  it('posts the formatted message to the channel', async () => {
    const { rest, calls } = stubRest();
    const result = await createDiscordNotifier({ token: 't', rest }).sendEventNotification('chan-1', event);
    expect(result.messageId).toBe('msg-99');
    expect(calls[0]!.route).toBe('/channels/chan-1/messages');
    expect((calls[0]!.body as { content: string }).content).toContain('Client: @ErianOsamu');
  });

  it('verifies a channel and surfaces its name', async () => {
    const { rest } = stubRest();
    expect(await createDiscordNotifier({ token: 't', rest }).verifyChannel('chan-1')).toEqual({ id: 'chan-1', name: 'vgen-alerts' });
  });
});
