import { describe, expect, it } from 'bun:test';
import {
  buildDraftActionRow,
  buildDraftStatusRow,
  buildEditDraftModal,
  handleDraftButtonInteraction,
  handleDraftModalSubmitInteraction,
  type DraftInteractionDeps,
} from '../src';

describe('Discord Draft Buttons and Modals', () => {
  it('builds an ActionRow with Approve, Edit, and Reject buttons', () => {
    const row = buildDraftActionRow(42);
    expect(row.components.length).toBe(3);
    expect((row.components[0]?.data as any).custom_id).toBe('approve_draft:42');
    expect((row.components[1]?.data as any).custom_id).toBe('edit_draft:42');
    expect((row.components[2]?.data as any).custom_id).toBe('reject_draft:42');
  });

  it('builds a status row with a disabled status badge button', () => {
    const row = buildDraftStatusRow('approved', 'Creator');
    expect(row.components.length).toBe(1);
    expect((row.components[0]?.data as any).disabled).toBe(true);
    expect((row.components[0]?.data as any).label).toContain('Approved by Creator');

    const rejectRow = buildDraftStatusRow('rejected');
    expect(rejectRow.components.length).toBe(1);
    expect((rejectRow.components[0]?.data as any).disabled).toBe(true);
    expect((rejectRow.components[0]?.data as any).label).toContain('Rejected');
  });

  it('builds a modal for editing draft text', () => {
    const modal = buildEditDraftModal(42, 'Existing text');
    expect((modal.data as any).custom_id).toBe('modal_edit_draft:42');
    expect(((modal.components[0] as any).components[0].data as any).value).toBe('Existing text');
  });

  it('handles approve button click by invoking service and updating message', async () => {
    let approvedDraftId: number | null = null;
    let updatedPayload: any = null;

    const deps: DraftInteractionDeps = {
      approveDraft: async ({ draftId }) => {
        approvedDraftId = draftId;
      },
      rejectDraft: async () => {},
      updateDraftContent: async () => {},
      getDraftContent: async () => 'test',
    };

    const mockButtonInteraction: any = {
      isButton: () => true,
      isModalSubmit: () => false,
      customId: 'approve_draft:42',
      user: { id: 'user1', username: 'Creator' },
      update: async (payload: any) => {
        updatedPayload = payload;
      },
    };

    await handleDraftButtonInteraction(mockButtonInteraction, deps);
    expect(approvedDraftId as any).toBe(42);
    expect(updatedPayload.content).toContain('Approved by Creator');
  });

  it('handles reject button click by invoking service and updating message', async () => {
    let rejectedDraftId: number | null = null;
    let updatedPayload: any = null;

    const deps: DraftInteractionDeps = {
      approveDraft: async () => {},
      rejectDraft: async ({ draftId }) => {
        rejectedDraftId = draftId;
      },
      updateDraftContent: async () => {},
      getDraftContent: async () => 'test',
    };

    const mockButtonInteraction: any = {
      isButton: () => true,
      isModalSubmit: () => false,
      customId: 'reject_draft:42',
      user: { id: 'user1', username: 'Creator' },
      update: async (payload: any) => {
        updatedPayload = payload;
      },
    };

    await handleDraftButtonInteraction(mockButtonInteraction, deps);
    expect(rejectedDraftId as any).toBe(42);
    expect(updatedPayload.content).toContain('Rejected by Creator');
  });

  it('handles edit button click by showing the edit modal', async () => {
    let shownModal: any = null;

    const deps: DraftInteractionDeps = {
      approveDraft: async () => {},
      rejectDraft: async () => {},
      updateDraftContent: async () => {},
      getDraftContent: async (id) => `Existing text for ${id}`,
    };

    const mockButtonInteraction: any = {
      isButton: () => true,
      isModalSubmit: () => false,
      customId: 'edit_draft:42',
      user: { id: 'user1', username: 'Creator' },
      showModal: async (modal: any) => {
        shownModal = modal;
      },
    };

    await handleDraftButtonInteraction(mockButtonInteraction, deps);
    expect(shownModal).toBeDefined();
    expect((shownModal.data as any).custom_id).toBe('modal_edit_draft:42');
    expect(((shownModal.components[0] as any).components[0].data as any).value).toBe('Existing text for 42');
  });

  it('handles modal submit by updating draft content and restoring action buttons', async () => {
    let updatedDraftId: number | null = null;
    let updatedContent: string = '';
    let updatedPayload: any = null;

    const deps: DraftInteractionDeps = {
      approveDraft: async () => {},
      rejectDraft: async () => {},
      updateDraftContent: async ({ draftId, newContent }) => {
        updatedDraftId = draftId;
        updatedContent = newContent;
      },
      getDraftContent: async () => 'test',
    };

    const mockModalInteraction: any = {
      isButton: () => false,
      isModalSubmit: () => true,
      customId: 'modal_edit_draft:42',
      user: { id: 'user1', username: 'Creator' },
      message: {
        content: '✍️ **Draft Reply for @client1**\n*(Draft only — human approval required before sending)*\n\nOld text',
      },
      fields: {
        getTextInputValue: (fieldId: string) => {
          if (fieldId === 'draft_content') return 'New edited text';
          return '';
        },
      },
      update: async (payload: any) => {
        updatedPayload = payload;
      },
    };

    await handleDraftModalSubmitInteraction(mockModalInteraction, deps);
    expect(updatedDraftId as any).toBe(42);
    expect(updatedContent).toBe('New edited text');
    expect(updatedPayload.content).toContain('New edited text');
    expect(updatedPayload.content).toContain('@client1');
    expect(updatedPayload.components.length).toBe(1);
    expect((updatedPayload.components[0].components[0].data as any).custom_id).toBe('approve_draft:42');
  });

  it('handles edit button fallback extraction from message content when getDraftContent is omitted', async () => {
    let shownModal: any = null;

    const deps: DraftInteractionDeps = {
      approveDraft: async () => {},
      rejectDraft: async () => {},
      updateDraftContent: async () => {},
    };

    const mockButtonInteraction: any = {
      isButton: () => true,
      isModalSubmit: () => false,
      customId: 'edit_draft:99',
      user: { id: 'user1', username: 'Creator' },
      message: {
        content:
          '✍️ **Draft Reply for @client2**\n*(Draft only — human approval required before sending)*\n\nFallback draft content extracted',
      },
      showModal: async (modal: any) => {
        shownModal = modal;
      },
    };

    await handleDraftButtonInteraction(mockButtonInteraction, deps);
    expect(shownModal).toBeDefined();
    expect(((shownModal.components[0] as any).components[0].data as any).value).toBe(
      'Fallback draft content extracted',
    );
  });

  it('handles modal submit using reply() when update() is not a function', async () => {
    let repliedPayload: any = null;

    const deps: DraftInteractionDeps = {
      approveDraft: async () => {},
      rejectDraft: async () => {},
      updateDraftContent: async () => {},
    };

    const mockModalInteraction: any = {
      isButton: () => false,
      isModalSubmit: () => true,
      customId: 'modal_edit_draft:77',
      user: { id: 'user1', username: 'Creator' },
      fields: {
        getTextInputValue: () => 'Direct reply text',
      },
      reply: async (payload: any) => {
        repliedPayload = payload;
      },
    };

    await handleDraftModalSubmitInteraction(mockModalInteraction, deps);
    expect(repliedPayload).toBeDefined();
    expect(repliedPayload.content).toBe('Direct reply text');
    expect(repliedPayload.components.length).toBe(1);
  });

  it('safely ignores invalid button or modal customIds', async () => {
    let called = false;
    const deps: DraftInteractionDeps = {
      approveDraft: async () => { called = true; },
      rejectDraft: async () => { called = true; },
      updateDraftContent: async () => { called = true; },
    };

    // No colon
    await handleDraftButtonInteraction({ customId: 'invalid' } as any, deps);
    expect(called).toBe(false);

    // Non-numeric ID
    await handleDraftButtonInteraction({ customId: 'approve_draft:abc' } as any, deps);
    expect(called).toBe(false);

    // Unknown action
    await handleDraftButtonInteraction({ customId: 'unknown_action:12' } as any, deps);
    expect(called).toBe(false);

    // Invalid modal customId
    await handleDraftModalSubmitInteraction({ customId: 'other_modal:12' } as any, deps);
    expect(called).toBe(false);
  });

  it('clamps button update message content to max 2000 characters when appending approval or rejection', async () => {
    let updatedPayload: any = null;
    const deps: DraftInteractionDeps = {
      approveDraft: async () => {},
      rejectDraft: async () => {},
      updateDraftContent: async () => {},
    };

    const longContent = 'A'.repeat(2000);
    const mockButtonInteraction: any = {
      isButton: () => true,
      isModalSubmit: () => false,
      customId: 'approve_draft:55',
      user: { id: 'user1', username: 'SuperLongCreatorNameThatExtendsTheSuffix' },
      message: { content: longContent },
      update: async (payload: any) => {
        updatedPayload = payload;
      },
    };

    await handleDraftButtonInteraction(mockButtonInteraction, deps);
    expect(updatedPayload.content.length).toBeLessThanOrEqual(2000);
    expect(updatedPayload.content).toContain('...');
    expect(updatedPayload.content).toContain('✅ Approved by SuperLongCreatorNameThatExtendsTheSuffix');

    // Test rejection as well
    mockButtonInteraction.customId = 'reject_draft:55';
    await handleDraftButtonInteraction(mockButtonInteraction, deps);
    expect(updatedPayload.content.length).toBeLessThanOrEqual(2000);
    expect(updatedPayload.content).toContain('...');
    expect(updatedPayload.content).toContain('❌ Rejected by SuperLongCreatorNameThatExtendsTheSuffix');
  });

  it('clamps modal submit formatted content to max 2000 characters', async () => {
    let updatedPayload: any = null;
    const deps: DraftInteractionDeps = {
      approveDraft: async () => {},
      rejectDraft: async () => {},
      updateDraftContent: async () => {},
    };

    const veryLongInput = 'B'.repeat(2500);
    const mockModalInteraction: any = {
      isButton: () => false,
      isModalSubmit: () => true,
      customId: 'modal_edit_draft:66',
      user: { id: 'user1', username: 'Creator' },
      message: {
        content: '✍️ **Draft Reply for @someclient**\n*(Draft only — human approval required before sending)*\n\nOld text',
      },
      fields: {
        getTextInputValue: () => veryLongInput,
      },
      update: async (payload: any) => {
        updatedPayload = payload;
      },
    };

    await handleDraftModalSubmitInteraction(mockModalInteraction, deps);
    expect(updatedPayload.content.length).toBeLessThanOrEqual(2000);
    expect(updatedPayload.content.endsWith('...')).toBe(true);
  });
});
