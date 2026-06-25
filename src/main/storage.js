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
    if (!fs.existsSync(storageFilePath)) return { repositories: [], scanRoots: [] };
    const data = JSON.parse(fs.readFileSync(storageFilePath, 'utf8'));
    return {
      repositories: Array.isArray(data.repositories) ? data.repositories : [],
      scanRoots: Array.isArray(data.scanRoots) ? data.scanRoots : [],
    };
  } catch (e) {
    // Corrupted file – start clean rather than blocking the user.
    return { repositories: [], scanRoots: [] };
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
  };
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

/** Where the data file lives (handy for the UI / debugging). */
function getStoragePath() {
  return storageFilePath;
}

module.exports = { init, loadRepos, saveRepos, loadScanRoots, saveScanRoots, getStoragePath };
