import { STREAMS, createRedisClient } from '@client-agent/queue';
import { startWorker } from './consumers';
import { handleProcessGmailEvent } from './handlers/processGmailEvent';

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const CONSUMER_GROUP = 'client_agent_workers';

console.log(`🚀 Starting Bun Worker (${WORKER_ID})...`);

const redis = createRedisClient();

const { shutdown } = await startWorker({
  workerId: WORKER_ID,
  group: CONSUMER_GROUP,
  redis,
  consumers: [
    { stream: STREAMS.EVENTS, handler: (task) => handleProcessGmailEvent(task) },
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
