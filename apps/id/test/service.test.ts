import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createHash } from 'node:crypto';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { clientSeedSQL } from '../scripts/client-seed';
import { SoftwareAuthenticator } from './authenticator';

const origin = 'https://id.example.com';
const cloudSecret = 'test-only-cloud-client-secret-never-deployed';
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const verifier = 'a'.repeat(64);
let bundle: string;
let root: string;
let state: string;
let runtimes: Miniflare[];
let runtime: Miniflare;
let cookie: string;
let ip: number;

beforeAll(async () => {
  await mkdir('.wrangler', { recursive: true });
  root = await mkdtemp('.wrangler/test-');
  bundle = resolve(root, 'worker.mjs');
  await build({
    entryPoints: ['src/index.ts'], outfile: bundle, bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', conditions: ['workerd', 'worker'],
    external: ['node:*', 'cloudflare:*'], logLevel: 'silent',
  });
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

async function instance(phone = false, delivered?: (data: any) => void | Promise<void>, pages = false) {
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: bundle }],
    compatibilityDate: '2025-11-18', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'test-identity-database' }, d1Persist: state,
    outboundService: async request => {
      // Better Auth validates RP logout hints by fetching its own published JWKS.
      // Dispatch that back into this local runtime; never contact the public origin.
      if (request.method === 'GET' && request.url === `${origin}/api/auth/jwks`) {
        return mf.dispatchFetch(request.url);
      }
      if (phone && request.url === 'https://omni.example.com/send') {
        expect(request.headers.get('authorization')).toBe('Bearer test-only-token');
        await delivered?.(await request.json());
        return Response.json({});
      }
      throw new Error('Unexpected outbound network request');
    },
    serviceBindings: pages ? {
      PAGES: async request => {
        const path = new URL(request.url).pathname;
        if (path === '/sign-in.html') return new Response('owner page fixture');
        if (path === '/style.css') return new Response('owner asset fixture');
        return new Response('Not found', { status: 404 });
      },
    } : undefined,
    bindings: {
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: 'test-only-auth-secret-placeholder-never-deployed',
      ...(phone ? { OMNI_OTP_URL: 'https://omni.example.com/send', OMNI_API_TOKEN: 'test-only-token' } : {}),
    },
  });
  runtimes.push(mf);
  return mf;
}

beforeEach(async () => {
  state = resolve(await mkdtemp(`${root}/db-`));
  runtimes = [];
  runtime = await instance();
  const db = await runtime.getD1Database('DB');
  const migration = await readFile('migrations/0001_auth.sql', 'utf8');
  for (const sql of migration.split(';').map(s => s.trim()).filter(Boolean)) {
    await db.prepare(sql).run();
  }
  for (const sql of clientSeedSQL(digest(cloudSecret)).split(';').filter(Boolean)) {
    await db.prepare(sql).run();
  }
  cookie = '';
  ip = 1;
});
afterEach(async () => { await Promise.all(runtimes.map(mf => mf.dispose())); });

async function request(path: string, body?: unknown, options: {
  mf?: Miniflare; method?: string; form?: boolean; cookie?: string; ip?: string;
  headers?: Record<string, string>;
} = {}) {
  const headers = {
    ...(options.form ? {} : { origin }), 'cf-connecting-ip': options.ip ?? `192.0.2.${ip++}`,
    cookie: options.cookie ?? cookie, accept: 'application/json', ...options.headers,
    ...(body === undefined ? {} : {
      'content-type': options.form ? 'application/x-www-form-urlencoded' : 'application/json',
    }),
  };
  const response = await (options.mf ?? runtime).dispatchFetch(`${origin}${path}`, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers,
    body: body === undefined ? undefined : options.form ?
      new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
    redirect: 'manual',
  });
  const cookies = response.headers.getSetCookie();
  const jar = new Map(cookie.split('; ').filter(Boolean).map(entry => {
    const at = entry.indexOf('=');
    return [entry.slice(0, at), entry.slice(at + 1)];
  }));
  for (const entry of cookies) {
    const [pair] = entry.split(';');
    const at = pair.indexOf('=');
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
  return response;
}

