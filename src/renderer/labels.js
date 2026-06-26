/**
 * labels.js (renderer)
 * --------------------
 * Small presentation helpers for the UI: friendly time formatting and the
 * definitions of the per-repository action buttons.
 *
 * Friendly status wording itself lives in the main process (messages.js /
 * statusInterpreter.js) and arrives ready-to-show; this file is purely about
 * how the renderer lays things out.
 */

/**
 * Turn an ISO timestamp into a friendly "Last checked" phrase.
 * @param {string|null} iso
 * @returns {string}
 */
export function formatLastChecked(iso) {
  if (!iso) return 'Never checked';
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now - then;
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);

  if (sec < 45) return 'Checked just now';
  if (min < 60) return `Checked ${min} minute${min === 1 ? '' : 's'} ago`;
  if (hr < 24) return `Checked ${hr} hour${hr === 1 ? '' : 's'} ago`;
  if (day < 7) return `Checked ${day} day${day === 1 ? '' : 's'} ago`;
  return `Checked on ${then.toLocaleDateString()}`;
}

/**
 * Friendly presentation for each file change type. `cls` is a CSS class used to
 * colour the badge. These intentionally avoid raw Git terms.
 */
export const CHANGE_TYPES = {
  added: { label: 'Added', icon: '➕', cls: 'ct-added' },
  modified: { label: 'Edited', icon: '✏️', cls: 'ct-modified' },
  deleted: { label: 'Deleted', icon: '🗑️', cls: 'ct-deleted' },
  renamed: { label: 'Renamed', icon: '🔀', cls: 'ct-renamed' },
  copied: { label: 'Copied', icon: '📑', cls: 'ct-renamed' },
  untracked: { label: 'New', icon: '✨', cls: 'ct-untracked' },
  typechange: { label: 'Changed', icon: '🔁', cls: 'ct-modified' },
  conflicted: { label: 'Needs attention', icon: '⚠️', cls: 'ct-conflict' },
};

/** Look up change-type presentation, with a safe fallback. */
export function changeTypeInfo(type) {
  return CHANGE_TYPES[type] || { label: 'Changed', icon: '•', cls: 'ct-modified' };
}

/** Friendly label for a file that changed ONLINE (simple mode). */
export function onlineChangeLabel(type) {
  const map = {
    added: 'Added online',
    modified: 'Edited online',
    deleted: 'Deleted online',
    renamed: 'Renamed online',
    copied: 'Copied online',
    typechange: 'Changed online',
  };
  return map[type] || 'Changed online';
}

/* Simple-mode grouping of local changes (no staged/unstaged distinction). */
export function localGroupKey(type) {
  if (type === 'untracked' || type === 'added') return 'new';
  if (type === 'deleted') return 'deleted';
  if (type === 'renamed' || type === 'copied') return 'renamed';
  if (type === 'conflicted') return 'attention';
  return 'edited';
}
export const LOCAL_GROUP_TITLES = {
  attention: 'Files needing attention',
  new: 'New files',
  edited: 'Edited files',
  deleted: 'Deleted files',
  renamed: 'Renamed files',
};
export const LOCAL_GROUP_ORDER = ['attention', 'new', 'edited', 'deleted', 'renamed'];

/** Split a repo-relative path into { name, dir } for two-line display. */
export function splitPath(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  if (idx === -1) return { name: norm, dir: '' };
  return { name: norm.slice(idx + 1), dir: norm.slice(0, idx) };
}
