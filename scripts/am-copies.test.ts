import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, WRITE, copies, problems, write } from './am-copies.mjs';

// am/ carries byte-equal copies of the pack's CLI and briefing (RFC 0012); herdr PRs keep changing
// them, so a drift must say how to resync.
describe("am's copies of the pack's CLI and briefing", () => {
  test('match herdr/mods/am-sidebar byte for byte', () => {
    const found = problems();
    if (found.length) throw new Error(`${found.join('\n')}\nRun \`${WRITE}\` and commit am/.`);
    expect(found).toEqual([]);
  });

  test('cover the CLI, the briefing, run.sh and the trust anchors', () => {
    const to = copies().map(([, target]) => target);
    for (const file of ['am/bin/automagik-herdr.mjs', 'am/bin/automagik-herdr', 'am/bin/run.sh', 'am/briefing.mjs', 'am/briefingEntry.mjs',
      'am/model.js', 'am/update.mjs', 'am/pack-keys.json', 'am/plugin-lane-keys.json']) expect(to).toContain(file);
  });

  test('a drifted, missing or stale copy is named, and --write repairs it', () => {
    const root = mkdtempSync(join(tmpdir(), 'am-copies-'));
    try {
      for (const dir of ['am', 'herdr/mods/am-sidebar', 'plugin-lane']) cpSync(join(ROOT, dir), join(root, dir), { recursive: true });
      writeFileSync(join(root, 'am', 'model.js'), '// drifted\n');
      rmSync(join(root, 'am', 'tidy.js'));
      // The CLI stops importing restart.js: am's copy is stale.
      const cli = join(root, 'herdr/mods/am-sidebar/bin/automagik-herdr.mjs');
      writeFileSync(cli, readFileSync(cli, 'utf8').replace(/^import [^\n]*"\.\.\/restart\.js";\n/m, ''));
      const found = problems(root);
      expect(found).toContain('am/model.js differs from herdr/mods/am-sidebar/model.js');
      expect(found).toContain('am/tidy.js is missing (a copy of herdr/mods/am-sidebar/tidy.js)');
      expect(found).toContain('am/restart.js is a stale copy: nothing am copies imports it now');
      write(root);
      expect(problems(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
