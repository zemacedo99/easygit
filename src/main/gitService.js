'use strict';

/**
 * gitService.js
 * -------------
 * The ONLY place in the app that actually runs Git commands.
 *
 * Responsibilities:
 *   - Run a git command safely (no shell injection) inside a given repo folder.
 *   - Capture stdout, stderr, exit code, and enforce a timeout.
 *   - Classify common Git failures into stable error codes so the rest of the
 *     app can translate them into friendly messages (see statusInterpreter.js
 *     and messages.js).
 *
 * IMPORTANT: This module knows nothing about the UI. It returns plain data.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Default timeout for a single git command (ms). Network commands (fetch/pull/
// push) get a longer timeout passed in by the caller.
const DEFAULT_TIMEOUT_MS = 20000;
const NETWORK_TIMEOUT_MS = 60000;

/**
 * Stable error codes used across the app. The UI never sees these directly;
 * they are mapped to friendly text in messages.js.
 */
const GitErrorCode = {
  GIT_NOT_INSTALLED: 'GIT_NOT_INSTALLED',
  FOLDER_NOT_FOUND: 'FOLDER_NOT_FOUND',
  NOT_A_REPO: 'NOT_A_REPO',
  NO_REMOTE: 'NO_REMOTE',
  NO_UPSTREAM: 'NO_UPSTREAM',
  AUTH_FAILED: 'AUTH_FAILED',
  NETWORK_UNAVAILABLE: 'NETWORK_UNAVAILABLE',
  PULL_CONFLICT: 'PULL_CONFLICT',
  PUSH_REJECTED: 'PUSH_REJECTED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Run a single git command.
 *
 * @param {string} repoPath  Absolute path the command runs in (cwd).
 * @param {string[]} args    Git arguments, e.g. ['status', '--porcelain'].
 * @param {object} [options]
 * @param {number} [options.timeout]   Override timeout in ms.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, code: number|null, errorCode: string|null}>}
 *
 * This NEVER throws for a "git said no" situation; it resolves with ok:false
 * and an errorCode. It only rejects for truly unexpected programming errors.
 */
function runGit(repoPath, args, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    // execFile (not exec) means args are passed as an array and never go through
    // a shell, so a folder name with spaces or special characters is harmless.
    execFile(
      'git',
      args,
      {
        cwd: repoPath,
        timeout,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024, // 10 MB – plenty for status/log output
        // Force English output so our text-matching for error classification is
        // stable regardless of the user's system language.
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      },
      (error, stdout, stderr) => {
        const out = (stdout || '').toString();
        const err = (stderr || '').toString();

        if (!error) {
          resolve({ ok: true, stdout: out, stderr: err, code: 0, errorCode: null });
          return;
        }

        // Timed out
        if (error.killed && error.signal === 'SIGTERM') {
          resolve({ ok: false, stdout: out, stderr: err, code: null, errorCode: GitErrorCode.TIMEOUT });
          return;
        }

        // git binary missing entirely
        if (error.code === 'ENOENT') {
          resolve({ ok: false, stdout: out, stderr: err, code: null, errorCode: GitErrorCode.GIT_NOT_INSTALLED });
          return;
        }

        const exitCode = typeof error.code === 'number' ? error.code : null;
        resolve({
          ok: false,
          stdout: out,
          stderr: err,
          code: exitCode,
          errorCode: classifyError(err + '\n' + out, args),
        });
      }
    );
  });
}

/**
 * Inspect git's stderr/stdout and figure out which well-known failure happened.
 * Order matters: more specific checks first.
 *
 * @param {string} text  Combined stderr + stdout (lowercased internally).
 * @param {string[]} args  The git args, used to disambiguate (e.g. push vs pull).
 * @returns {string} a GitErrorCode value
 */
