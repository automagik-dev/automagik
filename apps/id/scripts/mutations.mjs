import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const mutations = [
  {
    name: 'drop PKCE enforcement',
    test: 'plain and missing PKCE',
    edits: [['scripts/client-seed.ts', 'requirePKCE: true', 'requirePKCE: false']],
  },
  {
    name: 'allow any redirect',
    test: 'registered native loopback',
    edits: [['src/auth.ts', 'validateRedirectUri: strictRedirectUri', 'validateRedirectUri: () => true']],
  },
  {
    name: 'turn public registration on',
    test: 'unsupported sign-in',
    edits: [
      ['src/auth.ts', 'allowDynamicClientRegistration: false', 'allowDynamicClientRegistration: true'],
      ['src/auth.ts', 'allowUnauthenticatedClientRegistration: false', 'allowUnauthenticatedClientRegistration: true'],
      ['src/index.ts', "'/oauth2/public-client-prelogin',", "'/oauth2/public-client-prelogin', '/oauth2/register',"],
    ],
  },
  {
    name: 'store the rate limit in memory',
    test: 'D1 rate limit survives',
    edits: [['src/auth.ts', "storage: 'database'", "storage: 'memory'"]],
  },
  {
    name: 'serve a page file directly as .html',
    test: 'direct .html paths answer 404',
    edits: [['src/index.ts', 'if (directPage(url.pathname)) return', 'if (false) return']],
  },
  {
    name: 'let CI skip the page browser tests',
    test: 'the CI job runs the browser tests',
    edits: [['../../.github/workflows/ci.yml', 'ID_PAGES_BROWSER: required', 'ID_PAGES_BROWSER: optional']],
  },
];

const reportTo = process.argv[2];
await mkdir('.wrangler', { recursive: true });
for (const [index, mutation] of mutations.entries()) {
  // The owner's terminal receives the mutation's name before any source is changed.
  const announcement = `Mutation check: ${mutation.name}.`;
  if (reportTo) {
    const notice = spawnSync('hc', ['send', reportTo, announcement], { encoding: 'utf8' });
    if (notice.status !== 0) throw new Error(`Could not report mutation: ${notice.stderr}`);
  }
  process.stdout.write(`${announcement}\n`);
  const originals = new Map();
  try {
    for (const [file, before, after] of mutation.edits) {
      const current = await readFile(file, 'utf8');
      if (!originals.has(file)) originals.set(file, current);
      if (current.split(before).length !== 2) throw new Error(`Ambiguous mutation in ${file}`);
      await writeFile(file, current.replace(before, after));
    }
    const result = spawnSync('bun', ['run', 'test', '--', '-t', mutation.test], {
      encoding: 'utf8', timeout: 60000,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    await writeFile(`.wrangler/mutation-${index + 1}.log`, output);
    if (result.status !== 1 || !output.includes('AssertionError')) {
      throw new Error(`${mutation.name}: survived or infrastructure failed; see mutation-${index + 1}.log`);
    }
    process.stdout.write(`${mutation.name}: KILLED (assertion failed)\n`);
  } finally {
    for (const [file, original] of originals) await writeFile(file, original);
  }
}
