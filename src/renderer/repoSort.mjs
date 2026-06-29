/**
 * repoSort.mjs (renderer, pure)
 * -----------------------------
 * Pure helpers for ordering and filtering the repository list. No DOM, no IPC,
 * no imports — so it is trivially unit-testable in Node (see test/repoSort).
 *
 * Sorting is intentionally simple and friendly:
 *   - 'attention' : repositories that need the user to do something float to the
 *                   top (errors first, then download/upload, then local changes),
 *                   so the list answers "what should I deal with?" at a glance.
 *   - 'name'      : A→Z by the friendly name.
 *   - 'recent'    : most-recently-checked first.
 *   - 'added'     : keep the original order (as added).
 */

/** Lower number = more urgent = shown first. Keys are status codes. */
const ATTENTION_RANK = {
  error: 0,
  'needs-upload-and-download': 1,
  'needs-download': 2,
  'needs-upload': 3,
  'local-changes': 4,
  'no-remote': 5,
  'up-to-date': 6,
  unknown: 7,
};

function attentionRank(repo) {
  const r = ATTENTION_RANK[repo && repo.lastStatus];
  return r == null ? 99 : r;
}

function byName(a, b) {
  return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), undefined, {
    sensitivity: 'base',
  });
}

function recentKey(repo) {
  const t = repo && repo.lastChecked ? Date.parse(repo.lastChecked) : NaN;
  return Number.isFinite(t) ? t : -Infinity; // never-checked sorts last
}

/**
 * Filter by a free-text query (matches name or path, case-insensitive) and sort.
 * Returns a NEW array; the input is never mutated.
 *
 * @param {Array<object>} repos      decorated repositories (have name, path, lastStatus, lastChecked)
 * @param {string} [query]           free-text filter
 * @param {'attention'|'name'|'recent'|'added'} [sortBy]
 * @returns {Array<object>}
 */
export function sortAndFilterRepos(repos, query = '', sortBy = 'attention') {
  let list = Array.isArray(repos) ? repos.slice() : [];

  const q = String(query || '').trim().toLowerCase();
  if (q) {
    list = list.filter(
      (r) =>
        String((r && r.name) || '').toLowerCase().includes(q) ||
        String((r && r.path) || '').toLowerCase().includes(q)
    );
  }

  // Array.prototype.sort is stable, so 'added' (no sort) keeps the original
  // order and the byName tie-breaker stays deterministic.
  if (sortBy === 'name') {
    list.sort(byName);
  } else if (sortBy === 'recent') {
    list.sort((a, b) => recentKey(b) - recentKey(a) || byName(a, b));
  } else if (sortBy === 'attention') {
    list.sort((a, b) => attentionRank(a) - attentionRank(b) || byName(a, b));
  }

  return list;
}

/** Exported for tests / callers that want the urgency ordering directly. */
export { attentionRank };
