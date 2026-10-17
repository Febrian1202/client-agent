import { describe, expect, it } from 'bun:test';
import type { ChatInputCommandInteraction, Interaction, REST } from 'discord.js';
import { createInteractionRouter, registerSlashCommands, READ_COMMAND } from '../src';
import type { ReadInteractionDeps } from '../src/commands/read';

function chatInput(commandName: string): ChatInputCommandInteraction & Interaction {
  return {
    isChatInputCommand: () => true,
    commandName,
  } as unknown as ChatInputCommandInteraction & Interaction;
}

describe('Interaction router', () => {
  it('dispatches a chat input interaction to the matching handler', async () => {
    const seen: string[] = [];
    const router = createInteractionRouter({ read: async (interaction) => { seen.push(interaction.commandName); } });
    await router(chatInput('read'));
    expect(seen).toEqual(['read']);
  });

  it('ignores non chat input interactions and unknown command names', async () => {
    const seen: string[] = [];
    const router = createInteractionRouter({ read: async (interaction) => { seen.push(interaction.commandName); } });
    await router({ isChatInputCommand: () => false } as unknown as Interaction);
    await router(chatInput('ban') as unknown as Interaction);
    expect(seen).toEqual([]);
  });

  it('swallows handler rejections instead of propagating them', async () => {
    const logs: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args); };
    try {
      const router = createInteractionRouter({
        read: async () => { throw new Error('enqueue failed'); },
      });
      await router(chatInput('read') as unknown as Interaction);
    } finally {
      console.error = originalError;
    }
    expect(logs).toHaveLength(1);
    expect(String(logs[0]![1])).toContain('enqueue failed');
  });
});

describe('Slash command registration', () => {
  it('puts the commands on the guild route when a guildId is given', async () => {
    const calls: Array<{ route: string; body: unknown }> = [];
    const rest = {
      put: async (route: string, options: { body: unknown }) => {
        calls.push({ route, body: options.body });
        return options.body;
      },
    } as unknown as REST;
    await registerSlashCommands(rest, { applicationId: 'app-1', guildId: 'guild-1', commands: [READ_COMMAND] });
    expect(calls[0]!.route).toBe('/applications/app-1/guilds/guild-1/commands');
    expect(calls[0]!.body).toEqual([READ_COMMAND]);
  });

  it('puts the commands on the global route without a guildId', async () => {
    const calls: Array<{ route: string; body: unknown }> = [];
    const rest = {
      put: async (route: string, options: { body: unknown }) => {
        calls.push({ route, body: options.body });
        return options.body;
      },
    } as unknown as REST;
    await registerSlashCommands(rest, { applicationId: 'app-1', commands: [READ_COMMAND] });
    expect(calls[0]!.route).toBe('/applications/app-1/commands');
  });
});