function classifyError(text, args = []) {
  const t = (text || '').toLowerCase();

  if (t.includes('not a git repository')) return GitErrorCode.NOT_A_REPO;

  if (
    t.includes('authentication failed') ||
    t.includes('could not read username') ||
    t.includes('could not read password') ||
    t.includes('permission denied (publickey)') ||
    t.includes('invalid username or password') ||
    t.includes('access denied')
  ) {
    return GitErrorCode.AUTH_FAILED;
  }

  if (
    t.includes('could not resolve host') ||
    t.includes('could not resolve hostname') ||
    t.includes('network is unreachable') ||
    t.includes('failed to connect') ||
    t.includes('connection timed out') ||
    t.includes('temporary failure in name resolution') ||
    t.includes('unable to access')
  ) {
    return GitErrorCode.NETWORK_UNAVAILABLE;
  }

  if (
    t.includes('no such remote') ||
    t.includes("'origin' does not appear to be a git repository") ||
    t.includes('no configured push destination') ||
    t.includes('does not appear to be a git repository')
  ) {
    return GitErrorCode.NO_REMOTE;
  }

  if (
    t.includes('no upstream') ||
    t.includes('no tracking information') ||
    t.includes('there is no tracking information')
  ) {
    return GitErrorCode.NO_UPSTREAM;
  }

  // Pull conflicts / merge problems
  if (
    t.includes('conflict') ||
    t.includes('would be overwritten by merge') ||
    t.includes('automatic merge failed') ||
    t.includes('needs merge') ||
    t.includes('overwritten by checkout')
  ) {
    return GitErrorCode.PULL_CONFLICT;
  }

  // Push rejected (remote moved on, non-fast-forward)
  const isPush = args[0] === 'push';
  if (isPush && (t.includes('rejected') || t.includes('non-fast-forward') || t.includes('fetch first'))) {
    return GitErrorCode.PUSH_REJECTED;
  }

  return GitErrorCode.UNKNOWN;
}

/**
 * Is the `git` executable available on this machine?
 * @returns {Promise<{installed: boolean, version: string|null}>}
 */
async function checkGitInstalled() {
  const res = await runGit(process.cwd(), ['--version']);
  if (res.ok) {
    return { installed: true, version: res.stdout.trim() };
  }
  return { installed: false, version: null };
}

/**
 * Quick check that a folder exists AND is (or is inside) a git repository.
 * Uses the filesystem first (fast) and confirms with git.
 *
 * @param {string} folderPath
 * @returns {Promise<{isRepo: boolean, errorCode: string|null}>}
 */
async function isGitRepo(folderPath) {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { isRepo: false, errorCode: GitErrorCode.FOLDER_NOT_FOUND };
  }
  if (!fs.statSync(folderPath).isDirectory()) {
    return { isRepo: false, errorCode: GitErrorCode.FOLDER_NOT_FOUND };
  }

  // Ask git directly – this also accepts a sub-folder of a repo and worktrees.
  const res = await runGit(folderPath, ['rev-parse', '--is-inside-work-tree']);
  if (res.ok && res.stdout.trim() === 'true') {
    return { isRepo: true, errorCode: null };
  }
  return { isRepo: false, errorCode: GitErrorCode.NOT_A_REPO };
}

// ---------------------------------------------------------------------------
// Higher-level helpers that wrap specific git commands. Each returns plain data
// and an ok flag. repoManager.js composes these.
// ---------------------------------------------------------------------------

/** Current branch name, or '' when in a detached HEAD state. */
async function getCurrentBranch(repoPath) {
  const res = await runGit(repoPath, ['branch', '--show-current']);
  return res.ok ? res.stdout.trim() : '';
}

/** The origin remote URL, or null when there is no remote configured. */
async function getRemoteUrl(repoPath) {
  const res = await runGit(repoPath, ['remote', 'get-url', 'origin']);
  if (res.ok) return res.stdout.trim();
  return null;
}

/**
 * Porcelain status -> list of changed files with a simple, friendly category.
 * @returns {Promise<{ok: boolean, files: Array<{path: string, kind: string}>, errorCode: string|null}>}
 */
async function getLocalChanges(repoPath) {
  const res = await runGit(repoPath, ['status', '--porcelain']);
  if (!res.ok) return { ok: false, files: [], errorCode: res.errorCode };

  const files = res.stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0)
    .map((line) => {
      const code = line.slice(0, 2);
      const filePath = line.slice(3);
      return { path: filePath, kind: describeChange(code) };
    });

  return { ok: true, files, errorCode: null };
}

