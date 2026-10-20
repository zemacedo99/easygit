'use strict';

/**
 * updateConfig.js
 * ---------------
 * THE one place that says where EasyGit looks for updates.
 *
 * Updates come from the EasyGit Git repository itself: every release is an
 * annotated tag vX.Y.Z whose commit contains versions/vX.Y.Z/ with the
 * installer, the portable exe and update.json (size + SHA-256 of both, plus the
 * release's "What's new"). See docs/RELEASE_PROCESS.md.
 *
 * The repository is private, so it is read with Git using the sign-in Windows
 * already has for it (Git Credential Manager). EasyGit never asks for, stores or
 * logs credentials; Git prompts are disabled so nothing ever pops up.
 *
 * EASYGIT_UPDATE_SOURCE overrides the repository for testing (e.g. a local
 * file:// repository). It is read only here, in the main process.
 */

const DEFAULT_REPOSITORY = 'https://github.com/zemacedo99/easygit.git';

function updateSource(env = process.env) {
  const override = env.EASYGIT_UPDATE_SOURCE;
  return override && /^(https:\/\/|file:\/\/)/.test(override) ? override : DEFAULT_REPOSITORY;
}

module.exports = {
  updateSource,
  /** Folder (inside the tag) holding a release's files. */
  releaseFolder: (version) => `versions/v${version}`,
  /** Automatic check after startup: delay, so the window is never slowed down. */
  startupCheckDelayMs: 8000,
  /** Give up on a single Git step after this long. */
  gitTimeoutMs: 5 * 60 * 1000,
};
