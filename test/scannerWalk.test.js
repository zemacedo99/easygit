'use strict';
// Auto-find walking real (temporary) folders: repositories nested inside other
// repositories must be found; dependency/build folders and .git internals not.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { scanForRepos } = require('../src/main/scanner');

function tree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repo = (rel) => {
    const dir = path.join(root, rel);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
  };
  return { root, repo };
}

const names = (res, root) => res.found.map((f) => path.relative(root, f.path).replace(/\\/g, '/')).sort();

test('finds repositories nested inside another repository', async (t) => {
  const { root, repo } = tree(t);
  repo('outer');
  repo('outer/inner');
  repo('outer/libs/deeper');
  repo('outer/inner/innermost');
  repo('separate');
  const res = await scanForRepos(root);
  assert.deepEqual(names(res, root), ['outer', 'outer/inner', 'outer/inner/innermost', 'outer/libs/deeper', 'separate']);
});

test('finds a nested repository whose .git is a file (submodule / worktree style)', async (t) => {
  const { root, repo } = tree(t);
  repo('outer');
  const sub = path.join(root, 'outer', 'modules', 'shared');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../../.git/modules/shared\n');
  const res = await scanForRepos(root);
  assert.deepEqual(names(res, root), ['outer', 'outer/modules/shared']);
});

test('still skips dependency/build folders and never reports .git internals', async (t) => {
  const { root, repo } = tree(t);
  repo('app');
  repo('app/node_modules/some-package');
  repo('app/build/generated');
  repo('app/.hidden/tool');
  fs.mkdirSync(path.join(root, 'app', '.git', 'modules', 'x', '.git'), { recursive: true });
  const res = await scanForRepos(root);
  assert.deepEqual(names(res, root), ['app']);
});

test('each repository is reported once', async (t) => {
  const { root, repo } = tree(t);
  repo('outer');
  repo('outer/inner');
  const res = await scanForRepos(root);
  assert.equal(res.found.length, new Set(res.found.map((f) => f.path.toLowerCase())).size);
});
