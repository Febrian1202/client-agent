import { STREAMS, createRedisClient } from '@client-agent/queue';
import { TaskType } from '@client-agent/domain';
import { closeSharedBrowserContext } from '@client-agent/browser';
import { client as dbClient } from '@client-agent/db';
import { startWorker } from './consumers';
import { handleProcessGmailEvent } from './handlers/processGmailEvent';
import { handleNotifyDiscord } from './handlers/notifyDiscord';
import {
  handleReadVgenConversation,
  handleSyncConversation,
} from './handlers/readVgenConversation';
import { handleGenerateSummary } from './handlers/generateSummary';
import { handleGenerateReplyDraft } from './handlers/generateReplyDraft';
import { handleSendVgenMessage } from './handlers/sendVgenMessage';
import { resolveDiscordNotifier } from './services/discord';
import { resolveVgenWorkerDeps } from './services/vgen';
import { resolveAiWorkerDeps } from './services/ai';
import { startWorkerDiscordBot } from './bot';

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const CONSUMER_GROUP = 'client_agent_workers';

console.log(`🚀 Starting Bun Worker (${WORKER_ID})...`);

const redis = createRedisClient();

if ((await resolveDiscordNotifier()) === null) {
  console.warn('[worker] Discord integration not configured - NOTIFY_DISCORD tasks will fail');
}

const botHandle = await startWorkerDiscordBot();
if (botHandle) {
  console.log('[worker] Discord bot started - /read command available');
} else {
  console.log('[worker] Discord bot not configured (DISCORD_BOT_TOKEN / DISCORD_APPLICATION_ID missing)');
}

const { shutdown } = await startWorker({
  workerId: WORKER_ID,
  group: CONSUMER_GROUP,
  redis,
  consumers: [
    { stream: STREAMS.EVENTS, handler: (task) => handleProcessGmailEvent(task) },
    {
      stream: STREAMS.NOTIFICATIONS,
      handler: async (task) => {
        const deps = await resolveDiscordNotifier();
        if (!deps) {
          throw new Error('Discord integration is not configured');
        }
        return await handleNotifyDiscord(task, deps);
      },
    },
    {
      stream: STREAMS.BROWSER,
      handler: async (task) => {
        const deps = await resolveVgenWorkerDeps();
        const type = task.data.type;
        if (type !== String(TaskType.READ_VGEN_CONVERSATION) && type !== String(TaskType.SYNC_CONVERSATION)) {
          throw new Error(`BROWSER stream received unsupported task type: ${type}`);
        }
        return type === String(TaskType.SYNC_CONVERSATION)
          ? handleSyncConversation(task, deps)
          : handleReadVgenConversation(task, deps);
      },
    },
    {
      stream: STREAMS.AGENT,
      handler: async (task) => {
        const deps = await resolveAiWorkerDeps();
        const type = task.data.type;
        if (type === String(TaskType.GENERATE_SUMMARY)) {
          return handleGenerateSummary(task, deps);
        }
        if (type === String(TaskType.GENERATE_REPLY_DRAFT)) {
          return handleGenerateReplyDraft(task, deps);
        }
        throw new Error(`AGENT stream received unsupported task type: ${type}`);
      },
    },
    {
      stream: STREAMS.SEND,
      handler: async (task) => {
        const vgenDeps = await resolveVgenWorkerDeps();
        return handleSendVgenMessage(task, {
          adapter: vgenDeps.adapter,
          messenger: vgenDeps.messenger,
        });
      },
    },
  ],
});

async function shutdownAndExit() {
  console.log('\n🛑 Worker received shutdown signal. Exiting gracefully...');
  if (botHandle) {
    await botHandle.stop();
  }
  await closeSharedBrowserContext();
  await shutdown(15000);
  redis.disconnect();
  await dbClient.end();
  process.exit(0);
}

process.on('SIGTERM', shutdownAndExit);
process.on('SIGINT', shutdownAndExit);
