import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import {
  buildDraftActionRow,
  buildDraftStatusRow,
  buildEditDraftModal,
} from '../components/draftButtons';
import { formatReplyDraftMessage } from '../commands/reply';

export interface DraftInteractionDeps {
  approveDraft: (input: { draftId: number; userId?: number | string }) => Promise<unknown>;
  rejectDraft: (input: { draftId: number; userId?: number | string; reason?: string }) => Promise<unknown>;
  updateDraftContent: (input: { draftId: number; newContent: string; userId?: number | string }) => Promise<unknown>;
  getDraftContent?: (draftId: number) => Promise<string | null | undefined>;
}

function clampMessageWithSuffix(baseContent: string, suffix: string): string {
  if (!baseContent) {
    return suffix.trimStart();
  }
  const maxBaseLength = 2000 - suffix.length;
  const safeBase =
    baseContent.length > maxBaseLength
      ? baseContent.slice(0, Math.max(0, maxBaseLength - 3)) + '...'
      : baseContent;
  return `${safeBase}${suffix}`;
}

export async function handleDraftButtonInteraction(
  interaction: ButtonInteraction,
  deps: DraftInteractionDeps,
): Promise<void> {
  const customId = interaction.customId;
  const colonIndex = customId.indexOf(':');
  if (colonIndex === -1) return;

  const action = customId.slice(0, colonIndex);
  const draftId = parseInt(customId.slice(colonIndex + 1), 10);
  if (isNaN(draftId)) return;

  const actorName = interaction.user?.username ?? 'Creator';
  const userId = interaction.user?.id;

  if (action === 'approve_draft') {
    await deps.approveDraft({ draftId, userId });
    const statusRow = buildDraftStatusRow('approved', actorName);
    const suffix = `\n\n✅ Approved by ${actorName}`;
    const baseContent = (interaction.message?.content ?? '').replace(/\n\n[✅❌].*$/, '').trim();
    const content = clampMessageWithSuffix(baseContent, suffix);

    await interaction.update({
      content,
      components: [statusRow],
    });
  } else if (action === 'reject_draft') {
    await deps.rejectDraft({ draftId, userId });
    const statusRow = buildDraftStatusRow('rejected', actorName);
    const suffix = `\n\n❌ Rejected by ${actorName}`;
    const baseContent = (interaction.message?.content ?? '').replace(/\n\n[✅❌].*$/, '').trim();
    const content = clampMessageWithSuffix(baseContent, suffix);

    await interaction.update({
      content,
      components: [statusRow],
    });
  } else if (action === 'edit_draft') {
    let content = '';
    if (deps.getDraftContent) {
      content = (await deps.getDraftContent(draftId)) ?? '';
    }
    if (!content && interaction.message?.content) {
      const parts = interaction.message.content.split('*(Draft only — human approval required before sending)*');
      if (parts.length > 1 && parts[1]) {
        content = parts[1].trim();
      } else {
        content = interaction.message.content;
      }
    }
    const modal = buildEditDraftModal(draftId, content);
    await interaction.showModal(modal);
  }
}

export async function handleDraftModalSubmitInteraction(
  interaction: ModalSubmitInteraction,
  deps: DraftInteractionDeps,
): Promise<void> {
  const customId = interaction.customId;
  const colonIndex = customId.indexOf(':');
  if (colonIndex === -1) return;

  const action = customId.slice(0, colonIndex);
  const draftId = parseInt(customId.slice(colonIndex + 1), 10);
  if (isNaN(draftId)) return;

  if (action !== 'modal_edit_draft') return;

  const newContent = interaction.fields.getTextInputValue('draft_content');
  const userId = interaction.user?.id;

  await deps.updateDraftContent({ draftId, newContent, userId });

  let formattedContent = newContent;
  if (interaction.message?.content) {
    const match = interaction.message.content.match(/✍️ \*\*Draft Reply for @([^\n*]+)\*\*/);
    if (match && match[1]) {
      formattedContent = formatReplyDraftMessage(match[1].trim(), newContent);
    }
  }

  if (formattedContent.length > 2000) {
    formattedContent = formattedContent.slice(0, 1997) + '...';
  }

  const actionRow = buildDraftActionRow(draftId);
  if (typeof (interaction as any).update === 'function') {
    await (interaction as any).update({
      content: formattedContent,
      components: [actionRow],
    });
  } else if (typeof (interaction as any).reply === 'function') {
    await (interaction as any).reply({
      content: formattedContent,
      components: [actionRow],
    });
  }
}
