import { config } from '@client-agent/config';
import { createTask, findTaskByIdempotencyKey, getOwnerUserId } from '@client-agent/db';
import { TaskType } from '@client-agent/domain';
import { publishTask, STREAMS } from '@client-agent/queue';
import {
  READ_COMMAND,
  REST,
  createInteractionRouter,
  handleReadInteraction,
  registerSlashCommands,
  startDiscordBot,
  type BotHandle,
  type ReadInteractionDeps,
} from '@client-agent/discord';

export interface ReadEnqueuerOptions {
  publisher?: (stream: string, payload: Record<string, unknown>) => Promise<string>;
}

export async function resolveReadEnqueuer(
  options?: ReadEnqueuerOptions,
): Promise<ReadInteractionDeps['enqueue'] | null> {
  if (!config.DISCORD_BOT_TOKEN) return null;

  const ownerId = await getOwnerUserId();
  const publisher = options?.publisher ?? publishTask;

  return async ({
    clientUsername,
    interactionId,
    interactionToken,
    applicationId,
    channelId,
  }) => {
    const idempotencyKey = `read_vgen:${clientUsername}:${interactionId}`;
    let task = await findTaskByIdempotencyKey(idempotencyKey);
    if (!task) {
      task = await createTask({
        userId: ownerId,
        type: TaskType.READ_VGEN_CONVERSATION,
        input: {
          clientUsername,
          requestedBy: 'discord',
          discord: { interactionId, interactionToken, applicationId, channelId },
        },
        idempotencyKey,
      });
    }
    await publisher(STREAMS.BROWSER, {
      type: String(TaskType.READ_VGEN_CONVERSATION),
      taskId: String(task.id),
    });
    return { taskId: task.id };
  };
}

export async function startWorkerDiscordBot(
  options?: ReadEnqueuerOptions,
): Promise<BotHandle | null> {
  const token = config.DISCORD_BOT_TOKEN;
  const applicationId = config.DISCORD_APPLICATION_ID;
  if (!token || !applicationId) return null;

  const enqueue = await resolveReadEnqueuer(options);
  if (!enqueue) return null;

  const rest = new REST({ version: '10' }).setToken(token);
  await registerSlashCommands(rest, {
    applicationId,
    guildId: config.DISCORD_GUILD_ID,
    commands: [READ_COMMAND],
  });

  return await startDiscordBot({
    token,
    applicationId,
    guildId: config.DISCORD_GUILD_ID,
    commands: [READ_COMMAND],
    onInteraction: createInteractionRouter({
      read: (interaction) => handleReadInteraction(interaction, { enqueue }),
    }),
  });
}
