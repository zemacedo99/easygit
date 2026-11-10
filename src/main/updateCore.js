'use strict';

/**
 * updateCore.js
 * -------------
 * Pure, testable building blocks for in-app updates (no Electron, no network):
 * version comparison, picking the latest release tag, validating the release's
 * update.json, verifying a downloaded file, the update state machine, and
 * friendly error messages.
 *
 * Trust model: update.json is read from the release tag of the EasyGit
 * repository over authenticated HTTPS (Git checks every object's hash too), and
 * every downloaded artifact must match its size and SHA-256 from that file
 * before it can ever be executed.
 */

const crypto = require('crypto');
const fs = require('fs');

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

/** "1.4.0" / "v1.4.0" → [1, 4, 0]; anything else (pre-releases, junk) → null. */
function parseVersion(v) {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(v == null ? '' : v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Numeric semantic comparison (negative when a < b). Throws on invalid input. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Invalid version: ${pa ? b : a}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * The newest release from `git ls-remote --tags` output ("<sha>\trefs/tags/vX.Y.Z").
 * Only exact vX.Y.Z tags count; anything else is ignored. @returns {{version, tag}|null}
 */
function latestFromTags(lsRemoteOutput) {
  let best = null;
  for (const line of String(lsRemoteOutput || '').split(/\r?\n/)) {
    const m = /^[0-9a-f]{40,64}\s+refs\/tags\/(v\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec(line.trim());
    if (!m) continue;
    const version = m[1].slice(1);
    if (!best || compareVersions(version, best.version) > 0) best = { version, tag: m[1] };
  }
  return best;
}

/** 'up-to-date' | 'available' | 'ahead' (running a newer build: never downgrade). */
function compareToLatest(current, latest) {
  const d = compareVersions(current, latest);
  return d === 0 ? 'up-to-date' : d < 0 ? 'available' : 'ahead';
}

/* ------------------------------------------------------------------ */
/* Release metadata (versions/vX.Y.Z/update.json)                      */
/* ------------------------------------------------------------------ */

const METADATA_SCHEMA = 1;
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024; // 1 GiB sanity cap
/** Plain file names only: no folders, no "..", must be an .exe. */
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}\.exe$/;

function cleanText(s, max = 300) {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function validateArtifact(a, version, label) {
  if (!a || typeof a !== 'object') return `${label} is missing`;
  if (typeof a.file !== 'string' || !SAFE_FILE.test(a.file) || a.file.includes('..')) return `${label} file name is not allowed`;
  if (!a.file.includes(version)) return `${label} file name does not match the version`;
  if (!Number.isSafeInteger(a.size) || a.size <= 0 || a.size > MAX_ARTIFACT_BYTES) return `${label} size is invalid`;
  if (typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(a.sha256)) return `${label} checksum is invalid`;
  return null;
}

/** The release's "What's new" entry, in the same shape as src/renderer/changelog.mjs. */
function cleanChangelog(c, version) {
  if (!c || typeof c !== 'object' || c.version !== version || !Array.isArray(c.sections)) return null;
  const sections = c.sections
    .filter((s) => s && typeof s === 'object' && Array.isArray(s.items))
    .slice(0, 20)
    .map((s) => ({ heading: cleanText(s.heading, 120), items: s.items.map((i) => cleanText(i)).filter(Boolean).slice(0, 40) }))
    .filter((s) => s.heading && s.items.length);
  if (!sections.length) return null;
  return {
    version,
    date: /^\d{4}-\d{2}-\d{2}$/.test(c.date) ? c.date : '',
    summary: cleanText(c.summary, 200),
    sections,
  };
}

/**
 * Validate update.json for the expected release. Anything unexpected fails closed.
 * @returns {{ok: true, metadata: object} | {ok: false, reason: string}}
 */
function validateMetadata(raw, expectedVersion) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { ok: false, reason: 'update information is not valid JSON' };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'update information is missing' };
  if (data.schema !== METADATA_SCHEMA) return { ok: false, reason: 'update information has an unknown format' };
  if (!parseVersion(data.version) || data.version !== expectedVersion) return { ok: false, reason: 'update information is for a different version' };
  for (const [key, label] of [['installer', 'Installer'], ['portable', 'Portable version']]) {
    const problem = validateArtifact(data[key], data.version, label);
    if (problem) return { ok: false, reason: problem };
  }
  return {
    ok: true,
    metadata: {
      schema: METADATA_SCHEMA,
      version: data.version,
      date: /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : '',
      installer: { file: data.installer.file, size: data.installer.size, sha256: data.installer.sha256.toLowerCase() },
      portable: { file: data.portable.file, size: data.portable.size, sha256: data.portable.sha256.toLowerCase() },
      changelog: cleanChangelog(data.changelog, data.version),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Integrity                                                           */
/* ------------------------------------------------------------------ */

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Check a downloaded file against its expected size and SHA-256.
 * @returns {Promise<{ok: boolean, reason?: 'missing'|'size'|'checksum'}>}
 */
async function verifyFile(file, expected) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (e) {
    return { ok: false, reason: 'missing' };
  }
  if (!stat.isFile() || stat.size !== expected.size) return { ok: false, reason: 'size' };
  const actual = await sha256File(file);
  return actual === String(expected.sha256).toLowerCase() ? { ok: true } : { ok: false, reason: 'checksum' };
}

/* ------------------------------------------------------------------ */
/* Build kind + progress                                               */
/* ------------------------------------------------------------------ */

/** 'portable' (electron-builder portable exe), 'installed' (NSIS) or 'development'. */
function detectBuildKind({ isPackaged, env = {}, platform = process.platform }) {
  if (!isPackaged) return 'development';
  if (platform === 'win32' && env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  if (platform === 'win32') return 'installed';
  return 'unsupported';
}

const UNITS = { B: 1, bytes: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };

/** Bytes received so far, from a git "Receiving objects: …, 12.34 MiB | …" line. */
function receivedBytes(line) {
  const m = /Receiving objects:.*?,\s*([\d.]+)\s*(bytes|B|KiB|MiB|GiB)/.exec(String(line));
  return m ? Math.round(parseFloat(m[1]) * UNITS[m[2]]) : null;
}

/* ------------------------------------------------------------------ */
/* State machine                                                       */
/* ------------------------------------------------------------------ */

/** Allowed transitions. Anything else is a bug and is refused. */
const TRANSITIONS = {
  idle: ['checking'],
  checking: ['up-to-date', 'available', 'ahead', 'error'],
  'up-to-date': ['checking'],
  ahead: ['checking'],
  available: ['checking', 'downloading'],
  downloading: ['verifying', 'error'],
  verifying: ['ready', 'error'],
  ready: ['installing', 'checking'],
  installing: ['error'],
  error: ['checking', 'downloading'],
};

/** Move to `status`, merging `patch`; throws on an illegal transition. */
function transition(state, status, patch = {}) {
  const allowed = TRANSITIONS[state.status] || [];
  if (!allowed.includes(status)) throw new Error(`Update cannot go from ${state.status} to ${status}`);
  const next = { ...state, ...patch, status };
  if (status !== 'downloading') delete next.progress;
  if (status !== 'error') delete next.error;
  return next;
}

/* ------------------------------------------------------------------ */
/* Friendly errors                                                     */
/* ------------------------------------------------------------------ */

const ERRORS = {
  offline: { title: 'Can’t reach the update server', detail: 'Check your internet or company network connection, then try again.' },
  access: { title: 'No access to EasyGit updates', detail: 'Your computer could not sign in to the EasyGit update source. Make sure you can open the EasyGit project on GitHub, then try again.' },
  unavailable: { title: 'Update server unavailable', detail: 'The EasyGit update source did not respond as expected. Try again later.' },
  metadata: { title: 'Update information is incomplete', detail: 'This version can’t be installed from inside EasyGit. Ask for the new version to be downloaded manually.' },
  download: { title: 'Download didn’t finish', detail: 'The update could not be downloaded completely. Nothing was installed. Try again.' },
  checksum: { title: 'Update failed a safety check', detail: 'The downloaded file did not match the official release, so it was deleted and nothing was installed.' },
  disk: { title: 'Couldn’t save the update', detail: 'EasyGit could not write the update to this computer (disk full or no permission). Nothing was installed.' },
  install: { title: 'Update couldn’t be installed', detail: 'The new version could not be started. Your current version is unchanged.' },
  unsupported: { title: 'Updates aren’t available here', detail: 'In-app updates work in the installed or portable EasyGit for Windows.' },
};

/** Map Git's stderr to one of the friendly categories. */
function classifyGitError(stderr) {
  const s = String(stderr || '');
  if (/Could not resolve host|unable to access|Failed to connect|Connection (timed out|refused|reset)|Operation timed out|network is unreachable/i.test(s)) {
    if (/\b(401|403)\b|Authentication failed|could not read Username|terminal prompts disabled/i.test(s)) return 'access';
    return 'offline';
  }
  if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|\b(401|403)\b|not authorized|Permission denied/i.test(s)) return 'access';
  return 'unavailable';
}

function friendlyError(kind) {
  return { kind, ...(ERRORS[kind] || ERRORS.unavailable) };
}

module.exports = {
  parseVersion,
  compareVersions,
  latestFromTags,
  compareToLatest,
  validateMetadata,
  sha256File,
  verifyFile,
  detectBuildKind,
  receivedBytes,
  transition,
  TRANSITIONS,
  classifyGitError,
  friendlyError,
  SAFE_FILE,
};
