import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ApiClient, type ConversationSummary, type MessageItem } from '../src/lib/api';

describe('Conversation & Message Viewer (/conversations)', () => {
  const pagePath = resolve(__dirname, '../src/routes/conversations/+page.svelte');

  describe('Step 1: File Existence & Svelte 5 Structure', () => {
    it('creates +page.svelte under apps/web/src/routes/conversations', () => {
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
  });

  describe('Step 2: Left Pane & Conversation List', () => {
    it('implements a 320px left sidebar with search filter', () => {
      const content = readFileSync(pagePath, 'utf8');

      // 320px width token (w-80 or w-[320px])
      expect(content).toMatch(/w-80|w-\[320px\]/);
      expect(content).toContain('search');
    });

    it('lists conversations with client username, avatar initial, snippet, and sync timestamp', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('clientUsername');
      expect(content).toContain('lastMessageSnippet');
      expect(content).toContain('lastSyncedAt');
    });

    it('highlights active conversation with distinct selection styling', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('selectedConversation');
      expect(content).toContain('selectConversation');
    });
  });

  describe('Step 3: Right Pane & Message Thread', () => {
    it('renders header with client username, display name, and external VGen link', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('clientDisplayName');
      expect(content).toContain('vgen.co');
      expect(content).toContain('target="_blank"');
    });

    it('renders [Sync from VGen] button invoking api.syncConversation', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('Sync from VGen');
      expect(content).toContain('api.syncConversation');
    });

    it('renders chronological message bubbles for inbound and outbound messages', () => {
      const content = readFileSync(pagePath, 'utf8');

      // Inbound styling: #f4faff background
      expect(content).toContain('#f4faff');
      // Inbound vs outbound message distinction
      expect(content).toContain("msg.direction === 'inbound'");
      expect(content).toContain("msg.direction === 'outbound'");
      // Message content and timestamp
      expect(content).toContain('msg.content');
    });
  });

  describe('Step 4: AI Reply & Draft Bar', () => {
    it('includes AI reply trigger or input bar creating a draft via api.createDraft', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('api.createDraft');
      expect(content).toContain('Generate AI Reply');
    });

    it('executes api.syncConversation and api.createDraft correctly with ApiClient', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      let requestedBody: any = null;

      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedMethod = init?.method ?? 'GET';
        if (init?.body) {
          requestedBody = JSON.parse(String(init.body));
        }

        if (requestedUrl.includes('/sync')) {
          return new Response(
            JSON.stringify({ taskId: '109', status: 'queued' }),
            { status: 202, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (requestedUrl.includes('/drafts')) {
          return new Response(
            JSON.stringify({
              draft: {
                id: 401,
                conversationId: 10,
                content: 'Thank you for your update! Rigging sketches are in progress.',
                status: 'pending_approval',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const client = new ApiClient({ fetch: mockFetch });

      // 1. Sync conversation
      const syncRes = await client.syncConversation(10);
      expect(requestedUrl).toBe('/api/v1/conversations/10/sync');
      expect(requestedMethod).toBe('POST');
      expect(syncRes.status).toBe('queued');

      // 2. Create draft
      const draftRes = await client.createDraft({
        conversationId: 10,
        content: 'Thank you for your update! Rigging sketches are in progress.',
      });
      expect(requestedUrl).toBe('/api/v1/drafts');
      expect(requestedMethod).toBe('POST');
      expect(requestedBody.conversationId).toBe(10);
      expect(draftRes.id).toBe(401);
      expect(draftRes.status).toBe('pending_approval');
    });
  });

  describe('Step 5: Design Tokens & Accessibility', () => {
    it('applies official design tokens from DESIGN.md and ui.pen', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('#ddf4ff'); // Canvas background
      expect(content).toContain('#c7e8fa'); // 2px subtle sky-blue card border
      expect(content).toContain('#f4faff'); // Subtle surface fill
      expect(content).toContain('#3c3c3c'); // Charcoal primary text
      expect(content).toContain('#777777'); // Muted secondary text
      expect(content).toContain('#a5ed6e'); // Primary CTA token
      expect(content).toContain('rounded-xl'); // 12px border radius
    });

    it('renders empty states when search returns no matches or list is empty', () => {
      const content = readFileSync(pagePath, 'utf8');

      expect(content).toContain('No conversations found');
    });
  });
});
