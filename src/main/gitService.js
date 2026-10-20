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
        maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
        // Force English output so our text-matching for error classification is
        // stable regardless of the user's system language. Callers may add extra
        // env vars (e.g. GIT_TERMINAL_PROMPT) via options.env.
        env: { ...process.env, LC_ALL: 'C', LANG: 'C', ...(options.env || {}) },
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
 * @returns {Promise<{ok: boolean, entries: Array<{full: string, hash: string, when: string, author: string, subject: string}>}>}
 */
async function getRecentHistory(repoPath, limit = 5) {
  // Use a unit-separator-delimited format so subjects with weird chars are safe.
  // %H = full hash (used to match against unpushed commits), %h = short hash.
  const fmt = '%H\x1f%h\x1f%cr\x1f%an\x1f%s';
  const res = await runGit(repoPath, ['log', `-n${limit}`, `--pretty=format:${fmt}`]);
  if (!res.ok) return { ok: false, entries: [] };

  const entries = res.stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter(Boolean)
    .map((line) => {
      const [full, hash, when, author, subject] = line.split('\x1f');
      return { full, hash, when, author, subject };
    });
  return { ok: true, entries };
}

/**
 * Detailed working/index status using porcelain v1 with NUL separators so file
 * names with spaces or unusual characters are handled safely. Splits changes
 * into three buckets so the UI can show "this computer" vs "ready to save" vs
 * "needs attention".
 *
 * @param {string} repoPath
 * @param {{untrackedFiles?: boolean}} [options]  untrackedFiles: list every new
 *   file inside new folders (by default Git shows a new folder as one "folder/" entry)
 * @returns {Promise<{ok: boolean, staged: object[], working: object[], conflicted: object[], errorCode: string|null}>}
 *   staged/working items: { path, type, orig? }   conflicted items: { path }
 */
async function getDetailedStatus(repoPath, options = {}) {
  const args = ['status', '--porcelain=v1', '-z'];
  if (options.untrackedFiles) args.push('--untracked-files=all');
  const res = await runGit(repoPath, args);
  if (!res.ok) return { ok: false, staged: [], working: [], conflicted: [], errorCode: res.errorCode };

  const staged = [];
  const working = [];
  const conflicted = [];

  const tokens = res.stdout.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry || entry.length < 3) continue;

    const x = entry[0];
    const y = entry[1];
    const code = x + y;
    const filePath = entry.slice(3);

    // Renames / copies in the index carry a second token: the original path.
    let orig = null;
    if (x === 'R' || x === 'C') {
      orig = tokens[i + 1] || null;
      i++; // consume the original-path token
    }

    // Unmerged / conflicting entries (a person must resolve these).
    if (code === 'DD' || code === 'AA' || x === 'U' || y === 'U') {
      conflicted.push({ path: filePath });
      continue;
    }

    // Untracked (brand new) file.
    if (code === '??') {
      working.push({ path: filePath, type: 'untracked' });
      continue;
    }

    // Ignored files never appear without --ignored, but guard anyway.
    if (code === '!!') continue;

    // X = staged side, Y = working-tree side. A file can be in both.
    if (x !== ' ' && x !== '?') {
      staged.push({ path: filePath, type: mapStatusCode(x), orig });
    }
    if (y !== ' ' && y !== '?') {
      working.push({ path: filePath, type: mapStatusCode(y), orig });
    }
  }

  return { ok: true, staged, working, conflicted, errorCode: null };
}

/** Map a single porcelain status letter to a friendly change-type code. */
function mapStatusCode(c) {
  switch (c) {
    case 'A': return 'added';
    case 'M': return 'modified';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'copied';
    case 'T': return 'typechange';
    default: return 'modified';
  }
}

