/**
 * remoteStatus.mjs (renderer, pure)
 * ---------------------------------
 * Wording for the optional "Show online repository status" setting, and which
 * link "Open online project" may use. The status only says whether the
 * project has an online repository CONFIGURED (from its own Git settings); it
 * never claims the online repository is reachable or up to date.
 */

/** The remote shown first: "origin" if present, otherwise the first one. */
export function primaryRemote(status) {
  if (!status || !Array.isArray(status.remotes) || status.remotes.length === 0) return null;
  return status.remotes.find((r) => r.name === status.primary) || status.remotes[0];
}

function where(remote) {
  if (remote.kind === 'web' && remote.host) return remote.host;
  if (remote.kind === 'local') return 'a folder on this computer';
  return 'an online repository';
}

/**
 * A short label for a card / the details panel, or null before the first check.
 * @returns {{icon: string, text: string, title: string, tone: 'online'|'local'|'unknown'} | null}
 */
export function remoteStatusInfo(status) {
  if (!status || !status.state) return null;
  if (status.state === 'local-only') {
    return {
      icon: '⚪',
      text: 'Only on this computer',
      title: 'No online repository connected. This project is not linked to any online copy.',
      tone: 'local',
    };
  }
  if (status.state === 'connected') {
    const main = primaryRemote(status);
    const others = status.remotes.length - 1;
    const list = status.remotes.map((r) => `${r.name}: ${where(r)}`).join('\n');
    return {
      icon: main.kind === 'local' ? '🔗' : '🌐',
      text: `${main.kind === 'local' ? 'Linked to' : 'Online repository:'} ${where(main)}${others > 0 ? ` (+${others} more)` : ''}`,
      title: `Connected to ${status.remotes.length === 1 ? 'an online repository' : `${status.remotes.length} online repositories`}:\n${list}\n(Configured — this doesn't check that it can be reached.)`,
      tone: 'online',
    };
  }
  return {
    icon: '❔',
    text: status.reason === 'missing' ? 'Folder not found' : 'Online repository unknown',
    title: status.reason === 'missing'
      ? 'The project folder could not be found, so its online repository could not be read.'
      : 'EasyGit could not read this project’s online repository settings.',
    tone: 'unknown',
  };
}

/**
 * The web link "Open online project" should open, or null to hide the button.
 * Without the setting, this is exactly today's rule (the "origin" link). With
 * it on, a project whose online repository isn't called "origin" can be opened too.
 */
export function onlineProjectLink(repo, settings, details) {
  const known = (details && details.browserUrl) || (repo && repo.browserUrl);
  if (known) return known;
  if (!settings || !settings.showRemoteStatus || !repo) return null;
  const status = repo.remoteStatus;
  if (!status || status.state !== 'connected') return null;
  const main = primaryRemote(status);
  if (main && main.browserUrl) return main.browserUrl;
  const any = status.remotes.find((r) => r.browserUrl);
  return any ? any.browserUrl : null;
}
