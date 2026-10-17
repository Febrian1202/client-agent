import { z } from 'zod';
import type { AgentToolDefinition } from './types';

export const findClientInputSchema = z.object({
  username: z.string().min(1, 'Username is required'),
});

export const findClientTool: AgentToolDefinition<z.infer<typeof findClientInputSchema>> = {
  name: 'find_client',
  description: 'Search for a client in the database by their platform username.',
  schema: findClientInputSchema,
  parameters: {
    type: 'object',
    properties: {
      username: {
        type: 'string',
        description: 'The username of the client (e.g. erianosamu)',
      },
    },
    required: ['username'],
  },
  execute: async (input, context) => {
    return context.db.findClient(input.username);
  },
};

export const getConversationInputSchema = z.object({
  clientUsername: z.string().min(1, 'Client username is required'),
  limit: z.number().int().positive().optional().default(20),
});

export const getConversationTool: AgentToolDefinition<z.infer<typeof getConversationInputSchema>> = {
  name: 'get_conversation',
  description: 'Retrieve conversation history and messages for a client from the database.',
  schema: getConversationInputSchema,
  parameters: {
    type: 'object',
    properties: {
      clientUsername: {
        type: 'string',
        description: 'The username of the client whose messages to retrieve',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of recent messages to return (default: 20)',
      },
    },
    required: ['clientUsername'],
  },
  execute: async (input, context) => {
    return context.db.getConversation(input.clientUsername, input.limit);
  },
};

export const readVgenConversationInputSchema = z.object({
  clientUsername: z.string().min(1, 'Client username is required'),
  limit: z.number().int().positive().optional().default(20),
});

export const readVgenConversationTool: AgentToolDefinition<z.infer<typeof readVgenConversationInputSchema>> = {
  name: 'read_vgen_conversation',
  description: 'Fetch the latest live conversation messages directly from VGen via browser automation.',
  schema: readVgenConversationInputSchema,
  parameters: {
    type: 'object',
    properties: {
      clientUsername: {
        type: 'string',
        description: 'The VGen username of the client to read',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of recent messages to fetch',
      },
    },
    required: ['clientUsername'],
  },
  execute: async (input, context) => {
    if (!context.platform?.readVgenConversation) {
      throw new Error('Platform adapter is not available in tool context');
    }
    return context.platform.readVgenConversation(input.clientUsername, input.limit);
  },
};

export const defaultToolDefinitions = [
  findClientTool,
  getConversationTool,
  readVgenConversationTool,
];
