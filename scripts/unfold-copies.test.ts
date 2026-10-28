import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Files one Unfold plugin carries from another, byte for byte, so each installs on its own: the
// source is the one that is edited. A copy that drifts from it ships, or tests against, code
// nobody reviewed. The sse hub copies are held in sse-copies.test.ts.
const APPS = join(import.meta.dir, '..', 'apps');
// copy -> source
const COPIES: Record<string, string> = {
  'unfold-mind-dsh/catalog/events.v3.json': 'unfold-events-dsh/catalog/events.v3.json',
  'unfold-mind-dsh/src/client/ui.jsx': 'unfold-events-dsh/src/client/ui.jsx',
  'unfold-mind-dsh/test/support/window.js': 'unfold-events-dsh/src/window.js',
  'unfold-session-dsh/src/call-view.js': 'unfold-events-dsh/src/call-view.js',
  'unfold-settings-dsh/src/client/ui.jsx': 'unfold-events-dsh/src/client/ui.jsx',
  'unfold-trajectory-dsh/catalog/events.v3.json': 'unfold-events-dsh/catalog/events.v3.json',
  'unfold-trajectory-dsh/src/mind/metrics.js': 'unfold-mind-dsh/src/metrics.js',
  'unfold-trajectory-dsh/src/mind/moments.js': 'unfold-mind-dsh/src/moments.js',
  'unfold-trajectory-dsh/test/support/catalog.js': 'unfold-mind-dsh/test/support/catalog.js',
  'unfold-trajectory-dsh/test/support/display.js': 'unfold-mind-dsh/src/display.js',
  'unfold-trajectory-dsh/test/support/mind.js': 'unfold-mind-dsh/src/mind.js',
  'unfold-trajectory-dsh/test/support/redact.js': 'unfold-mind-dsh/src/redact.js',
  'unfold-trajectory-dsh/test/support/sentences.js': 'unfold-mind-dsh/src/sentences.js',
  'unfold-trajectory-dsh/test/support/window.js': 'unfold-events-dsh/src/window.js',
};
// Mind's test catalog loader is unfold-events-dsh's src/catalog.js with the catalog one directory
// further up: adapted, not a copy.

describe('the Unfold plugins’ copied files', () => {
  test('each copy is byte for byte its source', () => {
    const drifted = Object.entries(COPIES)
      .filter(([copy, source]) => !readFileSync(join(APPS, copy)).equals(readFileSync(join(APPS, source))))
      .map(([copy, source]) => `${copy} (copy ${source})`);
    expect(drifted).toEqual([]);
  });
});

// The credential redaction is carried as code inside larger files: each copy of a block, by its
// declaration, is the block in its source, line for line.
const BLOCKS: [string, string, string[]][] = [
  // [the declaration, its source, its copies]
  ['const SECRET_KEY =', 'unfold-mind-dsh/src/redact.js', ['unfold-events-dsh/src/client/redact.js', 'unfold-events-dsh/src/window.js', 'unfold-settings-dsh/src/redact.js']],
  ['const SECRET_TEXT = [', 'unfold-mind-dsh/src/redact.js', ['unfold-events-dsh/src/client/redact.js', 'unfold-events-dsh/src/window.js', 'unfold-settings-dsh/src/redact.js']],
  ['const SECRET_VALUES = [', 'unfold-mind-dsh/src/redact.js', ['unfold-events-dsh/src/client/redact.js']],
  ['const QUOTED_SECRET = [', 'unfold-events-dsh/src/window.js', ['unfold-mind-dsh/src/mind.js']],
  ['const YAML_SECRET = [', 'unfold-events-dsh/src/window.js', ['unfold-mind-dsh/src/mind.js']],
  ['const ESCAPED_SECRET = [', 'unfold-events-dsh/src/window.js', ['unfold-mind-dsh/src/mind.js']],
  ['const ESCAPED_END =', 'unfold-events-dsh/src/window.js', ['unfold-mind-dsh/src/mind.js']],
];

/** The block `declaration` opens in `file`: one line, or through the `]` that closes its list. */
function block(file: string, declaration: string): string {
  const lines = readFileSync(join(APPS, file), 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith(declaration));
  if (start < 0) return `${declaration} is not in ${file}`;
  const end = declaration.endsWith('[') ? lines.indexOf(']', start) : start;
  return lines.slice(start, end + 1).join('\n');
}

describe('the copied credential redaction', () => {
  test('each copy of a redaction block is its source block', () => {
    const drifted = BLOCKS.flatMap(([declaration, source, copies]) =>
      copies.filter((copy) => block(copy, declaration) !== block(source, declaration)).map((copy) => `${copy}: ${declaration} (copy ${source})`),
    );
    expect(drifted).toEqual([]);
  });
});
