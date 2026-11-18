'use strict';
// In-app updates: pure logic + the real Git transport against a LOCAL repository
// (no network). The fixture repo looks like the EasyGit repo: a
// release tag vX.Y.Z containing versions/vX.Y.Z/{installer, portable, update.json}.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const core = require('../src/main/updateCore');
const { createUpdater } = require('../src/main/updater');
const portable = require('../src/main/portableReplace');
const config = require('../src/main/updateConfig');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ------------------------------ pure logic ------------------------------ */

test('semantic version comparison is numeric, never string-based', () => {
  assert.ok(core.compareVersions('1.3.0', '1.4.0') < 0);
  assert.ok(core.compareVersions('1.3.9', '1.4.0') < 0);
  assert.ok(core.compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(core.compareVersions('2.0.0', '1.99.99') > 0);
  assert.equal(core.compareVersions('v1.3.0', '1.3.0'), 0);
  assert.throws(() => core.compareVersions('1.3', '1.3.0'));
  assert.equal(core.parseVersion('1.4.0-beta'), null);
});

test('current vs latest: up to date, update available, or ahead (never a downgrade)', () => {
  assert.equal(core.compareToLatest('1.3.0', '1.3.0'), 'up-to-date');
  assert.equal(core.compareToLatest('1.3.0', '1.4.0'), 'available');
  assert.equal(core.compareToLatest('1.10.0', '1.9.0'), 'ahead');
});

test('latest release is picked from tags by version order, ignoring other tags', () => {
  const out = [
    `${'a'.repeat(40)}\trefs/tags/v1.9.0`,
    `${'b'.repeat(40)}\trefs/tags/v1.10.0`,
    `${'c'.repeat(40)}\trefs/tags/v1.2.0`,
    `${'d'.repeat(40)}\trefs/tags/v2.0.0-beta`,
    `${'e'.repeat(40)}\trefs/tags/nightly`,
  ].join('\n');
  assert.deepEqual(core.latestFromTags(out), { version: '1.10.0', tag: 'v1.10.0' });
  assert.equal(core.latestFromTags('garbage'), null);
});

const goodMeta = (v = '1.4.0', over = {}) => ({
  schema: 1,
  version: v,
  date: '2026-11-01',
  installer: { file: `EasyGit Setup ${v}.exe`, size: 10, sha256: 'a'.repeat(64) },
  portable: { file: `EasyGit-${v}-portable.exe`, size: 10, sha256: 'b'.repeat(64) },
  changelog: { version: v, date: '2026-11-01', summary: 'New things.', sections: [{ heading: 'New', items: ['A thing'] }] },
  ...over,
});

test('update metadata is validated strictly (malformed, wrong version, unsafe names)', () => {
  assert.equal(core.validateMetadata(goodMeta(), '1.4.0').ok, true);
  assert.equal(core.validateMetadata(JSON.stringify(goodMeta()), '1.4.0').ok, true);
  const bad = [
    '{not json',
    null,
    [],
    goodMeta('1.4.0', { schema: 2 }),
    goodMeta('1.5.0'), // metadata for another version than the tag
    goodMeta('1.4.0', { installer: { file: '..\\..\\evil.exe', size: 10, sha256: 'a'.repeat(64) } }),
    goodMeta('1.4.0', { installer: { file: 'EasyGit Setup 1.4.0.bat', size: 10, sha256: 'a'.repeat(64) } }),
    goodMeta('1.4.0', { installer: { file: 'EasyGit Setup 1.3.0.exe', size: 10, sha256: 'a'.repeat(64) } }),
    goodMeta('1.4.0', { portable: { file: 'EasyGit-1.4.0-portable.exe', size: -1, sha256: 'b'.repeat(64) } }),
    goodMeta('1.4.0', { portable: { file: 'EasyGit-1.4.0-portable.exe', size: 10, sha256: 'xyz' } }),
    goodMeta('1.4.0', { portable: undefined }),
  ];
  for (const raw of bad) assert.equal(core.validateMetadata(raw, '1.4.0').ok, false, JSON.stringify(raw));
  // A bad changelog never blocks the update; it is just left out.
  const noLog = core.validateMetadata(goodMeta('1.4.0', { changelog: { version: '9.9.9', sections: [] } }), '1.4.0');
  assert.equal(noLog.ok, true);
  assert.equal(noLog.metadata.changelog, null);
});

test('checksum verification: success, mismatch, wrong size, missing file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-verify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const file = path.join(dir, 'x.exe');
  const data = Buffer.from('EasyGit test payload');
  fs.writeFileSync(file, data);
  assert.deepEqual(await core.verifyFile(file, { size: data.length, sha256: sha(data).toUpperCase() }), { ok: true });
  assert.deepEqual(await core.verifyFile(file, { size: data.length, sha256: 'f'.repeat(64) }), { ok: false, reason: 'checksum' });
  assert.deepEqual(await core.verifyFile(file, { size: data.length + 1, sha256: sha(data) }), { ok: false, reason: 'size' });
  assert.deepEqual(await core.verifyFile(path.join(dir, 'nope.exe'), { size: 1, sha256: sha(data) }), { ok: false, reason: 'missing' });
});

