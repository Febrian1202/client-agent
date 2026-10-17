import { REST } from 'discord.js';
import { formatEventNotification, type DiscordEventNotification } from './notifications';

export interface DiscordRestLike {
  post(route: string, options: { body: unknown }): Promise<unknown>;
  patch(route: string, options: { body: unknown }): Promise<unknown>;
  get(route: string): Promise<unknown>;
}

export interface DiscordNotifier {
  sendEventNotification(channelId: string, event: DiscordEventNotification): Promise<{ messageId: string }>;
  verifyChannel(channelId: string): Promise<{ id: string; name: string }>;
}

export interface DiscordMessenger {
  editInteractionFollowup(input: {
    applicationId: string;
    interactionToken: string;
    content: string;
  }): Promise<{ messageId: string | null }>;
  sendChannelMessage(channelId: string, content: string): Promise<{ messageId: string }>;
}

interface RestError extends Error {
  status?: number;
  code?: number;
}

function isExpiredInteractionToken(err: unknown): boolean {
  const restError = err as RestError | undefined;
  return (
    restError?.status === 404 ||
    restError?.code === 10062 ||
    String(restError?.message ?? '').includes('404')
  );
}

export function createDiscordNotifier(options: {
  token: string;
  rest?: DiscordRestLike;
}): DiscordNotifier & DiscordMessenger {
  const rest: DiscordRestLike =
    options.rest ?? new REST({ version: '10' }).setToken(options.token);

  return {
    async sendEventNotification(channelId, event) {
      const response = (await rest.post(`/channels/${channelId}/messages`, {
        body: { content: formatEventNotification(event) },
      })) as { id: string | number };
      return { messageId: String(response.id) };
    },

    async verifyChannel(channelId) {
      const response = (await rest.get(`/channels/${channelId}`)) as { id: string; name: string };
      return { id: response.id, name: response.name };
    },

    async editInteractionFollowup({ applicationId, interactionToken, content }) {
      try {
        const response = (await rest.patch(
          `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
          { body: { content } },
        )) as { id: string | number };
        return { messageId: String(response.id) };
      } catch (err) {
        if (isExpiredInteractionToken(err)) return { messageId: null };
        throw err;
      }
    },

    async sendChannelMessage(channelId, content) {
      const response = (await rest.post(`/channels/${channelId}/messages`, {
        body: { content },
      })) as { id: string | number };
      return { messageId: String(response.id) };
    },
  };
}
