import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { ApiClient, type UserProfile } from './lib/api';

export const handle: Handle = async ({ event, resolve }) => {
  const pathname = event.url.pathname;

  // Static assets and internal SvelteKit endpoints bypass auth
  if (
    pathname.startsWith('/_app') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/robots.txt')
  ) {
    return resolve(event);
  }

  const session = event.cookies.get('session');
  let user: UserProfile | null = null;

  if (session) {
    try {
      const apiBase = process.env.API_URL || 'http://localhost:3001';
      const client = new ApiClient({
        baseUrl: apiBase,
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (!headers.has('cookie')) {
            headers.set('cookie', `session=${session}`);
          }
          return event.fetch(input, { ...init, headers });
        },
      });
      user = await client.getMe();
    } catch {
      user = null;
    }
  }

  event.locals.user = user;

  const isLoginPage = pathname === '/login';

  if (!user && !isLoginPage) {
    throw redirect(303, '/login');
  }

  if (user && isLoginPage) {
    throw redirect(303, '/dashboard');
  }

  return resolve(event);
};
