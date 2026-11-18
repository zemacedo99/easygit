'use strict';

/**
 * updateConfig.js
 * ---------------
 * THE one place that says where EasyGit looks for updates.
 *
 * Updates come from the public EasyGit repository on GitHub: every release is
 * an annotated tag vX.Y.Z whose commit contains versions/vX.Y.Z/update.json
 * (size + SHA-256 of the installer and the portable exe, plus the release's
 * "What's new"). The executables themselves are attached to the matching
 * GitHub Release (they are never committed). See docs/RELEASE_PROCESS.md.
 *
 * The repository is read with Git with prompts disabled; EasyGit never asks
 * for, stores or logs credentials.
 *
 * EASYGIT_UPDATE_SOURCE overrides the repository for testing (e.g. a local
 * file:// repository). It is read only here, in the main process.
 */

const DEFAULT_REPOSITORY = 'https://github.com/zemacedo99/easygit.git';

function updateSource(env = process.env) {
  const override = env.EASYGIT_UPDATE_SOURCE;
  return override && /^(https:\/\/|file:\/\/)/.test(override) ? override : DEFAULT_REPOSITORY;
}

/**
 * Download URL of a release file attached to a GitHub Release, or null when the
 * update source is not a github.com repository. Used when a release tag does not
 * contain the executable itself.
 */
function releaseAssetUrl(source, version, file) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(source || ''));
  if (!m || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  // GitHub stores an uploaded file name with spaces turned into dots
  // ("EasyGit Setup 2.1.1.exe" -> "EasyGit.Setup.2.1.1.exe"). Releases from
  // v2.1.2 on use names without spaces, so this only matters for older ones.
  const assetName = String(file).replace(/ /g, '.');
  return `https://github.com/${m[1]}/${m[2]}/releases/download/v${version}/${encodeURIComponent(assetName)}`;
}

module.exports = {
  updateSource,
  releaseAssetUrl,
  /** Folder (inside the tag) holding a release's files. */
  releaseFolder: (version) => `versions/v${version}`,
  /** Automatic check after startup: delay, so the window is never slowed down. */
  startupCheckDelayMs: 8000,
  /** Give up on a single Git step after this long. */
  gitTimeoutMs: 5 * 60 * 1000,
};
