'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const git = require('../src/main/gitService');
const tools = require('../src/main/projectTools');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-detailed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
  run('init', '-q'); run('config', 'user.name', 'Test'); run('config', 'user.email', 'test@example.invalid');
  run('config', 'core.autocrlf', 'false');
  const commit = message => { run('add', '-A'); run('commit', '-qm', message); return run('rev-parse', 'HEAD'); };
  write('file.txt', 'first\nsecond\n'); const initial = commit('Initial');
  return { root, run, write, commit, initial };
}

test('stack starts empty and refuses empty or unknown operations', async t => {
  const { root } = fixture(t);
  assert.deepEqual((await git.stashList(root)).entries, []);
  assert.equal((await git.stashChange(root, 'push', '')).ok, false);
  assert.equal((await git.stashChange(root, 'drop', 'anything')).ok, false);
});

test('stack includes tracked, staged and new files, newest first, and pops selected older work', async t => {
  const { root, write, run } = fixture(t);
  write('file.txt', 'older\n'); run('add', 'file.txt'); write('new.txt', 'new\n');
  assert.equal((await git.stashChange(root, 'push', 'Older work')).ok, true);
  const older = (await git.stashList(root)).entries[0];
  assert.deepEqual((await git.stashFiles(root, older.oid)).files.map(f => f.path).sort(), ['file.txt', 'new.txt']);
  write('file.txt', 'newer\n'); assert.equal((await git.stashChange(root, 'push', 'Newer work')).ok, true);
  const stack = (await git.stashList(root)).entries;
  assert.equal(stack.length, 2); assert.match(stack[0].subject, /Newer work/); assert.equal(stack[1].oid, older.oid);
  assert.equal((await git.stashChange(root, 'pop', older.oid)).ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'file.txt'), 'utf8'), 'older\n');
  assert.equal((await git.stashList(root)).entries[0].oid, stack[0].oid);
  assert.equal((await git.getDetailedStatus(root)).staged.length, 1);
  assert.equal((await git.stashChange(root, 'pop', stack[0].oid)).ok, false);
});

test('failed restore against a changed base preserves the stack', async t => {
  const { root, write, commit } = fixture(t);
  write('file.txt', 'shelved\n'); await git.stashChange(root, 'push', 'Conflict');
  const oid = (await git.stashList(root)).entries[0].oid;
  write('file.txt', 'different\n'); commit('Different base');
  const result = await git.stashChange(root, 'pop', oid);
  assert.equal(result.ok, false); assert.match(result.error.detail, /entry is kept/);
  assert.equal((await git.stashList(root)).entries[0].oid, oid);
});

test('restoring the newest entry removes it from the stack', async t => {
  const { root, write } = fixture(t);
  write('file.txt', 'work\n'); await git.stashChange(root, 'push', 'Top');
  const top = (await git.stashList(root)).entries[0];
  assert.equal((await git.stashChange(root, 'pop', top.oid)).ok, true);
  assert.equal((await git.stashList(root)).entries.length, 0);
  assert.equal(fs.readFileSync(path.join(root, 'file.txt'), 'utf8'), 'work\n');
});

test('overlapping stack mutations are serialized and stale IDs are refused', async t => {
  const { root, write } = fixture(t);
  write('file.txt', 'work\n');
  const pending = git.stashChange(root, 'push', 'First');
  assert.equal((await git.stashChange(root, 'push', 'Duplicate')).ok, false);
  assert.equal((await pending).ok, true);
  assert.equal((await git.stashFiles(root, 'a'.repeat(40))).ok, false);
  assert.equal((await git.stashChange(root, 'pop', 'a'.repeat(40))).ok, false);
});

test('literal special-character paths cannot expand into other diff files', async t => {
  const { root, write, commit } = fixture(t);
  write('[sample].txt', 'specific\n'); write('s.txt', 'other\n');
  const oid = commit('Special paths');
  const result = await git.commitDiff(root, oid, '[sample].txt');
  assert.match(result.text, /specific/); assert.doesNotMatch(result.text, /\+other/);
});

test('merge file lists and diffs both use the first parent', async t => {
  const { root, run, write, commit } = fixture(t);
  const base = run('branch', '--show-current');
  run('checkout', '-qb', 'side'); write('side.txt', 'side\n'); commit('Side');
  run('checkout', '-q', base); write('main.txt', 'main\n'); commit('Main');
  run('merge', '--no-ff', '-qm', 'Merge side', 'side'); const oid = run('rev-parse', 'HEAD');
  assert.deepEqual((await git.commitFiles(root, oid)).files.map(f => f.path), ['side.txt']);
  assert.match((await git.commitDiff(root, oid, 'side.txt')).text, /\+side/);
});

