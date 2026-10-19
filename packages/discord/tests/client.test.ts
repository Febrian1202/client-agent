import { describe, expect, it } from 'bun:test';
import { VGenEventType } from '@client-agent/domain';
import { createDiscordNotifier, type DiscordRestLike } from '../src/client';

function stubRest() {
  const calls: Array<{ method: 'post' | 'patch' | 'get'; route: string; body?: unknown }> = [];
  const rest: DiscordRestLike = {
    post: async (route, options) => { calls.push({ method: 'post', route, body: options.body }); return { id: 'msg-99' }; },
    patch: async (route, options) => { calls.push({ method: 'patch', route, body: options.body }); return { id: 'msg-77' }; },
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

describe('Discord messenger', () => {
  it('edits the interaction followup via the original webhook message', async () => {
    const { rest, calls } = stubRest();
    const result = await createDiscordNotifier({ token: 't', rest }).editInteractionFollowup({
      applicationId: 'app-1', interactionToken: 'tok-1', content: 'Finished! ✅',
    });
    expect(result).toEqual({ messageId: 'msg-77' });
    expect(calls[0]!.route).toBe('/webhooks/app-1/tok-1/messages/@original');
    expect((calls[0]!.body as { content: string }).content).toBe('Finished! ✅');
  });

  it('resolves a null messageId when the interaction token expired (404)', async () => {
    const expired = Object.assign(new Error('HTTP 404 Not Found'), { status: 404, code: 10062 });
    const rest: DiscordRestLike = {
      post: async () => { throw new Error('unexpected post'); },
      patch: async () => { throw expired; },
      get: async () => ({}),
    };
    const result = await createDiscordNotifier({ token: 't', rest }).editInteractionFollowup({
      applicationId: 'app-1', interactionToken: 'tok-1', content: 'too late',
    });
    expect(result).toEqual({ messageId: null });
  });

  it('rethrows patch errors that are not expired-token problems', async () => {
    const rest: DiscordRestLike = {
      post: async () => { throw new Error('unexpected post'); },
      patch: async () => { throw new Error('HTTP 500 Internal Server Error'); },
      get: async () => ({}),
    };
    const notifier = createDiscordNotifier({ token: 't', rest });
    await expect(notifier.editInteractionFollowup({
      applicationId: 'app-1', interactionToken: 'tok-1', content: 'x',
    })).rejects.toThrow('HTTP 500 Internal Server Error');
  });

  it('sends a channel message via POST /channels/{id}/messages', async () => {
    const { rest, calls } = stubRest();
    const result = await createDiscordNotifier({ token: 't', rest }).sendChannelMessage('chan-9', 'Here is your preview 📨');
    expect(result).toEqual({ messageId: 'msg-99' });
    expect(calls[0]!.route).toBe('/channels/chan-9/messages');
    expect((calls[0]!.body as { content: string }).content).toBe('Here is your preview 📨');
  });

  it('includes components and embeds in editInteractionFollowup', async () => {
    const { rest, calls } = stubRest();
    const mockComponent = { toJSON: () => ({ type: 1, components: [] }) };
    const mockEmbed = { toJSON: () => ({ title: 'Embed Title' }) };

    await createDiscordNotifier({ token: 't', rest }).editInteractionFollowup({
      applicationId: 'app-1',
      interactionToken: 'tok-1',
      content: 'Updated draft',
      components: [mockComponent as any],
      embeds: [mockEmbed as any],
    });

    expect(calls[0]!.route).toBe('/webhooks/app-1/tok-1/messages/@original');
    const body = calls[0]!.body as any;
    expect(body.content).toBe('Updated draft');
    expect(body.components).toEqual([{ type: 1, components: [] }]);
    expect(body.embeds).toEqual([{ title: 'Embed Title' }]);
  });

  it('includes components and embeds in sendChannelMessage options', async () => {
    const { rest, calls } = stubRest();
    const mockComponent = { toJSON: () => ({ type: 1, components: [] }) };

    await createDiscordNotifier({ token: 't', rest }).sendChannelMessage('chan-9', 'Preview', {
      components: [mockComponent as any],
      embeds: [{ title: 'Plain Embed' }],
    });

    expect(calls[0]!.route).toBe('/channels/chan-9/messages');
    const body = calls[0]!.body as any;
    expect(body.content).toBe('Preview');
    expect(body.components).toEqual([{ type: 1, components: [] }]);
    expect(body.embeds).toEqual([{ title: 'Plain Embed' }]);
  });
});
