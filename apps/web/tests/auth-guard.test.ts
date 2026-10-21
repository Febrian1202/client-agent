import { describe, expect, it } from 'bun:test';
import { handle } from '../src/hooks.server';

// Helper to execute the SvelteKit handle hook and normalize both
// Response returns and thrown SvelteKit Redirect errors ({ status, location })
async function executeHandle(
  event: any,
  resolve: (event: any) => Promise<Response> = () => Promise.resolve(new Response('OK', { status: 200 }))
) {
  try {
    const res = await handle({ event, resolve });
    return {
      status: res.status,
      location: res.headers.get('location'),
      response: res,
    };
  } catch (err: any) {
    if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
      return {
        status: err.status as number,
        location: err.location as string,
        response: null,
      };
    }
    throw err;
  }
}

function createMockEvent(options: {
  pathname: string;
  sessionCookie?: string;
  mockFetchUser?: { id: number; name: string; email: string } | null;
  fetchStatus?: number;
}) {
  const url = new URL(`http://localhost:5173${options.pathname}`);
  const locals: Record<string, any> = {};

  const cookies = {
    get: (name: string) => (name === 'session' ? options.sessionCookie : undefined),
    set: () => {},
    delete: () => {},
  };

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = input.toString();
    if (urlStr.includes('/api/v1/auth/me')) {
      if (options.fetchStatus && options.fetchStatus !== 200) {
        return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
          status: options.fetchStatus,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (options.mockFetchUser) {
        return new Response(JSON.stringify({ user: options.mockFetchUser }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  };

  return {
    event: {
      url,
      cookies,
      locals,
      fetch: mockFetch,
      request: new Request(url.toString()),
    },
    locals,
  };
}

describe('Server Auth Guard Hook', () => {
  it('redirects unauthenticated users to /login when accessing protected routes', async () => {
    const { event } = createMockEvent({
      pathname: '/dashboard',
      sessionCookie: undefined,
    });

    const result = await executeHandle(event);
    expect(result.status).toBe(303);
    expect(result.location).toBe('/login');
  });

  it('allows access to /login when unauthenticated', async () => {
    let resolveCalled = false;
    const { event } = createMockEvent({
      pathname: '/login',
      sessionCookie: undefined,
    });

    const result = await executeHandle(event, async () => {
      resolveCalled = true;
      return new Response('Login Page', { status: 200 });
    });

    expect(result.status).toBe(200);
    expect(resolveCalled).toBe(true);
  });

  it('redirects authenticated users away from /login to /dashboard', async () => {
    const { event } = createMockEvent({
      pathname: '/login',
      sessionCookie: 'valid-session-token',
      mockFetchUser: { id: 1, name: 'Erian Osamu', email: 'erian@localhost' },
    });

    const result = await executeHandle(event);
    expect(result.status).toBe(303);
    expect(result.location).toBe('/dashboard');
  });

  it('allows authenticated users to access protected routes and populates event.locals.user', async () => {
    let resolveCalled = false;
    const { event, locals } = createMockEvent({
      pathname: '/dashboard',
      sessionCookie: 'valid-session-token',
      mockFetchUser: { id: 1, name: 'Erian Osamu', email: 'erian@localhost' },
    });

    const result = await executeHandle(event, async () => {
      resolveCalled = true;
      return new Response('Dashboard Page', { status: 200 });
    });

    expect(result.status).toBe(200);
    expect(resolveCalled).toBe(true);
    expect(locals.user).toEqual({ id: 1, name: 'Erian Osamu', email: 'erian@localhost' });
  });

  it('redirects users with invalid or expired session to /login when accessing protected routes', async () => {
    const { event } = createMockEvent({
      pathname: '/commissions',
      sessionCookie: 'invalid-session-token',
      fetchStatus: 401,
    });

    const result = await executeHandle(event);
    expect(result.status).toBe(303);
    expect(result.location).toBe('/login');
  });

  it('allows static assets to pass through without authentication', async () => {
    let resolveCalled = false;
    const { event } = createMockEvent({
      pathname: '/_app/immutable/entry.js',
      sessionCookie: undefined,
    });

    const result = await executeHandle(event, async () => {
      resolveCalled = true;
      return new Response('asset content', { status: 200 });
    });

    expect(result.status).toBe(200);
    expect(resolveCalled).toBe(true);
  });
});
