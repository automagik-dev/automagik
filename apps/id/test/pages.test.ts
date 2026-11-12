// The owner's pages (pages/sign-in.html, pages/consent.html) against PAGES-CONTRACT.md.
//
// Three layers:
//  1. Files: same-origin only, no inline code, only the contract's endpoints, nothing stored
//     or logged. Always runs.
//  2. A real Chromium on the real Worker (Miniflare, D1, the pages as its static assets) with
//     a virtual authenticator: create a passkey, sign in, allow, cancel, phone codes.
//  3. Every state of both pages with the service's answers scripted, each checked for its
//     words, console errors, the calls it made and sideways overflow at 390 and 320 wide.
//
// Layers 2 and 3 need playwright-core (a dev dependency here) and a Chromium
// (`node node_modules/playwright-core/cli.js install chromium`); without one they are skipped,
// unless ID_PAGES_BROWSER=required, as CI sets it. ID_PAGES_CHROME names another Chromium.
// ID_PAGES_SHOTS=<folder> also writes a picture of every state at 1440 and 390, light and
// dark (and at 320, light), with an INDEX.md; ID_PAGES_ONLY=<text,text> keeps the states whose name holds one.
import { afterAll, describe, expect, test } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clientSeedSQL } from '../scripts/client-seed';

const CONTRACT = [
  '/api/id/config', '/api/auth/get-session', '/api/auth/sign-out',
  '/api/auth/oauth2/public-client-prelogin', '/api/auth/oauth2/continue', '/api/auth/oauth2/consent',
  '/api/auth/passkey/generate-authenticate-options', '/api/auth/passkey/verify-authentication',
  '/api/auth/passkey/generate-register-options', '/api/auth/passkey/verify-registration',
  '/api/auth/phone-number/send-otp', '/api/auth/phone-number/verify',
];
const PAGES = ['sign-in', 'consent'] as const;
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const read = (name: string) => readFile(resolve('pages', name), 'utf8');

