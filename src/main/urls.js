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

/**
 * Does this look like a Git repository link we can clone? Accepts the common
 * shapes: https://, http://, ssh://, git://, and scp-style user@host:path.
 * @param {string|null} url
 * @returns {boolean}
 */
function isProbablyGitUrl(url) {
  const s = String(url || '').trim();
  if (!s) return false;
  if (/^(https?|ssh|git|ftps?|file):\/\/[^\s]+/i.test(s)) return true; // scheme://…
  if (/^[^\s@:]+@[^\s@:]+:[^\s].*/.test(s)) return true; // scp-style: user@host:path
  return false;
}

/**
 * Make a string safe to use as a folder name on Windows (and elsewhere).
 * Strips characters Windows forbids, trims trailing dots/spaces, and avoids
 * reserved device names. Returns '' if nothing usable remains.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFolderName(name) {
  let n = String(name || '').replace(/[\\/]/g, ''); // no path separators
  // eslint-disable-next-line no-control-regex
  n = n.replace(/[<>:"|?*\x00-\x1F]/g, ''); // Windows-forbidden characters
  n = n.replace(/\s+/g, ' ').trim();
  n = n.replace(/[. ]+$/, ''); // Windows dislikes trailing dot/space
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n)) n = `${n}-project`;
  return n;
}

/**
 * Suggest a local folder name from a repository link. Takes the last path
 * segment and drops a trailing ".git". Falls back to "new-project".
 *   https://host/team/easygit.git        -> easygit
 *   git@host:team/easygit.git            -> easygit
 *   ssh://git@host/team/project.git      -> project
 * @param {string|null} remoteUrl
 * @returns {string}
 */
function suggestFolderName(remoteUrl) {
  let s = String(remoteUrl || '').trim();
  if (!s) return 'new-project';
  s = s.replace(/[?#].*$/, ''); // drop query/fragment
  s = s.replace(/[/\\]+$/, ''); // drop trailing slashes
  const parts = s.split(/[/\\:]+/).filter(Boolean);
  let last = parts.length ? parts[parts.length - 1] : '';
  last = last.replace(/\.git$/i, '');
  const clean = sanitizeFolderName(last);
  return clean || 'new-project';
}

module.exports = { toBrowserUrl, providerName, isProbablyGitUrl, sanitizeFolderName, suggestFolderName };