/** The upstream (online) branch name, e.g. "origin/main", or null if none. */
async function getUpstreamName(repoPath) {
  const res = await runGit(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return res.ok ? res.stdout.trim() : null;
}

/**
 * Full hashes of local commits that have NOT been uploaded yet (ahead of
 * upstream). Returns null when there is no upstream to compare against.
 * @returns {Promise<Set<string>|null>}
 */
async function getUnpushedHashes(repoPath) {
  const res = await runGit(repoPath, ['rev-list', '@{u}..HEAD']);
  if (!res.ok) return null;
  return new Set(res.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
}

/** Local branch names (current line of work + others). */
async function listBranches(repoPath) {
  const res = await runGit(repoPath, ['branch', '--format=%(refname:short)']);
  if (!res.ok) return [];
  return res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Files that changed ONLINE since the local version, using already-fetched info
 * (no network): git diff --name-status HEAD..@{u}. Returns [] when there is no
 * upstream to compare against.
 * @returns {Promise<Array<{path: string, type: string}>>}
 */
async function getOnlineChanges(repoPath) {
  const res = await runGit(repoPath, ['diff', '--name-status', '-z', 'HEAD..@{u}']);
  if (!res.ok) return [];

  const tokens = res.stdout.split('\0').filter((t) => t.length > 0);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++];
    const code = status[0];
    if (code === 'R' || code === 'C') {
      i++; // skip the old path
      const newPath = tokens[i++];
      if (newPath) out.push({ path: newPath, type: code === 'R' ? 'renamed' : 'copied' });
    } else {
      const p = tokens[i++];
      if (p) out.push({ path: p, type: mapStatusCode(code) });
    }
  }
  return out;
}

// --- Staging / selection commands (always from an explicit user action) ------

/** Move specific files into "ready to save" (stage). Handles deletes too. */
async function stageFiles(repoPath, paths) {
  if (!paths || paths.length === 0) return { ok: false, errorCode: GitErrorCode.UNKNOWN };
  const res = await runGit(repoPath, ['add', '--', ...paths]);
  return { ok: res.ok, errorCode: res.errorCode, stderr: res.stderr };
}

/** Stage everything ("select all changes to save"). */
async function stageAll(repoPath) {
  const res = await runGit(repoPath, ['add', '-A']);
  return { ok: res.ok, errorCode: res.errorCode, stderr: res.stderr };
}

/** Move specific files back out of "ready to save" (unstage), non-destructively. */
async function unstageFiles(repoPath, paths) {
  if (!paths || paths.length === 0) return { ok: false, errorCode: GitErrorCode.UNKNOWN };
  // `git restore --staged` (Git 2.23+) only touches the index, never the file.
  let res = await runGit(repoPath, ['restore', '--staged', '--', ...paths]);
  if (!res.ok) {
    // Fallback for very old Git: reset only the index entry (also non-destructive).
    res = await runGit(repoPath, ['reset', '-q', 'HEAD', '--', ...paths]);
  }
  return { ok: res.ok, errorCode: res.errorCode, stderr: res.stderr };
}

/** Commit ONLY what is staged (does not touch unstaged changes). */
async function commitStaged(repoPath, message) {
  const res = await runGit(repoPath, ['commit', '-m', message]);
  return { ok: res.ok, errorCode: res.errorCode, stdout: res.stdout, stderr: res.stderr };
}

/** Switch to an existing local branch (never creates or deletes). */
async function switchBranch(repoPath, name) {
  const res = await runGit(repoPath, ['checkout', name]);
  return { ok: res.ok, errorCode: res.errorCode, stderr: res.stderr };
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

/**
 * First upload of a branch that isn't linked online yet: push and set the
 * online link (git push -u origin <branch>). Non-destructive.
 */
async function pushSetUpstream(repoPath, branch) {
  const res = await runGit(repoPath, ['push', '-u', 'origin', branch], { timeout: NETWORK_TIMEOUT_MS });
  return { ok: res.ok, errorCode: res.errorCode, stdout: res.stdout, stderr: res.stderr };
}

/**
 * Clone an online repository into a NEW local folder.
 *
 * Runs via execFile with an argument array (never a shell string). The leading
 * `--` stops a hostile URL that starts with `-` from being read as an option.
 * GIT_TERMINAL_PROMPT=0 disables Git's interactive credential prompt, so a
 * private repo without saved credentials fails fast instead of hanging — the
 * user's existing SSH keys / credential helpers still work normally. EasyGit
 * never asks for or stores credentials.
 *
 * @param {string} url         repository link (https / ssh / scp-style)
 * @param {string} targetPath  absolute path of the NEW folder to create
 * @param {string} [cwd]       working directory (the destination's parent)
 * @returns {Promise<{ok: boolean, errorCode: string|null, stderr: string}>}
 */
async function clone(url, targetPath, cwd) {
  const res = await runGit(cwd || process.cwd(), ['clone', '--', String(url), String(targetPath)], {
    timeout: 10 * 60 * 1000, // clones can be large / slow
    env: { GIT_TERMINAL_PROMPT: '0' },
  });
  return { ok: res.ok, errorCode: res.errorCode, stderr: res.stderr };
}

// Detailed-mode queries are lazy. Accept full object IDs only, never revision
// expressions or command options supplied by the renderer.
const validOid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
const detailError = detail => ({ ok: false, error: { title: 'Could not complete this action', detail } });

function parseChangedFiles(output) {
  const tokens = output.split('\0');
  const files = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++];
    if (!status) continue;
    const first = tokens[i++];
    const renamed = /^[RC]/.test(status);
    const next = renamed ? tokens[i++] : first;
    if (next) files.push({ path: next, type: mapStatusCode(status[0]), ...(renamed ? { orig: first } : {}) });
  }
  return files;
}

