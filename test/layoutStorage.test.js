'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const storage = require('../src/main/storage');
const repoManager = require('../src/main/repoManager');

const REPOS = ['a', 'b', 'c'].map((id) => ({
  id, name: id, path: path.join(os.tmpdir(), 'not-real', id), remoteUrl: null, lastStatus: 'unknown', lastChecked: null,
}));

function setup(t, saved) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-layout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const file = path.join(dir, 'repositories.json');
  fs.writeFileSync(file, JSON.stringify(saved, null, 2));
  storage.init(dir);
  repoManager.load();
  return { file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('existing data loads as before: no layout, organization settings off', (t) => {
  const { file, read } = setup(t, { version: 1, repositories: REPOS, scanRoots: [], settings: { sortBy: 'name' } });
  assert.equal(repoManager.getLayout(), null);
  const settings = repoManager.getSettings();
  assert.equal(settings.sortBy, 'name');
  for (const key of ['organizeRepos', 'orgManualOrder', 'orgGroups', 'orgCustomGroups', 'orgSuggestGroups']) {
    assert.equal(settings[key], false, key);
  }
  // Saving other data does not invent a layout.
  repoManager.setSettings({ theme: 'light' });
  assert.equal('layout' in read(), false);
  assert.deepEqual(read().repositories.map((r) => r.id), ['a', 'b', 'c']);
  assert.ok(fs.existsSync(file));
});

test('layout is saved separately and cleaned of unknown ids', (t) => {
  const { read } = setup(t, { repositories: REPOS });
  repoManager.setLayout({
    order: ['c', 'a', 'zzz', 5], groups: [{ id: 'g1', name: 'Team', collapsed: true, repoIds: ['b', 'nope'] }, { bad: true }],
    dismissedSuggestions: ['x|a,b', 7], extra: 'ignored',
  });
  assert.deepEqual(read().layout, {
    order: ['c', 'a'], groups: [{ id: 'g1', name: 'Team', collapsed: true, repoIds: ['b'] }],
    ungroupedCollapsed: false, dismissedSuggestions: ['x|a,b'],
  });
  assert.deepEqual(read().repositories, REPOS);
});

test('removing a repository drops it from its group without touching others', (t) => {
  const { read } = setup(t, { repositories: REPOS });
  repoManager.setLayout({ order: ['a', 'b', 'c'], groups: [{ id: 'g', name: 'G', repoIds: ['a', 'b'] }] });
  assert.equal(repoManager.removeRepo('a').ok, true);
  assert.deepEqual(read().layout.groups[0].repoIds, ['b']);
  assert.deepEqual(read().layout.order, ['b', 'c']);
});

test('Remove all keeps (now empty) groups and never touches folders', (t) => {
  const { read } = setup(t, { repositories: REPOS });
  repoManager.setLayout({ order: ['a', 'b', 'c'], groups: [{ id: 'g', name: 'G', repoIds: ['a', 'b'] }] });
  repoManager.removeAllRepos();
  assert.deepEqual(read().repositories, []);
  assert.deepEqual(read().layout.order, []);
  assert.deepEqual(read().layout.groups, [{ id: 'g', name: 'G', collapsed: false, repoIds: [] }]);
});
