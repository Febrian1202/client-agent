import { getRedisClient } from './connection';

export async function publishTask(
  stream: string,
  payload: Record<string, unknown>
): Promise<string> {
  const redis = getRedisClient();
  const flatArgs: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    flatArgs.push(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }

  const id = await redis.xadd(stream, '*', ...flatArgs);
  if (!id) {
    throw new Error(`Failed to publish task to stream: ${stream}`);
  }
  return id;
}
