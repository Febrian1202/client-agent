import { describe, expect, it } from 'bun:test';
import {
  STREAMS,
  createConsumerGroupIfNotExists,
  createRedisClient,
  publishTask,
} from '../src/index';

describe('Redis Streams Producer and Consumer', () => {
  it('connects to Redis and pings successfully', async () => {
    const redis = createRedisClient();
    const pong = await redis.ping();
    expect(pong).toBe('PONG');
    redis.disconnect();
  });

  it('publishes task to stream and reads it back via consumer group', async () => {
    const testStream = `${STREAMS.EVENTS}_test_${Date.now()}`;
    const testGroup = 'test_group';

    // 1. Create consumer group
    await createConsumerGroupIfNotExists(testStream, testGroup);

    // 2. Publish task
    const testPayload = { messageId: 'msg_123', eventType: 'TEST_EVENT' };
    const entryId = await publishTask(testStream, testPayload);
    expect(entryId).toBeString();

    // 3. Read via XREADGROUP
    const redis = createRedisClient();
    const result = await redis.xreadgroup(
      'GROUP',
      testGroup,
      'test_consumer',
      'COUNT',
      1,
      'BLOCK',
      2000,
      'STREAMS',
      testStream,
      '>'
    );

    expect(result).toBeDefined();
    expect(result?.length).toBeGreaterThan(0);

    const streamEntries = result![0]![1];
    expect(streamEntries.length).toBe(1);
    const [id, fields] = streamEntries[0]!;
    expect(id).toBe(entryId);

    // Redis stream returns flat array of [key, value, key, value]
    const parsedPayload: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      parsedPayload[fields[i]!] = fields[i + 1]!;
    }
    expect(parsedPayload.messageId).toBe('msg_123');
    expect(parsedPayload.eventType).toBe('TEST_EVENT');

    // Ack
    await redis.xack(testStream, testGroup, id);

    // Clean up
    await redis.del(testStream);
    redis.disconnect();
  });
});
