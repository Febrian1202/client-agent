import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ApiClient, type ClientItem, type CommissionItem } from '../src/lib/api';

describe('Clients & Commission Tracker (/clients, /clients/[id], /commissions)', () => {
  const clientsPagePath = resolve(__dirname, '../src/routes/clients/+page.svelte');
  const clientDetailPagePath = resolve(__dirname, '../src/routes/clients/[id]/+page.svelte');
  const commissionsPagePath = resolve(__dirname, '../src/routes/commissions/+page.svelte');

  describe('Step 1: File Existence & Svelte 5 Structure', () => {
    it('creates +page.svelte under apps/web/src/routes/clients', () => {
      expect(existsSync(clientsPagePath)).toBe(true);
    });

    it('creates +page.svelte under apps/web/src/routes/clients/[id]', () => {
      expect(existsSync(clientDetailPagePath)).toBe(true);
    });

    it('creates +page.svelte under apps/web/src/routes/commissions', () => {
      expect(existsSync(commissionsPagePath)).toBe(true);
    });

    it('uses Svelte 5 runes ($state, $derived) and adheres to no em dash anti-slop rule in all three pages', () => {
      for (const filePath of [clientsPagePath, clientDetailPagePath, commissionsPagePath]) {
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

    it('applies design tokens for canvas, cards, borders, CTA green, and accent blue across pages', () => {
      for (const filePath of [clientsPagePath, clientDetailPagePath, commissionsPagePath]) {
        const content = readFileSync(filePath, 'utf8');
        expect(content).toContain('#ddf4ff'); // Canvas background
        expect(content).toContain('#c7e8fa'); // 2px border token
        expect(content).toContain('#1cb0f6'); // Accent blue
        expect(content).toContain('rounded-xl'); // 12px border radius
      }
    });
  });

  describe('Step 2: Client Directory (/clients)', () => {
    it('provides search input filtering clients by name or username', () => {
      const content = readFileSync(clientsPagePath, 'utf8');
      expect(content).toContain('<input');
      expect(content).toContain('search');
      expect(content).toContain('searchQuery');
      expect(content).toContain('filteredClients');
    });

    it('renders client directory cards with avatar initial, username, display name, and platform badge', () => {
      const content = readFileSync(clientsPagePath, 'utf8');
      expect(content).toContain('client.username');
      expect(content).toContain('client.displayName');
      expect(content).toContain('vgen');
      expect(content).toContain('firstSeenAt');
      expect(content).toContain('lastSeenAt');
    });

    it('includes navigation links to client detail page (/clients/[id])', () => {
      const content = readFileSync(clientsPagePath, 'utf8');
      expect(content).toContain('/clients/');
    });

    it('invokes api.listClients on load and provides refresh mechanism', () => {
      const content = readFileSync(clientsPagePath, 'utf8');
      expect(content).toContain('api.listClients');
      expect(content).toContain('loadClients');
      expect(content).toContain('RefreshCw');
    });

    it('strips leading @ symbol when searching by username', () => {
      const content = readFileSync(clientsPagePath, 'utf8');
      expect(content).toContain("replace(/^@/, '')");
    });
  });

  describe('Step 3: Client Detail Profile (/clients/[id])', () => {
    it('renders client header with display name, username, platform badge, and external VGen link', () => {
      const content = readFileSync(clientDetailPagePath, 'utf8');
      expect(content).toContain('displayName');
      expect(content).toContain('username');
      expect(content).toContain('vgen.co');
      expect(content).toContain('target="_blank"');
    });

    it('renders Client Memory profile card with pills for FACT, PREFERENCE, and INFERENCE', () => {
      const content = readFileSync(clientDetailPagePath, 'utf8');
      expect(content).toContain('FACT');
      expect(content).toContain('PREFERENCE');
      expect(content).toContain('INFERENCE');

      // Check design tokens for memory badges
      expect(content).toContain('#58cc02'); // FACT green
      expect(content).toContain('#1cb0f6'); // PREFERENCE blue
      expect(content).toContain('#af71f5'); // INFERENCE purple
    });

    it('renders commission history list for this client with service name, status, price, and deadline', () => {
      const content = readFileSync(clientDetailPagePath, 'utf8');
      expect(content).toContain('serviceName');
      expect(content).toContain('amount');
      expect(content).toContain('status');
      expect(content).toContain('guaranteedDelivery');
    });

    it('provides link to conversation thread with this client and back navigation to /clients', () => {
      const content = readFileSync(clientDetailPagePath, 'utf8');
      expect(content).toContain('/conversations');
      expect(content).toContain('/clients');
    });

    it('uses $effect to reactively reload when route param changes and handles client not found cleanly', () => {
      const content = readFileSync(clientDetailPagePath, 'utf8');
      expect(content).toContain('$effect');
      expect(content).toContain('clientId');
      expect(content).toContain('loadClientData()');
      expect(content).toContain('Client not found');
      expect(content).not.toContain('fallback || DEFAULT_SAMPLE_CLIENTS[0]');
    });
  });

  describe('Step 4: Commission Pipeline Board (/commissions)', () => {
    it('provides status filter tabs for All, Requested, Accepted, In Progress, Delivered, and Completed', () => {
      const content = readFileSync(commissionsPagePath, 'utf8');
      expect(content).toContain('All');
      expect(content).toContain('Requested');
      expect(content).toContain('Accepted');
      expect(content).toContain('In Progress');
      expect(content).toContain('Delivered');
      expect(content).toContain('Completed');
    });

    it('renders commission cards with service name, price in USD, client name & avatar, order ID, and deadline', () => {
      const content = readFileSync(commissionsPagePath, 'utf8');
      expect(content).toContain('serviceName');
      expect(content).toContain('USD');
      expect(content).toContain('orderId');
      expect(content).toContain('clientUsername');
      expect(content).toContain('deadlineText');
    });

    it('renders Client Note & Brief Summary Box with bg-[#f4faff] and rounded-xl', () => {
      const content = readFileSync(commissionsPagePath, 'utf8');
      expect(content).toContain('bg-[#f4faff]');
      expect(content).toContain('rounded-xl');
      expect(content).toMatch(/briefSummary|clientNote|brief/);
    });

    it('provides action buttons: Open Thread, Accept, Update Stage, and Mark Completed', () => {
      const content = readFileSync(commissionsPagePath, 'utf8');
      expect(content).toContain('Open Thread');
      expect(content).toContain('Accept');
      expect(content).toContain('Update Stage');
      expect(content).toContain('Mark Completed');
    });

    it('invokes api.updateCommission when updating commission status', () => {
      const content = readFileSync(commissionsPagePath, 'utf8');
      expect(content).toContain('api.updateCommission');
    });
  });

  describe('Step 5: ApiClient Methods for Clients & Commissions', () => {
    it('calls GET /api/v1/clients with optional search parameter', async () => {
      let requestedUrl = '';
      const mockFetch = async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            clients: [
              {
                id: 1,
                userId: 1,
                platform: 'vgen',
                username: 'KitsuneMei',
                displayName: 'Mei • Kitsune VTuber',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = new ApiClient({ fetch: mockFetch as any });
      const clients = await client.listClients({ search: 'Kitsune' });

      expect(requestedUrl).toContain('/api/v1/clients?search=Kitsune');
      expect(clients.length).toBe(1);
      expect(clients[0].username).toBe('KitsuneMei');
    });

    it('calls GET /api/v1/clients/:id', async () => {
      let requestedUrl = '';
      const mockFetch = async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            client: {
              id: 1,
              userId: 1,
              platform: 'vgen',
              username: 'KitsuneMei',
              displayName: 'Mei • Kitsune VTuber',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = new ApiClient({ fetch: mockFetch as any });
      const res = await client.getClient(1);

      expect(requestedUrl).toContain('/api/v1/clients/1');
      expect(res.id).toBe(1);
      expect(res.username).toBe('KitsuneMei');
    });

    it('calls GET /api/v1/commissions with status and clientId filters', async () => {
      let requestedUrl = '';
      const mockFetch = async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            commissions: [
              {
                id: 101,
                clientId: 1,
                serviceName: 'Live2D Rigging',
                amount: '850.00',
                currency: 'USD',
                status: 'in_progress',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = new ApiClient({ fetch: mockFetch as any });
      const commissions = await client.listCommissions({ clientId: 1, status: 'in_progress' });

      expect(requestedUrl).toContain('/api/v1/commissions?');
      expect(requestedUrl).toContain('clientId=1');
      expect(requestedUrl).toContain('status=in_progress');
      expect(commissions.length).toBe(1);
      expect(commissions[0].serviceName).toBe('Live2D Rigging');
    });

    it('calls PATCH /api/v1/commissions/:id to update commission status', async () => {
      let requestedUrl = '';
      let requestMethod = '';
      let requestBody = '';

      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestMethod = init?.method ?? 'GET';
        requestBody = String(init?.body ?? '');
        return new Response(
          JSON.stringify({
            commission: {
              id: 101,
              clientId: 1,
              serviceName: 'Live2D Rigging',
              amount: '850.00',
              currency: 'USD',
              status: 'completed',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = new ApiClient({ fetch: mockFetch as any });
      const updated = await client.updateCommission(101, { status: 'completed' });

      expect(requestedUrl).toContain('/api/v1/commissions/101');
      expect(requestMethod).toBe('PATCH');
      expect(JSON.parse(requestBody)).toEqual({ status: 'completed' });
      expect(updated.status).toBe('completed');
    });
  });
});
