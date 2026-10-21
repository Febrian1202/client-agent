import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ApiClient, type IntegrationItem, type AuditItem } from '../src/lib/api';

describe('Integrations & Audit Log Pages (/integrations & /audit-log)', () => {
  const integrationsPagePath = resolve(__dirname, '../src/routes/integrations/+page.svelte');
  const auditLogPagePath = resolve(__dirname, '../src/routes/audit-log/+page.svelte');

  describe('Step 1: File Existence & Svelte 5 Structure', () => {
    it('creates +page.svelte under apps/web/src/routes/integrations', () => {
      expect(existsSync(integrationsPagePath)).toBe(true);
    });

    it('creates +page.svelte under apps/web/src/routes/audit-log', () => {
      expect(existsSync(auditLogPagePath)).toBe(true);
    });

    it('uses Svelte 5 runes ($state, $derived) and adheres to no em dash anti-slop rule in both pages', () => {
      for (const filePath of [integrationsPagePath, auditLogPagePath]) {
        const content = readFileSync(filePath, 'utf8');
        expect(content).toContain('$state');
        expect(content).toContain('$derived');

        // antislop R-02: FORBIDDEN em dash character (—) in UI text
        const templateWithoutComments = content
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        expect(templateWithoutComments).not.toContain('—');
      }
    });

    it('applies design tokens for canvas, cards, borders, green active, and orange warning', () => {
      for (const filePath of [integrationsPagePath, auditLogPagePath]) {
        const content = readFileSync(filePath, 'utf8');
        expect(content).toContain('#ddf4ff'); // Canvas background
        expect(content).toContain('#c7e8fa'); // 2px border token
        expect(content).toContain('rounded-xl'); // 12px border radius
      }

      const integrationsContent = readFileSync(integrationsPagePath, 'utf8');
      expect(integrationsContent).toContain('#58cc02'); // Green connected/active
      expect(integrationsContent).toContain('#ff9600'); // Orange warning/expired
    });
  });

  describe('Step 2: Integrations Status Dashboard (/integrations)', () => {
    it('renders connection status cards for Gmail Pub/Sub, Discord Bot, and VGen Browser Session', () => {
      const content = readFileSync(integrationsPagePath, 'utf8');
      expect(content).toContain('Gmail Pub/Sub');
      expect(content).toContain('Discord Bot');
      expect(content).toContain('VGen Browser Session');
    });

    it('displays status indicators and connection details for each integration', () => {
      const content = readFileSync(integrationsPagePath, 'utf8');
      // Gmail details
      expect(content).toContain('Listening');
      expect(content).toContain('Last sync');
      // Discord details
      expect(content).toContain('Online');
      expect(content).toContain('Guild');
      // VGen details
      expect(content).toContain('Browser Profile');
      expect(content).toContain('Manual login');
    });

    it('includes action buttons to test connection or refresh status', () => {
      const content = readFileSync(integrationsPagePath, 'utf8');
      expect(content).toContain('Test Connection');
      expect(content).toContain('Refresh');
      expect(content).toContain('api.listIntegrations');
    });

    it('fetches integration statuses via api.listIntegrations()', async () => {
      let requestedUrl = '';
      const mockFetch = async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            data: [
              {
                provider: 'gmail',
                status: 'connected',
                connected: true,
                metadata: {
                  emailAddress: 'creator@vgen.example.com',
                  lastHistoryId: '984120',
                  lastSyncAt: new Date().toISOString(),
                },
              },
              {
                provider: 'discord',
                status: 'connected',
                connected: true,
                metadata: {
                  channelId: '123456789012345678',
                  channelName: 'vgen-commissions',
                  guildName: 'Creator Sanctuary',
                  latencyMs: 38,
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = new ApiClient({ fetch: mockFetch });
      const items = await client.listIntegrations();

      expect(requestedUrl).toBe('/api/v1/integrations');
      expect(items.length).toBe(2);
      expect(items[0].provider).toBe('gmail');
      expect(items[0].connected).toBe(true);
      expect(items[1].provider).toBe('discord');
    });
  });

  describe('Step 3: Immutable Audit Log Viewer (/audit-log)', () => {
    it('renders audit log table with Timestamp, Actor, Action, Target, and Details/Inspector columns', () => {
      const content = readFileSync(auditLogPagePath, 'utf8');
      expect(content).toContain('Timestamp');
      expect(content).toContain('Actor');
      expect(content).toContain('Action');
      expect(content).toContain('Target');
      expect(content).toContain('Details');
    });

    it('renders actor badges for user, agent, and system actors', () => {
      const content = readFileSync(auditLogPagePath, 'utf8');
      expect(content).toContain('user');
      expect(content).toContain('agent');
      expect(content).toContain('system');
    });

    it('formats timestamps with monospace font class for scannability', () => {
      const content = readFileSync(auditLogPagePath, 'utf8');
      expect(content).toContain('font-mono');
    });

    it('provides actor filter tabs (All, User, Agent, System) and action search filter', () => {
      const content = readFileSync(auditLogPagePath, 'utf8');
      expect(content).toContain('All');
      expect(content).toContain('User');
      expect(content).toContain('Agent');
      expect(content).toContain('System');
      expect(content).toContain('actorFilter');
      expect(content).toContain('actionFilter');
    });

    it('includes collapsible or modal JSON metadata inspector for immutable log records', () => {
      const content = readFileSync(auditLogPagePath, 'utf8');
      expect(content).toContain('JSON.stringify');
      expect(content).toContain('metadata');
      expect(content).toContain('selectedLog');
      expect(content).toContain('role="dialog"');
    });

    it('queries api.listAuditLogs with filter parameters', async () => {
      let requestedUrl = '';
      const mockFetch = async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            auditLogs: [
              {
                id: 1,
                userId: 1,
                actorType: 'user',
                actorId: 1,
                action: 'USER_APPROVED_DRAFT',
                targetType: 'draft',
                targetId: 301,
                metadata: { clientUsername: 'KitsuneMei', approvedAt: new Date().toISOString() },
                ipAddress: '127.0.0.1',
                createdAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = new ApiClient({ fetch: mockFetch });
      const logs = await client.listAuditLogs({ actorType: 'user' });

      expect(requestedUrl).toContain('/api/v1/audit-log');
      expect(requestedUrl).toContain('actorType=user');
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('USER_APPROVED_DRAFT');
    });
  });
});
