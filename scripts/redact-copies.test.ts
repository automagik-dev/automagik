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
  test('each copy is byte for byte the Bot team source', () => {
    const source = readFileSync(SOURCE);
    const drifted = COPIES.filter((file) => !readFileSync(join(APPS, file)).equals(source));
    expect(drifted).toEqual([]);
  });
});
