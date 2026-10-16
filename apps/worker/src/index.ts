import { STREAMS, createRedisClient } from '@client-agent/queue';
import { startWorker } from './consumers';
import { handleProcessGmailEvent } from './handlers/processGmailEvent';
import { handleNotifyDiscord } from './handlers/notifyDiscord';
import { resolveDiscordNotifier } from './services/discord';

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const CONSUMER_GROUP = 'client_agent_workers';

console.log(`🚀 Starting Bun Worker (${WORKER_ID})...`);

const redis = createRedisClient();

if ((await resolveDiscordNotifier()) === null) {
  console.warn('[worker] Discord integration not configured - NOTIFY_DISCORD tasks will fail');
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
        await handleNotifyDiscord(task, deps);
      },
    },
  ],
});

async function shutdownAndExit() {
  console.log('\n🛑 Worker received shutdown signal. Exiting gracefully...');
  await shutdown();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdownAndExit);
process.on('SIGINT', shutdownAndExit);
