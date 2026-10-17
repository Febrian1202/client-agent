import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
} from 'discord.js';

export const REPLY_COMMAND = {
  name: 'reply',
  description: 'Draft a contextual reply to a VGen client (requires human approval to send)',
  options: [
    {
      name: 'username',
      description: 'VGen username of the client',
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: 'instruction',
      description: 'What you want to convey in the reply',
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
};

export function formatReplyDraftMessage(clientUsername: string, draft: string): string {
  return [
    `✍️ **Draft Reply for @${clientUsername}**`,
    `*(Draft only — human approval required before sending)*`,
    '',
    draft.trim(),
  ].join('\n');
}

export interface PendingReplyDraftMessage {
  clientUsername: string;
  instruction: string;
  interactionId: string;
  interactionToken: string;
  applicationId: string;
  channelId: string;
}

export interface ReplyDraftInteractionDeps {
  enqueue: (input: PendingReplyDraftMessage) => Promise<{ taskId: number } | void>;
}

export async function handleReplyInteraction(
  interaction: ChatInputCommandInteraction,
  deps: ReplyDraftInteractionDeps,
): Promise<void> {
  const username = (interaction.options.getString('username', true) ?? '').trim();
  const instruction = (interaction.options.getString('instruction', true) ?? '').trim();
  await interaction.reply(`Drafting contextual reply for @${username}... ⏳`);

  try {
    await deps.enqueue({
      clientUsername: username,
      instruction,
      interactionId: interaction.id,
      interactionToken: interaction.token,
      applicationId: interaction.applicationId,
      channelId: interaction.channelId,
    });
  } catch (err: any) {
    await interaction.editReply(`❌ Failed to enqueue reply draft task: ${err.message || err}`);
  }
}
