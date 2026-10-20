'use strict';

/**
 * portableReplace.js
 * ------------------
 * Updating the PORTABLE EasyGit. A running .exe can't overwrite itself on
 * Windows, so after the new portable exe has been downloaded and verified:
 *
 *   1. The old EasyGit starts the NEW exe with
 *        --easygit-portable-replace=<path of the old exe>
 *      and quits.
 *   2. The new exe (this code, before any window opens) waits until the old
 *      file is released, swaps it in safely (old → .old, new → original name,
 *      rolling back on any failure), starts the updated EasyGit from the
 *      original location, and exits.
 *
 * Guard rails: the helper only replaces a file called EasyGit*.exe, and only
 * copies itself when it is running from EasyGit's own update staging folder.
 */

const fs = require('fs');
const path = require('path');

const FLAG = '--easygit-portable-replace=';

/** The target path when this process was started as the replace helper. */
function helperTarget(argv) {
  const arg = (argv || []).find((a) => typeof a === 'string' && a.startsWith(FLAG));
  return arg ? arg.slice(FLAG.length) : null;
}

/** Is `child` inside `parent` (after resolving)? */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Validate the helper's inputs before touching any file. */
function checkReplaceRequest({ source, target, stagingRoot }) {
  if (!source || !target) return 'missing paths';
  if (!/^EasyGit[^\\/]*\.exe$/i.test(path.basename(target))) return 'target is not an EasyGit executable';
  if (!path.isAbsolute(target)) return 'target must be absolute';
  if (!stagingRoot || !isInside(source, stagingRoot)) return 'helper is not running from the update folder';
  if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) return 'source and target are the same file';
  return null;
}

/**
 * Swap `source` in place of `target`. Retries while the old exe is still locked.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function replaceFile({ source, target, timeoutMs = 60000, retryMs = 500, fsi = fs, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const fresh = `${target}.new`;
  const old = `${target}.old`;
  try {
    fsi.rmSync(fresh, { force: true });
    fsi.copyFileSync(source, fresh);
  } catch (e) {
    return { ok: false, reason: 'could not copy the new version next to the old one' };
  }
  const deadline = Date.now() + timeoutMs;
  // Wait until the old exe can be moved aside (it is locked while it runs).
  for (;;) {
    try {
      fsi.rmSync(old, { force: true });
      fsi.renameSync(target, old);
      break;
    } catch (e) {
      if (Date.now() >= deadline) {
        try { fsi.rmSync(fresh, { force: true }); } catch (x) { /* ignore */ }
        return { ok: false, reason: 'the old version is still in use' };
      }
      await sleep(retryMs);
    }
  }
  try {
    fsi.renameSync(fresh, target);
  } catch (e) {
    // Put the original back so the user is never left without EasyGit.
    try { fsi.renameSync(old, target); } catch (x) { /* nothing more we can do */ }
    return { ok: false, reason: 'could not put the new version in place' };
  }
  try { fsi.rmSync(old, { force: true }); } catch (e) { /* removed next time */ }
  return { ok: true };
}

/** Remove a leftover "<exe>.old" from an earlier update (best effort). */
function removeLeftover(exePath) {
  if (!exePath) return;
  try { fs.rmSync(`${exePath}.old`, { force: true }); } catch (e) { /* still locked: try next time */ }
}

module.exports = { FLAG, helperTarget, checkReplaceRequest, replaceFile, removeLeftover, isInside };
