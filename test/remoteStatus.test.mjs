// Optional "Show online repository status": detection from `git remote -v`
// (no network), labels, and when "Open online project" may appear.
// All repositories are temporary and local; remote URLs are never contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { remoteStatusInfo, onlineProjectLink, primaryRemote } from '../src/renderer/remoteStatus.mjs';

const require = createRequire(import.meta.url);
const git = require('../src/main/gitService.js');
const urls = require('../src/main/urls.js');
const storage = require('../src/main/storage.js');
const repoManager = require('../src/main/repoManager.js');

function workspace(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-remote-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  storage.init(base);
  repoManager.load();
  const make = (name, remotes = []) => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir);
    const run = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
    run('init', '-q');
    for (const [remote, url] of remotes) run('remote', 'add', remote, url);
    return { dir, run, config: () => { try { return run('config', '--get-regexp', '^remote\\.'); } catch { return ''; } } };
  };
  return { base, make };
}

const HTTPS = 'https://git.example.com/scm/~someone/project.git';
const SSH = 'git@github.com:team/project.git';

/* ---------------------------- reading remotes ---------------------------- */

test('git remote -v parsing: one entry per remote, any name, fetch URL preferred', () => {
  const out = [
    `origin\t${HTTPS} (fetch)`,
    `origin\t${HTTPS} (push)`,
    'upstream\tgit@github.com:team/project.git (fetch)',
    'upstream\thttps://push.example.com/x.git (push)',
    'garbage line',
    '',
  ].join('\n');
  assert.deepEqual(git.parseRemotes(out), [
    { name: 'origin', url: HTTPS },
    { name: 'upstream', url: 'git@github.com:team/project.git' },
  ]);
  assert.deepEqual(git.parseRemotes(''), []);
});

test('listRemotes: none, origin, other names, multiple, odd URLs; failures do not throw', async (t) => {
  const { base, make } = workspace(t);
  assert.deepEqual(await git.listRemotes(make('none').dir), { ok: true, remotes: [], errorCode: null });
  assert.deepEqual((await git.listRemotes(make('origin', [['origin', HTTPS]]).dir)).remotes, [{ name: 'origin', url: HTTPS }]);
  assert.deepEqual((await git.listRemotes(make('other', [['company', SSH]]).dir)).remotes, [{ name: 'company', url: SSH }]);
  const many = await git.listRemotes(make('many', [['origin', HTTPS], ['backup', SSH], ['local', 'file:///C:/copies/project.git'], ['weird', 'not a url']]).dir);
  assert.deepEqual(many.remotes.map((r) => r.name).sort(), ['backup', 'local', 'origin', 'weird']);
  const notRepo = path.join(base, 'plain-folder');
  fs.mkdirSync(notRepo);
  assert.equal((await git.listRemotes(notRepo)).ok, false);
  assert.equal((await git.listRemotes(path.join(base, 'gone'))).ok, false);
});

test('remote host labels: HTTPS, SSH, ssh://, local paths, malformed', () => {
  assert.deepEqual(urls.remoteHost(HTTPS), { kind: 'web', host: 'git.example.com' });
  assert.deepEqual(urls.remoteHost(SSH), { kind: 'web', host: 'github.com' });
  assert.deepEqual(urls.remoteHost('ssh://git@git.example.com:7999/team/p.git'), { kind: 'web', host: 'git.example.com' });
  assert.deepEqual(urls.remoteHost('https://user:secret@example.com/p.git'), { kind: 'web', host: 'example.com' });
  for (const local of ['file:///C:/copies/p.git', 'C:\\copies\\p.git', 'C:/copies/p.git', '\\\\server\\share\\p.git', '/srv/git/p.git', '../p.git']) {
    assert.equal(urls.remoteHost(local).kind, 'local', local);
  }
  for (const odd of ['not a url', 'weird:thing', '', null, 'https://']) {
    assert.equal(urls.remoteHost(odd).kind, 'unknown', String(odd));
  }
});

/* ------------------------------ the setting ------------------------------ */

test('setting OFF (default): no remote status is read or stored', async (t) => {
  const { make } = workspace(t);
  assert.equal(repoManager.getSettings().showRemoteStatus, false);
  const { repo } = await repoManager.addRepo(make('p', [['origin', HTTPS]]).dir);
  assert.equal(repo.remoteStatus, undefined);
  const list = await repoManager.refreshRemoteStatus();
  assert.equal(list[0].remoteStatus, undefined, 'refresh is a no-op while off');
});

