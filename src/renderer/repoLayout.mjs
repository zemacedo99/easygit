/**
 * repoLayout.mjs (renderer, pure)
 * -------------------------------
 * The optional "organize your repository list" model: a custom order and
 * one level of collapsible groups. Pure functions only — no DOM, no IPC — so it
 * is unit-tested in Node (see test/repoLayout.test.mjs).
 *
 * IMPORTANT: groups are EasyGit metadata only. Nothing here ever reads, moves,
 * renames or creates folders on disk; suggestions only look at the path
 * strings EasyGit already stored.
 *
 * Layout shape (persisted by the main process as `layout` in repositories.json):
 *   {
 *     order: [repoId, ...],                       // custom order of ALL repos
 *     groups: [{ id, name, collapsed, repoIds }], // group order = array order
 *     ungroupedCollapsed: false,                  // the "Not in a group" section
 *     dismissedSuggestions: [signature, ...],     // folder suggestions the user declined
 *   }
 * A repository belongs to at most one group. Repositories missing from `order`
 * (newly added/cloned/found) are appended in "order added" order.
 *
 * Sorting rule: the saved layout is the user's "Custom order". Automatic sorts
 * (Needs action first, Name, ...) only change how repositories are presented
 * inside each group / the flat list; they never rewrite the saved layout, so
 * choosing "Custom order" again brings the arrangement straight back.
 */

import { sortAndFilterRepos } from './repoSort.mjs';

const MAX_NAME = 60;

export function emptyLayout() {
  return { order: [], groups: [], ungroupedCollapsed: false, dismissedSuggestions: [] };
}

