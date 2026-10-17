import { config } from '@client-agent/config';
import { OpenAICompatibleClient } from '@client-agent/ai';
import { createDiscordNotifier, type DiscordMessenger } from '@client-agent/discord';

export interface AiWorkerDeps {
  aiClient: OpenAICompatibleClient;
  messenger: DiscordMessenger | null;
}

let sharedAiClient: OpenAICompatibleClient | null = null;

export async function resolveAiWorkerDeps(): Promise<AiWorkerDeps> {
  sharedAiClient ??= new OpenAICompatibleClient({
    baseURL: config.AI_BASE_URL,
    apiKey: config.AI_PROVIDER_API_KEY,
    defaultModel: config.AI_MODEL,
    timeoutMs: config.AI_TIMEOUT_MS,
    maxRetries: config.AI_MAX_RETRIES,
  });

  const token = config.DISCORD_BOT_TOKEN;
  return {
    aiClient: sharedAiClient,
    messenger: token ? createDiscordNotifier({ token }) : null,
  };
}
