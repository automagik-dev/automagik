import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { clientSeedSQL } from './client-seed';

// Read an existing Cloud client secret through stdin, never an argument or a log.
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const secret = Buffer.concat(chunks).toString('utf8').trim();
if (secret.length < 32) throw new Error('Pipe the Cloud client secret (at least 32 characters)');
const mode = process.argv[2];
if (mode !== '--local' && mode !== '--remote') throw new Error('Choose --local or --remote');
await mkdir('.wrangler', { recursive: true });
const directory = await mkdtemp('.wrangler/seed-');
try {
  const file = join(directory, 'clients.sql');
  await writeFile(file, clientSeedSQL(createHash('sha256').update(secret).digest('base64url')),
    { mode: 0o600 });
  const result = spawnSync('bun', ['x', '--no-install', 'wrangler', 'd1', 'execute', 'DB', mode,
    '--config', 'wrangler.local.toml', '--file', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
