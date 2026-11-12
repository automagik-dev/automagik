import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider';
import { createAuth, type Env } from './auth';

function publicData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicData);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'email' && key !== 'emailVerified')
      .map(([key, entry]) => [key, publicData(entry)]));
  if (typeof value === 'string' && value.endsWith('@id.invalid')) return 'Automagik user';
  return value;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/sign-in' || url.pathname === '/consent') {
      if (env.PAGES) {
        const page = new URL(`${url.pathname.slice(1)}.html`, url.origin);
        const response = await env.PAGES.fetch(new Request(page, request));
        if (response.ok) {
          const headers = new Headers(response.headers);
          headers.set('referrer-policy', 'no-referrer');
          headers.set('cache-control', 'no-store');
          headers.set('x-frame-options', 'DENY');
          return new Response(response.body, { status: response.status, headers });
        }
      }
      return new Response('page not built yet', { status: 501 });
    }
    if (url.pathname === '/api/id/config') {
      return Response.json({ phoneEnabled: Boolean(env.OMNI_OTP_URL) });
    }
    if (env.PAGES && ['GET', 'HEAD'].includes(request.method) &&
        !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/.well-known/')) {
      return env.PAGES.fetch(request);
    }
    const auth = createAuth(env, ctx);
    if (url.pathname === '/.well-known/openid-configuration' ||
        url.pathname === '/api/auth/.well-known/openid-configuration') {
      return oauthProviderOpenIdConfigMetadata(auth)(request);
    }
    if (url.pathname === '/.well-known/oauth-authorization-server/api/auth') {
      return oauthProviderAuthServerMetadata(auth)(request);
    }
    // Expose only the authentication surface we support. Managed client CRUD is server only.
    const path = url.pathname.replace(/^\/api\/auth/, '');
    const allowed = new Set([
      '/get-session', '/sign-out', '/jwks',
      '/passkey/generate-register-options', '/passkey/verify-registration',
      '/passkey/generate-authenticate-options', '/passkey/verify-authentication',
      '/oauth2/authorize', '/oauth2/token', '/oauth2/userinfo', '/oauth2/revoke',
      '/oauth2/end-session', '/oauth2/end-session/confirm', '/oauth2/consent', '/oauth2/continue',
      '/oauth2/public-client-prelogin',
      ...(env.OMNI_OTP_URL ? ['/phone-number/send-otp', '/phone-number/verify'] : []),
    ]);
    if (!url.pathname.startsWith('/api/auth/') || !allowed.has(path)) {
      return new Response('Not found', { status: 404 });
    }
    const response = await auth.handler(request);
    if (response.headers.get('content-type')?.includes('application/json')) {
      const text = await response.text();
      if (!text) return new Response(null, response);
      const body = publicData(JSON.parse(text));
      return new Response(JSON.stringify(body), response);
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
