'use strict';

/**
 * storage.js
 * ----------
 * Remembers the user's list of repositories between launches.
 *
 * Uses a single JSON file in Electron's per-user data folder
 * (app.getPath('userData')), so it never pollutes the user's own folders and
 * survives app restarts. The shape is intentionally simple and human-readable.
 *
 * Persisted per repository:
 *   - id           stable internal id
 *   - name         friendly name (editable later)
 *   - path         local folder path
 *   - remoteUrl    online repository URL, if known
 *   - lastStatus   last known status code (see statusInterpreter.js)
 *   - lastChecked  ISO timestamp of the last status check
 *
 * Optional `layout` (only used when "Organize your repository list" is on):
 * custom order + EasyGit-only groups, keyed by repository id. Kept separate
 * from the repositories themselves; it never refers to or changes real folders.
 */

const fs = require('fs');
const path = require('path');

let storageFilePath = null;

/**
 * Must be called once at startup with Electron's userData directory.
 * @param {string} userDataDir
 */
function init(userDataDir) {
  storageFilePath = path.join(userDataDir, 'repositories.json');
}

function ensureInitialized() {
  if (!storageFilePath) {
    throw new Error('storage.init(userDataDir) must be called before use.');
  }
}

/**
 * Read the whole saved object. Returns a safe default if nothing is saved yet
 * or the file is corrupted (we never crash on a bad file).
 * @returns {{repositories: Array<object>, scanRoots: string[]}}
 */
function readAll() {
  ensureInitialized();
  try {
    if (!fs.existsSync(storageFilePath)) return { repositories: [], scanRoots: [], settings: {}, layout: null };
    const data = JSON.parse(fs.readFileSync(storageFilePath, 'utf8'));
    return {
      repositories: Array.isArray(data.repositories) ? data.repositories : [],
      scanRoots: Array.isArray(data.scanRoots) ? data.scanRoots : [],
      settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
      layout: data.layout && typeof data.layout === 'object' ? data.layout : null,
    };
  } catch (e) {
    // Corrupted file – start clean rather than blocking the user.
    return { repositories: [], scanRoots: [], settings: {}, layout: null };
  }
}

/** Write the whole object atomically (temp file + rename). */
function writeAll(data) {
  ensureInitialized();
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    repositories: data.repositories || [],
    scanRoots: data.scanRoots || [],
    settings: data.settings || {},
  };
  // Only written once the user has organized something, so older files stay as they were.
  if (data.layout) payload.layout = data.layout;
  const tmp = storageFilePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, storageFilePath);
}

/**
 * Load the saved repositories.
 * @returns {Array<object>}
 */
function loadRepos() {
  return readAll().repositories;
}

/**
 * Persist the list of repositories, preserving any other saved data.
 * @param {Array<object>} repositories
 */
function saveRepos(repositories) {
  const all = readAll();
  all.repositories = repositories;
  writeAll(all);
}

/**
 * Load the folders the user has scanned before (used to suggest where to look
 * next time). @returns {string[]}
 */
function loadScanRoots() {
  return readAll().scanRoots;
}

/**
 * Persist the remembered scan-root folders, preserving the repository list.
 * @param {string[]} scanRoots
 */
function saveScanRoots(scanRoots) {
  const all = readAll();
  all.scanRoots = scanRoots;
  writeAll(all);
}

/**
 * Load user preferences (e.g. simple/advanced mode). Returns {} if unset.
 * @returns {object}
 */
function loadSettings() {
  return readAll().settings;
}

/**
 * Persist user preferences, preserving the repository list and scan roots.
 * @param {object} settings
 */
function saveSettings(settings) {
  const all = readAll();
  all.settings = settings;
  writeAll(all);
}

/**
 * Load the optional list organization (custom order + groups), or null.
 * @returns {object|null}
 */
function loadLayout() {
  return readAll().layout;
}

/**
 * Persist the list organization, preserving everything else.
 * @param {object|null} layout
 */
function saveLayout(layout) {
  const all = readAll();
  all.layout = layout;
  writeAll(all);
}

/** Where the data file lives (handy for the UI / debugging). */
function getStoragePath() {
  return storageFilePath;
}

module.exports = {
  init,
  loadRepos,
  saveRepos,
  loadScanRoots,
  saveScanRoots,
  loadSettings,
  saveSettings,
  loadLayout,
  saveLayout,
  getStoragePath,
};
