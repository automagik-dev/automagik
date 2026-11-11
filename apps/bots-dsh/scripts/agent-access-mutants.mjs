// Run under the same exclusive gate lock as the tests: each mutant is always restored.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const source = new URL('../src/host/agent-access.js', import.meta.url)
const original = readFileSync(source, 'utf8')
const mutants = [
  {
    name: 'accept a revoked token',
    from: " || identity.revokedAt !== undefined",
    to: '',
    test: 'token create stores only hash; revoke immediately refuses the token',
  },
  {
    name: 'skip the audit on refusal',
    from: "await audit({ ...entry, outcome: 'refused', reason })",
    to: '// mutant: refusal is not audited',
    test: 'refusal audit records missing, wrong, revoked, unknown and invalid calls',
  },
  {
    name: 'log the raw token',
    from: 'const hash = digest(candidate)',
    to: `await appendFile(auditPath(), JSON.stringify({ rawToken: candidate }) + '\\n')
    const hash = digest(candidate)`,
    test: 'no raw token or secret values in responses or audit, including pasted config',
  },
]
try {
  for (const mutant of mutants) {
    assert.ok(original.includes(mutant.from), `${mutant.name}: mutation site missing`)
    writeFileSync(source, original.replace(mutant.from, mutant.to))
    const result = spawnSync(process.execPath, ['--import', './test/harness-resolve.mjs',
      '--test', '--test-reporter=tap', `--test-name-pattern=${mutant.test}`,
      'test/agent-access.test.js'], { cwd: new URL('..', import.meta.url), encoding: 'utf8',
      timeout: 60000 })
    const output = (result.stdout ?? '') + (result.stderr ?? '')
    assert.ok(result.status !== null && result.status !== 0 && /not ok/.test(output)
      && /AssertionError/.test(output), `${mutant.name}: no assertion killed mutant`)
    console.log(`KILLED: ${mutant.name} — ${mutant.test}`)
    writeFileSync(source, original)
  }
} finally {
  writeFileSync(source, original)
}
