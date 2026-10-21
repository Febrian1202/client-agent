import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ApiClient, type TaskItem } from '../src/lib/api';

describe('Agent Task Monitor (/agent)', () => {
  const pagePath = resolve(__dirname, '../src/routes/agent/+page.svelte');

  describe('Step 1: File Existence & Svelte 5 Structure', () => {
    it('creates +page.svelte under apps/web/src/routes/agent', () => {
      expect(existsSync(pagePath)).toBe(true);
    });

    it('uses Svelte 5 runes ($state, $derived) and adheres to no em dash anti-slop rule', () => {
      const content = readFileSync(pagePath, 'utf8');
      expect(content).toContain('$state');
      expect(content).toContain('$derived');

      // antislop R-02: FORBIDDEN em dash character (—) in UI text
      // We check template body outside script tags or comments
      const templateWithoutComments = content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(templateWithoutComments).not.toContain('—');
    });
  });

  describe('Step 2: Table Rendering & Status Badges', () => {
    it('renders task monitor table headers: Task ID, Type, Status, Attempts, Created At, Action', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('Task ID');
      expect(content).toContain('Type');
      expect(content).toContain('Status');
      expect(content).toContain('Attempts');
      expect(content).toContain('Created At');
      expect(content).toContain('Action');
    });

    it('renders status badges for queued, running, completed, failed, and dead states', () => {
      const content = readFileSync(pagePath, 'utf8');

      // Status values supported
      expect(content).toContain('queued');
      expect(content).toContain('running');
      expect(content).toContain('completed');
      expect(content).toContain('failed');
      expect(content).toContain('dead');

      // Design token colors for statuses
      expect(content).toContain('#1cb0f6'); // blue (queued)
      expect(content).toContain('#58cc02'); // green (completed)
      expect(content).toContain('#ff4b4b'); // red (failed)
      expect(content).toContain('#c7e8fa'); // 2px border token
    });

    it('formats attempt count showing current attempts out of maxAttempts', () => {
      const content = readFileSync(pagePath, 'utf8');
      expect(content).toContain('maxAttempts');
      expect(content).toContain('attempts');
    });
  });

  describe('Step 3: Status Filter Tabs & Task Query', () => {
    it('provides filter pills for All, Running, Queued, Completed, and Failed / Dead', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('All');
      expect(content).toContain('Running');
      expect(content).toContain('Queued');
      expect(content).toContain('Completed');
      expect(content).toContain('Failed / Dead');
    });

    it('updates task query when changing status filter', async () => {
      let requestedUrl = '';
      const mockFetch = async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            tasks: [
              {
                id: 101,
                userId: 1,
                type: 'SEND_VGEN_MESSAGE',
                status: 'failed',
                attempts: 3,
                maxAttempts: 3,
                input: { conversationId: 10, content: 'Hello' },
                output: null,
                error: 'Browser connection timed out after 30s',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            pagination: { page: 1, limit: 20, total: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = new ApiClient({ fetch: mockFetch });

      // Query with Running status
      await client.listTasks({ status: 'running' });
      expect(requestedUrl).toContain('status=running');

      // Query with Queued status
      await client.listTasks({ status: 'queued' });
      expect(requestedUrl).toContain('status=queued');

      // Query with Completed status
      await client.listTasks({ status: 'completed' });
      expect(requestedUrl).toContain('status=completed');

      // Query with Failed status
      await client.listTasks({ status: 'failed' });
      expect(requestedUrl).toContain('status=failed');

      // Query All (no status query parameter)
      await client.listTasks({});
      expect(requestedUrl).not.toContain('status=');
    });
  });

  describe('Step 4: Task Detail Drawer & Retry Action', () => {
    it('includes a slide-over drawer or modal displaying full JSON input and output', () => {
      const content = readFileSync(pagePath, 'utf8');

      // Drawer/modal structure and JSON viewers
      expect(content).toContain('JSON Input');
      expect(content).toContain('JSON Output');
      expect(content).toContain('JSON.stringify');
      expect(content).toContain('role="dialog"');
      expect(content).toContain('aria-modal="true"');
    });

    it('displays error details and failure reason when task has failed', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('Failure Reason');
      expect(content).toContain('selectedTask.error');
    });

    it('renders [Retry Task] button with #a5ed6e CTA token calling api.retryTask(id)', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('Retry Task');
      expect(content).toContain('api.retryTask');
      expect(content).toContain('#a5ed6e'); // Vibrant lime green CTA token
    });

    it('executes api.retryTask(id) with loading state and handles response', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method ?? 'GET';
        return new Response(
          JSON.stringify({
            task: {
              id: 101,
              userId: 1,
              type: 'SEND_VGEN_MESSAGE',
              status: 'queued',
              attempts: 0,
              maxAttempts: 3,
              input: { conversationId: 10 },
              output: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            status: 're-queued',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = new ApiClient({ fetch: mockFetch });
      const res = await client.retryTask(101);

      expect(requestedUrl).toBe('/api/v1/agent/tasks/101/retry');
      expect(requestedMethod).toBe('POST');
      expect(res.status).toBe('re-queued');
      expect(res.task.status).toBe('queued');
      expect(res.task.attempts).toBe(0);
    });

    it('supports keyboard accessibility with Escape key to close drawer and visible focus outlines', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('Escape');
      expect(content).toContain('focus:outline-none');
    });
  });

  describe('Step 5: Design Tokens & Layout Fidelity', () => {
    it('applies official design tokens from DESIGN.md and ui.pen', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('#ddf4ff'); // Canvas background
      expect(content).toContain('#c7e8fa'); // 2px subtle sky-blue card border
      expect(content).toContain('#f4faff'); // Subtle surface fill
      expect(content).toContain('#3c3c3c'); // Charcoal primary text
      expect(content).toContain('#777777'); // Muted secondary text
      expect(content).toContain('#a5ed6e'); // Primary action button
      expect(content).toContain('rounded-xl'); // 12px border radius
    });

    it('renders summary metric cards for quick queue visibility', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('Total Tasks');
      expect(content).toContain('Running');
      expect(content).toContain('Queued');
      expect(content).toContain('Failed');
    });
  });
});