function cleanName(name) {
  return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function clone(layout) {
  return {
    order: layout.order.slice(),
    groups: layout.groups.map((g) => ({ ...g, repoIds: g.repoIds.slice() })),
    ungroupedCollapsed: !!layout.ungroupedCollapsed,
    dismissedSuggestions: layout.dismissedSuggestions.slice(),
  };
}

/**
 * Make any saved (or missing / corrupted) layout safe to use with the current
 * repositories: unknown ids are dropped, duplicates removed, and repositories
 * not in the custom order yet are appended in their "order added" position.
 * With no saved layout this yields the current order and no groups.
 * @param {object|null|undefined} raw
 * @param {Array<{id: string}>} repos
 */
export function normalizeLayout(raw, repos) {
  const ids = (Array.isArray(repos) ? repos : []).map((r) => r && r.id).filter((id) => typeof id === 'string');
  const known = new Set(ids);
  const src = raw && typeof raw === 'object' ? raw : {};

  const seen = new Set();
  const order = [];
  for (const id of Array.isArray(src.order) ? src.order : []) {
    if (known.has(id) && !seen.has(id)) { seen.add(id); order.push(id); }
  }
  for (const id of ids) if (!seen.has(id)) { seen.add(id); order.push(id); }

  const member = new Set();
  const groupIds = new Set();
  const groups = [];
  for (const g of Array.isArray(src.groups) ? src.groups : []) {
    if (!g || typeof g.id !== 'string' || !g.id || groupIds.has(g.id)) continue;
    groupIds.add(g.id);
    const repoIds = [];
    for (const id of Array.isArray(g.repoIds) ? g.repoIds : []) {
      if (known.has(id) && !member.has(id)) { member.add(id); repoIds.push(id); }
    }
    groups.push({ id: g.id, name: cleanName(g.name) || 'Group', collapsed: !!g.collapsed, repoIds });
  }

  const dismissedSuggestions = Array.from(
    new Set((Array.isArray(src.dismissedSuggestions) ? src.dismissedSuggestions : []).filter((s) => typeof s === 'string'))
  );

  return { order, groups, ungroupedCollapsed: !!src.ungroupedCollapsed, dismissedSuggestions };
}

/* ------------------------------------------------------------------ */
/* Settings → what is enabled                                          */
/* ------------------------------------------------------------------ */

/**
 * Which organization features are active. Everything is off unless the master
 * "organizeRepos" setting is on; custom groups and suggestions also need groups.
 */
export function orgFlags(settings) {
  const s = settings || {};
  const enabled = !!s.organizeRepos;
  const manual = enabled && !!s.orgManualOrder;
  const groups = enabled && !!s.orgGroups;
  return {
    enabled,
    manual,
    groups,
    customGroups: groups && !!s.orgCustomGroups,
    suggest: groups && !!s.orgSuggestGroups,
    // "Custom order" is offered in the Sort menu only while it means something.
    customSort: manual || groups,
  };
}

/**
 * The sort actually used for the list. A saved 'custom' sort falls back to the
 * sort the user had before (or "Needs action first") while organization is off,
 * so disabling the feature restores the original experience exactly.
 */
export function effectiveSort(settings) {
  const s = settings || {};
  const sortBy = s.sortBy || 'attention';
  if (sortBy === 'custom' && !orgFlags(s).customSort) {
    return s.sortFallback && s.sortFallback !== 'custom' ? s.sortFallback : 'attention';
  }
  return sortBy;
}

/* ------------------------------------------------------------------ */
/* Layout operations (all return a NEW layout)                         */
/* ------------------------------------------------------------------ */

function insertBefore(list, id, beforeId) {
  const at = beforeId ? list.indexOf(beforeId) : -1;
  if (at < 0) list.push(id);
  else list.splice(at, 0, id);
}

/** The group a repository is in, or null when it is not in a group. */
export function groupOf(layout, repoId) {
  return layout.groups.find((g) => g.repoIds.includes(repoId)) || null;
}

/**
 * Reorder a repository in the flat custom order (group membership untouched).
 * @param {string|null} beforeId  place it just before this repo; null = at the end
 */
export function reorderRepo(layout, repoId, beforeId) {
  if (!layout.order.includes(repoId) || repoId === beforeId) return layout;
  const next = clone(layout);
  next.order = next.order.filter((id) => id !== repoId);
  insertBefore(next.order, repoId, beforeId);
  return next;
}

/**
 * Move a repository into a group (or out of all groups when groupId is null),
 * placed before `beforeId` within that destination, or at its end.
 */
export function moveRepo(layout, repoId, groupId, beforeId = null) {
  if (!layout.order.includes(repoId) || repoId === beforeId) return layout;
  if (groupId && !layout.groups.some((g) => g.id === groupId)) return layout;
  const next = clone(layout);
  for (const g of next.groups) g.repoIds = g.repoIds.filter((id) => id !== repoId);
  if (groupId) {
    insertBefore(next.groups.find((g) => g.id === groupId).repoIds, repoId, beforeId);
  } else {
    next.order = next.order.filter((id) => id !== repoId);
    insertBefore(next.order, repoId, beforeId);
  }
  return next;
}

let idCounter = 0;
function newGroupId() {
  idCounter += 1;
  return `g_${Date.now().toString(36)}_${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Add a group (at the end), optionally with repositories, which leave any group
 * they were in. @returns {{layout: object, group: object|null}}
 */
export function createGroup(layout, name, repoIds = [], id = newGroupId()) {
  const clean = cleanName(name);
  if (!clean) return { layout, group: null };
  const next = clone(layout);
  const members = repoIds.filter((r, i) => next.order.includes(r) && repoIds.indexOf(r) === i);
  for (const g of next.groups) g.repoIds = g.repoIds.filter((r) => !members.includes(r));
  const group = { id, name: clean, collapsed: false, repoIds: members };
  next.groups.push(group);
  return { layout: next, group };
}

export function renameGroup(layout, groupId, name) {
  const clean = cleanName(name);
  if (!clean || !layout.groups.some((g) => g.id === groupId)) return layout;
  const next = clone(layout);
  next.groups.find((g) => g.id === groupId).name = clean;
  return next;
}

/**
 * Delete a group. Its repositories simply become "not in a group" (they keep
 * their place in the custom order); nothing is removed from EasyGit.
 */
export function deleteGroup(layout, groupId) {
  if (!layout.groups.some((g) => g.id === groupId)) return layout;
  const next = clone(layout);
  next.groups = next.groups.filter((g) => g.id !== groupId);
  return next;
}

/** Reorder groups: put `groupId` before `beforeGroupId` (null = last). */
export function moveGroup(layout, groupId, beforeGroupId) {
  const group = layout.groups.find((g) => g.id === groupId);
  if (!group || groupId === beforeGroupId) return layout;
  const next = clone(layout);
  const moving = next.groups.find((g) => g.id === groupId);
  next.groups = next.groups.filter((g) => g.id !== groupId);
  const at = beforeGroupId ? next.groups.findIndex((g) => g.id === beforeGroupId) : -1;
  if (at < 0) next.groups.push(moving);
  else next.groups.splice(at, 0, moving);
  return next;
}

/** Collapse/expand a group, or the "Not in a group" section when groupId is null. */
export function setCollapsed(layout, groupId, collapsed) {
  const next = clone(layout);
  if (!groupId) next.ungroupedCollapsed = !!collapsed;
  else {
    const g = next.groups.find((x) => x.id === groupId);
    if (!g) return layout;
    g.collapsed = !!collapsed;
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Suggestions from common parent folders                              */
/* ------------------------------------------------------------------ */

/**
 * Folder names too broad to make a meaningful group (compared lower-case).
 * A repository directly inside one of these is never grouped by its parent.
 */
const GENERIC_PARENTS = new Set([
  'users', 'user', 'home', 'documents', 'my documents', 'desktop', 'downloads',
  'git', 'github', 'gitlab', 'bitbucket', 'azure devops', 'repos', 'repo',
  'repositories', 'repository', 'projects', 'project', 'my projects', 'source',
  'sources', 'source code', 'src', 'code', 'dev', 'development', 'workspace',
  'workspaces', 'work', 'programs', 'program files', 'program files (x86)',
  'sites', 'clones', 'checkouts', 'temp', 'tmp', 'dropbox', 'google drive',
  'icloud drive', 'volumes', 'mnt', 'media', 'opt', 'var', 'srv', 'data',
  'public', 'shared', 'local', 'appdata', 'onedrive',
]);

/** Split a stored path into its parent folder (or null at the top). */
export function parentFolder(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  const at = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (at < 0) return null;
  const parent = s.slice(0, at);
  return parent === '' ? '/' : parent;
}

function segments(p) {
  return String(p).split(/[\\/]+/).filter(Boolean);
}

/** True for drive roots, home folders and generic folders like "Git" or "Documents". */
export function isGenericParent(parent) {
  if (!parent) return true;
  const segs = segments(parent);
  if (segs.length && /^[A-Za-z]:$/.test(segs[0])) segs.shift(); // drive letter
  if (segs.length === 0) return true; // a drive or filesystem root
  const name = segs[segs.length - 1].toLowerCase();
  if (GENERIC_PARENTS.has(name) || name.startsWith('onedrive') || name.startsWith('.')) return true;
  // The user's own home folder (C:\Users\<name>, /home/<name>, /Users/<name>).
  if (segs.length >= 2 && ['users', 'home'].includes(segs[segs.length - 2].toLowerCase())) return true;
  return false;
}

function parentKey(parent) {
  // Windows paths are case-insensitive; POSIX ones are not.
  const windowsy = /^[A-Za-z]:/.test(parent) || parent.includes('\\');
  const k = parent.replace(/\\/g, '/');
  return windowsy ? k.toLowerCase() : k;
}

/**
 * Suggest groups for repositories (not already in a group) that share the same
 * immediate parent folder. Needs at least two repositories per folder, skips
 * generic folders, names already used by a group, and anything dismissed.
 * @returns {Array<{signature: string, name: string, parent: string, repoIds: string[]}>}
 */
export function suggestGroups(repos, layout) {
  const grouped = new Set(layout.groups.flatMap((g) => g.repoIds));
  const usedNames = new Set(layout.groups.map((g) => g.name.toLowerCase()));
  const dismissed = new Set(layout.dismissedSuggestions);
  const byParent = new Map();
  for (const repo of Array.isArray(repos) ? repos : []) {
    if (!repo || grouped.has(repo.id)) continue;
    const parent = parentFolder(repo.path);
    if (!parent || isGenericParent(parent)) continue;
    const key = parentKey(parent);
    if (!byParent.has(key)) byParent.set(key, { parent, repoIds: [] });
    byParent.get(key).repoIds.push(repo.id);
  }
  const out = [];
  for (const [key, { parent, repoIds }] of byParent) {
    if (repoIds.length < 2) continue;
    const name = cleanName(segments(parent).pop());
    if (!name || usedNames.has(name.toLowerCase())) continue;
    // The signature changes when the set of repositories changes, so a
    // dismissed suggestion only comes back if something meaningful changed.
    const signature = `${key}|${repoIds.slice().sort().join(',')}`;
    if (dismissed.has(signature)) continue;
    out.push({ signature, name, parent, repoIds });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Turn a suggestion into a real (EasyGit-only) group. */
export function acceptSuggestion(layout, suggestion, id) {
  return createGroup(layout, suggestion.name, suggestion.repoIds, id);
}

/** Remember that the user declined these suggestions. */
export function dismissSuggestions(layout, signatures) {
  const next = clone(layout);
  for (const s of signatures) if (!next.dismissedSuggestions.includes(s)) next.dismissedSuggestions.push(s);
  return next;
}

/* ------------------------------------------------------------------ */
/* What to show                                                        */
/* ------------------------------------------------------------------ */

function byIndex(ids) {
  const pos = new Map(ids.map((id, i) => [id, i]));
  return (a, b) => (pos.has(a.id) ? pos.get(a.id) : Infinity) - (pos.has(b.id) ? pos.get(b.id) : Infinity);
}

/**
 * Build the list to display. Filtering always covers every repository —
 * including ones inside collapsed groups — and while searching, groups with a
 * match are shown open and groups without one are hidden.
 *
 * @param {object[]} repos      decorated repositories
 * @param {object} layout       a normalized layout
 * @param {{query?: string, sortBy?: string, groups?: boolean}} opts
 * @returns {{grouped: false, repos: object[], shown: number}
 *         | {grouped: true, sections: object[], shown: number}}
 */
export function buildListView(repos, layout, { query = '', sortBy = 'custom', groups = false } = {}) {
  const custom = sortBy === 'custom';
  const list = sortAndFilterRepos(repos, query, custom ? 'added' : sortBy);
  if (!groups) {
    if (custom) list.sort(byIndex(layout.order));
    return { grouped: false, repos: list, shown: list.length };
  }

  const searching = !!String(query || '').trim();
  const sections = [];
  const inGroup = new Set();
  for (const g of layout.groups) {
    const members = new Set(g.repoIds);
    g.repoIds.forEach((id) => inGroup.add(id));
    const items = list.filter((r) => members.has(r.id));
    if (custom) items.sort(byIndex(g.repoIds));
    if (searching && items.length === 0) continue;
    sections.push({ id: g.id, name: g.name, collapsed: searching ? false : g.collapsed, repos: items, total: g.repoIds.length });
  }
  const loose = list.filter((r) => !inGroup.has(r.id));
  if (custom) loose.sort(byIndex(layout.order));
  if (!(searching && loose.length === 0)) {
    sections.push({
      id: null,
      name: 'Not in a group',
      collapsed: searching ? false : layout.ungroupedCollapsed,
      repos: loose,
      total: layout.order.filter((id) => !inGroup.has(id)).length,
    });
  }
  return { grouped: true, sections, shown: list.length };
}
