import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
} from 'discord.js';

export const SUMMARIZE_COMMAND = {
  name: 'summarize',
  description: 'Generate an AI summary of conversation with a VGen client',
  options: [
    {
      name: 'username',
      description: 'VGen username of the client',
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
};

export function formatSummaryMessage(clientUsername: string, summary: string): string {
  return [
    `📋 **Conversation Summary · @${clientUsername}**`,
    '',
    summary.trim(),
  ].join('\n');
}

export interface PendingSummarizeMessage {
  clientUsername: string;
  interactionId: string;
  interactionToken: string;
  applicationId: string;
  channelId: string;
}

export interface SummarizeInteractionDeps {
  enqueue: (input: PendingSummarizeMessage) => Promise<{ taskId: number } | void>;
}

export async function handleSummarizeInteraction(
  interaction: ChatInputCommandInteraction,
  deps: SummarizeInteractionDeps,
): Promise<void> {
  const username = (interaction.options.getString('username', true) ?? '').trim();
  await interaction.reply(`Analyzing conversation for @${username}... ⏳`);

  try {
    await deps.enqueue({
      clientUsername: username,
      interactionId: interaction.id,
      interactionToken: interaction.token,
      applicationId: interaction.applicationId,
      channelId: interaction.channelId,
    });
  } catch (err: any) {
    await interaction.editReply(`❌ Failed to enqueue summarization task: ${err.message || err}`);
  }
}
