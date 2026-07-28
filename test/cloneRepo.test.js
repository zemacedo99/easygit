'use strict';

/**
 * End-to-end clone test — fully offline. It creates a local source Git repo,
 * serves it over a file:// URL, and drives repoManager.cloneRepo through the
 * real git clone (no network). Covers success, dedupe, no-overwrite, and
 * invalid-link handling.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repoManager = require('../src/main/repoManager');
const store = require('../src/main/storage');

let tmp, sourceUrl, dest;

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-clone-'));
  // Isolated storage for the repo list.
  store.init(path.join(tmp, 'userData'));
  fs.mkdirSync(path.join(tmp, 'userData'), { recursive: true });
  repoManager.load();

  // A real source repo with one commit — this is our stand-in "online project".
  const src = path.join(tmp, 'source-repo');
  fs.mkdirSync(src);
  git(src, ['init', '-q']);
  git(src, ['config', 'user.email', 'test@example.com']);
  git(src, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(src, 'README.md'), '# hello\n');
  git(src, ['add', '-A']);
  git(src, ['commit', '-q', '-m', 'init']);

  sourceUrl = pathToFileURL(src).href; // file:///…
  dest = path.join(tmp, 'downloads');
  fs.mkdirSync(dest);
});

after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
});

test('cloneRepo: downloads and adds the project', async () => {
  const res = await repoManager.cloneRepo({ url: sourceUrl, parentDir: dest, folderName: 'my-clone' });
  assert.equal(res.ok, true, res.error && res.error.detail);
  assert.equal(res.repo.name, 'my-clone');
  assert.equal(res.repo.path, path.join(dest, 'my-clone'));
  assert.ok(fs.existsSync(path.join(dest, 'my-clone', '.git')), 'cloned .git should exist');
  assert.ok(repoManager.listRepos().some((r) => r.path === path.join(dest, 'my-clone')), 'should be in the list');
});

test('cloneRepo: refuses to overwrite an existing folder', async () => {
  // "my-clone" now exists from the previous test.
  const res = await repoManager.cloneRepo({ url: sourceUrl, parentDir: dest, folderName: 'my-clone' });
  assert.equal(res.ok, false);
  assert.match(res.error.title, /already exists/i);
  assert.match(res.error.detail, /will not overwrite/i); // reassures the user their files are safe
});

test('cloneRepo: rejects an invalid link before touching disk', async () => {
  const res = await repoManager.cloneRepo({ url: 'not-a-real-link', parentDir: dest, folderName: 'whatever' });
  assert.equal(res.ok, false);
  assert.match(res.error.title, /does not look right/i);
  assert.ok(!fs.existsSync(path.join(dest, 'whatever')), 'no folder should be created for an invalid link');
});

test('cloneRepo: suggests a folder name from the link when none is given', async () => {
  const res = await repoManager.cloneRepo({ url: sourceUrl, parentDir: dest });
  assert.equal(res.ok, true, res.error && res.error.detail);
  // pathToFileURL keeps the last path segment ("source-repo").
  assert.equal(res.repo.name, 'source-repo');
});

test('cloneRepo: rejects a missing destination folder', async () => {
  const res = await repoManager.cloneRepo({ url: sourceUrl, parentDir: path.join(tmp, 'does-not-exist') });
  assert.equal(res.ok, false);
  assert.match(res.error.title, /not found/i);
});
