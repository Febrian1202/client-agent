import type { Redis } from './index';
import type { ParsedTask } from './consumer';

export interface RecoverPendingOptions {
  redis: Redis;
  stream: string;
  group: string;
  consumer: string;
  minIdleTimeMs?: number;
  batchSize?: number;
}

export async function recoverPendingTasks(options: RecoverPendingOptions): Promise<ParsedTask[]> {
  const { redis, stream, group, consumer, minIdleTimeMs = 300_000, batchSize = 20 } = options;
  const claimedTasks: ParsedTask[] = [];

  let startId = '0-0';
  do {
    const rawResult = await redis.xautoclaim(
      stream,
      group,
      consumer,
      minIdleTimeMs,
      startId,
      'COUNT',
      batchSize
    );

    if (!rawResult || !Array.isArray(rawResult)) {
      break;
    }

    const [nextId, entries] = rawResult as [string, [string, string[]][], string[]];
    startId = nextId;

    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (!entry || !Array.isArray(entry[1])) {
          continue;
        }
        const [id, fields] = entry;
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          data[fields[i]!] = fields[i + 1]!;
        }
        claimedTasks.push({ id, data });
      }
    }

    if (startId === '0-0' || !entries || entries.length === 0) {
      break;
    }
  } while (claimedTasks.length < 100);

  return claimedTasks;
}
