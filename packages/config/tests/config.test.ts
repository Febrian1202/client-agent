import { describe, expect, it } from 'bun:test';
import { parseConfig } from '../src/schema';

describe('Config Schema Validation', () => {
  it('parses valid environment configuration', () => {
    const rawEnv = {
      NODE_ENV: 'development',
      PORT: '3001',
      APP_URL: 'http://localhost:3001',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/client_agent',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_USERNAME: 'admin',
      AUTH_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=2,p=1$fake$hash',
      AUTH_SECRET: 'test_secret_key',
    };

    const config = parseConfig(rawEnv);

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_URL).toBe(rawEnv.DATABASE_URL);
    expect(config.REDIS_URL).toBe(rawEnv.REDIS_URL);
    expect(config.AUTH_USERNAME).toBe('admin');
  });

  it('defaults PORT to 3001 if omitted', () => {
    const rawEnv = {
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3001',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/client_agent',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_USERNAME: 'admin',
      AUTH_PASSWORD_HASH: '$argon2id$fake',
      AUTH_SECRET: 'test_secret_key',
    };

    const config = parseConfig(rawEnv);
    expect(config.PORT).toBe(3001);
  });

  it('provides sensible defaults for AI configuration', () => {
    const rawEnv = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/client_agent',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_USERNAME: 'admin',
      AUTH_PASSWORD_HASH: '$argon2id$fake',
      AUTH_SECRET: 'test_secret_key',
    };

    const config = parseConfig(rawEnv);
    expect(config.AI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(config.AI_MODEL).toBe('gpt-4o');
    expect(config.AI_TIMEOUT_MS).toBe(60000);
    expect(config.AI_MAX_RETRIES).toBe(2);
    expect(config.AI_PROVIDER_API_KEY).toBeUndefined();
  });

  it('parses custom AI configuration', () => {
    const rawEnv = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/client_agent',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_USERNAME: 'admin',
      AUTH_PASSWORD_HASH: '$argon2id$fake',
      AUTH_SECRET: 'test_secret_key',
      AI_BASE_URL: 'https://my-9router.vps.local/v1',
      AI_PROVIDER_API_KEY: 'sk-custom-9router-key',
      AI_MODEL: 'my-custom-combo',
      AI_TIMEOUT_MS: '45000',
      AI_MAX_RETRIES: '3',
    };

    const config = parseConfig(rawEnv);
    expect(config.AI_BASE_URL).toBe('https://my-9router.vps.local/v1');
    expect(config.AI_PROVIDER_API_KEY).toBe('sk-custom-9router-key');
    expect(config.AI_MODEL).toBe('my-custom-combo');
    expect(config.AI_TIMEOUT_MS).toBe(45000);
    expect(config.AI_MAX_RETRIES).toBe(3);
  });

  it('throws descriptive error when required key is missing', () => {
    const rawEnv = {
      NODE_ENV: 'development',
      // DATABASE_URL missing
      REDIS_URL: 'redis://localhost:6379',
      AUTH_USERNAME: 'admin',
      AUTH_PASSWORD_HASH: '$argon2id$fake',
      AUTH_SECRET: 'test_secret_key',
    };

    expect(() => parseConfig(rawEnv)).toThrow(/DATABASE_URL/);
  });
});