test('VS Code asynchronous launch failures are friendly', async t => {
  const { root } = fixture(t);
  const result = await tools.openCode(root, { findCode: async () => 'Code.exe', spawn: () => {
    const child = new EventEmitter(); process.nextTick(() => child.emit('error', Error('unavailable'))); return child;
  } });
  assert.equal(result.ok, false); assert.match(result.error.detail, /couldn't find/);
});

test('history and diffs handle initial/add/modify/delete/rename and binary files', async t => {
  const { root, write, commit, initial, run } = fixture(t);
  assert.equal((await git.commitFiles(root, initial)).files[0].type, 'added');
  write('file.txt', 'first\nchanged\n'); const modified = commit('Modify');
  const diff = await git.commitDiff(root, modified, 'file.txt');
  assert.equal(diff.ok, true); assert.match(diff.text, /-second/); assert.match(diff.text, /\+changed/);
  run('mv', 'file.txt', 'renamed.txt'); const renamed = commit('Rename');
  assert.equal((await git.commitFiles(root, renamed)).files[0].orig, 'file.txt');
  fs.unlinkSync(path.join(root, 'renamed.txt')); const deleted = commit('Delete');
  assert.equal((await git.commitFiles(root, deleted)).files[0].type, 'deleted');
  assert.match((await git.commitDiff(root, deleted, 'renamed.txt')).text, /-changed/);
  write('binary.dat', Buffer.from([0, 1, 2, 0])); const binary = commit('Binary');
  assert.equal((await git.commitDiff(root, binary, 'binary.dat')).binary, true);
  assert.equal((await git.getRecentHistory(root)).entries[0].subject, 'Binary');
});

test('diffs bound output and reject arbitrary revisions or paths', async t => {
  const { root, write, commit } = fixture(t);
  write('many.txt', Array.from({ length: 1500 }, (_, i) => `line ${i}`).join('\n'));
  const oid = commit('Many lines');
  const short = await git.commitDiff(root, oid, 'many.txt', 100);
  assert.equal(short.truncated, true); assert.equal(short.text.split('\n').length, 100);
  assert.equal((await git.commitDiff(root, oid, 'many.txt', 3000)).truncated, false);
  assert.equal((await git.commitFiles(root, '--all')).ok, false);
  assert.equal((await git.commitDiff(root, oid, '../other')).ok, false);
});

test('Recycle Bin accepts only existing regular project files and never deletes as fallback', async t => {
  const { root } = fixture(t); let moved;
  assert.equal((await tools.trashFile(root, 'file.txt', async p => { moved = p; })).ok, true);
  assert.equal(moved, await tools.validateTrashPath(root, 'file.txt'));
  for (const file of ['../file.txt', '..\\file.txt', '.git/config', 'file.txt:stream', root, 'missing', '.']) {
    assert.equal((await tools.trashFile(root, file, async () => assert.fail('must not move'))).ok, false, file);
  }
  assert.equal((await tools.trashFile(root, 'file.txt', async () => { throw Error('in use'); })).ok, false);
  assert.equal(fs.existsSync(path.join(root, 'file.txt')), true);
});

test('Recycle Bin rejects directory junctions', async t => {
  const { root } = fixture(t);
  fs.symlinkSync(root, path.join(root, 'linked'), 'junction');
  await assert.rejects(tools.validateTrashPath(root, 'linked/file.txt'));
});

test('VS Code finds Windows PATH executable and standard install fallback', async () => {
  assert.equal(await tools.findCode({ PATH: 'C:\\Code\\bin' }, 'win32', async p => p === 'C:\\Code\\Code.exe'), 'C:\\Code\\Code.exe');
  const expected = 'C:\\Local\\Programs\\Microsoft VS Code\\Code.exe';
  assert.equal(await tools.findCode({ LOCALAPPDATA: 'C:\\Local' }, 'win32', async p => p === expected), expected);
  assert.equal(await tools.findCode({}, 'win32', async () => false), null);
  assert.equal(await tools.findCode({ PATH: '/bin' }, 'linux', async p => p === '/bin/code'), '/bin/code');
});

test('VS Code passes project path as one argument without a shell and handles unavailable', async t => {
  const { root } = fixture(t);
  const result = await tools.openCode(root, { findCode: async () => 'Code.exe', spawn: (command, args, options) => {
    assert.equal(command, 'Code.exe'); assert.deepEqual(args, ['--new-window', fs.realpathSync(root)]);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    const child = new EventEmitter(); child.unref = () => {}; process.nextTick(() => child.emit('spawn')); return child;
  } });
  assert.equal(result.ok, true);
  assert.match((await tools.openCode(root, { findCode: async () => null })).error.detail, /couldn't find Visual Studio Code/);
});
