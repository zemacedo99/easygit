'use strict';

/**
 * statusInterpreter.js
 * --------------------
 * Turns raw Git facts (local changes, remote present?, ahead/behind counts)
 * into a single friendly status plus a human-readable explanation.
 *
 * This is the "translation brain": the rest of the app gets a clean result it
 * can show directly, with no Git terminology.
 *
 * It does NOT run Git itself – it only interprets the data gathered by
 * repoManager.js via gitService.js.
 */

const { Status, STATUS_INFO } = require('./messages');

/**
 * @typedef {Object} StatusFacts
 * @property {boolean} hasRemote        Is an online repository configured?
 * @property {boolean} hasUpstream      Is the current branch linked to an online one?
 * @property {number}  localChangeCount How many files are changed locally.
 * @property {number}  ahead            Saved locally but not uploaded.
 * @property {number}  behind           Newer versions available online.
 * @property {boolean} fetched          Did we successfully refresh online info?
 */

/**
 * Decide the overall status code from the facts.
 * Priority order is chosen so the most "action needed" state wins.
 *
 * @param {StatusFacts} f
 * @returns {string} a Status value
 */
function decideStatus(f) {
  const hasLocal = f.localChangeCount > 0;
  const hasUp = f.ahead > 0;
  const hasDown = f.behind > 0;

  if (!f.hasRemote) {
    // No online repo at all. Local changes still matter to the user.
    return Status.NO_REMOTE;
  }

  if (hasUp && hasDown) return Status.NEEDS_UPLOAD_AND_DOWNLOAD;
  if (hasDown) return Status.NEEDS_DOWNLOAD;
  if (hasUp) return Status.NEEDS_UPLOAD;
  if (hasLocal) return Status.LOCAL_CHANGES;
  return Status.UP_TO_DATE;
}

/**
 * Build the full, friendly explanation paragraph for the details panel.
 * Combines local + online situations into clear, layered sentences.
 *
 * @param {string} status   the decided Status value
 * @param {StatusFacts} f
 * @returns {string}
 */
function buildExplanation(status, f) {
  const sentences = [];

  // Use the detailed working/staged/conflicted counts when available; fall back
  // to the single localChangeCount for older callers.
  const hasDetailed =
    f.workingCount != null || f.stagedCount != null || f.conflictedCount != null;
  const working = hasDetailed ? num(f.workingCount) : num(f.localChangeCount);
  const staged = num(f.stagedCount);
  const conflicted = num(f.conflictedCount);
  const totalLocal = working + staged + conflicted;

  // 1) Conflicts first – they need a person.
  if (conflicted > 0) {
    sentences.push(
      `${cap(pluralize(conflicted, 'file has', 'files have'))} conflicting changes that need a person to help. EasyGit will not change them automatically.`
    );
  }

  // 2) Local situation: unsaved changes and selected (ready-to-save) changes.
  if (working > 0) {
    sentences.push(
      `You changed ${pluralize(working, 'file', 'files')} on this computer. Select the ones you want to save.`
    );
  }
  if (staged > 0) {
    sentences.push(
      `${pluralize(staged, 'change is', 'changes are')} ready to save as a version.`
    );
  }

  // 3) No online repo
  if (!f.hasRemote) {
    sentences.push(
      'This project is not connected to an online repository, so there is nothing to upload or download yet.'
    );
    if (totalLocal === 0) sentences.push('There are no changes on this computer right now.');
    return sentences.join(' ');
  }

  // 4) Online comparison. (A failed online refresh is shown on the online
  // card, not repeated here, to keep the banner calm.)
  if (f.ahead > 0 && f.behind > 0) {
    sentences.push(
      `You have ${pluralize(f.ahead, 'saved version', 'saved versions')} that ${
        f.ahead === 1 ? 'has' : 'have'
      } not been uploaded yet, and there ${f.behind === 1 ? 'is' : 'are'} also ${pluralize(
        f.behind,
        'newer version',
        'newer versions'
      )} online. It is usually safest to download the latest version first, then upload yours.`
    );
  } else if (f.ahead > 0) {
    sentences.push(
      `You have ${pluralize(f.ahead, 'saved version', 'saved versions')} that ${
        f.ahead === 1 ? 'has' : 'have'
      } not been uploaded yet.`
    );
  } else if (f.behind > 0) {
    sentences.push(
      `There ${f.behind === 1 ? 'is' : 'are'} ${pluralize(
        f.behind,
        'newer version',
        'newer versions'
      )} online. Download ${f.behind === 1 ? 'it' : 'them'} before continuing.`
    );
  } else if (totalLocal === 0) {
    sentences.push('Everything is up to date. No action is needed.');
  }

  return sentences.join(' ');
}

/**
 * Produce a short online-comparison summary line for the details panel.
 * @param {StatusFacts} f
 * @returns {string}
 */
function buildOnlineSummary(f) {
  if (!f.hasRemote) return 'Not connected to an online repository.';
  if (!f.hasUpstream) return 'This version line is not linked to an online one yet.';
  if (!f.fetched) return 'Online information could not be refreshed (showing last known comparison).';

  const parts = [];
  if (f.ahead > 0) parts.push(`${pluralize(f.ahead, 'version', 'versions')} to upload`);
  if (f.behind > 0) parts.push(`${pluralize(f.behind, 'newer version', 'newer versions')} to download`);
  if (parts.length === 0) return 'In sync with the online repository.';
  return parts.join(' · ');
}

/**
 * The main entry point: take the gathered facts and return everything the UI
 * needs to display, all in friendly language.
 *
 * @param {StatusFacts} facts
 * @returns {{
 *   status: string,
 *   label: string,
 *   tone: string,
 *   explanation: string,
 *   onlineSummary: string,
 *   localSummary: string
 * }}
 */
function interpret(facts) {
  const status = decideStatus(facts);
  const info = STATUS_INFO[status];

  const working = facts.workingCount != null ? facts.workingCount : facts.localChangeCount || 0;
  const staged = num(facts.stagedCount);
  const summaryParts = [];
  if (working > 0) summaryParts.push(`${pluralize(working, 'file', 'files')} changed`);
  if (staged > 0) summaryParts.push(`${staged} ready to save`);
  const localSummary = summaryParts.length
    ? `${summaryParts.join(', ')}.`
    : 'Everything is clean. No changes on this computer.';

  return {
    status,
    label: info.label,
    tone: info.tone,
    explanation: buildExplanation(status, facts),
    onlineSummary: buildOnlineSummary(facts),
    localSummary,
  };
}

/** Tiny helper: "1 change" / "3 changes". */
function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Coerce to a finite number (0 when missing). */
function num(x) {
  return Number.isFinite(x) ? x : 0;
}

/** Capitalise the first letter. */
function cap(s) {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

module.exports = { interpret, decideStatus, buildExplanation };
