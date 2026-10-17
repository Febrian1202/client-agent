import { afterAll, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getConfig } from '@client-agent/config';
import { agentTasks, db } from '@client-agent/db';
import { STREAMS } from '@client-agent/queue';
import { TaskType } from '@client-agent/domain';
import * as realDiscord from '@client-agent/discord';

// Snapshot the real parsed config (getConfig() returns a plain object, safe to spread)
const REAL_CONFIG: Record<string, unknown> = { ...getConfig() };
// Discord env values are overridden per test and read live by the config mock
const testDiscordEnv: Record<string, string | undefined> = {};

mock.module('@client-agent/config', () => {
  const config = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop in testDiscordEnv) return testDiscordEnv[prop];
        return REAL_CONFIG[prop];
      },
    },
  );
  return {
    config,
    getConfig: () => ({ ...REAL_CONFIG, ...testDiscordEnv }),
  };
});

const discordSpy = {
  registrations: [] as Array<{ applicationId: string; guildId?: string; commands: unknown[] }>,
  botStarts: [] as Array<Record<string, unknown>>,
};

// Capture the original before mock registration; bun's mock.module rewrites exports
// in place, so calling realDiscord.registerSlashCommands inside the mock would recurse.
const capturedRegisterSlashCommands = realDiscord.registerSlashCommands;
type RegisterSlashCommandsArgs = Parameters<typeof capturedRegisterSlashCommands>;

mock.module('@client-agent/discord', () => ({
  ...realDiscord,
  registerSlashCommands: async (...args: RegisterSlashCommandsArgs) => {
    discordSpy.registrations.push(args[1]);
    if (args[0] && typeof (args[0] as any).put === 'function') {
      if (args[0] instanceof realDiscord.REST) {
        return;
      }
      return await capturedRegisterSlashCommands(args[0], args[1]);
    }
  },
  startDiscordBot: async (options: Record<string, unknown>) => {
    discordSpy.botStarts.push(options);
    return { stop: async () => {} };
  },
}));

const { resolveReadEnqueuer, resolveSummarizeEnqueuer, resolveReplyEnqueuer, startWorkerDiscordBot } = await import('../src/bot');

const createdTaskIds: number[] = [];

afterAll(async () => {
  mock.module('@client-agent/discord', () => realDiscord);
  for (const id of createdTaskIds) {
    await db.delete(agentTasks).where(eq(agentTasks.id, id));
  }
  for (const key of Object.keys(testDiscordEnv)) delete testDiscordEnv[key];
});

