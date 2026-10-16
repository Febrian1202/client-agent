import {
  STREAMS,
  createConsumerGroupIfNotExists,
  createRedisClient,
} from '@client-agent/queue';
import { formatHeartbeat } from './heartbeat';
import { handleTask } from './taskHandler';

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const CONSUMER_GROUP = 'client_agent_workers';

console.log(`🚀 Starting Bun Worker (${WORKER_ID})...`);

const redis = createRedisClient();
let isRunning = true;

// 1. Heartbeat interval (every 30s)
const heartbeatInterval = setInterval(() => {
  console.log(formatHeartbeat(WORKER_ID));
}, 30_000);

// Log initial heartbeat immediately
console.log(formatHeartbeat(WORKER_ID));

// 2. Setup consumer groups
await createConsumerGroupIfNotExists(STREAMS.EVENTS, CONSUMER_GROUP, redis);
await createConsumerGroupIfNotExists(STREAMS.NOTIFICATIONS, CONSUMER_GROUP, redis);

console.log(`Worker listening on stream: ${STREAMS.EVENTS} (Group: ${CONSUMER_GROUP})`);

// 3. Graceful shutdown
async function shutdown() {
  if (!isRunning) return;
  console.log('\n🛑 Worker received shutdown signal. Exiting gracefully...');
  isRunning = false;
  clearInterval(heartbeatInterval);
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 4. Main consumer loop
while (isRunning) {
  try {
    await handleTask({
      stream: STREAMS.EVENTS,
      group: CONSUMER_GROUP,
      consumer: WORKER_ID,
      redis,
      onProcess: async (task) => {
        console.log(`[${new Date().toISOString()}] Received task ${task.id}:`, task.data);
      },
    });
  } catch (err) {
    if (isRunning) {
      console.error('[Worker] Consumer loop error:', err);
      await Bun.sleep(1000);
    }
  }
}
