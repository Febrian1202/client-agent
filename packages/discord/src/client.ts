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
    components?: unknown[];
    embeds?: unknown[];
  }): Promise<{ messageId: string | null }>;
  sendChannelMessage(
    channelId: string,
    content: string,
    options?: {
      components?: unknown[];
      embeds?: unknown[];
    },
  ): Promise<{ messageId: string }>;
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

    async editInteractionFollowup({ applicationId, interactionToken, content, components, embeds }) {
      try {
        const body: Record<string, unknown> = { content };
        if (components !== undefined) {
          body.components = components.map((c) =>
            c && typeof (c as any).toJSON === 'function' ? (c as any).toJSON() : c,
          );
        }
        if (embeds !== undefined) {
          body.embeds = embeds.map((e) =>
            e && typeof (e as any).toJSON === 'function' ? (e as any).toJSON() : e,
          );
        }
        const response = (await rest.patch(
          `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
          { body },
        )) as { id: string | number };
        return { messageId: String(response.id) };
      } catch (err) {
        if (isExpiredInteractionToken(err)) return { messageId: null };
        throw err;
      }
    },

    async sendChannelMessage(channelId, content, options) {
      const body: Record<string, unknown> = { content };
      if (options?.components !== undefined) {
        body.components = options.components.map((c) =>
          c && typeof (c as any).toJSON === 'function' ? (c as any).toJSON() : c,
        );
      }
      if (options?.embeds !== undefined) {
        body.embeds = options.embeds.map((e) =>
          e && typeof (e as any).toJSON === 'function' ? (e as any).toJSON() : e,
        );
      }
      const response = (await rest.post(`/channels/${channelId}/messages`, {
        body,
      })) as { id: string | number };
      return { messageId: String(response.id) };
    },
  };
}
