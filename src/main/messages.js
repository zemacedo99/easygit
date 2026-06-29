'use strict';

/**
 * messages.js
 * -----------
 * The single source of truth for friendly, non-technical wording.
 *
 * Two jobs:
 *   1. STATUS_INFO – describes each repository status (label + colour + meaning)
 *      so the UI and the explanations stay consistent.
 *   2. friendlyError() – turns a technical GitErrorCode into a calm, helpful
 *      sentence the user can actually act on.
 *
 * Keep ALL user-facing wording here so it is easy to review and improve.
 */

const { GitErrorCode } = require('./gitService');

/**
 * Status codes produced by statusInterpreter.js, each with display metadata.
 * `tone` is a hint the UI uses to pick a badge colour.
 */
const Status = {
  UP_TO_DATE: 'up-to-date',
  LOCAL_CHANGES: 'local-changes',
  NEEDS_UPLOAD: 'needs-upload',
  NEEDS_DOWNLOAD: 'needs-download',
  NEEDS_UPLOAD_AND_DOWNLOAD: 'needs-upload-and-download',
  NO_REMOTE: 'no-remote',
  ERROR: 'error',
  UNKNOWN: 'unknown',
};

const STATUS_INFO = {
  [Status.UP_TO_DATE]: {
    label: 'Up to date',
    tone: 'good',
    short: 'Everything is updated. No action is needed.',
  },
  [Status.LOCAL_CHANGES]: {
    label: 'Local changes',
    tone: 'changes',
    short: 'You have changes on this computer that have not been saved as a version yet.',
  },
  [Status.NEEDS_UPLOAD]: {
    label: 'Needs upload',
    tone: 'upload',
    short: 'You have saved versions on this computer that have not been uploaded yet.',
  },
  [Status.NEEDS_DOWNLOAD]: {
    label: 'Needs download',
    tone: 'download',
    short: 'There are newer versions available online that you have not downloaded yet.',
  },
  [Status.NEEDS_UPLOAD_AND_DOWNLOAD]: {
    label: 'Needs upload and download',
    tone: 'both',
    short: 'You have versions to upload, and there are also newer versions online to download.',
  },
  [Status.NO_REMOTE]: {
    label: 'Not connected to online repository',
    tone: 'neutral',
    short: 'This repository is not connected to an online repository yet.',
  },
  [Status.ERROR]: {
    label: 'Error',
    tone: 'error',
    short: 'Something went wrong while checking this repository.',
  },
  [Status.UNKNOWN]: {
    label: 'Not checked yet',
    tone: 'neutral',
    short: 'This repository has not been checked yet. Use “Check changes” to see its state.',
  },
};

/**
 * Friendly, actionable text for each technical error code.
 * @param {string} errorCode  a GitErrorCode value
 * @param {string} [rawDetail]  optional raw git text, only shown as a last resort
 * @returns {{title: string, detail: string}}
 */
function friendlyError(errorCode, rawDetail = '') {
  switch (errorCode) {
    case GitErrorCode.GIT_NOT_INSTALLED:
      return {
        title: 'Git is not installed',
        detail:
          'EasyGit needs Git to be installed on this computer. You can download Git for free from git-scm.com. After installing it, please restart EasyGit.',
      };
    case GitErrorCode.FOLDER_NOT_FOUND:
      return {
        title: 'Folder not found',
        detail:
          'This folder could not be found. It may have been moved, renamed, or deleted. You can remove it from EasyGit and add it again.',
      };
    case GitErrorCode.NOT_A_REPO:
      return {
        title: 'Not a Git repository',
        detail:
          'This folder does not look like a Git repository. Choose another folder, or create a Git repository here first.',
      };
    case GitErrorCode.NO_REMOTE:
      return {
        title: 'No online repository',
        detail: 'This repository is not connected to an online repository yet.',
      };
    case GitErrorCode.NO_UPSTREAM:
      return {
        title: 'Not linked to an online version line',
        detail:
          'This version line is not yet linked to one online, so EasyGit cannot compare them. You can still save versions locally.',
      };
    case GitErrorCode.AUTH_FAILED:
      return {
        title: 'Sign-in failed',
        detail:
          'The online repository did not accept your sign-in. Please check your username, password, or access token and try again.',
      };
    case GitErrorCode.NETWORK_UNAVAILABLE:
      return {
        title: 'No internet connection',
        detail:
          'EasyGit could not reach the online repository. Please check your internet connection and try again.',
      };
    case GitErrorCode.PULL_CONFLICT:
      return {
        title: 'Conflicting changes',
        detail:
          'The online changes and your local changes affect the same things, so they could not be combined automatically. This one needs a person to help merge them — EasyGit will not change anything automatically.',
      };
    case GitErrorCode.PUSH_REJECTED:
      return {
        title: 'Upload was rejected',
        detail:
          'The online repository has newer versions that you do not have yet. Download the latest version first, then upload again.',
      };
    case GitErrorCode.TIMEOUT:
      return {
        title: 'This took too long',
        detail:
          'The operation took too long and was stopped. The online repository may be slow or unreachable. Please try again.',
      };
    case GitErrorCode.UNKNOWN:
    default:
      return {
        title: 'Something went wrong',
        detail:
          (rawDetail && rawDetail.trim()) ||
          'An unexpected problem happened. Please try again.',
      };
  }
}

module.exports = { Status, STATUS_INFO, friendlyError };
