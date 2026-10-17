import { config } from '@client-agent/config';
import { getIntegration, getOwnerUserId } from '@client-agent/db';
import { createDiscordNotifier, type DiscordMessenger, type DiscordNotifier } from '@client-agent/discord';

export interface DiscordNotifierDeps {
  notifier: DiscordNotifier;
  messenger: DiscordMessenger;
  channelId: string;
}

export async function resolveDiscordNotifier(): Promise<DiscordNotifierDeps | null> {
  const token = config.DISCORD_BOT_TOKEN;
  if (!token) return null;

  const userId = await getOwnerUserId();
  const integration = await getIntegration(userId, 'discord');
  if (!integration || integration.status !== 'connected') return null;

  const metadata = (integration.metadata ?? {}) as Record<string, unknown>;
  const channelId = metadata.channelId;
  if (typeof channelId !== 'string' || channelId.length === 0) return null;

  const notifier = createDiscordNotifier({ token });
  return { notifier, messenger: notifier, channelId };
}
