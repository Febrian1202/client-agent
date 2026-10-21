import { describe, expect, it } from 'bun:test';
import { ApiClient, ApiError } from '../src/lib/api';

describe('Web App ApiClient', () => {
  it('parses successful health check responses', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ status: 'ready', database: 'ok', redis: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const client = new ApiClient({ fetch: mockFetch });
    const health = await client.getHealth();

    expect(health.status).toBe('ready');
    expect(health.database).toBe('ok');
    expect(health.redis).toBe('ok');
  });

  it('handles login success and extracts user object', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          user: { id: 1, name: 'admin', email: 'admin@localhost' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const client = new ApiClient({ fetch: mockFetch });
    const user = await client.login('admin', 'admin123');

    expect(user.id).toBe(1);
    expect(user.name).toBe('admin');
  });

  it('throws descriptive error on invalid credentials', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const client = new ApiClient({ fetch: mockFetch });
    expect(client.login('admin', 'wrong')).rejects.toThrow('Invalid username or password');
  });

  it('retrieves current logged-in user with getMe', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          user: { id: 1, name: 'admin', email: 'admin@localhost' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const client = new ApiClient({ fetch: mockFetch });
    const user = await client.getMe();
    expect(user).not.toBeNull();
    expect(user?.name).toBe('admin');
  });

  it('returns null on getMe when unauthenticated', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'No active session' },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const client = new ApiClient({ fetch: mockFetch });
    const user = await client.getMe();
    expect(user).toBeNull();
  });

  it('fetches dashboard summary via getDashboardSummary', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          metrics: {
            activeCount: 5,
            inQueueCount: 3,
            completedMonthCount: 18,
            pendingDraftCount: 3,
          },
          activeCommissions: [
            {
              id: 1,
              serviceName: 'Character Illustration',
              status: 'in_progress',
              amount: '350.00',
              currency: 'USD',
            },
          ],
          commissions: [
            {
              id: 1,
              serviceName: 'Character Illustration',
              status: 'in_progress',
              amount: '350.00',
              currency: 'USD',
            },
          ],
          recentMessages: [
            {
              id: 10,
              conversationId: 1,
              direction: 'inbound',
              senderName: 'KitsuneMei',
              content: 'Can you adjust the hair color?',
            },
          ],
          pendingDrafts: [
            {
              id: 5,
              conversationId: 1,
              content: 'Sure, I can tweak that for you!',
              status: 'pending_approval',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const summary = await client.getDashboardSummary();

    expect(capturedUrl).toBe('/api/v1/dashboard/summary');
    expect(summary.metrics.activeCount).toBe(5);
    expect(summary.activeCommissions.length).toBe(1);
    expect(summary.recentMessages.length).toBe(1);
    expect(summary.pendingDrafts.length).toBe(1);
  });

  it('lists commissions with query filters', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          commissions: [
            {
              id: 1,
              serviceName: 'Live2D Model',
              status: 'active',
              amount: '1200.00',
              currency: 'USD',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const commissions = await client.listCommissions({ status: 'active' });

    expect(capturedUrl).toBe('/api/v1/commissions?status=active');
    expect(commissions.length).toBe(1);
    expect(commissions[0].serviceName).toBe('Live2D Model');
  });

  it('retrieves single commission and updates commission', async () => {
    let capturedPatchBody = '';
    let capturedPatchUrl = '';
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        capturedPatchUrl = String(url);
        capturedPatchBody = String(init.body);
        return new Response(
          JSON.stringify({
            commission: {
              id: 1,
              serviceName: 'Live2D Model',
              status: 'in_progress',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          commission: {
            id: 1,
            serviceName: 'Live2D Model',
            status: 'requested',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const commission = await client.getCommission(1);
    expect(commission.id).toBe(1);

    const updated = await client.updateCommission(1, { status: 'in_progress' });
    expect(capturedPatchUrl).toBe('/api/v1/commissions/1');
    expect(JSON.parse(capturedPatchBody)).toEqual({ status: 'in_progress' });
    expect(updated.status).toBe('in_progress');
  });

  it('lists conversations', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          conversations: [
            {
              id: 1,
              platform: 'vgen',
              externalId: 'vgen_123',
              status: 'active',
              clientUsername: 'KitsuneMei',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const conversations = await client.listConversations();

    expect(capturedUrl).toBe('/api/v1/conversations');
    expect(conversations.length).toBe(1);
    expect(conversations[0].clientUsername).toBe('KitsuneMei');
  });

  it('retrieves conversation with client context', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          conversation: {
            id: 1,
            clientId: 10,
            platform: 'vgen',
            externalId: 'conv_1',
            status: 'active',
          },
          client: {
            id: 10,
            username: 'KitsuneMei',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const client = new ApiClient({ fetch: mockFetch });
    const res = await client.getConversation(1);

    expect(res.conversation.id).toBe(1);
    expect(res.client?.username).toBe('KitsuneMei');
  });

  it('retrieves conversation messages with order and limit', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          messages: [
            {
              id: 1,
              conversationId: 1,
              direction: 'inbound',
              senderType: 'client',
              senderName: 'KitsuneMei',
              content: 'Hello, are commissions open?',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const messages = await client.getConversationMessages(1);

    expect(capturedUrl).toBe('/api/v1/conversations/1/messages');
    expect(messages.length).toBe(1);
    expect(messages[0].senderName).toBe('KitsuneMei');
  });

  it('triggers conversation sync via syncConversation', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? 'GET';
      return new Response(
        JSON.stringify({
          taskId: 'task_100',
          status: 'queued',
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const res = await client.syncConversation(1);

    expect(capturedUrl).toBe('/api/v1/conversations/1/sync');
    expect(capturedMethod).toBe('POST');
    expect(res.status).toBe('queued');
  });

  it('lists drafts filtered by status', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          drafts: [
            {
              id: 1,
              conversationId: 1,
              content: 'Thanks for reaching out!',
              status: 'pending_approval',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const drafts = await client.listDrafts({ status: 'pending_approval' });

    expect(capturedUrl).toBe('/api/v1/drafts?status=pending_approval');
    expect(drafts.length).toBe(1);
    expect(drafts[0].status).toBe('pending_approval');
  });

  it('retrieves single draft with approvals, creates and updates draft', async () => {
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            draft: { id: 2, conversationId: 1, content: 'Created draft', status: 'pending_approval' },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            draft: { id: 1, conversationId: 1, content: 'Updated draft', status: 'pending_approval' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          draft: { id: 1, conversationId: 1, content: 'Existing draft', status: 'pending_approval' },
          approvals: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const fetched = await client.getDraft(1);
    expect(fetched.draft.id).toBe(1);

    const created = await client.createDraft({ conversationId: 1, content: 'Created draft' });
    expect(created.id).toBe(2);

    const updated = await client.updateDraft(1, 'Updated draft');
    expect(updated.content).toBe('Updated draft');
  });

  it('approves a draft via approveDraft', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? 'GET';
      return new Response(
        JSON.stringify({
          draft: {
            id: 1,
            conversationId: 1,
            content: 'Approved response',
            status: 'approved',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const draft = await client.approveDraft(1);

    expect(capturedUrl).toBe('/api/v1/drafts/1/approve');
    expect(capturedMethod).toBe('POST');
    expect(draft.status).toBe('approved');
  });

  it('rejects a draft via rejectDraft', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? 'GET';
      capturedBody = String(init?.body);
      return new Response(
        JSON.stringify({
          draft: {
            id: 1,
            conversationId: 1,
            content: 'Rejected response',
            status: 'rejected',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const draft = await client.rejectDraft(1, 'Too informal');

    expect(capturedUrl).toBe('/api/v1/drafts/1/reject');
    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody)).toEqual({ reason: 'Too informal' });
    expect(draft.status).toBe('rejected');
  });

  it('dispatches an approved draft via sendDraft', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? 'GET';
      return new Response(
        JSON.stringify({
          taskId: 42,
          status: 'queued',
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const res = await client.sendDraft(1);

    expect(capturedUrl).toBe('/api/v1/drafts/1/send');
    expect(capturedMethod).toBe('POST');
    expect(res.taskId).toBe(42);
    expect(res.status).toBe('queued');
  });

  it('handles 409 NOT_APPROVED error when sending unapproved draft', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'NOT_APPROVED',
            message: 'Draft must be approved before sending',
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );

    const client = new ApiClient({ fetch: mockFetch });
    let error: any;
    try {
      await client.sendDraft(1);
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('NOT_APPROVED');
    expect(error.message).toBe('Draft must be approved before sending');
  });

  it('lists clients and retrieves a client by id', async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/clients/10')) {
        return new Response(
          JSON.stringify({
            client: {
              id: 10,
              userId: 1,
              platform: 'vgen',
              username: 'KitsuneMei',
              displayName: 'Mei',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          clients: [
            {
              id: 10,
              userId: 1,
              platform: 'vgen',
              username: 'KitsuneMei',
              displayName: 'Mei',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const clients = await client.listClients({ search: 'Mei' });
    expect(clients.length).toBe(1);
    expect(clients[0].username).toBe('KitsuneMei');

    const single = await client.getClient(10);
    expect(single.id).toBe(10);
    expect(single.displayName).toBe('Mei');
  });

  it('lists agent tasks with pagination metadata', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          tasks: [
            {
              id: 1,
              type: 'generate_reply_draft',
              status: 'completed',
              attempts: 1,
              maxAttempts: 3,
            },
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const result = await client.listTasks();

    expect(capturedUrl).toBe('/api/v1/agent/tasks');
    expect(result.tasks.length).toBe(1);
    expect(result.pagination.total).toBe(1);
  });

  it('retries a failed task via retryTask', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? 'GET';
      return new Response(
        JSON.stringify({
          task: {
            id: 1,
            type: 'generate_reply_draft',
            status: 'queued',
            attempts: 0,
          },
          status: 're-queued',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const res = await client.retryTask(1);

    expect(capturedUrl).toBe('/api/v1/agent/tasks/1/retry');
    expect(capturedMethod).toBe('POST');
    expect(res.status).toBe('re-queued');
    expect(res.task.id).toBe(1);
  });

  it('lists integrations via listIntegrations', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          data: [
            { provider: 'gmail', status: 'connected', connected: true, metadata: {} },
            { provider: 'discord', status: 'disconnected', connected: false, metadata: {} },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const integrations = await client.listIntegrations();

    expect(capturedUrl).toBe('/api/v1/integrations');
    expect(integrations.length).toBe(2);
    expect(integrations[0].provider).toBe('gmail');
    expect(integrations[0].connected).toBe(true);
  });

  it('lists audit logs via listAuditLogs', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          auditLogs: [
            {
              id: 1,
              action: 'draft.approved',
              actorType: 'user',
              targetType: 'draft',
              targetId: 1,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new ApiClient({ fetch: mockFetch });
    const logs = await client.listAuditLogs();

    expect(capturedUrl).toBe('/api/v1/audit-log');
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('draft.approved');
  });
});

