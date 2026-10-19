import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLayout,
  orgFlags,
  effectiveSort,
  reorderRepo,
  moveRepo,
  createGroup,
  renameGroup,
  deleteGroup,
  moveGroup,
  setCollapsed,
  groupOf,
  suggestGroups,
  acceptSuggestion,
  dismissSuggestions,
  isGenericParent,
  buildListView,
} from '../src/renderer/repoLayout.mjs';
import { sortAndFilterRepos } from '../src/renderer/repoSort.mjs';

const repo = (id, path, over = {}) => ({ id, name: id, path, lastStatus: 'unknown', lastChecked: null, ...over });

const REPOS = [
  repo('acm-doc', 'C:\\Git\\ACME\\documentation', { name: 'documentation', lastStatus: 'up-to-date' }),
  repo('acm-man', 'C:\\Git\\ACME\\management', { name: 'management', lastStatus: 'needs-download' }),
  repo('glx-doc', 'C:\\Git\\GLOBEX\\documentation', { name: 'documentation', lastStatus: 'up-to-date' }),
  repo('glx-man', 'C:\\Git\\GLOBEX\\management', { name: 'management', lastStatus: 'error' }),
  repo('easygit', 'C:\\Users\\me\\Git\\easy_git', { name: 'easygit', lastStatus: 'local-changes' }),
];

const ids = (list) => list.map((r) => r.id);
const fresh = () => normalizeLayout(null, REPOS);
const ON = { organizeRepos: true, orgManualOrder: true, orgGroups: true, orgCustomGroups: true, orgSuggestGroups: true };

test('no saved layout: current order, no groups, no side effects', () => {
  const layout = fresh();
  assert.deepEqual(layout.order, ids(REPOS));
  assert.deepEqual(layout.groups, []);
  assert.deepEqual(layout.dismissedSuggestions, []);
  assert.deepEqual(normalizeLayout('garbage', REPOS).order, ids(REPOS));
});

test('feature disabled: flags off and the flat list sorts exactly like before', () => {
  for (const settings of [{}, { orgManualOrder: true, orgGroups: true, orgCustomGroups: true }]) {
    const f = orgFlags(settings);
    assert.equal(f.enabled || f.manual || f.groups || f.customGroups || f.suggest || f.customSort, false);
  }
  for (const sortBy of ['attention', 'name', 'recent', 'added']) {
    const view = buildListView(REPOS, fresh(), { sortBy, groups: false });
    assert.equal(view.grouped, false);
    assert.deepEqual(ids(view.repos), ids(sortAndFilterRepos(REPOS, '', sortBy)));
  }
});

test('a saved "Custom order" sort falls back while organization is off', () => {
  assert.equal(effectiveSort({ sortBy: 'custom' }), 'attention');
  assert.equal(effectiveSort({ sortBy: 'custom', sortFallback: 'name' }), 'name');
  assert.equal(effectiveSort({ sortBy: 'custom', organizeRepos: true, orgManualOrder: true }), 'custom');
  assert.equal(effectiveSort({ sortBy: 'custom', organizeRepos: true, orgGroups: true }), 'custom');
  assert.equal(effectiveSort({ sortBy: 'name', organizeRepos: true }), 'name');
});

test('nested options need the master switch, and custom groups/suggestions need groups', () => {
  assert.equal(orgFlags({ organizeRepos: true, orgCustomGroups: true, orgSuggestGroups: true }).customGroups, false);
  assert.equal(orgFlags({ organizeRepos: true, orgCustomGroups: true, orgSuggestGroups: true }).suggest, false);
  assert.deepEqual(orgFlags(ON), { enabled: true, manual: true, groups: true, customGroups: true, suggest: true, customSort: true });
});

test('manual custom order is saved and survives a reload (normalize round-trip)', () => {
  let layout = reorderRepo(fresh(), 'easygit', 'acm-doc');
  layout = reorderRepo(layout, 'acm-doc', null);
  const expected = ['easygit', 'acm-man', 'glx-doc', 'glx-man', 'acm-doc'];
  assert.deepEqual(layout.order, expected);
  const reloaded = normalizeLayout(JSON.parse(JSON.stringify(layout)), REPOS);
  assert.deepEqual(ids(buildListView(REPOS, reloaded, { sortBy: 'custom' }).repos), expected);
});

test('automatic sorting never destroys the custom order', () => {
  const layout = reorderRepo(fresh(), 'easygit', 'acm-doc');
  const before = JSON.stringify(layout);
  const attention = buildListView(REPOS, layout, { sortBy: 'attention' });
  assert.equal(attention.repos[0].id, 'glx-man'); // error first
  assert.equal(JSON.stringify(layout), before);
  assert.equal(buildListView(REPOS, layout, { sortBy: 'custom' }).repos[0].id, 'easygit');
});

