import { login } from './api/login';
import { logout } from './api/logout';
import { me } from './api/me';
import { races } from './api/races';
import { register } from './api/register';
import { settings } from './api/settings';
import { type ApiHandler, type Env, fail } from './auth';
import { ensureSchema } from './schema';

const routes: Record<string, Partial<Record<string, ApiHandler>>> = {
  '/api/me': { GET: me },
  '/api/register': { POST: register },
  '/api/login': { POST: login },
  '/api/logout': { POST: logout },
  '/api/races': { POST: races },
  '/api/settings': { PUT: settings },
};

/**
 * Cloudflare Worker entry point. Static game files in dist/ are served by Workers Static
 * Assets; only /api/* reaches this code (see `assets.run_worker_first` in wrangler.jsonc).
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const route = routes[url.pathname];
    if (!route) return fail(404, 'Not found.');
    const handler = route[request.method];
    if (!handler) return fail(405, 'Method not allowed.', { allow: Object.keys(route).join(', ') });

    try {
      if (env.DB) await ensureSchema(env.DB);
      return await handler(request, env);
    } catch (err) {
      console.error('API error', url.pathname, err);
      return fail(500, 'Server error. Please try again.');
    }
  },
} satisfies ExportedHandler<Env>;
