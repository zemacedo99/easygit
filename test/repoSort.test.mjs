import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sortAndFilterRepos, attentionRank } from '../src/renderer/repoSort.mjs';

const repo = (over = {}) => ({
  id: over.id || over.name || 'x',
  name: 'repo',
  path: '/projects/repo',
  lastStatus: 'unknown',
  lastChecked: null,
  ...over,
});

test('filter matches name or path, case-insensitively', () => {
  const repos = [
    repo({ id: 'a', name: 'Website', path: '/dev/site' }),
    repo({ id: 'b', name: 'Invoices', path: '/work/money' }),
    repo({ id: 'c', name: 'Notes', path: '/dev/notes-app' }),
  ];
  assert.deepEqual(sortAndFilterRepos(repos, 'dev', 'added').map((r) => r.id), ['a', 'c']);
  assert.deepEqual(sortAndFilterRepos(repos, 'INVOICE', 'added').map((r) => r.id), ['b']);
  assert.deepEqual(sortAndFilterRepos(repos, 'zzz', 'added'), []);
});

test('attention sort floats action-needed repos to the top', () => {
  const repos = [
    repo({ id: 'ok', lastStatus: 'up-to-date' }),
    repo({ id: 'down', lastStatus: 'needs-download' }),
    repo({ id: 'err', lastStatus: 'error' }),
    repo({ id: 'local', lastStatus: 'local-changes' }),
  ];
  assert.deepEqual(
    sortAndFilterRepos(repos, '', 'attention').map((r) => r.id),
    ['err', 'down', 'local', 'ok']
  );
});

test('name sort is A→Z and case-insensitive', () => {
  const repos = [repo({ id: '1', name: 'beta' }), repo({ id: '2', name: 'Alpha' }), repo({ id: '3', name: 'gamma' })];
  assert.deepEqual(sortAndFilterRepos(repos, '', 'name').map((r) => r.name), ['Alpha', 'beta', 'gamma']);
});

test('recent sort: most-recently-checked first, never-checked last', () => {
  const repos = [
    repo({ id: 'never', lastChecked: null }),
    repo({ id: 'old', lastChecked: '2024-01-01T00:00:00.000Z' }),
    repo({ id: 'new', lastChecked: '2025-06-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(sortAndFilterRepos(repos, '', 'recent').map((r) => r.id), ['new', 'old', 'never']);
});

test('added sort preserves original order (stable)', () => {
  const repos = [repo({ id: '1', name: 'z' }), repo({ id: '2', name: 'a' }), repo({ id: '3', name: 'm' })];
  assert.deepEqual(sortAndFilterRepos(repos, '', 'added').map((r) => r.id), ['1', '2', '3']);
});

test('does not mutate the input array', () => {
  const repos = [repo({ id: '1', name: 'z' }), repo({ id: '2', name: 'a' })];
  const before = repos.map((r) => r.id);
  sortAndFilterRepos(repos, '', 'name');
  assert.deepEqual(repos.map((r) => r.id), before);
});

test('unknown status ranks after all known statuses', () => {
  assert.ok(attentionRank({ lastStatus: 'unknown' }) > attentionRank({ lastStatus: 'up-to-date' }));
  assert.equal(attentionRank({ lastStatus: 'not-a-real-status' }), 99);
});
