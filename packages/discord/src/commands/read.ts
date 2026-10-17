import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { MessageResult } from '@client-agent/platform';
import { formatUtcMinute } from '../notifications';

export const READ_COMMAND = {
  name: 'read',
  description: 'Fetch the latest messages from a VGen conversation into this channel',
  options: [
    {
      name: 'username',
      description: 'VGen username of the client',
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
};

const MAX_PREVIEW_LENGTH = 1900;
const MAX_MESSAGE_LENGTH = 200;
const MAX_PREVIEW_MESSAGES = 5;

function cleanMessageContent(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_MESSAGE_LENGTH
    ? collapsed.slice(0, MAX_MESSAGE_LENGTH)
    : collapsed;
}

export function formatConversationPreview(
  clientUsername: string,
  messages: MessageResult[],
): string {
  const entries = messages.map(
    (message) =>
      `**${message.senderName} · ${message.sentAt ? formatUtcMinute(message.sentAt) : 'time unknown'}**\n> ${cleanMessageContent(message.content)}`,
  );

  const render = (count: number, body: string[]) =>
    `📨 Conversation with @${clientUsername} (latest ${count})\n${body.join('\n')}`;

  let kept = entries.slice(-MAX_PREVIEW_MESSAGES);
  let text = render(kept.length, kept);
  while (text.length > MAX_PREVIEW_LENGTH && kept.length > 0) {
    kept = kept.slice(1);
    text = render(kept.length, kept);
  }
  return text;
}

export interface PendingConversationMessage {
  clientUsername: string;
  interactionId: string;
  interactionToken: string;
  applicationId: string;
  channelId: string;
}

export interface ReadInteractionDeps {
  enqueue: (input: PendingConversationMessage) => Promise<{ taskId: number } | void>;
}

export async function handleReadInteraction(
  interaction: ChatInputCommandInteraction,
  deps: ReadInteractionDeps,
): Promise<void> {
  const username = (interaction.options.getString('username', true) ?? '').trim();
  await interaction.reply(`Fetching conversation for @${username}... ⏳`);

  if (!username) {
    await interaction.editReply('Please provide a VGen username, e.g. /read ErianOsamu.');
    return;
  }

  try {
    await deps.enqueue({
      clientUsername: username,
      interactionId: interaction.id,
      interactionToken: interaction.token,
      applicationId: interaction.applicationId,
      channelId: interaction.channelId,
    });
  } catch {
    await interaction.followUp('Failed to queue the read request. Check the worker logs.');
  }
}