async function commitFiles(root, oid) {
  if (!validOid(oid)) return detailError('Choose a saved version from the list.');
  const result = await runGit(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', '--name-status', '--diff-merges=first-parent', '-M', '-z', oid, '--']);
  if (!result.ok) return detailError('The changed-file list could not be read. Try checking this project again.');
  // Inspect merge commits relative to their first parent, matching the viewer.
  return { ok: true, files: [...new Map(parseChangedFiles(result.stdout).map(f => [f.path, f])).values()] };
}

async function commitDiff(root, oid, file, requestedLimit = 600) {
  if (!validOid(oid) || typeof file !== 'string' || file.includes('\0')) return detailError('Choose a file from a saved version.');
  const changed = await commitFiles(root, oid);
  if (!changed.ok) return changed;
  const entry = changed.files.find(f => f.path === file);
  if (!entry) return detailError('This file is not part of that saved version.');
  const parents = await runGit(root, ['rev-list', '--parents', '-n', '1', oid, '--']);
  if (!parents.ok) return detailError('This saved version could not be read.');
  const parent = parents.stdout.trim().split(/\s+/)[1];
  if (parent && !validOid(parent)) return detailError('This saved version could not be read.');
  // Compare trees explicitly: path-filtered git show can simplify a merge away.
  const command = parent ? ['diff'] : ['show', '--format='];
  const revisions = parent ? [parent, oid] : [oid];
  const result = await runGit(root, ['--literal-pathspecs', ...command, '--patch', '--no-ext-diff', '--no-textconv',
    '--no-color', '--unified=3', '-M', ...revisions, '--', ...new Set([entry.orig, file].filter(Boolean))], { maxBuffer: 2 * 1024 * 1024 });
  if (!result.ok) return detailError('This diff is too large or could not be read. Open the project in your editor to inspect it.');
  const binary = /^(Binary files .* differ|GIT binary patch)$/m.test(result.stdout);
  const limit = Math.min(10000, Math.max(100, Number(requestedLimit) || 600));
  const lines = result.stdout.split('\n');
  return { ok: true, binary, text: binary ? '' : lines.slice(0, limit).join('\n'), truncated: !binary && lines.length > limit, limit };
}

async function stashList(root) {
  const result = await runGit(root, ['stash', 'list', '--format=%H%x00%gd%x00%cI%x00%gs']);
  if (!result.ok) return detailError('The work set aside could not be read.');
  return { ok: true, entries: result.stdout.split('\n').filter(Boolean).map(line => {
    const [oid, ref, when, ...subject] = line.replace(/\r$/, '').split('\0');
    return { oid, ref, when, subject: subject.join(' ') };
  }) };
}

async function stashFiles(root, oid) {
  if (!validOid(oid)) return detailError('Choose work from the stack.');
  const list = await stashList(root);
  if (!list.ok || !list.entries.some(e => e.oid === oid)) return detailError('The stack changed. Refresh it and choose again.');
  const result = await runGit(root, ['stash', 'show', '--include-untracked', '--name-status', '-z', oid]);
  return result.ok ? { ok: true, files: parseChangedFiles(result.stdout) } : detailError('The files in this entry could not be read.');
}

// Serialize stack operations from EasyGit. Entries are identified by object ID
// and resolved to their current stack reference immediately before pop.
const stashLocks = new Set();
async function stashChange(root, operation, value) {
  if (stashLocks.has(root)) return detailError('Another stack action is running. Please wait.');
  stashLocks.add(root);
  try {
    const status = await getDetailedStatus(root);
    if (!status.ok || status.conflicted.length) return detailError('Some files need attention. Resolve them before changing the stack.');
    let args;
    if (operation === 'push') {
      if (!status.working.length && !status.staged.length) return detailError('There are no changes to set aside.');
      if (typeof value !== 'string' || value.length > 500 || value.includes('\0')) return detailError('Use a short description for this work.');
      args = ['stash', 'push', '--include-untracked', '-m', value.trim() || 'Work set aside in EasyGit'];
    } else if (operation === 'pop' && validOid(value)) {
      if (status.working.length || status.staged.length) return detailError('Save or set aside your current changes before restoring this work.');
      const list = await stashList(root);
      const entry = list.ok && list.entries.find(e => e.oid === value);
      if (!entry || !/^stash@\{\d+\}$/.test(entry.ref)) return detailError('The stack changed. Refresh it and choose again.');
      args = ['stash', 'pop', '--index', entry.ref];
    } else return detailError('Choose a valid stack action.');
    const result = await runGit(root, args);
    if (!result.ok) return detailError(operation === 'pop'
      ? 'Some files could not be restored automatically. The stack entry is kept. Check the files needing attention; EasyGit will not resolve or delete anything automatically.'
      : 'The changes could not be set aside. Check the project before trying again.');
    return { ok: true, message: operation === 'pop' ? 'Changes restored. The entry was removed from the stack.' : 'Changes set aside, including new files. Ignored files stay here.' };
  } finally { stashLocks.delete(root); }
}

module.exports = {
  commitFiles, commitDiff, stashList, stashFiles, stashChange, parseChangedFiles,
  GitErrorCode,
  runGit,
  classifyError,
  checkGitInstalled,
  isGitRepo,
  getCurrentBranch,
  getRemoteUrl,
  getLocalChanges,
  getDetailedStatus,
  getAheadBehind,
  getUpstreamName,
  getUnpushedHashes,
  listBranches,
  getOnlineChanges,
  fetch,
  getRecentHistory,
  commitAll,
  stageFiles,
  stageAll,
  unstageFiles,
  commitStaged,
  switchBranch,
  pull,
  push,
  pushSetUpstream,
  clone,
  // exposed for callers that want to name a folder
  basename: (p) => path.basename(p),
};
