import type { z } from 'zod';
import type { ChatTool } from '@client-agent/ai';

export interface AgentToolContext {
  db: {
    findClient: (username: string) => Promise<any>;
    getConversation: (clientUsername: string, limit?: number) => Promise<any>;
    upsertClient?: (data: any) => Promise<any>;
    upsertConversation?: (data: any) => Promise<any>;
  };
  platform?: {
    readVgenConversation: (clientUsername: string, limit?: number) => Promise<any>;
  };
}

export interface AgentToolDefinition<T = any, R = any> {
  name: string;
  description: string;
  schema: z.ZodType<T, any, any>;
  parameters: Record<string, unknown>;
  execute: (input: T, context: AgentToolContext) => Promise<R>;
}

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  data?: any;
  error?: string;
  durationMs: number;
}
