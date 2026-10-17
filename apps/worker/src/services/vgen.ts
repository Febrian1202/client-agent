import { config } from '@client-agent/config';
import { createDiscordNotifier, type DiscordMessenger } from '@client-agent/discord';
import { VGenBrowserAdapter } from '@client-agent/vgen';

export interface VgenWorkerDeps {
  adapter: VGenBrowserAdapter;
  messenger: DiscordMessenger | null;
}

let sharedAdapter: VGenBrowserAdapter | null = null;

export async function resolveVgenWorkerDeps(): Promise<VgenWorkerDeps> {
  sharedAdapter ??= new VGenBrowserAdapter();
  const token = config.DISCORD_BOT_TOKEN;
  return {
    adapter: sharedAdapter,
    messenger: token ? createDiscordNotifier({ token }) : null,
  };
}
