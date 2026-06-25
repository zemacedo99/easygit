'use strict';

/**
 * scanner.js
 * ----------
 * Finds Git repositories on disk by looking for folders that contain a `.git`
 * entry. Deliberately conservative:
 *   - Only scans a folder the user explicitly chose (never the whole drive).
 *   - Has a depth limit so a huge folder tree can't hang the app.
 *   - Skips noisy folders (node_modules, etc.) and never descends INTO a repo
 *     once found (so we don't list nested junk as separate repos).
 *
 * Knows nothing about the UI. Returns plain data.
 */

const fs = require('fs');
const path = require('path');

// Folders we never bother looking inside – they are large and never contain
// repositories the user cares about.
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  '.cache',
  '.idea',
  '.vscode',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

const DEFAULT_MAX_DEPTH = 6;

/**
 * Recursively scan a folder for git repositories.
 *
 * @param {string} rootPath  Folder the user picked.
 * @param {object} [options]
 * @param {number} [options.maxDepth]  How deep to recurse (default 6).
 * @returns {Promise<{found: Array<{name: string, path: string}>, scannedFolders: number, errors: string[]}>}
 */
async function scanForRepos(rootPath, options = {}) {
  const maxDepth = options.maxDepth || DEFAULT_MAX_DEPTH;
  const found = [];
  const errors = [];
  let scannedFolders = 0;

  if (!rootPath || !fs.existsSync(rootPath)) {
    return { found, scannedFolders, errors: ['The selected folder could not be found.'] };
  }

  /**
   * @param {string} dir
   * @param {number} depth
   */
  function walk(dir, depth) {
    scannedFolders++;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // Permission denied, etc. – record and move on, never crash the scan.
      errors.push(dir);
      return;
    }

    // A repository is a folder that directly contains a ".git" entry
    // (folder for normal repos, a file for worktrees/submodules).
    const hasGit = entries.some((e) => e.name === '.git');
    if (hasGit) {
      found.push({ name: path.basename(dir), path: dir });
      // Do NOT descend into a repository – avoids listing submodules/nested
      // build output as separate repos.
      return;
    }

    if (depth >= maxDepth) return;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      // Skip hidden folders other than ones we care about (we already handled .git)
      if (entry.name.startsWith('.')) continue;

      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(rootPath, 0);

  return { found, scannedFolders, errors };
}

module.exports = { scanForRepos, IGNORED_DIR_NAMES, DEFAULT_MAX_DEPTH };