test('state machine only allows sensible transitions', () => {
  let s = { status: 'idle' };
  s = core.transition(s, 'checking');
  s = core.transition(s, 'available', { latest: { version: '1.4.0' } });
  s = core.transition(s, 'downloading', { progress: 0 });
  s = core.transition(s, 'verifying');
  assert.equal(s.progress, undefined);
  s = core.transition(s, 'ready');
  s = core.transition(s, 'installing');
  assert.throws(() => core.transition({ status: 'idle' }, 'installing'));
  assert.throws(() => core.transition({ status: 'up-to-date' }, 'downloading'));
  assert.throws(() => core.transition({ status: 'checking' }, 'ready'));
  assert.equal(core.transition({ status: 'checking' }, 'error', { error: { kind: 'offline' } }).error.kind, 'offline');
});

test('installed / portable / development builds are told apart', () => {
  assert.equal(core.detectBuildKind({ isPackaged: false, env: {} }), 'development');
  assert.equal(core.detectBuildKind({ isPackaged: true, env: {}, platform: 'win32' }), 'installed');
  assert.equal(core.detectBuildKind({ isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: 'C:\\x\\EasyGit.exe' }, platform: 'win32' }), 'portable');
  assert.equal(core.detectBuildKind({ isPackaged: true, env: {}, platform: 'linux' }), 'unsupported');
});

test('git progress lines become byte counts; git errors become friendly categories', () => {
  assert.equal(core.receivedBytes('Receiving objects: 100% (1/1), 71.65 MiB | 35.75 MiB/s'), Math.round(71.65 * 1024 * 1024));
  assert.equal(core.receivedBytes('Receiving objects:   0% (0/1), 512 bytes | 1 KiB/s'), 512);
  assert.equal(core.receivedBytes('remote: Total 1'), null);
  assert.equal(core.classifyGitError("fatal: unable to access 'https://x/': Could not resolve host: x"), 'offline');
  assert.equal(core.classifyGitError('fatal: Authentication failed for https://x'), 'access');
  assert.equal(core.classifyGitError('fatal: could not read Username for https://x: terminal prompts disabled'), 'access');
  assert.equal(core.classifyGitError('fatal: repository not found'), 'unavailable');
});

