import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The credential redactor is one edited source, apps/bots-dsh/src/host/redact.js. Each plugin
// installs on its own, so acp-dsh and the welcome carry byte-for-byte copies (the client copy is
// bundled into the welcome's browser half). A copy that drifts would ship shapes nobody reviewed.
const APPS = join(import.meta.dir, '..', 'apps');
const SOURCE = join(APPS, 'bots-dsh', 'src', 'host', 'redact.js');
const COPIES = [
  'acp-dsh/src/host/redact.js',
  'welcome-dsh/src/host/redact.js',
  'welcome-dsh/src/client/redact.js',
];

describe('the credential redactor copies', () => {
  test('the quoted npm key is redacted (fails if the quote allowance is dropped)', async () => {
    const { redactText } = await import('../apps/bots-dsh/src/host/redact.js');
    const quoted = [
      ['"_authToken": "quoted-secret-123456"', 'quoted-secret-123456'],
      ['"//registry.npmjs.org/:_auth": "quoted-auth-secret=="', 'quoted-auth-secret=='],
      ['NPM_TOKEN=env-token-secret', 'env-token-secret'],
      ['npm_config__authToken=npm-config-secret', 'npm-config-secret'],
    ];
    for (const [raw, secret] of quoted) expect(redactText(raw)).not.toContain(secret);
  });

  test('each copy is byte for byte the Bot team source', () => {
    const source = readFileSync(SOURCE);
    const drifted = COPIES.filter((file) => !readFileSync(join(APPS, file)).equals(source));
    expect(drifted).toEqual([]);
  });
});
