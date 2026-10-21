import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ApiClient, ApiError, type DraftItem } from '../src/lib/api';

describe('Drafts & Approvals Manager (/drafts)', () => {
  const pagePath = resolve(__dirname, '../src/routes/drafts/+page.svelte');

  describe('Step 1: File Existence & Svelte 5 Structure', () => {
    it('creates +page.svelte under apps/web/src/routes/drafts', () => {
      expect(existsSync(pagePath)).toBe(true);
    });

    it('uses Svelte 5 runes ($state, $derived) and adheres to no em dash anti-slop rule', () => {
      const content = readFileSync(pagePath, 'utf8');
      expect(content).toContain('$state');
      expect(content).toContain('$derived');

      // antislop R-02: FORBIDDEN em dash character (—) in UI text
      const templateWithoutComments = content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(templateWithoutComments).not.toContain('—');
    });

    it('applies design tokens for canvas, cards, borders, CTA green, and accent blue', () => {
      const content = readFileSync(pagePath, 'utf8');
      expect(content).toContain('#ddf4ff'); // Canvas background
      expect(content).toContain('#c7e8fa'); // 2px border token
      expect(content).toContain('#a5ed6e'); // Primary green CTA button
      expect(content).toContain('#1cb0f6'); // Accent blue
      expect(content).toContain('rounded-xl'); // 12px border radius
    });
  });

  describe('Step 2: Status Filter Tabs', () => {
    it('provides filter tabs for Pending Approval, Approved, Sent, and Rejected', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('Pending Approval');
      expect(content).toContain('Approved');
      expect(content).toContain('Sent');
      expect(content).toContain('Rejected');
    });

    it('filters drafts list by tab status correctly', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('pending_approval');
      expect(content).toContain('approved');
      expect(content).toContain('sent');
      expect(content).toContain('rejected');
      expect(content).toContain('filteredDrafts');
    });
  });

  describe('Step 3: Draft Card Layout & Details', () => {
    it('renders header with target client, conversation link, timestamp, and SHA-256 hash badge', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('clientUsername');
      expect(content).toContain('/conversations');
      expect(content).toMatch(/sha256|SHA-256|hash/i);
      expect(content).toContain('createdAt');
    });

    it('provides textarea for draft content with character counter (max 2000)', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('<textarea');
      expect(content).toContain('2000');
      expect(content).toContain('maxlength="2000"');
      expect(content).toContain('.length');
    });

    it('displays invalidation warning banner when an approved draft is modified', () => {
      const content = readFileSync(pagePath, 'utf8');

      // Warning alert copy informing creator that editing revokes approval
      expect(content).toMatch(/warning|invalidation|re-approval|revoke/i);
      expect(content).toContain('approved');
    });
  });

  describe('Step 4: Draft Action Buttons & Modals', () => {
    it('includes Save Edits, Approve, Reject, and Send to VGen buttons', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('Save Edits');
      expect(content).toContain('Approve');
      expect(content).toContain('Reject');
      expect(content).toContain('Send to VGen');
    });

    it('disables Send to VGen button unless draft status is approved', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain("draft.status !== 'approved'");
    });

    it('implements rejection reason modal with form input and cancel/submit actions', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('rejectionModalDraft');
      expect(content).toContain('rejectionReason');
      expect(content).toContain('api.rejectDraft');
    });

    it('includes toast alert container for action feedback', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('toastMessage');
      expect(content).toContain('showToast');
    });
  });

  describe('Step 5: API Integration & Edge Case Handling', () => {
    it('calls api.updateDraft and updates status back to pending_approval', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      let requestedBody: any = null;

      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method ?? 'GET';
        if (init?.body) {
          requestedBody = JSON.parse(String(init.body));
        }
        return new Response(
          JSON.stringify({
            draft: {
              id: 42,
              conversationId: 10,
              content: 'Updated draft response',
              status: 'pending_approval',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const testApi = new ApiClient({ baseUrl: 'http://localhost:3001', fetch: mockFetch as any });
      const updated = await testApi.updateDraft(42, 'Updated draft response');

      expect(requestedUrl).toBe('http://localhost:3001/api/v1/drafts/42');
      expect(requestedMethod).toBe('PATCH');
      expect(requestedBody).toEqual({ content: 'Updated draft response' });
      expect(updated.status).toBe('pending_approval');
      expect(updated.content).toBe('Updated draft response');
    });

    it('calls api.approveDraft and enables sending state', async () => {
      let requestedUrl = '';
      let requestedMethod = '';

      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method ?? 'GET';
        return new Response(
          JSON.stringify({
            draft: {
              id: 42,
              conversationId: 10,
              content: 'Approved reply',
              status: 'approved',
              approvedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const testApi = new ApiClient({ baseUrl: 'http://localhost:3001', fetch: mockFetch as any });
      const approved = await testApi.approveDraft(42);

      expect(requestedUrl).toBe('http://localhost:3001/api/v1/drafts/42/approve');
      expect(requestedMethod).toBe('POST');
      expect(approved.status).toBe('approved');
    });

    it('calls api.rejectDraft with reason in modal', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      let requestedBody: any = null;

      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method ?? 'GET';
        if (init?.body) {
          requestedBody = JSON.parse(String(init.body));
        }
        return new Response(
          JSON.stringify({
            draft: {
              id: 42,
              conversationId: 10,
              content: 'Rejected reply',
              status: 'rejected',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const testApi = new ApiClient({ baseUrl: 'http://localhost:3001', fetch: mockFetch as any });
      const rejected = await testApi.rejectDraft(42, 'Price discount requested is too steep');

      expect(requestedUrl).toBe('http://localhost:3001/api/v1/drafts/42/reject');
      expect(requestedMethod).toBe('POST');
      expect(requestedBody).toEqual({ reason: 'Price discount requested is too steep' });
      expect(rejected.status).toBe('rejected');
    });

    it('calls api.sendDraft and receives 202 task dispatch', async () => {
      let requestedUrl = '';
      let requestedMethod = '';

      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method ?? 'GET';
        return new Response(
          JSON.stringify({
            taskId: 'task_send_42',
            status: 'queued',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const testApi = new ApiClient({ baseUrl: 'http://localhost:3001', fetch: mockFetch as any });
      const sendResult = await testApi.sendDraft(42);

      expect(requestedUrl).toBe('http://localhost:3001/api/v1/drafts/42/send');
      expect(requestedMethod).toBe('POST');
      expect(sendResult.taskId).toBe('task_send_42');
      expect(sendResult.status).toBe('queued');
    });

    it('handles 409 conflict when sending unapproved or invalidated draft', async () => {
      const mockFetch = async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 'NOT_APPROVED',
              message: 'Draft must be approved before sending',
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const testApi = new ApiClient({ baseUrl: 'http://localhost:3001', fetch: mockFetch as any });

      let thrownError: ApiError | null = null;
      try {
        await testApi.sendDraft(42);
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(ApiError);
      expect(thrownError?.status).toBe(409);
      expect(thrownError?.code).toBe('NOT_APPROVED');
      expect(thrownError?.message).toBe('Draft must be approved before sending');
    });
  });
});
