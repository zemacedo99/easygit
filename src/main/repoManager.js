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

const git = require('./gitService');
const storage = require('./storage');
const scanner = require('./scanner');
const interpreter = require('./statusInterpreter');
const { Status, STATUS_INFO, friendlyError } = require('./messages');
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
    return { ok: true };
  }
  return { ok: false };
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

  // Local changes
  const local = await git.getLocalChanges(repo.path);

  // Optionally refresh online info first.
  let fetched = false;
  let fetchError = null;
  if (options.fetch && repo.remoteUrl) {
    const f = await git.fetch(repo.path);
    fetched = f.ok;
    if (!f.ok) fetchError = f.errorCode;
  }

  // Ahead / behind vs the online version line.
  const ab = await git.getAheadBehind(repo.path);

  const facts = {
    hasRemote: !!repo.remoteUrl,
    hasUpstream: ab.hasUpstream,
    localChangeCount: local.ok ? local.files.length : 0,
    ahead: ab.ahead,
    behind: ab.behind,
    fetched,
  };

  const interpreted = interpreter.interpret(facts);

  repo.lastStatus = interpreted.status;
  repo.lastChecked = new Date().toISOString();
  persist();

  // Recent history is a nice-to-have; ignore failures.
  const history = await git.getRecentHistory(repo.path, 5);

  return {
    ok: true,
    repo: decorate(repo),
    details: {
      ...interpreted,
      branch,
      files: local.ok ? local.files : [],
      history: history.ok ? history.entries : [],
      ahead: facts.ahead,
      behind: facts.behind,
      fetchError: fetchError ? friendlyError(fetchError) : null,
    },
  };
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
  removeRepo,
  renameRepo,
  scan,
  autoScan,
  checkStatus,
  saveVersion,
  download,
  upload,
  hasUnsavedChanges,
  getStoragePath: storage.getStoragePath,
};