async function jsonOK(response: Awaited<ReturnType<typeof request>>) {
  const text = await response.text();
  expect(response.status, text).toBe(200);
  try { return JSON.parse(text); } catch { throw new Error(`Invalid JSON response: ${text}`); }
}

async function signup(oauth_query?: string) {
  const authenticator = new SoftwareAuthenticator();
  const options = await jsonOK(await request('/api/auth/passkey/generate-register-options'));
  expect(options.authenticatorSelection.residentKey).toBe('required');
  const response = await request('/api/auth/passkey/verify-registration', {
    response: authenticator.register(options, origin), createSession: true,
    ...(oauth_query ? { oauth_query } : {}),
  });
  const result = await jsonOK(response);
  expect(JSON.stringify(result)).not.toContain('@id.invalid');
  const session = result.redirect ? await jsonOK(await request('/api/auth/get-session')) : result;
  expect(session.session.userId).toBeTruthy();
  return { authenticator, userId: session.session.userId, redirect: result.url };
}

function authorization(overrides: Record<string, string> = {}) {
  const query = new URLSearchParams({
    client_id: 'automagik-desktop', redirect_uri: 'http://127.0.0.1:53001/callback',
    response_type: 'code', scope: 'openid profile', state: 'test-state', nonce: 'test-nonce',
    code_challenge: digest(verifier), code_challenge_method: 'S256', ...overrides,
  });
  for (const [key, value] of [...query]) if (value === '') query.delete(key);
  return '/api/auth/oauth2/authorize?' + query;
}

async function authorizationResult(overrides: Record<string, string> = {}) {
  const response = await request(authorization(overrides));
  const body = await response.text();
  const target = response.headers.get('location') ?? JSON.parse(body).url;
  return { response, url: new URL(target, origin), body };
}

async function code() {
  const result = await authorizationResult();
  expect(result.url.origin).toBe('http://127.0.0.1:53001');
  expect(result.url.searchParams.get('state')).toBe('test-state');
  expect(result.url.searchParams.has('error'), result.body).toBe(false);
  return result.url.searchParams.get('code')!;
}

function exchange(authorizationCode: string, extra: Record<string, string> = {}) {
  const body: Record<string, string> = {
    grant_type: 'authorization_code', client_id: 'automagik-desktop', code: authorizationCode,
    redirect_uri: 'http://127.0.0.1:53001/callback', code_verifier: verifier, ...extra,
  };
  for (const [key, value] of Object.entries(body)) if (value === '') delete body[key];
  return request('/api/auth/oauth2/token', body, { form: true, cookie: '' });
}