describe('Worker Discord bot (/read pipeline)', () => {
  it('returns null when DISCORD_BOT_TOKEN is unset', async () => {
    testDiscordEnv.DISCORD_BOT_TOKEN = undefined;
    expect(await resolveReadEnqueuer()).toBeNull();
  });

  it('enqueues one READ_VGEN_CONVERSATION task with discord meta and publishes to BROWSER stream', async () => {
    testDiscordEnv.DISCORD_BOT_TOKEN = 'bot-token-123';

    const published: Array<{ stream: string; payload: Record<string, unknown> }> = [];
    const publisher = async (stream: string, payload: Record<string, unknown>) => {
      published.push({ stream, payload });
      return 'entry-1';
    };

    const enqueue = await resolveReadEnqueuer({ publisher });
    expect(enqueue).not.toBeNull();

    const interactionId = `itx-${Date.now()}-a`;
    const result = (await enqueue!({
      clientUsername: 'ErianOsamu',
      interactionId,
      interactionToken: 'tok-abc',
      applicationId: 'app-1',
      channelId: 'chan-1',
    })) as unknown as { taskId: number };

    const taskId = result.taskId;
    expect(typeof taskId).toBe('number');
    createdTaskIds.push(taskId);

    const rows = await db.select().from(agentTasks).where(eq(agentTasks.id, taskId));
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.type).toBe(TaskType.READ_VGEN_CONVERSATION);
    expect(row.idempotencyKey).toBe(`read_vgen:ErianOsamu:${interactionId}`);
    expect(row.input).toEqual({
      clientUsername: 'ErianOsamu',
      requestedBy: 'discord',
      discord: {
        interactionId,
        interactionToken: 'tok-abc',
        applicationId: 'app-1',
        channelId: 'chan-1',
      },
    });

    expect(published).toEqual([
      {
        stream: STREAMS.BROWSER,
        payload: { type: String(TaskType.READ_VGEN_CONVERSATION), taskId: String(taskId) },
      },
    ]);
  });

  it('reuses the same task when the same interactionId is enqueued twice', async () => {
    testDiscordEnv.DISCORD_BOT_TOKEN = 'bot-token-123';

    const calls: Array<{ stream: string; payload: Record<string, unknown> }> = [];
    const publisher = async (stream: string, payload: Record<string, unknown>) => {
      calls.push({ stream, payload });
      return 'entry-x';
    };

    const enqueue = await resolveReadEnqueuer({ publisher });
    expect(enqueue).not.toBeNull();

    const interactionId = `itx-${Date.now()}-b`;
    const input = {
      clientUsername: 'ErianOsamu',
      interactionId,
      interactionToken: 'tok-def',
      applicationId: 'app-1',
      channelId: 'chan-1',
    };
    const first = (await enqueue!(input)) as unknown as { taskId: number };
    const second = (await enqueue!(input)) as unknown as { taskId: number };

    expect(second.taskId).toBe(first.taskId);
    createdTaskIds.push(first.taskId);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.stream).toBe(STREAMS.BROWSER);
    expect(calls[0]!.payload).toEqual({
      type: String(TaskType.READ_VGEN_CONVERSATION),
      taskId: String(first.taskId),
    });

    const rows = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.idempotencyKey, `read_vgen:ErianOsamu:${interactionId}`));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.id)).toBe(first.taskId);
  });

  it('startWorkerDiscordBot without DISCORD_APPLICATION_ID resolves null without registering', async () => {
    testDiscordEnv.DISCORD_BOT_TOKEN = 'bot-token-123';
    testDiscordEnv.DISCORD_APPLICATION_ID = undefined;

    const publisher = async () => 'entry-none';
    const handle = await startWorkerDiscordBot({ publisher });

    expect(handle).toBeNull();
    expect(discordSpy.registrations).toHaveLength(0);
    expect(discordSpy.botStarts).toHaveLength(0);
  });

  it('enqueues GENERATE_SUMMARY and GENERATE_REPLY_DRAFT to AGENT stream', async () => {
    testDiscordEnv.DISCORD_BOT_TOKEN = 'bot-token-123';
    testDiscordEnv.DISCORD_APPLICATION_ID = 'app-xyz';

    const published: Array<{ stream: string; payload: Record<string, unknown> }> = [];
    const publisher = async (stream: string, payload: Record<string, unknown>) => {
      published.push({ stream, payload });
      return 'entry-agent';
    };

    const summarizeEnqueue = await resolveSummarizeEnqueuer({ publisher });
    expect(summarizeEnqueue).not.toBeNull();

    const sumItxId = `itx-sum-${Date.now()}`;
    const sumRes = (await summarizeEnqueue!({
      clientUsername: 'erianosamu',
      interactionId: sumItxId,
      interactionToken: 'tok-sum',
      applicationId: 'app-xyz',
      channelId: 'chan-sum',
    })) as unknown as { taskId: number };

    createdTaskIds.push(sumRes.taskId);
    expect(published).toContainEqual({
      stream: STREAMS.AGENT,
      payload: { type: String(TaskType.GENERATE_SUMMARY), taskId: String(sumRes.taskId) },
    });

    const replyEnqueue = await resolveReplyEnqueuer({ publisher });
    expect(replyEnqueue).not.toBeNull();

    const replyItxId = `itx-reply-${Date.now()}`;
    const replyRes = (await replyEnqueue!({
      clientUsername: 'erianosamu',
      instruction: 'Say choker is ready',
      interactionId: replyItxId,
      interactionToken: 'tok-rep',
      applicationId: 'app-xyz',
      channelId: 'chan-rep',
    })) as unknown as { taskId: number };

    createdTaskIds.push(replyRes.taskId);
    expect(published).toContainEqual({
      stream: STREAMS.AGENT,
      payload: { type: String(TaskType.GENERATE_REPLY_DRAFT), taskId: String(replyRes.taskId) },
    });

    // Start bot and verify all 3 commands are registered
    discordSpy.registrations = [];
    const handle = await startWorkerDiscordBot({ publisher });
    expect(handle).not.toBeNull();
    expect(discordSpy.registrations).toHaveLength(1);
    const registeredCommands = (discordSpy.registrations[0]!.commands as any[]).map((c) => c.name);
    expect(registeredCommands).toContain('read');
    expect(registeredCommands).toContain('summarize');
    expect(registeredCommands).toContain('reply');
  });
});
