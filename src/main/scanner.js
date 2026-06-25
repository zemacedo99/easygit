'use strict';

/**
 * scanner.js
 * ----------
 * Finds Git repositories on disk by detecting folders that contain a `.git`
 * entry (a `.git` directory for normal repos, or a `.git` FILE that points to a
 * real git directory for worktrees / submodules).
 *
 * Design goals:
 *   - Never scan the whole drive blindly. Scan a set of likely root folders.
 *   - Be cancellable and report progress, without freezing the app: the walk is
 *     asynchronous and yields to the event loop regularly so the main process
 *     can flush progress events and observe a cancel request.
 *   - Be resilient: a folder we cannot read is recorded and skipped, never
 *     crashes the scan.
 *   - Be fast: skip huge / system folders, limit depth, and cap total folders.
 *
 * Knows nothing about the UI. Returns plain data.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Folders we never look inside – large, system, or irrelevant. Compared
 * case-insensitively (stored lower-cased) so "AppData", "appdata", "Program
 * Files" etc. all match regardless of how the filesystem reports them.
 */
const IGNORED_DIR_NAMES = new Set(
  [
    // version-control internals
    '.git', '.svn', '.hg',
    // dependency / build output
    'node_modules', 'bower_components', 'vendor',
    'venv', '.venv', '__pycache__',
    'bin', 'obj', 'dist', 'build', 'out', 'target',
    '.cache', '.gradle', '.nuget',
    // editors / tooling
    '.idea', '.vs', '.vscode',
    // OS / system folders (Windows + general)
    'appdata', 'application data', 'programdata',
    'program files', 'program files (x86)',
    'windows', '$recycle.bin',
    'system volume information', 'recovery',
    '$windows.~bs', '$windows.~ws',
  ].map((s) => s.toLowerCase())
);

/** How deep each scan style is allowed to recurse (depth is per root). */
const DEPTH = {
  quick: 5,
  deeper: 6,
  custom: 8,
};

/** Default safety cap on the total number of folders visited in one scan. */
const MAX_FOLDERS = 60000;

/** Folder names commonly used to hold code projects (checked under each base). */
const DEV_FOLDER_NAMES = [
  'source', 'Source', 'src',
  'repos', 'Repos', 'repositories',
  'Projects', 'projects',
  'Development', 'development', 'dev',
  'Git', 'git',
  'code', 'Code',
  'workspace', 'Workspace',
  'GitHub', 'GitLab',
];

/**
 * Normalise a path for reliable duplicate detection. Resolves to an absolute
 * path, removes any trailing separators, and lower-cases it (EasyGit targets
 * Windows, whose filesystem is case-insensitive).
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

/** True if `p` exists and is a directory (never throws). */
function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

/**
 * True if `p` is a filesystem/drive root such as "C:\\", "D:\\" or "/". Used to
 * make sure an automatic scan never starts at a drive root (which would walk the
 * whole disk). The explicit "Choose a folder" preset is allowed to do so.
 * @param {string} p
 */
function isFilesystemRoot(p) {
  const resolved = path.resolve(p);
  return path.parse(resolved).root === resolved;
}

/**
 * Read the first bytes of a `.git` file to confirm it really points to a git
 * directory (worktrees / submodules use `gitdir: <path>`).
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function looksLikeGitDirFile(filePath) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buf, 0, 64, 0);
    return buf.slice(0, bytesRead).toString('utf8').startsWith('gitdir:');
  } catch (e) {
    return false;
  } finally {
    if (handle) {
      try { await handle.close(); } catch (e) { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Candidate root locations
// ---------------------------------------------------------------------------

/** The user's home folder plus any OneDrive-redirected bases. */
function knownBases() {
  const bases = [os.homedir()];
  for (const key of ['USERPROFILE', 'OneDrive', 'OneDriveConsumer', 'OneDriveCommercial', 'HOME']) {
    if (process.env[key]) bases.push(process.env[key]);
  }
  return [...new Set(bases.filter(Boolean))];
}

/** Keep only existing directories, de-duplicated by normalised path. */
function uniqueExistingDirs(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p) continue;
    const resolved = path.resolve(p);
    const n = normalizePath(resolved);
    if (seen.has(n)) continue;
    if (!isDirectory(resolved)) continue;
    seen.add(n);
    out.push(resolved);
  }
  return out;
}

/**
 * Drop any root that lives inside another root, so we never scan the same tree
 * twice (e.g. keep `C:\Users\me` and drop `C:\Users\me\Documents`).
 * @param {string[]} roots
 * @returns {string[]}
 */
function dropNestedRoots(roots) {
  const items = roots
    .map((r) => ({ raw: r, n: normalizePath(r) }))
    .sort((a, b) => a.n.length - b.n.length);
  const kept = [];
  for (const item of items) {
    const inside = kept.some((k) => item.n === k.n || item.n.startsWith(k.n + path.sep));
    if (!inside) kept.push(item);
  }
  return kept.map((k) => k.raw);
}

/**
 * Work out which root folders to scan for a given preset.
 *
 * @param {'quick'|'deeper'} preset
 * @param {string[]} [extraRoots]  Previously-scanned folders and parent folders
 *                                 of already-added repositories.
 * @returns {string[]} existing, de-duplicated, non-nested absolute paths
 */
