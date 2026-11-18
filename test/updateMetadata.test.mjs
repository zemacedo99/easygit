import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { buildMetadata, FIRST_SELF_UPDATING } from '../scripts/make-update-metadata.mjs';
import { CHANGELOG } from '../src/renderer/changelog.mjs';

const require = createRequire(import.meta.url);
const { validateMetadata, compareVersions } = require('../src/main/updateCore.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');


function fakeRelease(t, version, { badSums = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-meta-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const inst = crypto.randomBytes(1000);
  const port = crypto.randomBytes(800);
  fs.writeFileSync(path.join(dir, `EasyGit-Setup-${version}.exe`), inst);
  fs.writeFileSync(path.join(dir, `EasyGit-${version}-portable.exe`), port);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'),
    `${badSums ? 'F'.repeat(64) : sha(inst).toUpperCase()}  EasyGit-Setup-${version}.exe\r\n${sha(port).toUpperCase()}  EasyGit-${version}-portable.exe\r\n`);
  return { dir, inst, port };
}

const entry = (version) => ({ version, date: '2026-11-01', summary: 'Test.', sections: [{ heading: 'New', items: ['Thing'] }] });

test('the release script builds valid update metadata from the real files', (t) => {
  const { dir, inst, port } = fakeRelease(t, '1.4.0');
  const meta = buildMetadata({ dir, version: '1.4.0', changelog: entry('1.4.0') });
  assert.equal(validateMetadata(meta, '1.4.0').ok, true);
  assert.equal(meta.installer.sha256, sha(inst));
  assert.equal(meta.portable.size, port.length);
  assert.equal(meta.changelog.version, '1.4.0');
});

test('the release script refuses mismatched checksums or a missing changelog entry', (t) => {
  const bad = fakeRelease(t, '1.4.0', { badSums: true });
  assert.throws(() => buildMetadata({ dir: bad.dir, version: '1.4.0', changelog: entry('1.4.0') }), /does not match SHA256SUMS/);
  const ok = fakeRelease(t, '1.4.0');
  assert.throws(() => buildMetadata({ dir: ok.dir, version: '1.4.0', changelog: undefined }), /changelog/);
  assert.throws(() => buildMetadata({ dir: ok.dir, version: '1.4.0', changelog: entry('1.3.0') }), /changelog/);
});

// Executables are published as GitHub Release assets and are not committed, so
// this guard checks a release folder only while it holds the built executables
// (i.e. while a release is being prepared locally).
test('every self-updating release folder ships a valid update.json matching its files (release guard)', () => {
  const versionsDir = path.join(root, 'versions');
  const folders = fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir).filter((d) => /^v\d+\.\d+\.\d+$/.test(d)) : [];
  for (const folder of folders) {
    const version = folder.slice(1);
    const metaFile = path.join(root, 'versions', folder, 'update.json');
    if (compareVersions(version, FIRST_SELF_UPDATING) < 0) continue; // released before the updater existed
    const hasExecutables = fs.readdirSync(path.join(versionsDir, folder)).some((f) => f.endsWith('.exe'));
    if (!hasExecutables && !fs.existsSync(metaFile)) continue; // published on GitHub Releases only
    assert.ok(fs.existsSync(metaFile), `versions/${folder}/update.json is missing — run: node scripts/make-update-metadata.mjs ${version}`);
    const check = validateMetadata(fs.readFileSync(metaFile, 'utf8'), version);
    assert.ok(check.ok, `versions/${folder}/update.json: ${check.reason}`);
    for (const key of ['installer', 'portable']) {
      const file = path.join(root, 'versions', folder, check.metadata[key].file);
      if (!hasExecutables) continue; // the exe lives on the GitHub Release
      assert.equal(sha(fs.readFileSync(file)), check.metadata[key].sha256, `${file} checksum`);
    }
    assert.deepEqual(check.metadata.changelog, CHANGELOG.find((r) => r.version === version), 'update.json "What\'s new" must match changelog.mjs');
  }
});
