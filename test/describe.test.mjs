// Commit-description automation, the ✨ Suggest regression, and notification
// auto-close timers. Git tests use temporary local repositories only (the
// "online" repository is a local bare repo; nothing is pushed anywhere real).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { describeMode, customDefault, prepareDescription, FALLBACK_DESCRIPTION } from '../src/renderer/describe.mjs';
import { autoClosesType, armAutoClose, AUTO_CLOSE_MS } from '../src/renderer/toastTimer.mjs';

const require = createRequire(import.meta.url);
const storage = require('../src/main/storage.js');
const repoManager = require('../src/main/repoManager.js');
const { suggestCommitMessage } = require('../src/main/suggestMessage.js');

/* ----------------------------- modes + fallback ---------------------------- */

test('both options off keeps today’s behavior (ask, empty box)', () => {
  assert.equal(describeMode({}), 'manual');
  assert.equal(describeMode({ autoUploadNoPrompt: true }), 'manual', 'one-click needs the parent option');
  assert.equal(describeMode({ autoCommitMessage: true }), 'prepared');
  assert.equal(describeMode({ autoCommitMessage: true, autoUploadNoPrompt: true }), 'one-click');
});

test('a custom default description wins over the suggestion', async () => {
  let asked = false;
  const r = await prepareDescription({ commitDefaultMessage: '  Weekly   update  ' }, async () => { asked = true; return { ok: true, message: 'Add x' }; });
  assert.deepEqual(r, { message: 'Weekly update', source: 'default' });
  assert.equal(asked, false);
  assert.equal(customDefault({ commitDefaultMessage: 'x'.repeat(500) }).length, 200);
});

test('without a default, the suggestion from the actual changes is used', async () => {
  const r = await prepareDescription({ commitDefaultMessage: '' }, async () => ({ ok: true, message: 'Add login screen' }));
  assert.deepEqual(r, { message: 'Add login screen', source: 'suggested' });
});

test('suggestion failure always has a safe fallback', async () => {
  for (const suggest of [
    async () => ({ ok: false, error: 'read' }),
    async () => ({ ok: true, message: '   ' }),
    async () => { throw new Error('ipc down'); },
    null,
  ]) {
    assert.deepEqual(await prepareDescription({}, suggest), { message: FALLBACK_DESCRIPTION, source: 'fallback' });
  }
});

/* ------------------------- ✨ Suggest (regression) ------------------------- */

function tempRepo(t, { withRemote = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-describe-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, 'project');
  let remote = null;
  if (withRemote) {
    remote = path.join(base, 'online.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    execFileSync('git', ['clone', '-q', remote, dir], { stdio: 'pipe' });
  } else {
    fs.mkdirSync(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
  }
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid'); git('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), '# p\n');
  git('add', '.'); git('commit', '-qm', 'Initial');
  if (withRemote) git('push', '-q', 'origin', 'HEAD');
  storage.init(base);
  repoManager.load();
  return { dir, git, remote };
}