function getCandidateRoots(preset, extraRoots = []) {
  const bases = knownBases();
  const candidates = [];

  // Likely development folders under each base (always included).
  for (const base of bases) {
    for (const name of DEV_FOLDER_NAMES) candidates.push(path.join(base, name));
    candidates.push(path.join(base, 'Documents', 'GitHub'));
    candidates.push(path.join(base, 'Documents', 'Projects'));
    candidates.push(path.join(base, 'Documents', 'repos'));
  }

  // Folders the user scanned before, and parents of repos they already added.
  candidates.push(...extraRoots);

  // A deeper scan also looks across the main user folders (system folders are
  // still skipped while walking, thanks to IGNORED_DIR_NAMES).
  if (preset === 'deeper') {
    for (const base of bases) {
      candidates.push(base);
      candidates.push(path.join(base, 'Desktop'));
      candidates.push(path.join(base, 'Documents'));
      candidates.push(path.join(base, 'Downloads'));
    }
  }

  // Never let an automatic scan start at a bare drive root (a repo added at
  // C:\ would otherwise drag the whole drive in via its parent folder). Filter
  // these out BEFORE collapsing nested roots, so a stray drive root doesn't
  // swallow the real candidates first.
  const existing = uniqueExistingDirs(candidates).filter((r) => !isFilesystemRoot(r));
  return dropNestedRoots(existing);
}

// ---------------------------------------------------------------------------
// The scan itself
// ---------------------------------------------------------------------------

/**
 * Walk a set of root folders looking for git repositories.
 *
 * @param {object} options
 * @param {string[]} options.roots          Root folders to walk.
 * @param {number}   [options.maxDepth]     Max recursion depth per root.
 * @param {number}   [options.maxFolders]   Safety cap on folders visited.
 * @param {(p: {scannedFolders:number, found:number, currentPath:string|null, done?:boolean}) => void} [options.onProgress]
 * @param {{cancelled: boolean}} [options.token]  Set token.cancelled = true to stop.
 * @returns {Promise<{found: Array<{name:string,path:string}>, scannedFolders:number, errors:string[], cancelled:boolean, limitReached:boolean}>}
 */
async function scan(options = {}) {
  const roots = Array.isArray(options.roots) ? options.roots : [];
  const maxDepth = options.maxDepth || DEPTH.quick;
  const maxFolders = options.maxFolders || MAX_FOLDERS;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const token = options.token || { cancelled: false };

  const foundMap = new Map(); // normalised path -> { name, path }
  const errors = [];
  let scannedFolders = 0;
  let limitReached = false;

  // Breadth-first queue, consumed with a moving head index (O(1) dequeue) and
  // compacted occasionally so memory stays bounded on very wide trees.
  const queue = roots.map((r) => ({ dir: path.resolve(r), depth: 0 }));
  let head = 0;
  let lastYield = Date.now();

  while (head < queue.length) {
    if (token.cancelled) break;

    const { dir, depth } = queue[head++];
    if (head > 10000) {
      queue.splice(0, head); // drop already-processed entries to free memory
      head = 0;
    }
    scannedFolders++;

    // Yield to the event loop regularly (every 25 folders OR every ~50ms): keeps
    // the main process responsive, flushes progress events, and lets a cancel
    // request take effect mid-scan.
    const now = Date.now();
    if (scannedFolders % 25 === 0 || now - lastYield > 50) {
      if (onProgress) onProgress({ scannedFolders, found: foundMap.size, currentPath: dir });
      await new Promise((resolve) => setImmediate(resolve));
      lastYield = Date.now();
      if (token.cancelled) break;
    }

    if (scannedFolders > maxFolders) {
      limitReached = true;
      break;
    }

    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      // Permission denied / folder vanished – record and keep going.
      errors.push(dir);
      continue;
    }

    // A very large directory: yield before synchronously scanning its entries so
    // a single huge folder can't delay a pending cancel/paint.
    if (entries.length > 5000) {
      await new Promise((resolve) => setImmediate(resolve));
      lastYield = Date.now();
      if (token.cancelled) break;
    }

    // Is THIS folder a repository?
    const gitEntry = entries.find((e) => e.name === '.git');
    if (gitEntry) {
      let isRepo = gitEntry.isDirectory();
      if (!isRepo && (gitEntry.isFile() || gitEntry.isSymbolicLink())) {
        isRepo = await looksLikeGitDirFile(path.join(dir, '.git'));
      }
      if (isRepo) {
        const norm = normalizePath(dir);
        if (!foundMap.has(norm)) foundMap.set(norm, { name: path.basename(dir), path: dir });
        // Do not descend into a repository (avoids listing submodules / build
        // output inside it as separate repos).
        continue;
      }
    }

    if (depth >= maxDepth) continue;

    for (const entry of entries) {
      // Only directories. Note: a symlinked folder reports isDirectory()===false
      // here, so we naturally avoid following symlinks and looping forever.
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue; // skip hidden folders
      if (IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) continue;
      // Stop queuing once we are about to exceed the safety cap, so the queue
      // can't balloon ahead of the folders-read cap.
      if (scannedFolders + (queue.length - head) >= maxFolders) {
        limitReached = true;
        break;
      }
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }

  if (onProgress) {
    onProgress({ scannedFolders, found: foundMap.size, currentPath: null, done: true });
  }

  return {
    found: [...foundMap.values()],
    scannedFolders,
    errors,
    cancelled: token.cancelled,
    limitReached,
  };
}

/**
 * Convenience wrapper: scan a single chosen folder (the "Choose a folder"
 * preset and the legacy single-folder scan).
 * @param {string} rootPath
 * @param {object} [options]
 */
async function scanForRepos(rootPath, options = {}) {
  if (!rootPath || !isDirectory(rootPath)) {
    return { found: [], scannedFolders: 0, errors: ['The selected folder could not be found.'], cancelled: false, limitReached: false };
  }
  return scan({ roots: [rootPath], maxDepth: options.maxDepth || DEPTH.custom, ...options });
}

module.exports = {
  scan,
  scanForRepos,
  getCandidateRoots,
  normalizePath,
  IGNORED_DIR_NAMES,
  DEPTH,
  MAX_FOLDERS,
};
