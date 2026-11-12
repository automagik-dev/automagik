// Run only when deliberately updating the pinned auth schema; review the resulting SQL.
import { Database } from 'bun:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { mkdir, writeFile } from 'node:fs/promises';
import { createAuth, type Env } from '../src/auth';

const auth = createAuth({
  BETTER_AUTH_URL: 'https://id.example.com',
  BETTER_AUTH_SECRET: 'schema-generation-placeholder-not-a-credential',
} as Env, { waitUntil() {} }, true);
const migration = await getMigrations({ ...auth.options, database: new Database(':memory:') });
await mkdir(new URL('../migrations/', import.meta.url), { recursive: true });
await writeFile(new URL('../migrations/0001_auth.sql', import.meta.url),
  `-- Generated from Better Auth 1.7.21, passkey, jwt, OAuth provider and phoneNumber.\n${await migration.compileMigrations()}\n`);
