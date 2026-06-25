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
 * Load the saved repositories. Returns [] if nothing is saved yet or if the
 * file is somehow corrupted (we never crash on a bad file).
 * @returns {Array<object>}
 */
function loadRepos() {
  ensureInitialized();
  try {
    if (!fs.existsSync(storageFilePath)) return [];
    const raw = fs.readFileSync(storageFilePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.repositories)) return [];
    return data.repositories;
  } catch (e) {
    // Corrupted file – start clean rather than blocking the user.
    return [];
  }
}

/**
 * Persist the full list of repositories.
 * @param {Array<object>} repositories
 */
function saveRepos(repositories) {
  ensureInitialized();
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    repositories,
  };
  // Write atomically-ish: write to a temp file then rename, so a crash midway
  // can't leave a half-written file.
  const tmp = storageFilePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, storageFilePath);
}

/** Where the data file lives (handy for the UI / debugging). */
function getStoragePath() {
  return storageFilePath;
}

module.exports = { init, loadRepos, saveRepos, getStoragePath };
