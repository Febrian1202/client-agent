import { config } from '@client-agent/config';
import { getIntegration, getOwnerUserId } from '@client-agent/db';
import { createDiscordNotifier, type DiscordNotifier } from '@client-agent/discord';

export interface DiscordNotifierDeps {
  notifier: DiscordNotifier;
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

  return { notifier: createDiscordNotifier({ token }), channelId };
}
