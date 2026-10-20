import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANGELOG, compareVersions, releasesNewestFirst, formatReleaseDate } from '../src/renderer/changelog.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the running version has a changelog entry, and it is the newest (release checklist guard)', () => {
  assert.equal(CHANGELOG[0].version, pkg.version, `Add v${pkg.version} at the top of src/renderer/changelog.mjs`);
});

test('releases are listed newest first, with non-increasing dates', () => {
  assert.deepEqual(CHANGELOG.map((r) => r.version), releasesNewestFirst().map((r) => r.version));
  for (let i = 1; i < CHANGELOG.length; i++) {
    assert.ok(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0);
    assert.ok(CHANGELOG[i - 1].date >= CHANGELOG[i].date, 'dates out of order');
  }
});

test('every released versions/ folder is in the changelog, and older entries have release notes', () => {
  const folders = fs.readdirSync(path.join(root, 'versions')).filter((d) => /^v\d+\.\d+\.\d+$/.test(d));
  const listed = CHANGELOG.map((r) => `v${r.version}`);
  for (const f of folders) assert.ok(listed.includes(f), `${f} is released but missing from src/renderer/changelog.mjs`);
  // The newest entry may be the release being prepared (its folder comes later).
  for (const v of listed.slice(1)) {
    assert.ok(fs.existsSync(path.join(root, 'versions', v, 'RELEASE_NOTES.md')), `${v} has no versions/${v}/RELEASE_NOTES.md`);
  }
});

test('every entry is complete (date, summary, non-empty sections)', () => {
  for (const r of CHANGELOG) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(formatReleaseDate(r.date));
    assert.ok(r.summary.trim());
    assert.ok(r.sections.length > 0);
    for (const s of r.sections) {
      assert.ok(s.heading.trim());
      assert.ok(s.items.length > 0 && s.items.every((i) => typeof i === 'string' && i.trim()));
    }
  }
});

test('version comparison and date formatting', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.equal(compareVersions('1.3.0', '1.3.0'), 0);
  assert.deepEqual(releasesNewestFirst([{ version: '1.0.0' }, { version: '1.10.0' }, { version: '1.2.0' }]).map((r) => r.version), ['1.10.0', '1.2.0', '1.0.0']);
  assert.equal(formatReleaseDate('2026-10-20'), '20 October 2026');
  assert.equal(formatReleaseDate('soon'), '');
});
