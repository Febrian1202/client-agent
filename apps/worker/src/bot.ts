import { config } from '@client-agent/config';
import { createTask, findTaskByIdempotencyKey, getOwnerUserId } from '@client-agent/db';
import { TaskType } from '@client-agent/domain';
import { publishTask, STREAMS } from '@client-agent/queue';
import {
  READ_COMMAND,
  SUMMARIZE_COMMAND,
  REPLY_COMMAND,
  REST,
  createInteractionRouter,
  handleReadInteraction,
  handleSummarizeInteraction,
  handleReplyInteraction,
  registerSlashCommands,
  startDiscordBot,
  type BotHandle,
  type ReadInteractionDeps,
  type SummarizeInteractionDeps,
  type ReplyDraftInteractionDeps,
} from '@client-agent/discord';

export interface BotEnqueuerOptions {
  publisher?: (stream: string, payload: Record<string, unknown>) => Promise<string>;
}

export async function resolveReadEnqueuer(
  options?: BotEnqueuerOptions,
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

export async function resolveSummarizeEnqueuer(
  options?: BotEnqueuerOptions,
): Promise<SummarizeInteractionDeps['enqueue'] | null> {
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
    const idempotencyKey = `summarize_vgen:${clientUsername}:${interactionId}`;
    let task = await findTaskByIdempotencyKey(idempotencyKey);
    if (!task) {
      task = await createTask({
        userId: ownerId,
        type: TaskType.GENERATE_SUMMARY,
        input: {
          clientUsername,
          requestedBy: 'discord',
          discord: { interactionId, interactionToken, applicationId, channelId },
        },
        idempotencyKey,
      });
    }
    await publisher(STREAMS.AGENT, {
      type: String(TaskType.GENERATE_SUMMARY),
      taskId: String(task.id),
    });
    return { taskId: task.id };
  };
}

export async function resolveReplyEnqueuer(
  options?: BotEnqueuerOptions,
): Promise<ReplyDraftInteractionDeps['enqueue'] | null> {
  if (!config.DISCORD_BOT_TOKEN) return null;

  const ownerId = await getOwnerUserId();
  const publisher = options?.publisher ?? publishTask;

  return async ({
    clientUsername,
    instruction,
    interactionId,
    interactionToken,
    applicationId,
    channelId,
  }) => {
    const idempotencyKey = `reply_vgen:${clientUsername}:${interactionId}`;
    let task = await findTaskByIdempotencyKey(idempotencyKey);
    if (!task) {
      task = await createTask({
        userId: ownerId,
        type: TaskType.GENERATE_REPLY_DRAFT,
        input: {
          clientUsername,
          instruction,
          requestedBy: 'discord',
          discord: { interactionId, interactionToken, applicationId, channelId },
        },
        idempotencyKey,
      });
    }
    await publisher(STREAMS.AGENT, {
      type: String(TaskType.GENERATE_REPLY_DRAFT),
      taskId: String(task.id),
    });
    return { taskId: task.id };
  };
}

export async function startWorkerDiscordBot(
  options?: BotEnqueuerOptions,
): Promise<BotHandle | null> {
  const token = config.DISCORD_BOT_TOKEN;
  const applicationId = config.DISCORD_APPLICATION_ID;
  if (!token || !applicationId) return null;

  const readEnqueue = await resolveReadEnqueuer(options);
  const summarizeEnqueue = await resolveSummarizeEnqueuer(options);
  const replyEnqueue = await resolveReplyEnqueuer(options);

  if (!readEnqueue || !summarizeEnqueue || !replyEnqueue) return null;

  const commands = [READ_COMMAND, SUMMARIZE_COMMAND, REPLY_COMMAND];

  const rest = new REST({ version: '10' }).setToken(token);
  await registerSlashCommands(rest, {
    applicationId,
    guildId: config.DISCORD_GUILD_ID,
    commands,
  });

  return await startDiscordBot({
    token,
    applicationId,
    guildId: config.DISCORD_GUILD_ID,
    commands,
    onInteraction: createInteractionRouter({
      read: (interaction) => handleReadInteraction(interaction, { enqueue: readEnqueue }),
      summarize: (interaction) => handleSummarizeInteraction(interaction, { enqueue: summarizeEnqueue }),
      reply: (interaction) => handleReplyInteraction(interaction, { enqueue: replyEnqueue }),
    }),
  });
}
