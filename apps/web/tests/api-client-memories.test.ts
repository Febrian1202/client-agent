import { describe, expect, it, mock } from 'bun:test';
import { ApiClient } from '../src/lib/api';

describe('ApiClient Client Memories Methods', () => {
  it('calls GET /api/v1/clients/:id/memories', async () => {
    let requestedUrl = '';
    const mockFetch = mock(async (url: string, init?: any) => {
      requestedUrl = url;
      return new Response(
        JSON.stringify({
          memories: [{ id: 1, clientId: 42, type: 'fact', content: 'Test memory' }],
          grouped: { facts: [{ id: 1, text: 'Test memory' }], preferences: [], inferences: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new ApiClient({ baseUrl: 'http://localhost:3001', fetch: mockFetch as any });
    const res = await client.listClientMemories(42);

    expect(requestedUrl).toBe('http://localhost:3001/api/v1/clients/42/memories');
    expect(res.memories.length).toBe(1);
    expect(res.grouped.facts.length).toBe(1);
  });

  it('calls POST /api/v1/clients/:id/memories', async () => {
    let sentMethod = '';
    let sentBody = '';
    const mockFetch = mock(async (url: string, init?: any) => {
      sentMethod = init?.method;
      sentBody = init?.body;
      return new Response(
        JSON.stringify({
          memory: { id: 2, clientId: 42, type: 'fact', category: 'technical', content: 'VTube Studio' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new ApiClient({ baseUrl: 'http://localhost:3001', fetch: mockFetch as any });
    const res = await client.createClientMemory(42, {
      type: 'fact',
      category: 'technical',
      content: 'VTube Studio',
    });

    expect(sentMethod).toBe('POST');
    expect(JSON.parse(sentBody).category).toBe('technical');
    expect(res.id).toBe(2);
  });

  it('calls PATCH and DELETE for memory item', async () => {
    const mockFetch = mock(async (url: string, init?: any) => {
      if (init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ memory: { id: 2, content: 'Updated' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new ApiClient({ baseUrl: 'http://localhost:3001', fetch: mockFetch as any });
    const patched = await client.updateClientMemory(42, 2, 'Updated');
    expect(patched.content).toBe('Updated');

    const deleted = await client.deleteClientMemory(42, 2);
    expect(deleted.success).toBe(true);
  });
});