describe('Worker + D1 identity', () => {
  test('software passkey signup, sign-in, native S256 code flow, JWKS, ID token and userinfo', async () => {
    const { authenticator, userId } = await signup();
    cookie = '';
    const options = await jsonOK(await request('/api/auth/passkey/generate-authenticate-options'));
    expect(options.allowCredentials ?? []).toEqual([]); // discoverable credentials / conditional UI
    await jsonOK(await request('/api/auth/passkey/verify-authentication', {
      response: authenticator.authenticate(options, origin),
    }));
    const metadata = await jsonOK(await request('/.well-known/openid-configuration'));
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.registration_endpoint).toBeUndefined();
    for (const field of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint',
      'revocation_endpoint', 'end_session_endpoint', 'jwks_uri']) expect(metadata[field]).toBeTruthy();
    const tokens = await jsonOK(await exchange(await code()));
    const jwks = await jsonOK(await request(new URL(metadata.jwks_uri).pathname));
    const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
      issuer: metadata.issuer, audience: 'automagik-desktop',
    });
    expect(verified.payload.sub).toBe(userId);
    expect(verified.payload.nonce).toBe('test-nonce');
    expect(verified.payload.exp! * 1000).toBeGreaterThan(Date.now());
    expect(verified.payload.email).toBeUndefined();
    await expect(jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
      issuer: 'https://wrong.example.com', audience: 'automagik-desktop',
    })).rejects.toThrow();
    await expect(jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
      issuer: metadata.issuer, audience: 'another-client',
    })).rejects.toThrow();
    await expect(jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
      issuer: metadata.issuer, audience: 'automagik-desktop',
      currentDate: new Date(verified.payload.exp! * 1000 + 1000),
    })).rejects.toThrow();
    const user = await jsonOK(await request('/api/auth/oauth2/userinfo', undefined, {
      headers: { authorization: `Bearer ${tokens.access_token}` }, cookie: '',
    }));
    expect(user.sub).toBe(userId);
    expect(user.email).toBeUndefined();
    expect((await request('/api/auth/oauth2/revoke', {
      client_id: 'automagik-desktop', token: tokens.access_token,
    }, { form: true, cookie: '' })).status).toBe(200);
    const db = await runtime.getD1Database('DB');
    expect((await db.prepare('SELECT count(*) AS n FROM session').first<{ n: number }>())!.n)
      .toBeGreaterThan(0);
    expect((await db.prepare('SELECT count(*) AS n FROM passkey').first<{ n: number }>())!.n).toBe(1);
    const logout = await request('/api/auth/oauth2/end-session', {
      id_token_hint: tokens.id_token, client_id: 'automagik-desktop',
    });
    expect(logout.status).toBe(200);
    expect(await jsonOK(await request('/api/auth/get-session'))).toBeNull();
  });

  test('registered native loopback accepts arbitrary port; localhost, non-loopback and unregistered paths fail', async () => {
    await signup();
    expect((await authorizationResult()).url.searchParams.get('code')).toBeTruthy();
    for (const uri of ['http://localhost:53001/callback', 'http://example.com:53001/callback',
      'http://127.0.0.1:53001/unregistered', 'https://attacker.example.com/callback']) {
      const response = await request(authorization({ redirect_uri: uri }));
      const body = await response.text();
      if (response.status === 200) {
        const errorURL = new URL(JSON.parse(body).url);
        expect(errorURL.origin).toBe(origin);
        expect(errorURL.searchParams.has('error')).toBe(true);
        expect(errorURL.searchParams.has('code')).toBe(false);
      } else expect(response.status, body).toBeGreaterThanOrEqual(400);
      expect(response.headers.get('location')).toBeNull();
    }
    // A registered localhost URI still does not receive the IP-literal port exception.
    const db = await runtime.getD1Database('DB');
    await db.prepare('UPDATE oauthClient SET redirectUris = ? WHERE clientId = ?')
      .bind(JSON.stringify(['http://localhost:49152/callback']), 'automagik-desktop').run();
    const localhost = await authorizationResult({ redirect_uri: 'http://localhost:53001/callback' });
    expect(localhost.url.origin).toBe(origin);
    expect(localhost.url.searchParams.has('error')).toBe(true);
  });

  test('plain and missing PKCE fail for native and confidential clients', async () => {
    await signup();
    for (const client of [
      { client_id: 'automagik-desktop', redirect_uri: 'http://127.0.0.1:53001/callback' },
      { client_id: 'automagik-cloud', redirect_uri: 'https://cloud.example.com/auth/callback' },
    ]) {
      const plain = await authorizationResult({ ...client, code_challenge_method: 'plain' });
      expect(plain.url.searchParams.has('error')).toBe(true);
      expect(plain.url.searchParams.has('code')).toBe(false);
      const missing = await authorizationResult({ ...client, code_challenge: '', code_challenge_method: '' });
      expect(missing.url.searchParams.get('error')).toBe('invalid_request');
      expect(missing.url.searchParams.get('error_description')).toContain('pkce');
      expect(missing.url.searchParams.has('code')).toBe(false);
    }
  });

  test('Cloud confidential client requires its secret and completes S256 exchange', async () => {
    await signup();
    const result = await authorizationResult({
      client_id: 'automagik-cloud', redirect_uri: 'https://cloud.example.com/auth/callback',
    });
    expect(result.url.searchParams.has('error'), result.url.searchParams.get('error_description') ?? '')
      .toBe(false);
    const authorizationCode = result.url.searchParams.get('code')!;
    expect(authorizationCode).toBeTruthy();
    const body = {
      grant_type: 'authorization_code', client_id: 'automagik-cloud', code: authorizationCode,
      redirect_uri: 'https://cloud.example.com/auth/callback', code_verifier: verifier,
    };
    const unauthenticated = await request('/api/auth/oauth2/token', body, { form: true, cookie: '' });
    // extractClientCredentials selects method none; validateClientCredentials rejects the mismatch.
    // throwInvalidClient returns 400 without an attempted Basic authentication challenge.
    expect(unauthenticated.status).toBe(400);
    expect(await unauthenticated.json()).toEqual({
      error: 'invalid_client',
      error_description: 'client registered for client_secret_basic cannot use none',
    });
    const tokens = await jsonOK(await request('/api/auth/oauth2/token', body, {
      form: true, cookie: '', headers: {
        authorization: `Basic ${Buffer.from(`automagik-cloud:${cloudSecret}`).toString('base64')}`,
      },
    }));
    expect(tokens.id_token).toBeTruthy();
  });

  test('missing verifier, wrong verifier, replayed code and expired code fail', async () => {
    await signup();
    expect((await exchange(await code(), { code_verifier: '' })).status).toBe(400);
    expect((await exchange(await code(), { code_verifier: 'b'.repeat(64) })).status).toBe(400);
    const once = await code();
    await jsonOK(await exchange(once));
    expect((await exchange(once)).status).toBe(400);
    const expired = await code();
    const db = await runtime.getD1Database('DB');
    await db.prepare('UPDATE verification SET expiresAt = ?').bind(0).run();
    expect((await exchange(expired)).status).toBe(400);
  });

  test('passkey wrong origin and challenge replay fail', async () => {
    const authenticator = new SoftwareAuthenticator();
    const options = await jsonOK(await request('/api/auth/passkey/generate-register-options'));
    const registration = authenticator.register(options, 'https://wrong.example.com');
    expect((await request('/api/auth/passkey/verify-registration', { response: registration })).status).toBe(400);
    expect((await request('/api/auth/passkey/verify-registration', {
      response: authenticator.register(options, origin),
    })).status).toBe(400);
  });

  test('unsupported sign-in, sign-up, recovery, social and public registration routes are absent', async () => {
    for (const path of ['/sign-up/email', '/sign-in/email', '/sign-in/social', '/request-password-reset',
      '/oauth2/register', '/oauth2/create-client', '/sign-in/phone-number']) {
      expect((await request(`/api/auth${path}`, {})).status).toBe(404);
    }
    expect((await request('/api/auth/oauth2/register', {
      client_name: 'Unreviewed client', application_type: 'web',
      redirect_uris: ['https://unreviewed.example.com/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code'],
    })).status).toBe(404);
  });

  test('login redirects carry a signed query; continue resumes it after signup', async () => {
    const login = await authorizationResult();
    expect(login.url.pathname).toBe('/sign-in');
    for (const key of ['client_id', 'scope', 'state', 'nonce', 'exp', 'sig']) {
      expect(login.url.searchParams.get(key)).toBeTruthy();
    }
    const oauth_query = login.url.search.slice(1);
    const client = await jsonOK(await request('/api/auth/oauth2/public-client-prelogin', {
      client_id: 'automagik-desktop', oauth_query,
    }));
    expect(client.client_name).toBe('Automagik desktop');
    await signup();
    const continued = await jsonOK(await request('/api/auth/oauth2/continue', { oauth_query, selected: true }));
    expect(new URL(continued.url).searchParams.get('code')).toBeTruthy();
    expect((await request('/api/auth/oauth2/continue', {
      oauth_query: oauth_query.replace('test-state', 'tampered-state'),
      selected: true,
    })).status).toBe(400);
  });

  test('fresh passkey signup resumes a signed prompt=login query', async () => {
    const login = await authorizationResult({ prompt: 'login' });
    expect(login.url.pathname).toBe('/sign-in');
    const registration = await signup(login.url.search.slice(1));
    expect(registration.redirect).toBeTruthy();
    expect(new URL(registration.redirect).searchParams.get('code')).toBeTruthy();
  });

  test('account creation can resume prompt=create with an explicit created continuation', async () => {
    const login = await authorizationResult({ prompt: 'create' });
    expect(login.url.pathname).toBe('/sign-in');
    await signup();
    const continued = await jsonOK(await request('/api/auth/oauth2/continue', {
      created: true, oauth_query: login.url.search.slice(1),
    }));
    expect(new URL(continued.url).searchParams.get('code')).toBeTruthy();
  });

  test('third-party consent shows verified client metadata and requires acceptance', async () => {
    await signup();
    const db = await runtime.getD1Database('DB');
    await db.prepare(`INSERT INTO oauthClient
      (id, clientId, name, applicationType, tokenEndpointAuthMethod, redirectUris,
       scopes, grantTypes, responseTypes, skipConsent, requirePKCE)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'test-third-party', 'test-third-party', 'Example third party', 'web', 'none',
      JSON.stringify(['https://third.example.com/callback']),
      JSON.stringify(['openid', 'profile']), JSON.stringify(['authorization_code']),
      JSON.stringify(['code']), 0, 1,
    ).run();
    const consent = await authorizationResult({
      client_id: 'test-third-party', redirect_uri: 'https://third.example.com/callback',
    });
    expect(consent.url.pathname).toBe('/consent');
    expect(consent.url.searchParams.get('scope')).toBe('openid profile');
    expect(consent.url.searchParams.has('code')).toBe(false);
    const oauth_query = consent.url.search.slice(1);
    const client = await jsonOK(await request('/api/auth/oauth2/public-client-prelogin', {
      client_id: 'test-third-party', oauth_query,
    }));
    expect(client.client_name).toBe('Example third party');
    const accepted = await jsonOK(await request('/api/auth/oauth2/consent', { accept: true, oauth_query }));
    expect(new URL(accepted.url).searchParams.get('code')).toBeTruthy();
    const next = await authorizationResult({
      client_id: 'test-third-party', redirect_uri: 'https://third.example.com/callback', prompt: 'consent',
    });
    const denied = await jsonOK(await request('/api/auth/oauth2/consent', {
      accept: false, oauth_query: next.url.search.slice(1),
    }));
    expect(new URL(denied.url).searchParams.get('error')).toBe('access_denied');
    expect((await request('/api/auth/oauth2/consent', { accept: true, oauth_query }, { cookie: '' })).status)
      .toBe(401);
  });

  test('D1 challenges and sessions work in a separate runtime', async () => {
    const authenticator = new SoftwareAuthenticator();
    const options = await jsonOK(await request('/api/auth/passkey/generate-register-options'));
    const db = await runtime.getD1Database('DB');
    expect((await db.prepare('SELECT count(*) AS n FROM verification').first<{ n: number }>())!.n)
      .toBeGreaterThan(0);
    const peer = await instance();
    const registration = await jsonOK(await request('/api/auth/passkey/verify-registration', {
      response: authenticator.register(options, origin), createSession: true,
    }, { mf: peer }));
    const session = await jsonOK(await request('/api/auth/get-session'));
    expect(session.user.id).toBe(registration.session.userId);
    expect(session.user.email).toBeUndefined();
  });

  test('pages are owner placeholders; phone routes are off without config', async () => {
    for (const path of ['/sign-in', '/consent']) {
      const response = await request(path);
      expect(response.status).toBe(501);
      expect(await response.text()).toBe('page not built yet');
    }
    expect(await jsonOK(await request('/api/id/config'))).toEqual({ phoneEnabled: false });
    for (const path of ['/phone-number/send-otp', '/phone-number/verify']) {
      expect((await request(`/api/auth${path}`, {})).status).toBe(404);
    }
  });

  test('owner pages and supporting assets are served while an absent page stays 501', async () => {
    const pages = await instance(false, undefined, true);
    const response = await request('/sign-in?state=opaque', undefined, { mf: pages });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('owner page fixture');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await request('/consent', undefined, { mf: pages })).status).toBe(501);
    expect(await (await request('/style.css', undefined, { mf: pages })).text()).toBe('owner asset fixture');
  });

  test('direct .html paths answer 404, so a page is only ever served with its headers', async () => {
    const pages = await instance(false, undefined, true);
    for (const path of ['/sign-in.html', '/consent.html', '/sign-in.html?state=opaque', '/sign-in.html/',
      '/SIGN-IN.HTML', '/sign-in%2Ehtml', '/sign-in.htm', '/assets/other.html', '/%ff.html']) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const response = await request(path, undefined, { mf: pages, method });
        expect(response.status, `${method} ${path}`).toBe(404);
        expect(await response.text(), `${method} ${path}`).not.toContain('owner page fixture');
      }
    }
    // The page's own address and its files are untouched.
    const page = await request('/sign-in', undefined, { mf: pages });
    expect(page.status).toBe(200);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect((await request('/style.css', undefined, { mf: pages })).status).toBe(200);
  });

  test('D1 rate limit survives a second isolated runtime sharing the database', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await request('/api/auth/get-session', undefined, { ip: '192.0.2.201' })).status).toBe(200);
    }
    const peer = await instance();
    const limited = await request('/api/auth/get-session', undefined, { mf: peer, ip: '192.0.2.201' });
    expect(limited.status).toBe(429);
    const db = await peer.getD1Database('DB');
    expect((await db.prepare('SELECT count(*) AS n FROM rateLimit').first<{ n: number }>())!.n)
      .toBeGreaterThan(0);
  });

  test('Omni receives OTP with background fetch; verification signs in and three wrong codes lock', async () => {
    const deliveries: { phoneNumber: string; code: string }[] = [];
    const phoneRuntime = await instance(true, data => { deliveries.push(data); });
    const phoneNumber = '+15555550123';
    await jsonOK(await request('/api/auth/phone-number/send-otp', { phoneNumber }, { mf: phoneRuntime }));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].phoneNumber).toBe(phoneNumber);
    expect(deliveries[0].code).toMatch(/^\d{6}$/);
    const signedIn = await jsonOK(await request('/api/auth/phone-number/verify', {
      phoneNumber, code: deliveries[0].code,
    }, { mf: phoneRuntime }));
    expect(signedIn.user.id).toBeTruthy();
    cookie = '';
    const lockedNumber = '+15555550124';
    await jsonOK(await request('/api/auth/phone-number/send-otp', { phoneNumber: lockedNumber }, { mf: phoneRuntime }));
    const goodCode = deliveries[1].code;
    const badCode = goodCode === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await request('/api/auth/phone-number/verify', {
        phoneNumber: lockedNumber, code: badCode,
      }, { mf: phoneRuntime })).status).toBeGreaterThanOrEqual(400);
    }
    expect((await request('/api/auth/phone-number/verify', {
      phoneNumber: lockedNumber, code: goodCode,
    }, { mf: phoneRuntime })).status).toBe(403);
  });

  test('OTP response completes while the Omni waitUntil delivery is still pending', async () => {
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const phoneRuntime = await instance(true, async () => { started(); await gate; });
    const pending = request('/api/auth/phone-number/send-otp', {
      phoneNumber: '+15555550125',
    }, { mf: phoneRuntime });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await begun;
      const response = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('OTP response awaited Omni')), 2000);
        }),
      ]);
      expect(response.status).toBe(200);
    } finally {
      if (timer) clearTimeout(timer);
      release();
      await pending;
    }
  });
});
