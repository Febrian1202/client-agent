import { config } from '@client-agent/config';
import { createDiscordNotifier } from '@client-agent/discord';

export class DiscordNotConfiguredError extends Error {
  constructor(message = 'Discord bot token is not configured') {
    super(message);
    this.name = 'DiscordNotConfiguredError';
  }
}

export async function verifyDiscordChannel(channelId: string): Promise<{ id: string; name: string }> {
  const token = config.DISCORD_BOT_TOKEN;

  if (!token) {
    throw new DiscordNotConfiguredError();
  }

  return createDiscordNotifier({ token }).verifyChannel(channelId);
}