test('setting ON: local-only, one remote, other name, multiple remotes', async (t) => {
  const { make } = workspace(t);
  repoManager.setSettings({ showRemoteStatus: true });
  const add = async (name, remotes) => (await repoManager.addRepo(make(name, remotes).dir)).repo;

  const local = await add('local', []);
  assert.equal(local.remoteStatus.state, 'local-only');
  assert.deepEqual(local.remoteStatus.remotes, []);

  const one = await add('one', [['origin', HTTPS]]);
  assert.equal(one.remoteStatus.state, 'connected');
  assert.equal(one.remoteStatus.primary, 'origin');
  assert.deepEqual(one.remoteStatus.remotes[0], { name: 'origin', kind: 'web', host: 'git.example.com', browserUrl: 'https://git.example.com/scm/~someone/project' });

  const other = await add('other', [['company', SSH]]);
  assert.equal(other.remoteStatus.state, 'connected');
  assert.equal(other.remoteStatus.primary, 'company', 'no "origin": the first remote is used');
  assert.equal(other.remoteUrl, null, 'upload/download detection (origin) is unchanged');

  const many = await add('many', [['backup', SSH], ['origin', HTTPS], ['weird', 'not a url']]);
  assert.equal(many.remoteStatus.remotes.length, 3);
  assert.equal(many.remoteStatus.primary, 'origin', '"origin" is preferred when present');
  assert.equal(many.remoteStatus.remotes.find((r) => r.name === 'weird').kind, 'unknown');

  const secret = await add('secret', [['origin', 'https://user:token123@example.com/team/p.git']]);
  assert.equal(secret.remoteStatus.remotes[0].browserUrl, 'https://example.com/team/p', 'credentials are never kept');
  assert.ok(!JSON.stringify(secret.remoteStatus).includes('token123'));
});

test('status refreshes on check/refresh, survives a reload, and handles a vanished folder', async (t) => {
  const { make } = workspace(t);
  repoManager.setSettings({ showRemoteStatus: true });
  const p = make('p');
  const { repo } = await repoManager.addRepo(p.dir);
  assert.equal(repo.remoteStatus.state, 'local-only');
  p.run('remote', 'add', 'origin', HTTPS); // changed outside EasyGit
  const checked = await repoManager.checkStatus(repo.id, { fetch: false });
  assert.equal(checked.repo.remoteStatus.state, 'connected');
  repoManager.load(); // restart
  assert.equal(repoManager.listRepos()[0].remoteStatus.state, 'connected');
  fs.rmSync(p.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  const [gone] = await repoManager.refreshRemoteStatus();
  assert.deepEqual([gone.remoteStatus.state, gone.remoteStatus.reason], ['unknown', 'missing']);
});

test('reading the status never changes the project’s remotes', async (t) => {
  const { make } = workspace(t);
  repoManager.setSettings({ showRemoteStatus: true });
  const p = make('p', [['origin', HTTPS], ['backup', SSH]]);
  const before = p.config();
  const { repo } = await repoManager.addRepo(p.dir);
  await repoManager.refreshRemoteStatus();
  await repoManager.checkStatus(repo.id, { fetch: false });
  assert.equal(p.config(), before);
});

/* --------------------------- labels + the button -------------------------- */

const status = (remotes, primary = remotes[0] && remotes[0].name) => ({ state: remotes.length ? 'connected' : 'local-only', remotes, primary });
const web = (name, host = 'github.com') => ({ name, kind: 'web', host, browserUrl: `https://${host}/team/${name}` });

test('labels: connected (with host and extra remotes), local only, unknown, not yet read', () => {
  assert.equal(remoteStatusInfo(undefined), null);
  assert.equal(remoteStatusInfo(status([])).text, 'Only on this computer');
  assert.equal(remoteStatusInfo(status([web('origin', 'git.example.com')])).text, 'Online repository: git.example.com');
  const two = remoteStatusInfo(status([web('backup'), web('origin', 'git.example.com')], 'origin'));
  assert.equal(two.text, 'Online repository: git.example.com (+1 more)');
  assert.match(two.title, /backup: github\.com/);
  assert.match(two.title, /doesn't check that it can be reached/);
  assert.equal(remoteStatusInfo(status([{ name: 'local', kind: 'local', host: null, browserUrl: null }])).text, 'Linked to a folder on this computer');
  assert.equal(remoteStatusInfo({ state: 'unknown', reason: 'missing', remotes: [] }).text, 'Folder not found');
  assert.equal(primaryRemote(status([web('a'), web('origin')], 'origin')).name, 'origin');
});

test('Open online project: hidden with no remote; unchanged when off; uses any remote when on', () => {
  const off = { showRemoteStatus: false };
  const on = { showRemoteStatus: true };
  const localOnly = { remoteUrl: null, browserUrl: null, remoteStatus: status([]) };
  assert.equal(onlineProjectLink(localOnly, off), null);
  assert.equal(onlineProjectLink(localOnly, on), null);
  const withOrigin = { remoteUrl: HTTPS, browserUrl: 'https://git.example.com/x', remoteStatus: status([web('origin')]) };
  assert.equal(onlineProjectLink(withOrigin, off), 'https://git.example.com/x', 'today’s behavior');
  const otherName = { remoteUrl: null, browserUrl: null, remoteStatus: status([web('company')]) };
  assert.equal(onlineProjectLink(otherName, off), null, 'off: exactly as before');
  assert.equal(onlineProjectLink(otherName, on), 'https://github.com/team/company');
  const unbrowsable = { remoteUrl: null, browserUrl: null, remoteStatus: status([{ name: 'local', kind: 'local', host: null, browserUrl: null }]) };
  assert.equal(onlineProjectLink(unbrowsable, on), null, 'no web link → no button');
});
