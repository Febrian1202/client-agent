import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  APP_URL: z.string().url().default('http://localhost:3001'),

  // Database & Redis
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Single-User Auth
  AUTH_USERNAME: z.string().min(1, 'AUTH_USERNAME is required'),
  AUTH_PASSWORD_HASH: z.string().min(1, 'AUTH_PASSWORD_HASH is required'),
  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),

  // Browser Automation
  BROWSER_PROFILE_PATH: z.string().default('./browser-profile'),

  // Optional / future phase variables
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_PUBSUB_TOPIC: z.string().optional(),
  GOOGLE_PUBSUB_AUDIENCE: z.string().optional(),

  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_APPLICATION_ID: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),

  AI_PROVIDER_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-3-5-sonnet-20241022'),
});

export type AppConfig = z.infer<typeof configSchema>;

export function parseConfig(env: Record<string, unknown> = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const formattedErrors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`[Configuration Error] Missing or invalid environment variables:\n${formattedErrors}`);
  }
  return result.data;
}