/** Translate a porcelain 2-char code into a plain-English change kind. */
function describeChange(code) {
  if (code.includes('?')) return 'New file (not tracked yet)';
  if (code.includes('A')) return 'Added';
  if (code.includes('D')) return 'Deleted';
  if (code.includes('R')) return 'Renamed';
  if (code.includes('M')) return 'Edited';
  if (code.includes('U')) return 'Needs attention (conflict)';
  return 'Changed';
}

/**
 * Compare local branch against its upstream (online) counterpart.
 * @returns {Promise<{ok: boolean, hasUpstream: boolean, ahead: number, behind: number, errorCode: string|null}>}
 */
async function getAheadBehind(repoPath) {
  const res = await runGit(repoPath, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (!res.ok) {
    // No upstream is an expected, non-fatal situation.
    if (res.errorCode === GitErrorCode.NO_UPSTREAM || res.errorCode === GitErrorCode.NO_REMOTE) {
      return { ok: true, hasUpstream: false, ahead: 0, behind: 0, errorCode: null };
    }
    return { ok: false, hasUpstream: false, ahead: 0, behind: 0, errorCode: res.errorCode };
  }
  // Output is "<ahead>\t<behind>"
  const parts = res.stdout.trim().split(/\s+/);
  const ahead = parseInt(parts[0], 10) || 0;
  const behind = parseInt(parts[1], 10) || 0;
  return { ok: true, hasUpstream: true, ahead, behind, errorCode: null };
}

/**
 * Fetch from all remotes (downloads online info but changes nothing locally).
 * @returns {Promise<{ok: boolean, errorCode: string|null}>}
 */
async function fetch(repoPath) {
  const res = await runGit(repoPath, ['fetch', '--all', '--prune'], { timeout: NETWORK_TIMEOUT_MS });
  return { ok: res.ok, errorCode: res.errorCode };
}

/**
 * Recent history as a short, friendly list.
 * @returns {Promise<{ok: boolean, entries: Array<{hash: string, when: string, author: string, subject: string}>}>}
 */
async function getRecentHistory(repoPath, limit = 5) {
  // Use a unit-separator-delimited format so subjects with weird chars are safe.
  const fmt = '%h\x1f%cr\x1f%an\x1f%s';
  const res = await runGit(repoPath, ['log', `-n${limit}`, `--pretty=format:${fmt}`]);
  if (!res.ok) return { ok: false, entries: [] };

  const entries = res.stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter(Boolean)
    .map((line) => {
      const [hash, when, author, subject] = line.split('\x1f');
      return { hash, when, author, subject };
    });
  return { ok: true, entries };
}

// --- Action commands (only ever called from an explicit user button click) ---

/** Stage everything and commit with a message. */
async function commitAll(repoPath, message) {
  const add = await runGit(repoPath, ['add', '-A']);
  if (!add.ok) return { ok: false, stage: 'add', errorCode: add.errorCode, stderr: add.stderr };

  const commit = await runGit(repoPath, ['commit', '-m', message]);
  if (!commit.ok) return { ok: false, stage: 'commit', errorCode: commit.errorCode, stderr: commit.stderr };

  return { ok: true, stage: 'commit', errorCode: null, stdout: commit.stdout };
}

/** Pull (download + merge) from the online repository. */
async function pull(repoPath) {
  const res = await runGit(repoPath, ['pull'], { timeout: NETWORK_TIMEOUT_MS });
  return { ok: res.ok, errorCode: res.errorCode, stdout: res.stdout, stderr: res.stderr };
}

/** Push (upload) saved versions to the online repository. */
async function push(repoPath) {
  const res = await runGit(repoPath, ['push'], { timeout: NETWORK_TIMEOUT_MS });
  return { ok: res.ok, errorCode: res.errorCode, stdout: res.stdout, stderr: res.stderr };
}

module.exports = {
  GitErrorCode,
  runGit,
  classifyError,
  checkGitInstalled,
  isGitRepo,
  getCurrentBranch,
  getRemoteUrl,
  getLocalChanges,
  getAheadBehind,
  fetch,
  getRecentHistory,
  commitAll,
  pull,
  push,
  // exposed for callers that want to name a folder
  basename: (p) => path.basename(p),
};
