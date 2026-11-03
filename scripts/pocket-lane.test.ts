import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextPatch, sequenceOf } from './lane';
import { ROOT, nextVersion, versionCode } from './version';

// Pocket's rolling pocket-lane release (docs/rfcs/0011-monorepo-parts-and-releases.md, "Pocket"): phones
// read latest.json there and nowhere else. It must never pass for a release: its tag is not v*, it is
// never Latest, and nothing that looks for "the last release" by tag or by Latest takes it.
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const release = read('.github/workflows/release.yml');
const LANES = ['pocket-lane', 'herdr-lane', 'plugin-lane'];

/** The `pocket` job of release.yml, up to the next job. */
const pocketJob = (() => {
  const start = release.indexOf('\n  pocket:\n');
  const end = release.indexOf('\n  desktop:\n', start);
  return start < 0 || end < 0 ? '' : release.slice(start, end);
})();

describe('pocket-lane is never taken for a release', () => {
  test('every tag filter in release.yml takes v3.N.P and no rolling lane', () => {
    const filters = [...release.matchAll(/grep -E '(\^v3[^']*)'/g)].map(match => new RegExp(match[1]));
    expect(filters.length).toBeGreaterThanOrEqual(3);
    for (const filter of filters) {
      for (const lane of LANES) expect(filter.test(lane)).toBe(false);
      expect(filter.test('v3.57.0')).toBe(true);
    }
    // The tag lists they read are v3.* only, which a lane's name never matches.
    for (const lane of LANES) expect(new Bun.Glob('v3.*').match(lane)).toBe(false);
  });

  test('the version and patch tooling ignore it', () => {
    expect(nextVersion(['v3.57.0', ...LANES])).toBe('3.58.0');
    expect(nextPatch(['v3.57.0', 'v3.57.2', ...LANES])).toBe('3.57.3');
    for (const lane of LANES) expect(() => sequenceOf(lane)).toThrow(/not a release version/);
    expect(() => versionCode('pocket-lane')).toThrow(/not a version/);
  });

  test("Follow Omni keys on v<semver> tags of Omni's releases: a lane's name never passes", () => {
    const follow = read('.github/workflows/follow-omni.yml');
    const filter = /test\("([^"]+)"\)/.exec(follow)?.[1];
    expect(filter).toBeDefined();
    const tag = new RegExp((filter as string).replaceAll('\\\\', '\\'));
    expect(tag.test('v2.261023.32')).toBe(true);
    for (const lane of LANES) expect(tag.test(lane)).toBe(false);
  });

  test('it is created as a prerelease that is not Latest, then only its latest.json is replaced', () => {
    expect(pocketJob).not.toBe('');
    expect(pocketJob).toContain('gh release create pocket-lane --repo "${GITHUB_REPOSITORY}" --target dev --prerelease --latest=false');
    expect(pocketJob).toContain('gh release upload pocket-lane pocket/latest.json --clobber');
    // Never edited (that could flip prerelease or make it Latest), never given another file.
    expect(release).not.toMatch(/gh release edit pocket-lane/);
    expect([...pocketJob.matchAll(/gh release upload pocket-lane ([^\n]*)/g)].map(match => match[1].split(' --')[0])).toEqual(['pocket/latest.json']);
    // Only a release that is not a prerelease moves it, one run at a time, and never to a lower versionCode.
    expect(pocketJob).toMatch(/- name: Post latest\.json on pocket-lane\n\s+if: env\.PRERELEASE != 'true'/);
    expect(pocketJob).toMatch(/concurrency:\n\s+group: pocket-lane\n\s+cancel-in-progress: false/);
    expect(pocketJob).toContain('if (( code <= ${current:-0} )); then');
  });

  test('latest.json names the APK on its own vX.Y.Z release with its sha256, and goes up after it', () => {
    expect(pocketJob).toContain('--arg url "https://github.com/${GITHUB_REPOSITORY}/releases/download/v${VERSION}/${apk}"');
    expect(pocketJob).toContain("'{versionCode: $code, versionName: $name, url: $url, sha256: $sha, notes: $notes}'");
    const apk = pocketJob.indexOf('gh release upload "v${VERSION}" "pocket/automagik-pocket-${VERSION}.apk"');
    const manifest = pocketJob.indexOf('gh release upload "v${VERSION}" pocket/latest.json');
    const lane = pocketJob.indexOf('gh release upload pocket-lane');
    expect(apk).toBeGreaterThan(-1);
    expect(manifest).toBeGreaterThan(apk);
    expect(lane).toBeGreaterThan(manifest);
  });

  test("a full release's desktop build keeps the APK and latest.json the Pocket job put on it", () => {
    const sweep = read('.github/workflows/desktop-build.yml').split('\n').find(line => /case "\$\{name\}" in .*\) continue ;; esac/.test(line)) ?? '';
    const kept = /in (.*)\) continue/.exec(sweep)?.[1].split('|') ?? [];
    expect(kept).toContain('automagik-pocket-*.apk');
    expect(kept).toContain('latest.json');
  });

  test('the app reads pocket-lane by default, and -Ppocket.updateUrl= still overrides it', () => {
    const gradle = read('apps/pocket/android/app/build.gradle.kts');
    expect(gradle).toContain('providers.gradleProperty("pocket.updateUrl").orElse("https://github.com/automagik-dev/automagik/releases/download/pocket-lane/latest.json")');
    expect(gradle).not.toContain('releases/latest/download');
  });
});
