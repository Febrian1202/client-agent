import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export function buildDraftActionRow(draftId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_draft:${draftId}`)
      .setLabel('Approve ✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`edit_draft:${draftId}`)
      .setLabel('Edit ✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`reject_draft:${draftId}`)
      .setLabel('Reject ❌')
      .setStyle(ButtonStyle.Danger),
  );
}

export function buildDraftStatusRow(
  status: string,
  actorName?: string,
): ActionRowBuilder<ButtonBuilder> {
  const normalized = status.toLowerCase();
  let label: string;
  let style: ButtonStyle = ButtonStyle.Secondary;

  if (normalized.includes('sending')) {
    label = '✅ Approved — Sending...';
    style = ButtonStyle.Success;
  } else if (normalized.includes('approve')) {
    label = actorName ? `✅ Approved by ${actorName}` : '✅ Approved';
    style = ButtonStyle.Success;
  } else if (normalized.includes('reject')) {
    label = actorName ? `❌ Rejected by ${actorName}` : '❌ Rejected';
    style = ButtonStyle.Danger;
  } else {
    label = actorName ? `${status} by ${actorName}` : status;
    style = ButtonStyle.Secondary;
  }

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('status_draft')
      .setLabel(label)
      .setStyle(style)
      .setDisabled(true),
  );
}

export function buildEditDraftModal(
  draftId: number,
  currentContent: string,
): ModalBuilder {
  const safeContent = (currentContent ?? '').slice(0, 2000);

  const textInput = new TextInputBuilder()
    .setCustomId('draft_content')
    .setLabel('Draft Content')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(safeContent)
    .setMaxLength(2000)
    .setRequired(true);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);

  return new ModalBuilder()
    .setCustomId(`modal_edit_draft:${draftId}`)
    .setTitle('Edit Draft Reply')
    .addComponents(row);
}