test('create, rename and reorder groups', () => {
  let { layout, group: a } = createGroup(fresh(), '  Work  ', ['acm-doc'], 'a');
  assert.equal(a.name, 'Work');
  ({ layout } = createGroup(layout, 'Personal', ['easygit'], 'b'));
  assert.equal(createGroup(layout, '   ').group, null);
  layout = renameGroup(layout, 'a', 'ACME');
  assert.equal(layout.groups[0].name, 'ACME');
  assert.equal(renameGroup(layout, 'a', ''), layout);
  layout = moveGroup(layout, 'b', 'a');
  assert.deepEqual(layout.groups.map((g) => g.id), ['b', 'a']);
  layout = moveGroup(layout, 'b', null);
  assert.deepEqual(layout.groups.map((g) => g.id), ['a', 'b']);
});

test('move repos between groups, reorder inside a group, and ungroup', () => {
  let { layout } = createGroup(fresh(), 'A', ['acm-doc', 'acm-man'], 'a');
  ({ layout } = createGroup(layout, 'B', [], 'b'));
  layout = moveRepo(layout, 'acm-man', 'a', 'acm-doc'); // reorder inside group
  assert.deepEqual(layout.groups[0].repoIds, ['acm-man', 'acm-doc']);
  layout = moveRepo(layout, 'acm-doc', 'b'); // move between groups
  assert.deepEqual(layout.groups[0].repoIds, ['acm-man']);
  assert.deepEqual(layout.groups[1].repoIds, ['acm-doc']);
  assert.equal(groupOf(layout, 'acm-doc').id, 'b');
  layout = moveRepo(layout, 'acm-doc', null, 'glx-doc'); // out of the group
  assert.equal(groupOf(layout, 'acm-doc'), null);
  assert.equal(layout.order.indexOf('acm-doc'), layout.order.indexOf('glx-doc') - 1);
  assert.equal(moveRepo(layout, 'acm-doc', 'missing'), layout);
  // A repo is never in two groups, even with a hand-edited file.
  const twice = normalizeLayout({ groups: [{ id: 'x', repoIds: ['easygit'] }, { id: 'y', repoIds: ['easygit'] }] }, REPOS);
  assert.deepEqual(twice.groups.map((g) => g.repoIds), [['easygit'], []]);
});

test('deleting a group keeps its repositories (they become ungrouped)', () => {
  let { layout } = createGroup(fresh(), 'A', ['acm-doc', 'acm-man'], 'a');
  layout = deleteGroup(layout, 'a');
  assert.deepEqual(layout.groups, []);
  assert.deepEqual(layout.order, ids(REPOS));
  const view = buildListView(REPOS, layout, { groups: true });
  assert.equal(view.shown, REPOS.length);
  assert.deepEqual(ids(view.sections.at(-1).repos), ids(REPOS));
});

test('empty groups are kept and shown (but hidden while searching)', () => {
  const { layout } = createGroup(fresh(), 'Empty', [], 'e');
  const view = buildListView(REPOS, layout, { groups: true });
  assert.equal(view.sections[0].name, 'Empty');
  assert.equal(view.sections[0].repos.length, 0);
  assert.equal(buildListView(REPOS, layout, { groups: true, query: 'easy' }).sections.some((s) => s.id === 'e'), false);
});

test('removed repositories (and Remove all) drop out of groups and order', () => {
  let { layout } = createGroup(fresh(), 'A', ['acm-doc', 'acm-man'], 'a');
  const remaining = REPOS.filter((r) => r.id !== 'acm-doc');
  layout = normalizeLayout(layout, remaining);
  assert.deepEqual(layout.groups[0].repoIds, ['acm-man']);
  assert.equal(layout.order.includes('acm-doc'), false);
  const none = normalizeLayout(layout, []);
  assert.deepEqual(none.order, []);
  assert.deepEqual(none.groups.map((g) => g.repoIds), [[]]);
});

test('new repositories (added, cloned or auto-found) appear at the end, ungrouped', () => {
  const { layout } = createGroup(fresh(), 'A', ['acm-doc'], 'a');
  const more = [...REPOS, repo('new', 'D:\\Clones\\new')];
  const next = normalizeLayout(layout, more);
  assert.equal(next.order.at(-1), 'new');
  assert.equal(groupOf(next, 'new'), null);
});

test('renaming a repository does not affect its place', () => {
  const { layout } = createGroup(fresh(), 'A', ['acm-doc'], 'a');
  const renamed = REPOS.map((r) => (r.id === 'acm-doc' ? { ...r, name: 'Docs' } : r));
  const view = buildListView(renamed, normalizeLayout(layout, renamed), { groups: true });
  assert.equal(view.sections[0].repos[0].name, 'Docs');
});

test('disable / re-enable keeps the saved layout intact', () => {
  let { layout } = createGroup(fresh(), 'A', ['acm-doc'], 'a');
  layout = setCollapsed(layout, 'a', true);
  layout = reorderRepo(layout, 'easygit', 'acm-doc');
  const saved = JSON.stringify(layout);
  const off = buildListView(REPOS, layout, { sortBy: effectiveSort({ sortBy: 'custom' }), groups: orgFlags({}).groups });
  assert.equal(off.grouped, false);
  assert.deepEqual(ids(off.repos), ids(sortAndFilterRepos(REPOS, '', 'attention')));
  assert.equal(JSON.stringify(layout), saved);
  const on = buildListView(REPOS, normalizeLayout(JSON.parse(saved), REPOS), { sortBy: 'custom', groups: true });
  assert.equal(on.sections[0].collapsed, true);
  assert.equal(on.sections.at(-1).repos[0].id, 'easygit');
});

