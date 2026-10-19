'use strict';

/**
 * repoManager.js
 * --------------
 * The orchestration layer. It ties together storage, gitService, scanner,
 * statusInterpreter and messages so main.js (IPC) can stay thin.
 *
 * Responsibilities:
 *   - Keep the in-memory list of repositories and persist changes.
 *   - Add / remove repositories (with validation).
 *   - Check the status of one repository (optionally refreshing online info).
 *   - Run the friendly actions: save a version, download, upload.
 *
 * Everything returned here is already friendly data, ready for the UI.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const git = require('./gitService');
const storage = require('./storage');
const scanner = require('./scanner');
const interpreter = require('./statusInterpreter');
const suggester = require('./suggestMessage');
const { Status, STATUS_INFO, friendlyError, friendlyCloneError } = require('./messages');
const urls = require('./urls');

/** In-memory cache of repositories, loaded from storage at startup. */
let repos = [];

/** Load persisted repositories into memory. Call once at startup. */
function load() {
  repos = storage.loadRepos();
  return repos;
}

function persist() {
  storage.saveRepos(repos);
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Normalize a path so duplicates are detected reliably. Delegates to the
 * scanner so scan results and added repositories are compared identically.
 */
function normalize(p) {
  return scanner.normalizePath(p);
}

/** Return the stored repositories, enriched with display-friendly extras. */
function listRepos() {
  return repos.map(decorate);
}

/** Add display-only fields (provider name, browser URL, status metadata). */
function decorate(repo) {
  const statusInfo = STATUS_INFO[repo.lastStatus] || STATUS_INFO[Status.UNKNOWN];
  return {
    ...repo,
    statusLabel: statusInfo.label,
    statusTone: statusInfo.tone,
    statusShort: statusInfo.short,
    browserUrl: urls.toBrowserUrl(repo.remoteUrl),
    provider: urls.providerName(repo.remoteUrl),
  };
}

function findById(id) {
  return repos.find((r) => r.id === id);
}

/**
 * Add a single local folder as a repository, after validating it is a git repo.
 * @param {string} folderPath
 * @returns {Promise<{ok: boolean, repo?: object, error?: {title: string, detail: string}}>}
 */
async function addRepo(folderPath) {
  const check = await git.isGitRepo(folderPath);
  if (!check.isRepo) {
    return { ok: false, error: friendlyError(check.errorCode) };
  }

  // Avoid duplicates.
  const norm = normalize(folderPath);
  if (repos.some((r) => normalize(r.path) === norm)) {
    return {
      ok: false,
      error: {
        title: 'Already added',
        detail: 'This repository is already in your list.',
      },
    };
  }

  const remoteUrl = await git.getRemoteUrl(folderPath);
  const repo = {
    id: newId(),
    name: path.basename(folderPath),
    path: path.resolve(folderPath),
    remoteUrl: remoteUrl || null,
    lastStatus: Status.UNKNOWN,
    lastChecked: null,
  };
  repos.push(repo);
  persist();
  return { ok: true, repo: decorate(repo) };
}

/** Suggest a friendly local folder name from a repository link (pure). */
function suggestFolderName(url) {
  return urls.suggestFolderName(url);
}

/**
 * Download (git clone) an online project into a NEW local folder and add it to
 * the list — the friendly "Add repository from link or SSH" action.
 *
 * Safety: never overwrites an existing folder; uses safe argument arrays (no
 * shell); lets the installed Git handle authentication (no credentials stored
 * or requested); cleans up a partial folder if the download fails.
 *
 * @param {{url?: string, parentDir?: string, folderName?: string}} options
 * @returns {Promise<{ok: boolean, repo?: object, error?: {title: string, detail: string}}>}
 */
async function cloneRepo(options = {}) {
  const url = String(options.url || '').trim();
  const parentDir = String(options.parentDir || '').trim();

  if (!url) {
    return { ok: false, error: { title: 'Paste a link first', detail: 'Please paste the online project link you want to download.' } };
  }
  if (!urls.isProbablyGitUrl(url)) {
    return {
      ok: false,
      error: {
        title: 'That link does not look right',
        detail: 'Please paste a full project link, for example https://…, git@… or ssh://…',
      },
    };
  }
  if (!parentDir) {
    return { ok: false, error: { title: 'Choose where to save it', detail: 'Please choose a folder on this computer to save the project inside.' } };
  }
  let parentOk = false;
  try {
    parentOk = fs.statSync(parentDir).isDirectory();
  } catch (e) {
    parentOk = false;
  }
  if (!parentOk) {
    return { ok: false, error: { title: 'Folder not found', detail: 'That destination folder could not be found. Please choose another one.' } };
  }

  // Folder name: use what the user typed, else suggest from the link.
  let folderName = urls.sanitizeFolderName(options.folderName || '');
  if (!folderName) folderName = urls.suggestFolderName(url);
  if (!folderName) folderName = 'new-project';

  const target = path.resolve(parentDir, folderName);

  // Never overwrite an existing folder.
  if (fs.existsSync(target)) {
    return {
      ok: false,
      error: {
        title: 'That folder already exists',
        detail: `A folder named “${folderName}” already exists in that location. Please pick a different name or folder — EasyGit will not overwrite anything.`,
      },
    };
  }

  // Skip if this exact location is already in the list.
  const norm = normalize(target);
  if (repos.some((r) => normalize(r.path) === norm)) {
    return { ok: false, error: { title: 'Already added', detail: 'This project is already in your list.' } };
  }

  const res = await git.clone(url, target, parentDir);
  if (!res.ok) {
    // Remove any partial folder Git may have created before failing.
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (e) {
      /* best-effort cleanup */
    }
    return { ok: false, error: friendlyCloneError(res.errorCode) };
  }

  // Confirm the download really produced a Git project.
  const check = await git.isGitRepo(target);
  if (!check.isRepo) {
    return {
      ok: false,
      error: {
        title: 'Download finished, but something looks off',
        detail: 'The download completed but the folder does not look like a Git project. Please try again.',
      },
    };
  }

  const remoteUrl = await git.getRemoteUrl(target);
  const repo = {
    id: newId(),
    name: folderName,
    path: target,
    remoteUrl: remoteUrl || url,
    lastStatus: Status.UNKNOWN,
    lastChecked: null,
  };
  repos.push(repo);
  persist();
  return { ok: true, repo: decorate(repo) };
}

/**
 * Add several discovered repositories at once (from a scan). Skips invalid /
 * duplicate ones silently and reports how many were added.
 * @param {string[]} folderPaths
 * @returns {Promise<{added: object[], skipped: number}>}
 */
async function addManyRepos(folderPaths) {
  const added = [];
  let skipped = 0;
  for (const fp of folderPaths) {
    const res = await addRepo(fp);
    if (res.ok) added.push(res.repo);
    else skipped++;
  }
  return { added, skipped };
}

/** Remove a repository from EasyGit (does NOT touch the folder on disk). */
function removeRepo(id) {
  const before = repos.length;
  repos = repos.filter((r) => r.id !== id);
  if (repos.length !== before) {
    persist();
    pruneLayout();
    return { ok: true };
  }
  return { ok: false };
}

/**
 * Remove ALL repositories from EasyGit's list. This only forgets them here; it
 * never touches the folders on disk.
 * @returns {{ok: boolean, removed: number}}
 */
function removeAllRepos() {
  const removed = repos.length;
  repos = [];
  persist();
  pruneLayout(); // groups stay (now empty) so the user's group names aren't lost
  return { ok: true, removed };
}

/** Rename the friendly name of a repository. */
function renameRepo(id, newName) {
  const repo = findById(id);
  if (!repo) return { ok: false };
  repo.name = (newName || '').trim() || repo.name;
  persist();
  return { ok: true, repo: decorate(repo) };
}

/**
 * Build the list of "extra" roots to fold into an automatic scan: folders the
 * user scanned before, plus the parent folders of repositories already added
 * (so a re-scan easily finds sibling projects).
 * @returns {string[]}
 */
function getExtraRoots() {
  const previouslyScanned = storage.loadScanRoots();
  const parentsOfAdded = repos
    .map((r) => path.dirname(r.path))
    // Drop bare drive/filesystem roots (e.g. a repo at C:\repo -> C:\): scanning
    // from a drive root would walk the whole disk.
    .filter((p) => path.dirname(p) !== p);
  return [...previouslyScanned, ...parentsOfAdded];
}

/**
 * Remember a folder the user chose to scan, so future automatic scans look
 * there too. Keeps the most recent entries, de-duplicated, capped in size.
 * @param {string} folderPath
 */
function rememberScanRoot(folderPath) {
  if (!folderPath) return;
  const previous = storage.loadScanRoots();
  const merged = [];
  const seen = new Set();
  for (const p of [path.resolve(folderPath), ...previous]) {
    const n = normalize(p);
    if (seen.has(n)) continue;
    seen.add(n);
    merged.push(p);
    if (merged.length >= 25) break;
  }
  storage.saveScanRoots(merged);
}

/** Decorate raw scan hits with "already added" + sort new ones first. */
function decorateFindings(rawFound) {
  const known = new Set(repos.map((r) => normalize(r.path)));
  const found = rawFound.map((f) => ({
    ...f,
    alreadyAdded: known.has(normalize(f.path)),
  }));
  found.sort(
    (a, b) =>
      Number(a.alreadyAdded) - Number(b.alreadyAdded) ||
      a.name.localeCompare(b.name)
  );
  const newCount = found.filter((f) => !f.alreadyAdded).length;
  return {
    found,
    summary: { total: found.length, new: newCount, already: found.length - newCount },
  };
}

/**
 * Automatically scan likely locations (or a chosen folder) for git repositories.
 *
 * @param {'quick'|'deeper'|'custom'} preset
 * @param {string|null} customPath  Required when preset === 'custom'.
 * @param {object} [hooks]
 * @param {Function} [hooks.onProgress]  Forwarded to the scanner.
 * @param {{cancelled: boolean}} [hooks.token]  Cancellation token.
 */
async function autoScan(preset, customPath, hooks = {}) {
  let roots;
  let maxDepth;

  if (preset === 'custom') {
    if (!customPath) {
      return { found: [], roots: [], scannedFolders: 0, cancelled: false, errorCount: 0, limitReached: false, summary: { total: 0, new: 0, already: 0 } };
    }
    roots = [path.resolve(customPath)];
    maxDepth = scanner.DEPTH.custom;
    rememberScanRoot(customPath); // so future auto-scans look here too
  } else {
    roots = scanner.getCandidateRoots(preset, getExtraRoots());
    maxDepth = preset === 'deeper' ? scanner.DEPTH.deeper : scanner.DEPTH.quick;
  }

  const result = await scanner.scan({
    roots,
    maxDepth,
    onProgress: hooks.onProgress,
    token: hooks.token,
  });

  const { found, summary } = decorateFindings(result.found);

  return {
    found,
    roots,
    scannedFolders: result.scannedFolders,
    cancelled: result.cancelled,
    errorCount: result.errors.length,
    limitReached: result.limitReached,
    summary,
  };
}

/**
 * Legacy single-folder scan (kept for backward compatibility). Prefer autoScan.
 * @param {string} rootPath
 */
async function scan(rootPath) {
  return autoScan('custom', rootPath);
}

/**
 * Gather the facts for a repository and interpret them into a friendly status.
 *
 * @param {string} id
 * @param {object} [options]
 * @param {boolean} [options.fetch]  Refresh online info first (network call).
 * @returns {Promise<object>} a decorated repo plus a `details` object.
 */
async function checkStatus(id, options = {}) {
  const repo = findById(id);
  if (!repo) return { ok: false, error: { title: 'Not found', detail: 'That repository is no longer in your list.' } };

  // Folder still there and still a repo?
  const repoCheck = await git.isGitRepo(repo.path);
  if (!repoCheck.isRepo) {
    repo.lastStatus = Status.ERROR;
    repo.lastChecked = new Date().toISOString();
    persist();
    const err = friendlyError(repoCheck.errorCode);
    return {
      ok: true,
      repo: decorate(repo),
      details: {
        status: Status.ERROR,
        explanation: `${err.title}. ${err.detail}`,
        onlineSummary: '',
        localSummary: '',
        files: [],
        history: [],
        error: err,
      },
    };
  }

  // Current branch + remote URL (refresh the saved remote in case it changed).
  const branch = await git.getCurrentBranch(repo.path);
  const remoteUrl = await git.getRemoteUrl(repo.path);
  repo.remoteUrl = remoteUrl || null;
  repo.branch = branch;

  // Detailed local status: changed (working), ready-to-save (staged), conflicts.
  const detailed = await git.getDetailedStatus(repo.path);
  const working = detailed.ok ? detailed.working : [];
  const staged = detailed.ok ? detailed.staged : [];
  const conflicted = detailed.ok ? detailed.conflicted : [];

  // Optionally refresh online info first.
  let fetched = false;
  let fetchError = null;
  if (options.fetch && repo.remoteUrl) {
    const f = await git.fetch(repo.path);
    fetched = f.ok;
    if (!f.ok) fetchError = f.errorCode;
  }

  // Ahead / behind vs the online version line + the upstream name.
  const ab = await git.getAheadBehind(repo.path);
  const upstream = await git.getUpstreamName(repo.path);

  const facts = {
    hasRemote: !!repo.remoteUrl,
    hasUpstream: ab.hasUpstream,
    // Boolean "any changes?" signal only. A file changed on both sides ("MM")
    // appears in both working and staged, so this may exceed the unique count.
    localChangeCount: working.length + staged.length + conflicted.length,
    workingCount: working.length,
    stagedCount: staged.length,
    // Unique changed files (a file changed on both sides counts once) – used for
    // the simple-mode banner so it agrees with the de-duplicated file list.
    uniqueLocalCount: new Set([...working, ...staged].map((f) => f.path)).size,
    conflictedCount: conflicted.length,
    untrackedCount: working.filter((f) => f.type === 'untracked').length,
    ahead: ab.ahead,
    behind: ab.behind,
    fetched,
  };

  const interpreted = interpreter.interpret(facts);

  repo.lastStatus = interpreted.status;
  repo.lastChecked = new Date().toISOString();
  persist();

  // Recent history, marking which saved versions are only on this computer.
  const unpushed = await git.getUnpushedHashes(repo.path);
  const hist = await git.getRecentHistory(repo.path, 10);
  const history = (hist.ok ? hist.entries : []).map((e, i) => {
    let local;
    if (unpushed) local = unpushed.has(e.full); // precise: hash is ahead of upstream
    else if (!ab.hasUpstream) local = true; // no online line yet: nothing is uploaded
    else local = i < ab.ahead; // upstream exists but the lookup failed: best-effort (newest first)
    return { ...e, local };
  });

  // Local branches (for the version-line selector). Best-effort.
  const branches = await git.listBranches(repo.path);

  // Files changed online since the local version (for the simple "Online
  // project" area). Uses already-fetched info, so reflects the last check.
  const onlineFiles = ab.hasUpstream ? await git.getOnlineChanges(repo.path) : [];

  return {
    ok: true,
    repo: decorate(repo),
    details: {
      ...interpreted,
      branch,
      branches,
      upstream,
      onlineFiles,
      hasRemote: facts.hasRemote,
      remoteUrl: repo.remoteUrl,
      provider: urls.providerName(repo.remoteUrl),
      browserUrl: urls.toBrowserUrl(repo.remoteUrl),
      ahead: facts.ahead,
      behind: facts.behind,
      fetched,
      lastChecked: repo.lastChecked,
      working,
      staged,
      conflicted,
      history,
      counts: {
        working: working.length,
        staged: staged.length,
        conflicted: conflicted.length,
        history: history.length,
      },
      fetchError: fetchError ? friendlyError(fetchError) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Selection / staging actions (each only from an explicit user action in the UI)
// ---------------------------------------------------------------------------

/** Move specific files into "ready to save" (stage). */
async function stageFiles(id, paths) {
  const repo = findById(id);
  if (!repo) return notFound();
  const res = await git.stageFiles(repo.path, paths);
  return res.ok ? { ok: true } : { ok: false, error: friendlyError(res.errorCode, res.stderr) };
}

/** Move ALL changes into "ready to save" (never touches conflicted files). */
async function stageAll(id) {
  const repo = findById(id);
  if (!repo) return notFound();

  // If there are conflicts, `git add -A` would silently mark them resolved
  // (auto conflict resolution, which EasyGit must never do). In that case stage
  // only the explicit non-conflicted changed paths instead.
  const detailed = await git.getDetailedStatus(repo.path);
  if (detailed.ok && detailed.conflicted.length > 0) {
    const paths = [...new Set(detailed.working.map((f) => f.path))];
    if (paths.length === 0) return { ok: true };
    const res = await git.stageFiles(repo.path, paths);
    return res.ok ? { ok: true } : { ok: false, error: friendlyError(res.errorCode, res.stderr) };
  }

  const res = await git.stageAll(repo.path);
  return res.ok ? { ok: true } : { ok: false, error: friendlyError(res.errorCode, res.stderr) };
}

/** Move specific files back out of "ready to save" (unstage), completely. */
async function unstageFiles(id, paths) {
  const repo = findById(id);
  if (!repo) return notFound();

  // A staged rename is one item (new path) but git tracks it as delete(old) +
  // add(new). Restoring only the new path would leave the old path's deletion
  // staged, so also restore the original path for any selected rename/copy.
  const detailed = await git.getDetailedStatus(repo.path);
  const expanded = new Set(paths);
  if (detailed.ok) {
    for (const f of detailed.staged) {
      if ((f.type === 'renamed' || f.type === 'copied') && f.orig && paths.includes(f.path)) {
        expanded.add(f.orig);
      }
    }
  }
  const res = await git.unstageFiles(repo.path, [...expanded]);
  return res.ok ? { ok: true } : { ok: false, error: friendlyError(res.errorCode, res.stderr) };
}

/** Save a version from ONLY the ready-to-save (staged) changes. */
async function commitStaged(id, message) {
  const repo = findById(id);
  if (!repo) return notFound();
  if (!message || !message.trim()) {
    return { ok: false, error: { title: 'A short description is needed', detail: 'Please describe what this saved version contains.' } };
  }
  const detailed = await git.getDetailedStatus(repo.path);
  if (detailed.ok && detailed.staged.length === 0) {
    return { ok: false, error: { title: 'Nothing selected to save', detail: 'Move at least one change into “Ready to save” first.' } };
  }
  const res = await git.commitStaged(repo.path, message.trim());
  if (!res.ok) return { ok: false, error: friendlyError(res.errorCode, res.stderr) };
  return { ok: true, message: 'Your version was saved on this computer.' };
}

/**
 * Simple-mode "Upload my changes": the full safe flow in one step.
 *  - Conflicts -> stop (never auto-resolve).
 *  - No online project -> friendly error.
 *  - Local file changes -> save them (add -A + commit <message>) then upload.
 *  - No file changes but saved versions waiting -> just upload.
 *  - Nothing to upload -> "already uploaded".
 *
 * @param {string} id
 * @param {string} [message]  required only when there are local file changes
 */
async function uploadChanges(id, message) {
  const repo = findById(id);
  if (!repo) return notFound();

  const detailed = await git.getDetailedStatus(repo.path);
  if (detailed.ok && detailed.conflicted.length > 0) {
    return {
      ok: false,
      error: {
        title: 'Some files need attention',
        detail: 'Some files need attention before EasyGit can safely upload. Ask someone technical to help with this project.',
      },
    };
  }

  const remoteUrl = await git.getRemoteUrl(repo.path);
  if (!remoteUrl) {
    return { ok: false, error: { title: 'No online project', detail: 'This project is not connected to an online project yet.' } };
  }

  const hasFileChanges = detailed.ok && detailed.working.length + detailed.staged.length > 0;
  const upstream = await git.getUpstreamName(repo.path); // null when not linked online yet

  if (hasFileChanges) {
    if (!message || !message.trim()) {
      return { ok: false, error: { title: 'A short description is needed', detail: 'Please describe what you changed.' } };
    }
    // Save the changes (select all safe changes, then save a version).
    const staged = await stageAll(id); // conflict-safe (no conflicts here anyway)
    if (!staged.ok) return staged;
    const commit = await git.commitStaged(repo.path, message.trim());
    if (!commit.ok) return { ok: false, error: friendlyError(commit.errorCode, commit.stderr) };
  } else if (upstream) {
    // Linked online: we can tell when there is genuinely nothing to upload.
    const ab = await git.getAheadBehind(repo.path);
    if (ab.ahead === 0) {
      return { ok: true, noop: true, message: 'Everything is already uploaded.' };
    }
  }
  // If there is no online link yet, there are local versions never uploaded —
  // fall through and upload them (setting the link on first upload).

  // Upload (push). Set the online link on the first upload of a new line.
  const branch = await git.getCurrentBranch(repo.path);
  const res = upstream || !branch
    ? await git.push(repo.path)
    : await git.pushSetUpstream(repo.path, branch);
  if (!res.ok) return { ok: false, error: friendlyError(res.errorCode, res.stderr) };
  return {
    ok: true,
    message: hasFileChanges
      ? 'Your changes were saved and uploaded online.'
      : 'Your saved changes were uploaded online.',
  };
}

/**
 * Suggest a friendly change description from the changed files (read-only).
 * Looks only at file names + change types — never file contents, never network.
 * @param {string} id
 * @param {object} [options]
 * @param {boolean} [options.staged]  Base it on staged changes only (advanced).
 * @returns {Promise<{ok: boolean, message?: string, error?: string}>}
 *   error: 'not-found' | 'read' | 'none'
 */
async function suggestMessage(id, options = {}) {
  const repo = findById(id);
  if (!repo) return { ok: false, error: 'not-found' };

  const detailed = await git.getDetailedStatus(repo.path);
  if (!detailed.ok) return { ok: false, error: 'read' };

  let files;
  if (options.staged) {
    files = detailed.staged.slice();
  } else {
    // All local changes that will be uploaded (working + staged), de-duped.
    const byPath = new Map();
    [...detailed.staged, ...detailed.working].forEach((f) => {
      if (!byPath.has(f.path)) byPath.set(f.path, f);
    });
    files = [...byPath.values()];
  }

  if (files.length === 0) return { ok: false, error: 'none' };
  return { ok: true, message: suggester.suggestCommitMessage(files) };
}

/** Switch to another existing local version line (branch). Never creates/deletes. */
async function switchBranch(id, name) {
  const repo = findById(id);
  if (!repo) return notFound();
  const res = await git.switchBranch(repo.path, name);
  if (!res.ok) return { ok: false, error: friendlyError(res.errorCode, res.stderr) };
  return { ok: true, message: `You are now on version line “${name}”.` };
}

/** Resolve a repository's folder path (used by main to reveal a file). */
function getRepoPath(id) {
  const repo = findById(id);
  return repo ? repo.path : null;
}

/** Default user preferences, merged with any saved values. */
const DEFAULT_SETTINGS = {
  showVSCode: true,
  showAdvanced: false,
  showBranch: false,
  sortBy: 'attention',
  // Optional list organization – all OFF, so the list behaves exactly as before.
  organizeRepos: false, // master switch
  orgManualOrder: false, // drag projects into your own order
  orgGroups: false, // show projects in collapsible groups (EasyGit-only)
  orgCustomGroups: false, // create / rename / delete groups, move projects between them
  orgSuggestGroups: false, // suggest groups from shared parent folders
  theme: 'dark', // 'dark' | 'light'
  fontSize: 'normal', // 'normal' | 'large' | 'larger'
};

/** Load user preferences (simple/advanced mode, branch details). */
function getSettings() {
  return { ...DEFAULT_SETTINGS, ...storage.loadSettings() };
}

/** Persist user preferences and return the merged result. */
function setSettings(partial) {
  const merged = { ...getSettings(), ...(partial || {}) };
  storage.saveSettings(merged);
  return merged;
}

// ---------------------------------------------------------------------------
// List organization (custom order + groups). Pure EasyGit metadata keyed by
// repository id – it never touches folders on disk. The renderer owns the
// model (repoLayout.mjs); here we only store it safely and drop removed repos.
// ---------------------------------------------------------------------------

const MAX_GROUPS = 200;

/** Keep only the expected shape, with ids that still exist. */
function sanitizeLayout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const known = new Set(repos.map((r) => r.id));
  const ids = (list) => (Array.isArray(list) ? list.filter((id) => typeof id === 'string' && known.has(id)) : []);
  const groups = (Array.isArray(raw.groups) ? raw.groups : [])
    .filter((g) => g && typeof g.id === 'string' && g.id)
    .slice(0, MAX_GROUPS)
    .map((g) => ({
      id: g.id.slice(0, 80),
      name: String(g.name == null ? '' : g.name).slice(0, 60),
      collapsed: !!g.collapsed,
      repoIds: ids(g.repoIds),
    }));
  return {
    order: ids(raw.order),
    groups,
    ungroupedCollapsed: !!raw.ungroupedCollapsed,
    dismissedSuggestions: (Array.isArray(raw.dismissedSuggestions) ? raw.dismissedSuggestions : [])
      .filter((s) => typeof s === 'string')
      .slice(-500),
  };
}

/** The saved list organization, or null if the user never organized anything. */
function getLayout() {
  return sanitizeLayout(storage.loadLayout());
}

/** Save the list organization and return what was stored. */
function setLayout(layout) {
  const clean = sanitizeLayout(layout);
  storage.saveLayout(clean);
  return clean;
}

/** Forget removed repositories in the saved organization (if there is one). */
function pruneLayout() {
  const saved = storage.loadLayout();
  if (saved) storage.saveLayout(sanitizeLayout(saved));
}

function notFound() {
  return { ok: false, error: { title: 'Not found', detail: 'That repository is no longer in your list.' } };
}

// ---------------------------------------------------------------------------
// Actions – only ever triggered by an explicit user button click in the UI.
// ---------------------------------------------------------------------------

/**
 * "Save a version" -> stage everything and commit.
 * @param {string} id
 * @param {string} message  the user's description of this version
 */
async function saveVersion(id, message) {
  const repo = findById(id);
  if (!repo) return { ok: false, error: { title: 'Not found', detail: 'That repository is no longer in your list.' } };

  if (!message || !message.trim()) {
    return { ok: false, error: { title: 'A short description is needed', detail: 'Please describe what this saved version contains.' } };
  }

  // Nothing to save?
  const local = await git.getLocalChanges(repo.path);
  if (local.ok && local.files.length === 0) {
    return { ok: false, error: { title: 'Nothing to save', detail: 'There are no changes to save.' } };
  }

  const res = await git.commitAll(repo.path, message.trim());
  if (!res.ok) {
    return { ok: false, error: friendlyError(res.errorCode, res.stderr) };
  }
  return { ok: true, message: 'Your version was saved on this computer.' };
}

/**
 * "Download latest version" -> pull.
 * @param {string} id
 */
async function download(id) {
  const repo = findById(id);
  if (!repo) return { ok: false, error: { title: 'Not found', detail: 'That repository is no longer in your list.' } };

  const remoteUrl = await git.getRemoteUrl(repo.path);
  if (!remoteUrl) {
    return { ok: false, error: friendlyError(git.GitErrorCode.NO_REMOTE) };
  }

  const res = await git.pull(repo.path);
  if (!res.ok) {
    return { ok: false, error: friendlyError(res.errorCode, res.stderr) };
  }
  return { ok: true, message: 'You now have the latest version from online.' };
}

/**
 * "Upload my saved changes" -> push.
 * @param {string} id
 */
async function upload(id) {
  const repo = findById(id);
  if (!repo) return { ok: false, error: { title: 'Not found', detail: 'That repository is no longer in your list.' } };

  const remoteUrl = await git.getRemoteUrl(repo.path);
  if (!remoteUrl) {
    return { ok: false, error: friendlyError(git.GitErrorCode.NO_REMOTE) };
  }

  const res = await git.push(repo.path);
  if (!res.ok) {
    return { ok: false, error: friendlyError(res.errorCode, res.stderr) };
  }
  return { ok: true, message: 'Your saved changes were uploaded to the online repository.' };
}

/**
 * Whether the user has unsaved local changes (used to warn before download).
 * @param {string} id
 */
async function hasUnsavedChanges(id) {
  const repo = findById(id);
  if (!repo) return false;
  const local = await git.getLocalChanges(repo.path);
  return local.ok && local.files.length > 0;
}

module.exports = {
  load,
  listRepos,
  addRepo,
  addManyRepos,
  cloneRepo,
  suggestFolderName,
  removeRepo,
  removeAllRepos,
  renameRepo,
  scan,
  autoScan,
  checkStatus,
  saveVersion,
  stageFiles,
  stageAll,
  unstageFiles,
  commitStaged,
  uploadChanges,
  suggestMessage,
  switchBranch,
  download,
  upload,
  hasUnsavedChanges,
  getRepoPath,
  getSettings,
  setSettings,
  getLayout,
  setLayout,
  getStoragePath: storage.getStoragePath,
};
