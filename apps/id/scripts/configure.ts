import { readFile, writeFile } from 'node:fs/promises';

const origin = new URL(process.env.ID_WORKER_ORIGIN ?? '');
if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.workers.dev') ||
    origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
  throw new Error('First deployment requires an HTTPS workers.dev origin');
}
const databaseId = process.env.ID_DATABASE_ID ?? '';
if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw new Error('Set ID_DATABASE_ID');
const receiving = process.env.WHATSAPP_RECEIVING_NUMBER;
if (receiving && !/^\+?[1-9]\d{7,14}$/.test(receiving)) throw new Error('Invalid receiving number');
const template = await readFile('wrangler.toml', 'utf8');
await writeFile('wrangler.local.toml', template + '\n[vars]\n' +
  `BETTER_AUTH_URL = ${JSON.stringify(origin.origin)}\n` +
  (receiving ? `WHATSAPP_RECEIVING_NUMBER = ${JSON.stringify(receiving)}\n` : '') +
  '\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "automagik-id"\n' +
  `database_id = ${JSON.stringify(databaseId)}\nmigrations_dir = "migrations"\n`, { mode: 0o600 });