describe('pages: files', () => {
  test('the page script calls only endpoints the page contract names', async () => {
    const contract = await readFile('PAGES-CONTRACT.md', 'utf8');
    for (const path of CONTRACT) expect(contract, path).toContain(path);
    const script = await read('id.js');
    const called = [...script.matchAll(/['"`](\/api\/[^'"`?]*)/g)].map(match => match[1]);
    expect(called.length).toBeGreaterThan(8);
    for (const path of called) expect(CONTRACT, path).toContain(path);
    // The only other address it builds is the sign-in page, with the query as it came.
    const others = [...script.matchAll(/['"`](\/[a-z][^'"`\s]*)/g)].map(match => match[1])
      .filter(path => !path.startsWith('/api/'));
    expect([...new Set(others)]).toEqual(['/sign-in?${oauthQuery}']);
  });

  test('the page script stores nothing, logs nothing and writes no markup', async () => {
    const script = await read('id.js');
    for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'console.',
      'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function',
      'redirect_uri', 'http://', 'https://']) {
      expect(script.includes(banned), banned).toBe(false);
    }
  });

  test('pages load only files of their own, with no inline script or style', async () => {
    const css = await read('id.css');
    const loaded = new Set<string>();
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)/g)) loaded.add(match[1]);
    expect(css.includes('@import')).toBe(false);
    for (const page of PAGES) {
      const html = await read(`${page}.html`);
      expect(html, page).toContain(`<body data-page="${page}">`);
      expect(html, page).toMatch(/Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'/);
      expect(html.match(/<script\b[^>]*>/g), page).toEqual(['<script src="/id.js" defer>']);
      expect(/<style\b|\sstyle=|\son[a-z]+=|javascript:/i.test(html), page).toBe(false);
      expect(/type="(email|password)"|autocomplete="[^"]*(email|password)/i.test(html), page).toBe(false);
      for (const match of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) loaded.add(match[1]);
    }
    expect(loaded.size).toBeGreaterThan(5);
    for (const path of loaded) {
      expect(path.startsWith('/') && !path.startsWith('//'), path).toBe(true);
      expect(existsSync(resolve('pages', path.slice(1))), path).toBe(true);
    }
  });

  // Without this the browser layers below skip in CI and nobody notices.
  test('the CI job runs the browser tests', async () => {
    const workflow = await readFile(resolve('..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    const job = workflow.slice(workflow.indexOf('\n  id:\n'), workflow.indexOf('\n  privacy:\n'));
    expect(job).toContain('working-directory: apps/id');
    expect(job).toMatch(/\n {6}ID_PAGES_BROWSER: required\n/);
    expect(job).toMatch(/playwright-core\/cli\.js install --with-deps chromium/);
    expect(job.indexOf('install --with-deps chromium')).toBeLessThan(job.indexOf('bun run test'));
  });
});

// ---- A browser and a local service ---------------------------------------------------
const required = process.env.ID_PAGES_BROWSER === 'required';
const shots = process.env.ID_PAGES_SHOTS ? resolve(process.env.ID_PAGES_SHOTS) : '';
const only = (process.env.ID_PAGES_ONLY ?? '').split(',').filter(Boolean);
let browser: any;
let browserTried = false;
let browserError: unknown;
let root = '';
let bundle = '';
const worlds: Miniflare[] = [];

async function chromium(): Promise<any> {
  if (browserTried) {
    if (required && browserError) throw browserError;
    return browser;
  }
  browserTried = true;
  try {
    const library = 'playwright-core';
    const { chromium: engine } = await import(/* @vite-ignore */ library);
    browser = await engine.launch({
      executablePath: process.env.ID_PAGES_CHROME || process.env.LANDING_CHROME || undefined,
      args: ['--no-sandbox'],
    });
  } catch (error) {
    browserError = error;
    if (required) throw error;
    browser = null;
  }
  return browser;
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

// The real Worker with the real pages as its static assets, on a local port. `localhost` is
// a secure context, so passkeys work as they do on the deployed origin.
async function world() {
  if (!bundle) {
    await mkdir('.wrangler', { recursive: true });
    root = await mkdtemp('.wrangler/test-pages-');
    bundle = resolve(root, 'worker.mjs');
    await build({
      entryPoints: ['src/index.ts'], outfile: bundle, bundle: true, format: 'esm',
      platform: 'browser', target: 'es2022', conditions: ['workerd', 'worker'],
      external: ['node:*', 'cloudflare:*'], logLevel: 'silent',
    });
  }
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: bundle }],
    compatibilityDate: '2025-11-18', compatibilityFlags: ['nodejs_compat'],
    host: '127.0.0.1', port,
    d1Databases: { DB: 'pages-test-identity' }, d1Persist: resolve(await mkdtemp(`${root}/db-`)),
    assets: {
      directory: resolve('pages'), binding: 'PAGES',
      routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
      assetConfig: { html_handling: 'none' },
    },
    outboundService: async () => { throw new Error('Unexpected outbound network request'); },
    bindings: {
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: 'test-only-auth-secret-placeholder-never-deployed',
    },
  });
  worlds.push(mf);
  await mf.ready;
  const db = await mf.getD1Database('DB');
  const migration = await readFile('migrations/0001_auth.sql', 'utf8');
  for (const sql of migration.split(';').map(part => part.trim()).filter(Boolean)) await db.prepare(sql).run();
  for (const sql of clientSeedSQL(digest('test-only-cloud-client-secret-never-deployed')).split(';').filter(Boolean)) {
    await db.prepare(sql).run();
  }
  await db.prepare(`INSERT INTO oauthClient
    (id, clientId, name, applicationType, tokenEndpointAuthMethod, redirectUris,
     scopes, grantTypes, responseTypes, skipConsent, requirePKCE)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    'test-third-party', 'test-third-party', 'Example third party', 'web', 'none',
    JSON.stringify(['https://third.example.com/callback']),
    JSON.stringify(['openid', 'profile']), JSON.stringify(['authorization_code']),
    JSON.stringify(['code']), 0, 1,
  ).run();
  return { origin };
}

afterAll(async () => {
  await browser?.close();
  await Promise.all(worlds.map(mf => mf.dispose()));
  if (root) await rm(root, { recursive: true, force: true });
});

// What a page did: console errors, script errors and every request it made.
function watch(page: any) {
  const seen = { errors: [] as string[], requests: [] as string[] };
  page.on('console', (message: any) => {
    if (message.type() === 'error') seen.errors.push(`${message.text()} ${message.location()?.url ?? ''}`);
  });
  page.on('pageerror', (error: Error) => seen.errors.push(`pageerror ${error.message}`));
  page.on('request', (request: any) => seen.requests.push(`${request.method()} ${request.url()}`));
  return seen;
}
// Every request stays on the service's origin and is a page, one of its files or a contract
// endpoint. `exits` are the addresses the service itself sent the browser to.
function expectOnlyContract(seen: { requests: string[] }, origin: string, exits: string[] = []) {
  for (const entry of seen.requests) {
    const raw = entry.slice(entry.indexOf(' ') + 1);
    if (exits.some(exit => raw.startsWith(exit))) continue;
    const url = new URL(raw);
    expect(url.origin, entry).toBe(origin);
    const fine = url.pathname === '/sign-in' || url.pathname === '/consent' || url.pathname === '/id.css' ||
      url.pathname === '/id.js' || url.pathname.startsWith('/assets/') || CONTRACT.includes(url.pathname);
    expect(fine, entry).toBe(true);
  }
}
// The browser reports a refused call as a console error; nothing else may be one.
function expectErrors(seen: { errors: string[] }, refusedCalls = 0) {
  const other = seen.errors.filter(error => !/^Failed to load resource/.test(error));
  expect(other).toEqual([]);
  expect(seen.errors.length, seen.errors.join('\n')).toBe(refusedCalls);
}
const heading = (page: any) => page.locator('#title').innerText().then((text: string) => text.replace(/\s+/g, ' ').trim());
const said = (page: any) => page.locator('#say').innerText().then((text: string) => text.replace(/\u00a0/g, ' '));
const view = (page: any) => page.locator('#card [data-view]:not([hidden])').getAttribute('data-view');

describe('pages: the real Worker and its static files', () => {
  test('a page answers only at its own address; its .html file is never served directly', async () => {
    const { origin } = await world();
    for (const page of PAGES) {
      const served = await fetch(`${origin}/${page}?state=opaque`);
      expect(served.status, page).toBe(200);
      expect(await served.text(), page).toBe(await read(`${page}.html`));
      expect(served.headers.get('x-frame-options'), page).toBe('DENY');
      expect(served.headers.get('referrer-policy'), page).toBe('no-referrer');
      expect(served.headers.get('cache-control'), page).toBe('no-store');
      for (const direct of [`/${page}.html`, `/${page}.html?state=opaque`, `/${page}%2Ehtml`,
        `/${page}.HTML`, `/${page}.html/`]) {
        const response = await fetch(`${origin}${direct}`, { redirect: 'manual' });
        expect(response.status, direct).toBe(404);
        expect(await response.text(), direct).toBe('Not found');
      }
    }
    for (const file of ['/id.css', '/id.js', '/assets/pet.webp', '/assets/manrope-latin.woff2']) {
      expect((await fetch(`${origin}${file}`)).status, file).toBe(200);
    }
  });
});

describe('pages: a real browser on the real Worker', () => {
  const authorize = (origin: string, overrides: Record<string, string> = {}) => `${origin}/api/auth/oauth2/authorize?` +
    new URLSearchParams({
      client_id: 'automagik-desktop', redirect_uri: 'http://127.0.0.1:53001/callback', response_type: 'code',
      scope: 'openid profile', state: 'test-state', nonce: 'test-nonce',
      code_challenge: digest('a'.repeat(64)), code_challenge_method: 'S256', ...overrides,
    });
  const third = { client_id: 'test-third-party', redirect_uri: 'https://third.example.com/callback' };
  const exits = ['http://127.0.0.1:53001/callback', 'https://third.example.com/callback'];

  async function visitor(origin: string, address: string) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'cf-connecting-ip': address },
    });
    const page = await context.newPage();
    // The products' own callbacks are not part of this service: answer them here.
    for (const exit of exits) {
      await page.route(`${exit}**`, (route: any) => route.fulfill({ contentType: 'text/plain', body: 'product' }));
    }
    const devtools = await context.newCDPSession(page);
    await devtools.send('WebAuthn.enable');
    await devtools.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    } });
    const seen = watch(page);
    const enter = [`GET ${origin}/api/auth/oauth2/authorize`];
    const check = (refusedCalls = 0) => {
      expectOnlyContract({ requests: seen.requests.filter(entry => !enter.some(start => entry.startsWith(start))) }, origin, exits);
      expectErrors(seen, refusedCalls);
      seen.errors.length = 0;
      seen.requests.length = 0;
    };
    const landed = async (exit: string) => {
      await page.waitForURL((url: URL) => url.href.startsWith(exit));
      return new URL(page.url()).searchParams;
    };
    return { context, page, check, landed };
  }

  test('passkey account, sign-in, allow, cancel and the ways back in', async ({ skip }) => {
    if (!(await chromium())) return skip();
    const { origin } = await world();
    const { context, page, check, landed } = await visitor(origin, '192.0.2.21');

    // New here: the product's name is the verified one, and one tap makes the account.
    await page.goto(authorize(origin));
    await page.locator('#create-passkey').waitFor();
    expect(new URL(page.url()).pathname).toBe('/sign-in');
    expect(await heading(page)).toBe('Sign in to Automagik desktop');
    expect(await page.locator('#phone-offer').isHidden()).toBe(true);
    await page.locator('#create-passkey').click();
    let back = await landed(exits[0]);
    expect(back.get('code')).toBeTruthy();
    expect(back.get('state')).toBe('test-state');
    check();

    // Back another day: the same passkey signs in.
    await context.clearCookies();
    await page.goto(authorize(origin));
    await page.locator('#use-passkey').click();
    back = await landed(exits[0]);
    expect(back.get('code')).toBeTruthy();
    check();

    // A product that is not ours asks first: its verified name, what it will see, Allow.
    await page.goto(authorize(origin, third));
    await page.locator('#allow').waitFor();
    expect(new URL(page.url()).pathname).toBe('/consent');
    expect(await heading(page)).toBe('Allow Example third party?');
    expect(await page.locator('#asks strong').allInnerTexts()).toEqual(['Know it’s you', 'See your profile']);
    await page.locator('#allow').click();
    back = await landed(exits[1]);
    expect(back.get('code')).toBeTruthy();
    check();

    // Cancel sends the product a refusal, never a code.
    await page.goto(authorize(origin, { ...third, prompt: 'consent' }));
    await page.locator('#deny').click();
    back = await landed(exits[1]);
    expect(back.get('error')).toBe('access_denied');
    expect(back.has('code')).toBe(false);
    check();

    // The sign-in ran out while the question was open: nothing is sent, sign in again, answer.
    await page.goto(authorize(origin, { ...third, prompt: 'consent' }));
    await page.locator('#allow').waitFor();
    await context.clearCookies();
    await page.reload();
    await page.locator('#sign-in-again').waitFor();
    expect(await heading(page)).toBe('Sign in again');
    await page.locator('#sign-in-again').click();
    await page.locator('#use-passkey').click();
    await page.locator('#allow').click();
    back = await landed(exits[1]);
    expect(back.get('code')).toBeTruthy();
    check();

    // Asked for a fresh sign-in: the passkey is asked again even though a session exists.
    await page.goto(authorize(origin, { prompt: 'login' }));
    await page.locator('#use-passkey').waitFor();
    expect(await view(page)).toBe('passkey');
    await page.locator('#use-passkey').click();
    expect((await landed(exits[0])).get('code')).toBeTruthy();
    check();

    // Asked to create: the new account comes first and resumes with `created`.
    await page.goto(authorize(origin, { prompt: 'create' }));
    await page.locator('#create-passkey').waitFor();
    expect(await heading(page)).toBe('Create your account for Automagik desktop');
    expect(await page.locator('#card .button.primary:visible').innerText()).toBe('Create a passkey');
    await page.locator('#create-passkey').click();
    expect((await landed(exits[0])).get('code')).toBeTruthy();
    check();

    // Signed in elsewhere meanwhile: carry on with one tap, or pick another account.
    await context.clearCookies();
    await page.goto(authorize(origin));
    await page.locator('#use-passkey').waitFor();
    const request = page.url();
    await page.goto(`${origin}/sign-in`);
    await page.locator('#use-passkey').click();
    await page.locator('#sign-out').waitFor();
    expect(await heading(page)).toBe('You’re signed in');
    await page.goto(request);
    await page.locator('#continue').waitFor();
    expect(await heading(page)).toBe('Continue to Automagik desktop');
    await page.locator('#continue').click();
    expect((await landed(exits[0])).get('code')).toBeTruthy();
    await page.goto(request);
    await page.locator('#switch').click();
    await page.locator('#use-passkey').waitFor();
    expect(await heading(page)).toBe('Sign in to Automagik desktop');
    await page.locator('#use-passkey').click();
    expect((await landed(exits[0])).get('code')).toBeTruthy();
    check();

    // No product asked: signed in, nowhere invented to go, and a way out.
    await page.goto(`${origin}/sign-in`);
    await page.locator('#sign-out').click();
    await page.locator('#use-passkey').waitFor();
    expect(await said(page)).toBe('Signed out.');
    expect(await heading(page)).toBe('Sign in to Automagik');
    check();

    // A changed request is refused by the service; the page says so and offers no way on.
    await page.goto(request.replace('test-state', 'changed-state'));
    await page.locator('[data-view="stop"]:not([hidden])').waitFor();
    expect(await heading(page)).toBe('This link has expired');
    expect(await page.locator('#card button:visible').count()).toBe(0);
    check(1);
    await context.close();
  }, 120000);


});

// ---- Every state, with the service's answers scripted -------------------------------
type Reply = { status?: number; json?: unknown; body?: string; headers?: Record<string, string>; hang?: true; drop?: true };
interface Scene {
  name: string;
  page: typeof PAGES[number];
  query?: string;
  api?: Record<string, Reply>;
  passkey?: 'pending' | 'cancel' | 'ok' | 'none' | 'offer';
  act?: (page: any) => Promise<void>;
  title: string;
  say: string;
  view: string;
  refused?: number;
  more?: (page: any) => Promise<void>;
}
const request = (scope: string, extra = '') => `client_id=automagik-cloud&redirect_uri=https%3A%2F%2Fcloud.example.com` +
  `%2Fauth%2Fcallback&response_type=code&scope=${scope}&state=opaque&code_challenge=stub&code_challenge_method=S256` +
  `${extra}&exp=1893456000&ba_iat=1&ba_param=client_id&ba_param=scope&sig=stub`;
const cloud = request('openid+profile');
const account = { session: { id: 'session', userId: 'user' }, user: { id: 'user', name: 'Automagik user' } };
const options = { challenge: 'c3R1Yg', rpId: 'localhost', userVerification: 'required' };
const makeOptions = {
  challenge: 'c3R1Yg', rp: { id: 'localhost', name: 'Automagik ID' },
  user: { id: 'dXNlcg', name: 'Automagik user', displayName: 'Automagik user' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
};
const phoneOn = { '/api/id/config': { json: { phoneEnabled: true } } };
const toCode = async (page: any) => {
  await page.locator('#use-phone').click();
  await page.locator('#phone').fill('+55 11 91234 5678');
  await page.locator('#send-code').click();
  await page.locator('#code').waitFor();
};
const passkeyLine = 'A passkey is your fingerprint, face or screen lock. No password.';

const scenes: Scene[] = [
  { name: 'sign-in-01-loading', page: 'sign-in', query: cloud,
    api: { '/api/auth/oauth2/public-client-prelogin': { hang: true } },
    title: 'Sign in', say: 'One moment…', view: 'loading' },
  { name: 'sign-in-02-passkey', page: 'sign-in', query: cloud,
    title: 'Sign in to Automagik Cloud', say: passkeyLine, view: 'passkey',
    more: async (page) => { expect(await page.locator('#phone-offer').isHidden()).toBe(true); } },
  { name: 'sign-in-03-passkey-with-phone-on', page: 'sign-in', query: cloud, api: phoneOn,
    title: 'Sign in to Automagik Cloud', say: passkeyLine, view: 'passkey',
    more: async (page) => { expect(await page.locator('#use-phone').isVisible()).toBe(true); } },
  { name: 'sign-in-04-passkey-prompt-open', page: 'sign-in', query: cloud, passkey: 'pending',
    api: { '/api/auth/passkey/generate-authenticate-options': { json: options } },
    act: page => page.locator('#use-passkey').click(),
    title: 'Sign in to Automagik Cloud', say: 'Follow the prompt on your device.', view: 'passkey',
    more: async (page) => {
      expect(await page.locator('#use-passkey').innerText()).toBe('Waiting for your passkey…');
      expect(await page.locator('#create-passkey').isDisabled()).toBe(true);
    } },
  { name: 'sign-in-05-passkey-cancelled', page: 'sign-in', query: cloud, passkey: 'cancel',
    api: { '/api/auth/passkey/generate-authenticate-options': { json: options } },
    act: page => page.locator('#use-passkey').click(),
    title: 'Sign in to Automagik Cloud', say: 'Cancelled. Try again whenever you’re ready.', view: 'passkey',
    more: async (page) => { expect(await page.locator('#use-passkey').isEnabled()).toBe(true); } },
  { name: 'sign-in-06-passkey-failed', page: 'sign-in', query: cloud, passkey: 'ok', refused: 1,
    api: {
      '/api/auth/passkey/generate-authenticate-options': { json: options },
      '/api/auth/passkey/verify-authentication': { status: 401, json: { code: 'AUTHENTICATION_FAILED', message: '<b>raw</b>' } },
    },
    act: page => page.locator('#use-passkey').click(),
    title: 'Sign in to Automagik Cloud', say: 'That passkey didn’t work here. Try again, or create a new one.', view: 'passkey' },
  { name: 'sign-in-07-passkey-not-saved', page: 'sign-in', query: cloud, passkey: 'ok', refused: 1,
    api: {
      '/api/auth/passkey/generate-register-options': { json: makeOptions },
      '/api/auth/passkey/verify-registration': { status: 400, json: { code: 'FAILED_TO_VERIFY_REGISTRATION' } },
    },
    act: page => page.locator('#create-passkey').click(),
    title: 'Sign in to Automagik Cloud', say: 'The passkey wasn’t saved. Try again.', view: 'passkey' },
  { name: 'sign-in-08-no-passkeys-in-this-browser', page: 'sign-in', query: cloud, passkey: 'none',
    title: 'Sign in to Automagik Cloud', say: 'This browser can’t use passkeys.', view: 'stop',
    more: async (page) => { expect(await page.locator('#card button:visible').count()).toBe(0); } },
  { name: 'sign-in-09-account-created', page: 'sign-in', query: cloud, passkey: 'ok',
    api: {
      '/api/auth/passkey/generate-register-options': { json: makeOptions },
      '/api/auth/passkey/verify-registration': { json: { id: 'passkey', ...account } },
      '/api/auth/oauth2/continue': { hang: true },
    },
    act: page => page.locator('#create-passkey').click(),
    title: 'You’re signed in', say: 'Passkey saved. You’re in!', view: 'going',
    more: async (page) => { expect(await page.locator('#going-text').innerText()).toBe('Taking you back to Automagik Cloud…'); } },
  { name: 'sign-in-10-going-back-to-the-product', page: 'sign-in', query: cloud, passkey: 'ok',
    api: {
      '/api/auth/passkey/generate-authenticate-options': { json: options },
      '/api/auth/passkey/verify-authentication': { json: account },
      '/api/auth/oauth2/continue': { hang: true },
    },
    act: page => page.locator('#use-passkey').click(),
    title: 'You’re signed in', say: 'You’re in!', view: 'going' },
  { name: 'sign-in-11-signed-in-no-product', page: 'sign-in', passkey: 'ok',
    api: {
      '/api/auth/passkey/generate-authenticate-options': { json: options },
      '/api/auth/passkey/verify-authentication': { json: account },
    },
    act: page => page.locator('#use-passkey').click(),
    title: 'You’re signed in', say: 'You’re in!', view: 'done' },
  { name: 'sign-in-12-already-signed-in', page: 'sign-in', query: cloud,
    api: { '/api/auth/get-session': { json: account } },
    title: 'Continue to Automagik Cloud', say: 'You’re already signed in on this browser.', view: 'session' },
  { name: 'sign-in-13-asked-to-create', page: 'sign-in', query: request('openid+profile', '&prompt=create'),
    title: 'Create your account for Automagik Cloud', say: passkeyLine, view: 'passkey',
    more: async (page) => {
      expect(await page.locator('#card .button:visible').allInnerTexts()).toEqual(['Create a passkey', 'I have a passkey']);
    } },
  { name: 'sign-in-14-too-many-tries', page: 'sign-in', query: cloud, passkey: 'ok',
    api: { '/api/auth/passkey/generate-authenticate-options': { status: 429, json: { message: 'slow down' }, headers: { 'X-Retry-After': '42' } } },
    act: page => page.locator('#use-passkey').click(), refused: 1,
    title: 'Sign in to Automagik Cloud', say: 'Too many tries. Take a short break.', view: 'passkey',
    more: async (page) => {
      expect(await page.locator('#passkey-wait').innerText()).toMatch(/^Try again in 4[12] s$/);
      expect(await page.locator('#use-passkey').isDisabled()).toBe(true);
    } },
  { name: 'sign-in-15-no-connection-on-a-tap', page: 'sign-in', query: cloud, passkey: 'ok',
    api: { '/api/auth/passkey/generate-authenticate-options': { drop: true } },
    act: page => page.locator('#use-passkey').click(), refused: 1,
    title: 'Sign in to Automagik Cloud', say: 'Can’t reach Automagik. Check your connection.', view: 'passkey',
    more: async (page) => { expect(await page.locator('#use-passkey').isEnabled()).toBe(true); } },
  { name: 'sign-in-16-no-connection-on-load', page: 'sign-in', query: cloud, refused: 1,
    api: { '/api/auth/oauth2/public-client-prelogin': { drop: true } },
    title: 'Sign in', say: 'Can’t reach Automagik. Check your connection.', view: 'retry' },
  { name: 'sign-in-17-service-error', page: 'sign-in', query: cloud, refused: 1,
    api: { '/api/auth/oauth2/public-client-prelogin': { status: 500, body: '<h1>raw error page</h1>' } },
    title: 'Sign in', say: 'Something went wrong on our side.', view: 'retry',
    more: async (page) => { expect(await page.locator('body').innerText()).not.toContain('raw error page'); } },
  { name: 'sign-in-18-request-expired-or-changed', page: 'sign-in', query: cloud, refused: 1,
    api: { '/api/auth/oauth2/public-client-prelogin': { status: 400, json: { error: 'invalid_request', error_description: '<i>raw</i>' } } },
    title: 'This link has expired', say: 'Let’s start over.', view: 'stop',
    more: async (page) => { expect(await page.locator('#card button:visible').count()).toBe(0); } },
  { name: 'sign-in-19-phone-number', page: 'sign-in', query: cloud, api: phoneOn,
    act: page => page.locator('#use-phone').click(),
    title: 'Sign in to Automagik Cloud', say: 'We’ll send a 6-digit code on WhatsApp.', view: 'phone' },
  { name: 'sign-in-20-phone-number-passkey-offered', page: 'sign-in', query: cloud, passkey: 'offer',
    api: { ...phoneOn, '/api/auth/passkey/generate-authenticate-options': { json: options } },
    act: page => page.locator('#use-phone').click(),
    title: 'Sign in to Automagik Cloud', say: 'We’ll send a 6-digit code on WhatsApp.', view: 'phone',
    more: async (page) => {
      await page.locator('#phone-hint', { hasText: 'Your passkey may show up here too.' }).waitFor();
      expect(await page.locator('#phone').getAttribute('autocomplete')).toBe('username webauthn');
    } },
  { name: 'sign-in-21-phone-number-not-valid', page: 'sign-in', query: cloud, api: phoneOn,
    act: async (page) => {
      await page.locator('#use-phone').click();
      await page.locator('#phone').fill('11 91234 5678');
      await page.locator('#send-code').click();
    },
    title: 'Sign in to Automagik Cloud', say: 'We’ll send a 6-digit code on WhatsApp.', view: 'phone',
    more: async (page) => {
      expect(await page.locator('#phone-hint').innerText()).toBe('Use the full number with the country code, like +55 11 91234 5678.');
      expect(await page.locator('#phone').getAttribute('aria-invalid')).toBe('true');
    } },
  { name: 'sign-in-22-phone-sending', page: 'sign-in', query: cloud,
    api: { ...phoneOn, '/api/auth/phone-number/send-otp': { hang: true } },
    act: async (page) => {
      await page.locator('#use-phone').click();
      await page.locator('#phone').fill('+55 11 91234 5678');
      await page.locator('#send-code').click();
    },
    title: 'Sign in to Automagik Cloud', say: 'We’ll send a 6-digit code on WhatsApp.', view: 'phone',
    more: async (page) => { expect(await page.locator('#send-code').innerText()).toBe('Sending…'); } },
  { name: 'sign-in-23-phone-code', page: 'sign-in', query: cloud,
    api: { ...phoneOn, '/api/auth/phone-number/send-otp': { json: { message: 'code sent' } } },
    act: toCode,
    title: 'Sign in to Automagik Cloud', say: 'Code sent to +55 11 91234 5678. It can take a moment.', view: 'code',
    more: async (page) => {
      expect(await page.locator('#resend').innerText()).toMatch(/^Send again in (30|29) s$/);
      expect(await page.locator('#code').getAttribute('autocomplete')).toBe('one-time-code');
    } },
  { name: 'sign-in-24-phone-code-wrong', page: 'sign-in', query: cloud, refused: 1,
    api: {
      ...phoneOn, '/api/auth/phone-number/send-otp': { json: { message: 'code sent' } },
      '/api/auth/phone-number/verify': { status: 400, json: { code: 'INVALID_OTP', message: 'Invalid OTP' } },
    },
    act: async (page) => { await toCode(page); await page.locator('#code').fill('123456'); },
    title: 'Sign in to Automagik Cloud', say: 'That code isn’t right. Check it and try again.', view: 'code' },
  { name: 'sign-in-25-phone-code-expired', page: 'sign-in', query: cloud, refused: 1,
    api: {
      ...phoneOn, '/api/auth/phone-number/send-otp': { json: { message: 'code sent' } },
      '/api/auth/phone-number/verify': { status: 400, json: { code: 'OTP_EXPIRED', message: 'OTP expired' } },
    },
    act: async (page) => { await toCode(page); await page.locator('#code').fill('123456'); },
    title: 'Sign in to Automagik Cloud', say: 'That code expired. Send a new one.', view: 'code' },
  { name: 'sign-in-26-phone-code-locked', page: 'sign-in', query: cloud, refused: 1,
    api: {
      ...phoneOn, '/api/auth/phone-number/send-otp': { json: { message: 'code sent' } },
      '/api/auth/phone-number/verify': { status: 403, json: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' } },
    },
    act: async (page) => { await toCode(page); await page.locator('#code').fill('123456'); },
    title: 'Sign in to Automagik Cloud', say: 'Too many wrong codes. Send a new code to keep going.', view: 'code',
    more: async (page) => {
      expect(await page.locator('#code').isDisabled()).toBe(true);
      expect(await page.locator('#resend').isEnabled()).toBe(true);
      expect(await page.locator('body').innerText()).not.toMatch(/attempts? (left|remain)/i);
    } },
  { name: 'sign-in-27-phone-wait-to-send', page: 'sign-in', query: cloud, refused: 1,
    api: { ...phoneOn, '/api/auth/phone-number/send-otp': { status: 429, body: '', headers: { 'X-Retry-After': '55' } } },
    act: async (page) => {
      await page.locator('#use-phone').click();
      await page.locator('#phone').fill('+55 11 91234 5678');
      await page.locator('#send-code').click();
    },
    title: 'Sign in to Automagik Cloud', say: 'Too many tries. Take a short break.', view: 'phone',
    more: async (page) => { expect(await page.locator('#phone-wait').innerText()).toMatch(/^Try again in 5[45] s$/); } },
  { name: 'sign-in-28-phone-only-browser', page: 'sign-in', query: cloud, passkey: 'none', api: phoneOn,
    title: 'Sign in to Automagik Cloud', say: 'This browser can’t use passkeys. Use a phone code.', view: 'phone',
    more: async (page) => { expect(await page.locator('#back-to-passkey').isHidden()).toBe(true); } },

  { name: 'consent-01-checking', page: 'consent', query: request('openid+profile+offline_access'),
    api: { '/api/auth/oauth2/public-client-prelogin': { hang: true }, '/api/auth/get-session': { json: account } },
    title: 'Allow access', say: 'One moment…', view: 'loading' },
  { name: 'consent-02-ask', page: 'consent', query: request('openid+profile+offline_access'),
    api: { '/api/auth/get-session': { json: account } },
    title: 'Allow Automagik Cloud?', say: 'Automagik Cloud never sees your passkey.', view: 'ask',
    more: async (page) => {
      expect(await page.locator('#asks strong').allInnerTexts()).toEqual(['Know it’s you', 'See your profile', 'Stay connected']);
    } },
  { name: 'consent-03-ask-other-scopes-and-claims', page: 'consent',
    query: request('openid+files.read', `&claims=${encodeURIComponent('{"userinfo":{"name":null,"picture":null}}')}`),
    api: {
      '/api/auth/get-session': { json: account },
      '/api/auth/oauth2/public-client-prelogin': { json: { client_id: 'automagik-cloud', client_name: 'Example third party' } },
    },
    title: 'Allow Example third party?', say: 'Example third party never sees your passkey.', view: 'ask',
    more: async (page) => {
      expect(await page.locator('#asks li').allInnerTexts().then((rows: string[]) => rows.map(row => row.replace(/\s+/g, ' ').trim())))
        .toEqual(['Know it’s you Your Automagik ID', 'files.read Other access this app asks for', 'Extra details name, picture']);
    } },
  { name: 'consent-04-allowing', page: 'consent', query: request('openid+profile'),
    api: { '/api/auth/get-session': { json: account }, '/api/auth/oauth2/consent': { hang: true } },
    act: page => page.locator('#allow').click(),
    title: 'Allow Automagik Cloud?', say: 'Automagik Cloud never sees your passkey.', view: 'ask',
    more: async (page) => {
      expect(await page.locator('#allow').innerText()).toBe('Allowing…');
      expect(await page.locator('#deny').isDisabled()).toBe(true);
    } },
  { name: 'consent-05-going-back-to-the-product', page: 'consent', query: request('openid+profile'),
    api: { '/api/auth/get-session': { json: account },
      '/api/auth/oauth2/consent': { json: { redirect: true, url: 'https://cloud.example.com/auth/callback?code=stub&state=opaque' } } },
    act: page => page.locator('#allow').click(),
    title: 'Allowed', say: 'Done!', view: 'going',
    more: async (page) => { expect(await page.locator('#going-text').innerText()).toBe('Taking you back to Automagik Cloud…'); } },
  { name: 'consent-06-sign-in-ran-out', page: 'consent', query: request('openid+profile'),
    title: 'Sign in again', say: 'Your sign-in timed out.', view: 'expired',
    more: async (page) => { expect(await page.locator('#card button:visible').allInnerTexts()).toEqual(['Sign in']); } },
  { name: 'consent-07-request-expired-or-changed', page: 'consent', query: request('openid+profile'), refused: 1,
    api: { '/api/auth/get-session': { json: account },
      '/api/auth/oauth2/public-client-prelogin': { status: 400, json: { error: 'invalid_signature' } } },
    title: 'This link has expired', say: 'Let’s start over.', view: 'stop' },
  { name: 'consent-08-not-allowed', page: 'consent', query: request('openid+profile'), refused: 1,
    api: { '/api/auth/get-session': { json: account },
      '/api/auth/oauth2/consent': { status: 403, json: { error: 'access_denied', error_description: '<i>raw</i>' } } },
    act: page => page.locator('#allow').click(),
    title: 'Not allowed', say: 'This account can’t allow that.', view: 'stop' },
  { name: 'consent-09-too-many-tries', page: 'consent', query: request('openid+profile'), refused: 1,
    api: { '/api/auth/get-session': { json: account },
      '/api/auth/oauth2/consent': { status: 429, json: {}, headers: { 'X-Retry-After': '30' } } },
    act: page => page.locator('#allow').click(),
    title: 'Allow Automagik Cloud?', say: 'Too many tries. Take a short break.', view: 'ask',
    more: async (page) => {
      expect(await page.locator('#ask-wait').innerText()).toMatch(/^Try again in (30|29) s$/);
      expect(await page.locator('#allow').isDisabled()).toBe(true);
    } },
  { name: 'consent-10-no-connection', page: 'consent', query: request('openid+profile'), refused: 1,
    api: { '/api/auth/get-session': { json: account }, '/api/auth/oauth2/consent': { drop: true } },
    act: page => page.locator('#deny').click(),
    title: 'Allow Automagik Cloud?', say: 'Can’t reach Automagik. Check your connection.', view: 'ask',
    more: async (page) => { expect(await page.locator('#allow').isEnabled()).toBe(true); } },
  { name: 'consent-11-no-connection-on-load', page: 'consent', query: request('openid+profile'), refused: 2,
    api: { '/api/auth/get-session': { drop: true }, '/api/auth/oauth2/public-client-prelogin': { drop: true } },
    title: 'Allow access', say: 'Can’t reach Automagik. Check your connection.', view: 'retry' },
];

// The browser's own passkey prompt cannot be pictured, so each state scripts its outcome.
const authenticator = (mode: string) => `(() => {
  const mode = ${JSON.stringify(mode)};
  if (mode === 'none') { delete window.PublicKeyCredential; return; }
  const credential = { toJSON: () => ({ id: 'stub', rawId: 'stub', type: 'public-key', response: {}, clientExtensionResults: {} }) };
  const answer = () => mode === 'pending' || mode === 'offer' ? new Promise(() => {}) :
    mode === 'cancel' ? Promise.reject(new DOMException('The request was cancelled.', 'NotAllowedError')) :
    Promise.resolve(credential);
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get: answer, create: answer } });
  window.PublicKeyCredential.isConditionalMediationAvailable = async () => mode === 'offer';
})()`;

async function stage(context: any, origin: string, scene: Scene) {
  const page = await context.newPage();
  await page.addInitScript(authenticator(scene.passkey ?? 'pending'));
  const healthy: Record<string, Reply> = {
    '/api/id/config': { json: { phoneEnabled: false } },
    '/api/auth/get-session': { json: null },
    '/api/auth/oauth2/public-client-prelogin': { json: { client_id: 'automagik-cloud', client_name: 'Automagik Cloud' } },
  };
  await page.route(`${origin}/api/**`, (route: any) => {
    const path = new URL(route.request().url()).pathname;
    const reply = scene.api?.[path] ?? healthy[path] ?? { status: 500, body: 'not scripted' };
    if (reply.hang) return undefined;
    if (reply.drop) return route.abort('failed');
    return route.fulfill({
      status: reply.status ?? 200, headers: reply.headers,
      contentType: reply.body === undefined ? 'application/json' : 'text/html',
      body: reply.body ?? JSON.stringify(reply.json ?? null),
    });
  });
  // The product's callback is not this service: answer with no content, so the browser
  // stays on the page and its last state can be seen.
  await page.route('https://cloud.example.com/**', (route: any) => route.fulfill({ status: 204 }));
  const seen = watch(page);
  await page.goto(`${origin}/${scene.page}${scene.query ? `?${scene.query}` : ''}`);
  if (scene.view !== 'loading') await page.locator('#card[aria-busy="false"]').waitFor();
  await scene.act?.(page);
  await page.locator(`#card [data-view="${scene.view}"]:not([hidden])`).waitFor();
  await expect.poll(() => said(page)).toBe(scene.say);
  await page.evaluate('document.fonts.ready.then(() => true)');
  return { page, seen };
}

describe('pages: every state', () => {
  const chosen = scenes.filter(scene => !only.length || only.some(part => scene.name.includes(part)));

  test('each state says what it should, with no console error and only contract calls', async ({ skip }) => {
    if (!(await chromium())) return skip();
    const { origin } = await world();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    for (const scene of chosen) {
      const { page, seen } = await stage(context, origin, scene);
      expect(await heading(page), scene.name).toBe(scene.title);
      expect(await view(page), scene.name).toBe(scene.view);
      await scene.more?.(page);
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 700 });
        const overflow = await page.evaluate('document.documentElement.scrollWidth - window.innerWidth');
        expect(overflow, `${scene.name} at ${width}`).toBeLessThanOrEqual(0);
        const clipped = await page.evaluate(`[...document.querySelectorAll('#card button, #card h1, #say')]
          .filter(node => node.offsetParent && node.scrollWidth > node.clientWidth + 1).map(node => node.id)`);
        expect(clipped, `${scene.name} at ${width}`).toEqual([]);
      }
      expectOnlyContract(seen, origin, ['https://cloud.example.com/auth/callback']);
      expectErrors(seen, scene.refused ?? 0);
      await page.close();
    }
    await context.close();
  }, 300000);

  test('a framed page shows nothing and calls nothing', async ({ skip }) => {
    if (!(await chromium())) return skip();
    const { origin } = await world();
    const context = await browser.newContext();
    const page = await context.newPage();
    const seen = watch(page);
    // The Worker's own answer says DENY, so the browser refuses to frame it. A host that
    // lost that header is played here by the same files without it: the script hides them.
    for (const name of PAGES) {
      const body = await read(`${name}.html`);
      await page.route(`${origin}/bare/${name}?*`, (route: any) => route.fulfill({ contentType: 'text/html', body }));
    }
    await page.route(`${origin}/host`, (route: any) => route.fulfill({
      contentType: 'text/html',
      body: PAGES.map(name => `<iframe src="/${name}?${cloud}"></iframe><iframe src="/bare/${name}?${cloud}"></iframe>`).join(''),
    }));
    await page.goto(`${origin}/host`);
    await page.waitForLoadState('networkidle');
    const frames = page.frames().slice(1);
    expect(frames).toHaveLength(4);
    let refused = 0;
    let hidden = 0;
    for (const frame of frames) {
      if (new URL(frame.url()).pathname.startsWith('/bare/')) {
        expect(await frame.locator('#card').count(), frame.url()).toBe(1);
        expect(await frame.evaluate('document.documentElement.hidden'), frame.url()).toBe(true);
        hidden++;
      } else {
        expect(await frame.locator('#card').count(), frame.url()).toBe(0);
        refused++;
      }
    }
    expect([refused, hidden]).toEqual([2, 2]);
    expect(seen.requests.filter(entry => entry.includes(`${origin}/id.js`))).toHaveLength(2);
    expect(seen.requests.filter(entry => entry.includes('/api/'))).toEqual([]);
    await context.close();
  }, 60000);

  test.runIf(shots)('pictures of every state at 1440 and 390, light and dark', async ({ skip }) => {
    if (!(await chromium())) return skip();
    const { origin } = await world();
    await mkdir(shots, { recursive: true });
    const sizes = [
      { width: 1440, height: 900, scale: 1, schemes: ['light', 'dark'] },
      { width: 390, height: 844, scale: 2, schemes: ['light', 'dark'] },
      { width: 320, height: 568, scale: 2, schemes: ['light'] },
    ];
    for (const size of sizes) {
      for (const scheme of size.schemes) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale,
          colorScheme: scheme, hasTouch: size.width < 700, isMobile: size.width < 700,
        });
        for (const scene of chosen) {
          const { page } = await stage(context, origin, scene);
          await page.waitForTimeout(350);
          await page.screenshot({ path: resolve(shots, `${scene.name}-${size.width}-${scheme}.png`), fullPage: size.width === 320 });
          await page.close();
        }
        await context.close();
      }
    }
    const rows = chosen.map(scene => `| ${scene.name} | ${scene.title} | ${scene.say} | ` +
      sizes.flatMap(size => size.schemes.map(scheme =>
        `[${size.width} ${scheme}](${scene.name}-${size.width}-${scheme}.png)`)).join(' · ') + ' |');
    await writeFile(resolve(shots, 'INDEX.md'), [
      '# Automagik ID pages: every state', '',
      'Made by `ID_PAGES_SHOTS=<this folder> bun run test -- pages` in `apps/id`: the real pages, served by the',
      'real Worker, in Chromium. The service\'s answers and the browser\'s passkey prompt are scripted per state',
      '(the prompt itself belongs to the browser and cannot be pictured). 1440 x 900 at 1x; 390 x 844 and',
      '320 x 568 at 2x.', '',
      '| State | Heading | The pet says | Pictures |', '|---|---|---|---|', ...rows, '',
    ].join('\n'));
  }, 900000);
});
