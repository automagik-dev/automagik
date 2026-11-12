// A real SQLite database behind the narrow D1 methods the Pages Functions use.
// No remote binding, account or contact. Used by unit tests and the loopback browser server.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
export function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('schema.sql', import.meta.url), 'utf8'))
  function statement(sql, args = []) {
    return {
      bind: (...values) => statement(sql, values),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
      sql, args,
    }
  }
  const db = {
    prepare: statement,
    batch: async statements => {
      sqlite.exec('BEGIN')
      try {
        const values = statements.map(({ sql, args }) => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }))
        sqlite.exec('COMMIT'); return values
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const env = { WAITLIST_DB: db, WAITLIST_CONFIRM_SECRET: 'isolated-test-secret-not-a-credential', RESEND_API_KEY: 'isolated-test-key', WAITLIST_WHATSAPP_NUMBER: '15555550100', WAITLIST_DATA_JURISDICTION: 'eu' }
  return { db, env, sqlite, close: () => sqlite.close() }
}