test('search finds repositories inside collapsed groups and opens them temporarily', () => {
  let { layout } = createGroup(fresh(), 'ACME', ['acm-doc', 'acm-man'], 'a');
  ({ layout } = createGroup(layout, 'GLOBEX', ['glx-doc', 'glx-man'], 'b'));
  layout = setCollapsed(setCollapsed(layout, 'a', true), 'b', true);
  const view = buildListView(REPOS, layout, { groups: true, query: 'ACME\\management' });
  assert.equal(view.shown, 1);
  assert.deepEqual(view.sections.map((s) => s.id), ['a']);
  assert.equal(view.sections[0].collapsed, false);
  assert.deepEqual(ids(view.sections[0].repos), ['acm-man']);
  // Without the search the saved collapsed state is back.
  assert.equal(buildListView(REPOS, layout, { groups: true }).sections[0].collapsed, true);
});

test('automatic sorts apply inside groups; custom order restores the arrangement', () => {
  let { layout } = createGroup(fresh(), 'GLX', ['glx-doc', 'glx-man'], 'b');
  const attention = buildListView(REPOS, layout, { groups: true, sortBy: 'attention' });
  assert.deepEqual(ids(attention.sections[0].repos), ['glx-man', 'glx-doc']);
  const custom = buildListView(REPOS, layout, { groups: true, sortBy: 'custom' });
  assert.deepEqual(ids(custom.sections[0].repos), ['glx-doc', 'glx-man']);
});

test('suggests groups from the same immediate parent folder', () => {
  const s = suggestGroups(REPOS, fresh());
  assert.deepEqual(s.map((x) => x.name), ['ACME', 'GLOBEX']);
  assert.deepEqual(s[0].repoIds, ['acm-doc', 'acm-man']);
  assert.equal(s[0].parent, 'C:\\Git\\ACME');
});

test('no suggestion for unrelated repos or a single repo', () => {
  const unrelated = [repo('a', 'C:\\Work\\Alpha\\one'), repo('b', 'C:\\Work\\Beta\\two'), repo('c', 'C:\\Work\\Gamma\\three')];
  assert.deepEqual(suggestGroups(unrelated, normalizeLayout(null, unrelated)), []);
  const single = [repo('a', 'C:\\Work\\Alpha\\one')];
  assert.deepEqual(suggestGroups(single, normalizeLayout(null, single)), []);
});

test('generic parent folders are never suggested', () => {
  for (const p of ['C:\\', 'C:', '/', 'C:\\Git', 'C:\\Users', 'C:\\Users\\me', 'C:\\Users\\me\\Documents', 'D:\\Projects',
    '/home/me', '/Users/me/Projects', 'C:\\Users\\me\\OneDrive - Company', 'C:\\Users\\me\\source\\repos']) {
    assert.equal(isGenericParent(p), true, p);
  }
  assert.equal(isGenericParent('C:\\Git\\ACME'), false);
  const generic = [repo('a', 'C:\\Git\\one'), repo('b', 'C:\\Git\\two'), repo('c', 'C:\\one'), repo('d', 'C:\\two'),
    repo('e', '/home/me/one'), repo('f', '/home/me/two')];
  assert.deepEqual(suggestGroups(generic, normalizeLayout(null, generic)), []);
});

test('accepting a suggestion creates a group; already-grouped repos are not suggested again', () => {
  const [met] = suggestGroups(REPOS, fresh());
  const { layout, group } = acceptSuggestion(fresh(), met, 'met');
  assert.equal(group.name, 'ACME');
  assert.deepEqual(group.repoIds, ['acm-doc', 'acm-man']);
  assert.deepEqual(suggestGroups(REPOS, layout).map((x) => x.name), ['GLOBEX']);
});

test('a dismissed suggestion stays dismissed until the repository set changes', () => {
  const [, oph] = suggestGroups(REPOS, fresh());
  const layout = dismissSuggestions(fresh(), [oph.signature]);
  assert.deepEqual(suggestGroups(REPOS, layout).map((x) => x.name), ['ACME']);
  const more = [...REPOS, repo('glx-web', 'c:\\git\\globex\\website')];
  const back = suggestGroups(more, normalizeLayout(layout, more)).find((x) => x.name.toLowerCase() === 'globex');
  assert.ok(back, 'new repo in the folder brings the suggestion back');
  assert.equal(back.repoIds.length, 3);
});

test('suggestions only use stored paths (missing folders are fine) and skip used group names', () => {
  const gone = [repo('a', 'Z:\\Nowhere\\Client\\x'), repo('b', 'Z:\\Nowhere\\Client\\y')];
  assert.deepEqual(suggestGroups(gone, normalizeLayout(null, gone)).map((x) => x.name), ['Client']);
  const { layout } = createGroup(normalizeLayout(null, gone), 'client', [], 'c');
  assert.deepEqual(suggestGroups(gone, layout), []);
});
