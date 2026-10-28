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
