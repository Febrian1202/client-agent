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
