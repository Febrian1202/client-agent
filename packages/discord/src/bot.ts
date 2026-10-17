import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';

export { REST };

export interface BotOptions {
  token: string;
  applicationId: string;
  guildId?: string;
  commands: unknown[];
  onInteraction: (interaction: Interaction) => Promise<void>;
}

export interface BotHandle {
  stop(): Promise<void>;
}

export async function startDiscordBot(options: BotOptions): Promise<BotHandle> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', () => {
    console.log(`[discord:bot] Gateway connected (application ${options.applicationId})`);
  });

  client.on('interactionCreate', (interaction) => {
    options
      .onInteraction(interaction)
      .catch((err) => {
        console.error('[discord:bot] Interaction handler failed:', err);
      });
  });

  await client.login(options.token);
  return {
    stop: async () => {
      await client.destroy();
    },
  };
}

export async function registerSlashCommands(
  rest: REST,
  options: { applicationId: string; guildId?: string; commands: unknown[] },
): Promise<void> {
  const route = options.guildId
    ? Routes.applicationGuildCommands(options.applicationId, options.guildId)
    : Routes.applicationCommands(options.applicationId);
  await rest.put(route, { body: options.commands });
}

export function createInteractionRouter(
  handlers: Record<string, (interaction: ChatInputCommandInteraction) => Promise<void>>,
): (interaction: Interaction) => Promise<void> {
  return async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const handler = handlers[interaction.commandName];
    if (!handler) return;
    try {
      await handler(interaction);
    } catch (err) {
      console.error(`[discord:bot] Handler for /${interaction.commandName} failed:`, err);
    }
  };
}
