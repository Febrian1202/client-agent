import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
} from 'discord.js';

export { REST };
export type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  ModalSubmitInteraction,
};

export type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;
export type ButtonHandler = (interaction: ButtonInteraction) => Promise<void>;
export type ModalSubmitHandler = (interaction: ModalSubmitInteraction) => Promise<void>;

export interface InteractionRouterOptions {
  commands?: Record<string, CommandHandler>;
  buttons?: Record<string, ButtonHandler> | ButtonHandler;
  modals?: Record<string, ModalSubmitHandler> | ModalSubmitHandler;
  onButton?: ButtonHandler;
  onModalSubmit?: ModalSubmitHandler;
}

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
  handlersOrOptions:
    | Record<string, CommandHandler>
    | InteractionRouterOptions,
  additionalOptions?: InteractionRouterOptions,
): (interaction: Interaction) => Promise<void> {
  const isOptionsObject =
    'commands' in handlersOrOptions ||
    'buttons' in handlersOrOptions ||
    'modals' in handlersOrOptions ||
    'onButton' in handlersOrOptions ||
    'onModalSubmit' in handlersOrOptions;

  const commandHandlers: Record<string, CommandHandler> = isOptionsObject
    ? (handlersOrOptions as InteractionRouterOptions).commands ?? {}
    : (handlersOrOptions as Record<string, CommandHandler>);

  const buttonHandler: ButtonHandler | Record<string, ButtonHandler> | undefined =
    additionalOptions?.onButton ??
    additionalOptions?.buttons ??
    (isOptionsObject
      ? (handlersOrOptions as InteractionRouterOptions).onButton ??
        (handlersOrOptions as InteractionRouterOptions).buttons
      : undefined);

  const modalHandler: ModalSubmitHandler | Record<string, ModalSubmitHandler> | undefined =
    additionalOptions?.onModalSubmit ??
    additionalOptions?.modals ??
    (isOptionsObject
      ? (handlersOrOptions as InteractionRouterOptions).onModalSubmit ??
        (handlersOrOptions as InteractionRouterOptions).modals
      : undefined);

  return async (interaction: Interaction) => {
    if (typeof (interaction as any).isChatInputCommand === 'function' && interaction.isChatInputCommand()) {
      const handler = commandHandlers[interaction.commandName];
      if (!handler) return;
      try {
        await handler(interaction);
      } catch (err) {
        console.error(`[discord:bot] Handler for /${interaction.commandName} failed:`, err);
      }
      return;
    }

    if (typeof (interaction as any).isButton === 'function' && interaction.isButton()) {
      if (!buttonHandler) return;
      try {
        if (typeof buttonHandler === 'function') {
          await buttonHandler(interaction);
        } else {
          const prefix = interaction.customId.split(':')[0];
          const handler =
            buttonHandler[interaction.customId] ?? (prefix ? buttonHandler[prefix] : undefined);
          if (handler) {
            await handler(interaction);
          }
        }
      } catch (err) {
        console.error(`[discord:bot] Handler for button ${interaction.customId} failed:`, err);
      }
      return;
    }

    if (typeof (interaction as any).isModalSubmit === 'function' && interaction.isModalSubmit()) {
      if (!modalHandler) return;
      try {
        if (typeof modalHandler === 'function') {
          await modalHandler(interaction);
        } else {
          const prefix = interaction.customId.split(':')[0];
          const handler =
            modalHandler[interaction.customId] ?? (prefix ? modalHandler[prefix] : undefined);
          if (handler) {
            await handler(interaction);
          }
        }
      } catch (err) {
        console.error(`[discord:bot] Handler for modal ${interaction.customId} failed:`, err);
      }
      return;
    }
  };
}
