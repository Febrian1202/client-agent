import { describe, expect, it } from 'bun:test';
import { handleSendVgenMessage, type SendVgenMessageDeps } from '../src/handlers/sendVgenMessage';
import { DraftStatus } from '@client-agent/domain';
import { SendAmbiguousError } from '@client-agent/vgen';

describe('Worker: SEND_VGEN_MESSAGE Handler', () => {
  it('aborts and marks task dead when safety gate check fails', async () => {
    let auditAction = '';
    let taskDead = false;
    let discordAlert = '';

    const mockDeps: any = {
      getDraft: async () => ({ id: 1, conversationId: 10, content: 'Text', status: DraftStatus.PENDING_APPROVAL }), // unapproved!
      getConversation: async () => ({ id: 10, clientId: 100, platform: 'vgen' }),
      getClient: async () => ({ id: 100, username: 'client' }),
      getApprovals: async () => [],
      getLatestInboundMessage: async () => null,
      getCreatorUsername: () => 'r1daz_',
      adapter: { getAuthenticatedUsername: async () => 'r1daz_', sendMessage: async () => ({ success: true, messageId: 'm1' }) },
      insertAuditLog: async (log: any) => { auditAction = log.action; },
      markTaskDead: async () => { taskDead = true; },
      markTaskCompleted: async () => {},
      updateDraft: async () => {},
      insertMessage: async () => {},
      messenger: { sendChannelMessage: async (_ch: string, text: string) => { discordAlert = text; } },
    };

    const task: any = { id: 'stream-1', data: { taskId: 42, draftId: 1 } };
    expect(handleSendVgenMessage(task, mockDeps)).rejects.toThrow();
    expect(taskDead).toBe(true);
    expect(auditAction).toBe('MESSAGE_SEND_ABORTED_SAFETY_CHECK');
    expect(discordAlert).toContain('Safety check blocked send');
  });

  it('marks task dead and halts without retry when adapter throws SendAmbiguousError', async () => {
    let auditAction = '';
    let taskDead = false;

    const mockDeps: any = {
      getDraft: async () => ({
        id: 1,
        conversationId: 10,
        content: 'Text',
        status: DraftStatus.APPROVED,
        createdAt: new Date(),
      }),
      getConversation: async () => ({ id: 10, clientId: 100, platform: 'vgen', externalUrl: 'https://vgen.co/10' }),
      getClient: async () => ({ id: 100, username: 'client' }),
      getApprovals: async () => [{ id: 1, draftId: 1, status: 'active', action: 'approve', contentHash: 'abc' }],
      getLatestInboundMessage: async () => null,
      getCreatorUsername: () => 'r1daz_',
      adapter: {
        getAuthenticatedUsername: async () => 'r1daz_',
        sendMessage: async () => { throw new SendAmbiguousError('DOM timeout'); },
      },
      insertAuditLog: async (log: any) => { auditAction = log.action; },
      markTaskDead: async () => { taskDead = true; },
      markTaskCompleted: async () => {},
      updateDraft: async () => {},
      insertMessage: async () => {},
      messenger: { sendChannelMessage: async () => {} },
      computeHash: () => 'abc',
    };

    const task: any = { id: 'stream-1', data: { taskId: 42, draftId: 1 } };
    expect(handleSendVgenMessage(task, mockDeps)).rejects.toThrow();
    expect(taskDead).toBe(true);
    expect(auditAction).toBe('MESSAGE_SEND_FAILED');
  });

  it('successfully delivers message, records message, updates draft, logs audit, and marks task complete', async () => {
    const auditActions: string[] = [];
    let completedOutput: any = null;
    let updatedDraft: any = null;
    let insertedMessage: any = null;
    let discordNotification = '';

    const mockDeps: any = {
      getDraft: async () => ({
        id: 1,
        conversationId: 10,
        content: 'Hello client!',
        status: DraftStatus.APPROVED,
        createdAt: new Date(),
      }),
      getConversation: async () => ({ id: 10, clientId: 100, platform: 'vgen', externalUrl: 'https://vgen.co/10' }),
      getClient: async () => ({ id: 100, username: 'client' }),
      getApprovals: async () => [{ id: 1, draftId: 1, status: 'active', action: 'approve', contentHash: 'abc' }],
      getLatestInboundMessage: async () => null,
      getCreatorUsername: () => 'r1daz_',
      adapter: {
        getAuthenticatedUsername: async () => 'r1daz_',
        sendMessage: async (_input: any) => ({ success: true, messageId: 'msg-999' }),
      },
      insertAuditLog: async (log: any) => { auditActions.push(log.action); },
      markTaskDead: async () => {},
      markTaskCompleted: async (_id: number, output: any) => { completedOutput = output; },
      updateDraft: async (_id: number, data: any) => { updatedDraft = data; },
      insertMessage: async (_convId: number, data: any) => { insertedMessage = data; },
      messenger: { sendChannelMessage: async (_ch: string, text: string) => { discordNotification = text; } },
      computeHash: () => 'abc',
    };

    const task: any = { id: 'stream-1', data: { taskId: 42, draftId: 1 } };
    await handleSendVgenMessage(task, mockDeps);

    expect(auditActions).toContain('AGENT_ATTEMPTED_SEND');
    expect(auditActions).toContain('MESSAGE_SENT');
    expect(updatedDraft.status).toBe(DraftStatus.SENT);
    expect(insertedMessage.externalId).toBe('msg-999');
    expect(insertedMessage.direction).toBe('outbound');
    expect(insertedMessage.senderType).toBe('creator');
    expect(completedOutput).toEqual({ success: true, messageId: 'msg-999' });
    expect(discordNotification).toContain('Message successfully delivered to @client on VGen!');
  });
});