test('update source comes only from the main-process config', () => {
  assert.match(config.updateSource({}), /^https:\/\/github\.com\//);
  assert.equal(config.updateSource({ EASYGIT_UPDATE_SOURCE: 'file:///C:/tmp/repo' }), 'file:///C:/tmp/repo');
  assert.match(config.updateSource({ EASYGIT_UPDATE_SOURCE: 'http://insecure.example/repo' }), /^https:\/\/github/);
  // The renderer bridge exposes update calls without parameters.
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload.js'), 'utf8');
  for (const name of ['checkForUpdates', 'downloadUpdate', 'installUpdate', 'getUpdateState']) {
    assert.match(preload, new RegExp(`${name}: \\(\\) => ipcRenderer\\.invoke\\('update:[a-zA-Z]+'\\)`), name);
  }
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  for (const ch of ['check', 'download', 'install', 'getState']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('update:${ch}', async \\(\\) => updater\\.${ch}\\(\\)\\)`), ch);
  }
});

/* --------------------- real Git transport, local repo --------------------- */

function makeSource(t, { version = '1.4.0', corruptChecksum = false, withMetadata = true, withExecutables = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-updsrc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repo = path.join(root, 'src');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  git('config', 'uploadpack.allowFilter', 'true');
  git('config', 'uploadpack.allowAnySHA1InWant', 'true');
  fs.writeFileSync(path.join(repo, 'README.md'), 'old\n');
  git('add', '.'); git('commit', '-qm', 'v1.3.0'); git('tag', '-a', 'v1.3.0', '-m', 'v1.3.0');
  const dir = path.join(repo, 'versions', `v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  const installer = crypto.randomBytes(300 * 1024);
  const portableExe = crypto.randomBytes(200 * 1024);
  if (withExecutables) {
    fs.writeFileSync(path.join(dir, `EasyGit Setup ${version}.exe`), installer);
    fs.writeFileSync(path.join(dir, `EasyGit-${version}-portable.exe`), portableExe);
  }
  if (withMetadata) {
    fs.writeFileSync(path.join(dir, 'update.json'), JSON.stringify(goodMeta(version, {
      installer: { file: `EasyGit Setup ${version}.exe`, size: installer.length, sha256: corruptChecksum ? 'f'.repeat(64) : sha(installer) },
      portable: { file: `EasyGit-${version}-portable.exe`, size: portableExe.length, sha256: sha(portableExe) },
    })));
  }
  git('add', '.'); git('commit', '-qm', `v${version}`); git('tag', '-a', `v${version}`, '-m', `v${version}`);
  return { url: pathToFileURL(repo).href, installer, portableExe, root, repo };
}

function updaterFor(t, src, { current = '1.3.0', buildKind = 'installed', source, fetchAsset, assetUrl } = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-updwork-'));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const states = [];
  const launched = [];
  const u = createUpdater({
    currentVersion: current,
    buildKind,
    workDir,
    source: () => source || src.url,
    onState: (s) => states.push(s.status),
    launch: (a) => { launched.push(a); },
    ...(fetchAsset ? { fetchAsset } : {}),
    ...(assetUrl ? { assetUrl } : {}),
  });
  return { u, states, launched, workDir };
}

test('current == latest: up to date, nothing downloaded', async (t) => {
  const src = makeSource(t);
  const { u, workDir } = updaterFor(t, src, { current: '1.4.0' });
  const s = await u.check();
  assert.equal(s.status, 'up-to-date');
  assert.equal(s.latest.version, '1.4.0');
  assert.ok(s.lastCheckedAt);
  assert.equal(fs.existsSync(path.join(workDir, 'download')), false);
});

test('a newer development build is reported as ahead, never downgraded', async (t) => {
  const src = makeSource(t);
  const { u } = updaterFor(t, src, { current: '1.5.0' });
  assert.equal((await u.check()).status, 'ahead');
  assert.equal((await u.download()).status, 'ahead'); // download refused
});

test('installed: available → download with progress → verified → install hands over the verified installer', async (t) => {
  const src = makeSource(t);
  const { u, states, launched } = updaterFor(t, src);
  const s = await u.check();
  assert.equal(s.status, 'available');
  assert.equal(s.latest.version, '1.4.0');
  assert.equal(s.latest.changelog.sections[0].items[0], 'A thing');
  assert.equal(s.file, undefined);
  const ready = await u.download('https://evil.example/malware.exe'); // arguments are ignored
  assert.equal(ready.status, 'ready');
  assert.equal(ready.file, undefined, 'paths are never exposed to the renderer');
  assert.deepEqual(states.filter((x, i) => states.indexOf(x) === i), ['checking', 'available', 'downloading', 'verifying', 'ready']);
  await u.install();
  assert.equal(launched.length, 1);
  assert.equal(launched[0].kind, 'installed');
  assert.equal(path.basename(launched[0].file), 'EasyGit Setup 1.4.0.exe');
  assert.equal(sha(fs.readFileSync(launched[0].file)), sha(src.installer));
});

test('portable builds download the portable exe', async (t) => {
  const src = makeSource(t);
  const { u, launched } = updaterFor(t, src, { buildKind: 'portable' });
  await u.check();
  assert.equal((await u.download()).status, 'ready');
  await u.install();
  assert.equal(path.basename(launched[0].file), 'EasyGit-1.4.0-portable.exe');
  assert.equal(sha(fs.readFileSync(launched[0].file)), sha(src.portableExe));
});

test('checksum mismatch is a hard failure: file deleted, nothing launched', async (t) => {
  const src = makeSource(t, { corruptChecksum: true });
  const { u, launched, workDir } = updaterFor(t, src);
  await u.check();
  const s = await u.download();
  assert.equal(s.status, 'error');
  assert.equal(s.error.kind, 'checksum');
  assert.deepEqual(fs.readdirSync(path.join(workDir, 'download')), []);
  await u.install();
  assert.equal(launched.length, 0);
});

test('a staged file tampered with before install is refused', async (t) => {
  const src = makeSource(t);
  const { u, launched, workDir } = updaterFor(t, src);
  await u.check();
  await u.download();
  fs.appendFileSync(path.join(workDir, 'download', 'EasyGit Setup 1.4.0.exe'), 'x');
  const s = await u.install();
  assert.equal(s.status, 'error');
  assert.equal(s.error.kind, 'checksum');
  assert.equal(launched.length, 0);
});

test('GitHub Release assets: download URL is built only for github.com sources', () => {
  assert.equal(config.releaseAssetUrl('https://github.com/owner/easygit.git', '2.2.0', 'EasyGit Setup 2.2.0.exe'),
    'https://github.com/owner/easygit/releases/download/v2.2.0/EasyGit.Setup.2.2.0.exe');
  assert.equal(config.releaseAssetUrl('https://github.com/owner/easygit.git', '2.2.0', 'EasyGit-Setup-2.2.0.exe'),
    'https://github.com/owner/easygit/releases/download/v2.2.0/EasyGit-Setup-2.2.0.exe');
  assert.equal(config.releaseAssetUrl('https://github.com/owner/easygit', '2.2.0', 'EasyGit-2.2.0-portable.exe'),
    'https://github.com/owner/easygit/releases/download/v2.2.0/EasyGit-2.2.0-portable.exe');
  assert.equal(config.releaseAssetUrl('file:///C:/tmp/repo', '2.2.0', 'x.exe'), null);
  assert.equal(config.releaseAssetUrl('https://git.example.com/scm/team/easygit.git', '2.2.0', 'x.exe'), null);
  assert.equal(config.releaseAssetUrl('https://github.com/owner/easygit.git', '../2.2.0', 'x.exe'), null);
});

test('tag without executables: the exe comes from the GitHub Release and is verified', async (t) => {
  const src = makeSource(t, { withExecutables: false });
  const asked = [];
  const fetchAsset = async ({ url, dest, onBytes }) => {
    asked.push(url);
    fs.writeFileSync(dest, src.installer);
    onBytes(src.installer.length);
  };
  const { u, launched } = updaterFor(t, src, { fetchAsset, assetUrl: (v, f) => `https://github.com/owner/easygit/releases/download/v${v}/${encodeURIComponent(f)}` });
  assert.equal((await u.check()).status, 'available');
  assert.equal((await u.download()).status, 'ready');
  assert.deepEqual(asked, ['https://github.com/owner/easygit/releases/download/v1.4.0/EasyGit%20Setup%201.4.0.exe']);
  await u.install();
  assert.equal(sha(fs.readFileSync(launched[0].file)), sha(src.installer));

  // A tampered asset fails the checksum and is deleted.
  const bad = updaterFor(t, src, { fetchAsset: async ({ dest }) => fs.writeFileSync(dest, Buffer.alloc(src.installer.length)), assetUrl: () => 'https://github.com/o/r/releases/download/v1.4.0/x.exe' });
  await bad.u.check();
  const s = await bad.u.download();
  assert.equal(s.status, 'error');
  assert.equal(s.error.kind, 'checksum');
  assert.deepEqual(fs.readdirSync(path.join(bad.workDir, 'download')), []);

  // Not a GitHub source and no exe in the tag: reported, not installed.
  const none = updaterFor(t, src);
  await none.u.check();
  assert.equal((await none.u.download()).error.kind, 'metadata');
});

test('a release without update.json is reported, not installed', async (t) => {
  const src = makeSource(t, { withMetadata: false });
  const { u } = updaterFor(t, src);
  const s = await u.check();
  assert.equal(s.status, 'error');
  assert.equal(s.error.kind, 'metadata');
});

test('download failure (source gone mid-way) fails closed with no partial file', async (t) => {
  const src = makeSource(t);
  const { u, launched, workDir } = updaterFor(t, src);
  await u.check();
  fs.rmSync(src.repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  const s = await u.download();
  assert.equal(s.status, 'error');
  assert.ok(['offline', 'unavailable', 'download', 'access'].includes(s.error.kind), s.error.kind);
  assert.deepEqual(fs.existsSync(path.join(workDir, 'download')) ? fs.readdirSync(path.join(workDir, 'download')) : [], []);
  await u.install();
  assert.equal(launched.length, 0);
});

test('unreachable source gives a friendly error; development builds cannot install', async (t) => {
  const src = makeSource(t);
  const missing = pathToFileURL(path.join(src.root, 'does-not-exist')).href;
  const { u } = updaterFor(t, src, { source: missing });
  const s = await u.check();
  assert.equal(s.status, 'error');
  assert.ok(s.error.title && s.error.detail);
  const dev = updaterFor(t, src, { buildKind: 'development' });
  assert.equal((await dev.u.check()).status, 'available');
  const d = await dev.u.download();
  assert.equal(d.status, 'error');
  assert.equal(d.error.kind, 'unsupported');
});

/* ----------------------------- portable swap ----------------------------- */

test('portable helper refuses anything but an EasyGit exe, from the update folder', () => {
  const staging = path.join(os.tmpdir(), 'EasyGit', 'updates');
  const source = path.join(staging, 'download', 'EasyGit-1.4.0-portable.exe');
  assert.equal(portable.checkReplaceRequest({ source, target: 'D:\\Tools\\EasyGit-1.3.0-portable.exe', stagingRoot: staging }), null);
  assert.ok(portable.checkReplaceRequest({ source, target: 'C:\\Windows\\explorer.exe', stagingRoot: staging }));
  assert.ok(portable.checkReplaceRequest({ source, target: 'EasyGit.exe', stagingRoot: staging }));
  assert.ok(portable.checkReplaceRequest({ source: 'C:\\Downloads\\EasyGit.exe', target: 'D:\\EasyGit.exe', stagingRoot: staging }));
  assert.equal(portable.helperTarget(['x', '--easygit-portable-replace=D:\\EasyGit.exe']), 'D:\\EasyGit.exe');
  assert.equal(portable.helperTarget(['x']), null);
});

test('portable swap waits for the old exe, replaces it, and rolls back on failure', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-swap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const source = path.join(dir, 'new.exe');
  const target = path.join(dir, 'EasyGit-1.3.0-portable.exe');
  fs.writeFileSync(source, 'NEW');
  fs.writeFileSync(target, 'OLD');
  // Old exe "locked" for the first 3 attempts.
  let locked = 3;
  const fsi = { ...fs, renameSync: (a, b) => { if (a === target && locked-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return fs.renameSync(a, b); } };
  assert.deepEqual(await portable.replaceFile({ source, target, fsi, retryMs: 1 }), { ok: true });
  assert.equal(fs.readFileSync(target, 'utf8'), 'NEW');
  assert.equal(fs.existsSync(`${target}.old`), false);

  // Final rename fails → the original comes back.
  fs.writeFileSync(target, 'OLD');
  const failing = { ...fs, renameSync: (a, b) => { if (a.endsWith('.new')) throw new Error('nope'); return fs.renameSync(a, b); } };
  const r = await portable.replaceFile({ source, target, fsi: failing, retryMs: 1 });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'OLD');

  // Still locked after the timeout → untouched.
  const stuck = { ...fs, renameSync: (a, b) => { if (a === target) throw new Error('busy'); return fs.renameSync(a, b); } };
  const s = await portable.replaceFile({ source, target, fsi: stuck, timeoutMs: 20, retryMs: 5 });
  assert.equal(s.ok, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'OLD');
  assert.equal(fs.existsSync(`${target}.new`), false);
});
