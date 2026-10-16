import { REST } from 'discord.js';
import { formatEventNotification, type DiscordEventNotification } from './notifications';

export interface DiscordRestLike {
  post(route: string, options: { body: unknown }): Promise<unknown>;
  get(route: string): Promise<unknown>;
}

export interface DiscordNotifier {
  sendEventNotification(channelId: string, event: DiscordEventNotification): Promise<{ messageId: string }>;
  verifyChannel(channelId: string): Promise<{ id: string; name: string }>;
}

export function createDiscordNotifier(options: {
  token: string;
  rest?: DiscordRestLike;
}): DiscordNotifier {
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
  };
}