const write = (dir, rel, text = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

test('regression: Suggest sees files inside NEW folders (was “Add files”)', async (t) => {
  const { dir } = tempRepo(t);
  write(dir, 'reports/Q3 summary.docx');
  write(dir, 'reports/chart.png');
  const { repo } = await repoManager.addRepo(dir);
  assert.deepEqual(await repoManager.suggestMessage(repo.id), { ok: true, message: 'Add q3 summary and chart' });
});

test('regression: a README edit no longer hides new work (was “Update documentation”)', async (t) => {
  const { dir } = tempRepo(t);
  write(dir, 'README.md', '# changed\n');
  write(dir, 'src/LoginScreen.js');
  const { repo } = await repoManager.addRepo(dir);
  assert.deepEqual(await repoManager.suggestMessage(repo.id), { ok: true, message: 'Add login screen and update readme' });
});

test('regression: detailed Save with nothing ready says so (was “No changes found”)', async (t) => {
  const { dir, git } = tempRepo(t);
  write(dir, 'notes.txt');
  const { repo } = await repoManager.addRepo(dir);
  assert.deepEqual(await repoManager.suggestMessage(repo.id, { staged: true }), { ok: false, error: 'nothing-ready' });
  git('add', 'notes.txt');
  assert.deepEqual(await repoManager.suggestMessage(repo.id, { staged: true }), { ok: true, message: 'Add notes' });
});

test('Suggest reflects the CURRENT changes each time it is pressed', async (t) => {
  const { dir } = tempRepo(t);
  write(dir, 'invoice.js');
  const { repo } = await repoManager.addRepo(dir);
  assert.equal((await repoManager.suggestMessage(repo.id)).message, 'Add invoice');
  fs.rmSync(path.join(dir, 'invoice.js'));
  write(dir, 'README.md', '# docs\n');
  assert.equal((await repoManager.suggestMessage(repo.id)).message, 'Update documentation');
});

test('multi-file naming stays short and falls back for long lists', () => {
  assert.equal(suggestCommitMessage([{ path: 'a/client.js', type: 'untracked' }, { path: 'b/order.js' }]), 'Add client and update order');
  assert.equal(suggestCommitMessage([{ path: 'old.js', type: 'deleted' }, { path: 'docs/x.md' }]), 'Update x and remove old');
  const long = [{ path: `${'very_long_name_'.repeat(4)}a.js`, type: 'untracked' }, { path: `${'another_long_name_'.repeat(4)}.txt` }];
  assert.ok(suggestCommitMessage(long).length <= 72);
});

/* --------------------- one-click: save + upload, locally ------------------- */

test('one-click: the chosen description is saved and uploaded (custom default or suggestion)', async (t) => {
  const { dir, git, remote } = tempRepo(t, { withRemote: true });
  const { repo } = await repoManager.addRepo(dir);
  const online = () => execFileSync('git', ['--git-dir', remote, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();

  // Default empty → description from the actual changes.
  write(dir, 'src/LoginScreen.js');
  const suggested = await prepareDescription({ autoCommitMessage: true, autoUploadNoPrompt: true }, () => repoManager.suggestMessage(repo.id));
  assert.equal(suggested.source, 'suggested');
  assert.equal((await repoManager.uploadChanges(repo.id, suggested.message)).ok, true);
  assert.equal(online(), 'Add login screen');
  assert.equal(git('status', '--porcelain'), '');

  // Custom default → exactly that text.
  write(dir, 'src/LoginScreen.js', 'changed\n');
  const custom = await prepareDescription({ autoCommitMessage: true, autoUploadNoPrompt: true, commitDefaultMessage: 'Daily sync' }, () => repoManager.suggestMessage(repo.id));
  assert.equal((await repoManager.uploadChanges(repo.id, custom.message)).ok, true);
  assert.equal(online(), 'Daily sync');
});

/* --------------------------- notification timers --------------------------- */

test('only success/info notifications may close by themselves', () => {
  assert.equal(autoClosesType('success'), true);
  assert.equal(autoClosesType('info'), true);
  assert.equal(autoClosesType('error'), false);
  assert.equal(autoClosesType('warn'), false);
});

test('each notification has its own timer; closing one cancels only its timer', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const closed = [];
    const a = armAutoClose(() => closed.push('a'));
    mock.timers.tick(2000);
    const b = armAutoClose(() => closed.push('b'));
    const c = armAutoClose(() => closed.push('c'));
    c.cancel(); // closed by hand
    mock.timers.tick(AUTO_CLOSE_MS - 2000);
    assert.deepEqual(closed, ['a']);
    b.pause(); // hovered
    mock.timers.tick(AUTO_CLOSE_MS * 2);
    assert.deepEqual(closed, ['a']);
    b.resume();
    mock.timers.tick(AUTO_CLOSE_MS);
    assert.deepEqual(closed, ['a', 'b']);
    a.cancel(); // closing after expiry is harmless
    mock.timers.tick(AUTO_CLOSE_MS * 3);
    assert.deepEqual(closed, ['a', 'b']);
  } finally {
    mock.timers.reset();
  }
});

test('new settings default to off and persist', (t) => {
  tempRepo(t);
  const s = repoManager.getSettings();
  for (const key of ['autoCommitMessage', 'autoUploadNoPrompt', 'autoCloseToasts']) assert.equal(s[key], false, key);
  assert.equal(s.commitDefaultMessage, '');
  repoManager.setSettings({ autoCloseToasts: true, commitDefaultMessage: 'Daily sync' });
  repoManager.load();
  assert.equal(repoManager.getSettings().autoCloseToasts, true);
  assert.equal(repoManager.getSettings().commitDefaultMessage, 'Daily sync');
});
