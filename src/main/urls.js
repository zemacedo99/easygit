'use strict';

/**
 * urls.js
 * -------
 * Turns a Git remote URL into a normal web link the user can open in a browser.
 *
 * Git remotes come in several shapes:
 *   - SSH:        git@github.com:user/repo.git
 *   - SSH (full): ssh://git@github.com/user/repo.git
 *   - HTTPS:      https://github.com/user/repo.git
 *
 * We convert all of them to a clean https://host/user/repo link. Works for the
 * common providers (GitHub, GitLab, Bitbucket) and any generic HTTPS host.
 */

/**
 * @param {string|null} remoteUrl
 * @returns {string|null} a browsable https URL, or null if we can't make one.
 */
function toBrowserUrl(remoteUrl) {
  if (!remoteUrl) return null;
  let url = remoteUrl.trim();

  // Already a normal web link.
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return stripGitSuffix(url);
  }

  // scp-like SSH: git@host:user/repo.git  (only when there is no ://-scheme,
  // otherwise this would wrongly capture a port from a full ssh:// URL).
  const scpMatch = !url.includes('://') && url.match(/^[^@]+@([^:]+):(.+)$/);
  if (scpMatch) {
    const host = scpMatch[1];
    const repoPath = scpMatch[2];
    return stripGitSuffix(`https://${host}/${repoPath}`);
  }

  // Full SSH URL: ssh://git@host/user/repo.git  (port optional)
  const sshMatch = url.match(/^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const repoPath = sshMatch[2];
    return stripGitSuffix(`https://${host}/${repoPath}`);
  }

  // git:// protocol
  const gitMatch = url.match(/^git:\/\/([^/]+)\/(.+)$/);
  if (gitMatch) {
    return stripGitSuffix(`https://${gitMatch[1]}/${gitMatch[2]}`);
  }

  // Unknown shape – don't guess.
  return null;
}

/** Remove a trailing ".git" (and any trailing slash) from a web URL. */
function stripGitSuffix(url) {
  return url.replace(/\.git$/i, '').replace(/\/$/, '');
}

/**
 * A short, friendly provider name for display, e.g. "GitHub".
 * @param {string|null} remoteUrl
 * @returns {string|null}
 */
function providerName(remoteUrl) {
  const web = toBrowserUrl(remoteUrl);
  if (!web) return null;
  if (web.includes('github.')) return 'GitHub';
  if (web.includes('gitlab.')) return 'GitLab';
  if (web.includes('bitbucket.')) return 'Bitbucket';
  if (web.includes('dev.azure.com') || web.includes('visualstudio.com')) return 'Azure DevOps';
  try {
    return new URL(web).hostname;
  } catch (e) {
    return null;
  }
}

module.exports = { toBrowserUrl, providerName };
