/**
 * changelog.mjs (renderer, pure data)
 * -----------------------------------
 * The user-facing "What's new & version history" shown in Settings.
 *
 * Source of truth: versions/vX.Y.Z/RELEASE_NOTES.md (summarized in plain
 * language) and the release tag dates. It lives under src/ so it ships inside
 * the packaged app automatically.
 *
 * RELEASES: add the new version at the TOP before tagging (see
 * docs/RELEASE_PROCESS.md). test/changelog.test.mjs fails if package.json's
 * version has no entry here, or if an entry has no versions/ release notes.
 */

/**
 * @typedef {{ heading: string, items: string[] }} ChangelogSection
 * @typedef {{ version: string, date: string, summary: string, sections: ChangelogSection[] }} ChangelogRelease
 * @type {ChangelogRelease[]}  newest first; `date` is the release tag date (YYYY-MM-DD)
 */
export const CHANGELOG = [
  {
    version: '2.1.1',
    date: '2026-11-18',
    summary: 'A new EasyGit logo, and updates now come from the public EasyGit page on GitHub.',
    sections: [
      {
        heading: 'Changes',
        items: [
          'New EasyGit logo and app icon',
          'Check for updates now looks on the public EasyGit page on GitHub, so updates work for everyone',
        ],
      },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-11-03',
    summary: 'See which projects are connected online, and Auto-find now finds projects inside other projects.',
    sections: [
      {
        heading: 'Online repository status (optional, off by default)',
        items: [
          'On each project, see whether it is connected to an online repository (for example “Online repository: git.example.com”) or is only on this computer',
          'Projects with several online repositories show them all, whatever they are called',
          'Read from the project’s own settings: EasyGit doesn’t go online and never changes anything',
          '“Open online project” only appears when there is something to open',
        ],
      },
      {
        heading: 'Fixes',
        items: [
          'Auto-find now finds projects kept inside another project’s folder, including submodule-style projects',
        ],
      },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-10-20',
    summary: 'EasyGit can now update itself, plus faster uploads and an always-available Settings.',
    sections: [
      {
        heading: 'Updates from inside EasyGit',
        items: [
          'Check for updates in Settings, plus one quiet check after starting',
          'A small “Update available” label next to the version when a newer one exists',
          'See what’s new before updating; the download is checked against the official release before anything runs',
          'Installed EasyGit updates in place and restarts; the portable version replaces its own file',
          'Updates come from the EasyGit project on Bitbucket, using the sign-in your computer already has',
        ],
      },
      {
        heading: 'Saving and uploading (optional, off by default)',
        items: [
          'Have the description of your changes prepared automatically (you can still edit it)',
          'Set a default description, or let EasyGit describe the files you actually changed',
          'Save and upload in one click, without being asked for a description',
          '✨ Suggest now describes files inside new folders and mixed changes properly',
        ],
      },
      {
        heading: 'Everyday improvements',
        items: [
          'Settings is always available from the top of the window, even with no projects',
          'The EasyGit version is shown next to the app name',
          'What’s new & version history inside Settings',
          'Optional: success and information messages close by themselves; warnings and errors stay',
        ],
      },
      {
        heading: 'Also included (first released in v1.3.0)',
        items: [
          'Optional repository organization: your own order, collapsible groups and group suggestions from project folders',
          'Open in VS Code',
          'Set changes aside for later, view the changes in a saved version, and move files to the Recycle Bin (detailed mode)',
          'Long file lists scroll while headers and counts stay visible',
        ],
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-20',
    summary: 'Organize your repository list your own way, plus new project tools.',
    sections: [
      {
        heading: 'Repository organization (optional, off by default)',
        items: [
          'Arrange projects in your own order by dragging them',
          'Collapsible groups, with a project count on each group',
          'Create, rename, delete and reorder your own groups, and move projects between them',
          'Group suggestions based on the folders your projects are in, which you review first',
          'A “Custom order” sort; other sorts and search still work, even inside collapsed groups',
          'Your order and groups are remembered between launches',
          'Groups exist only inside EasyGit and never move or rename folders on your computer',
        ],
      },
      {
        heading: 'Project tools',
        items: [
          'Open in VS Code',
          'Set changes aside for later and restore them (detailed mode)',
          'View the changes in a saved version (detailed mode)',
          'Move a file to the Recycle Bin, with two confirmations (detailed mode)',
          'Long file lists scroll while headers and counts stay visible',
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-07-28',
    summary: 'Add a project straight from an online link.',
    sections: [
      {
        heading: 'Add repository from link or SSH',
        items: [
          'Paste an https://, git@ or ssh:// link in Auto-find Git repositories',
          'Choose where to save it; EasyGit suggests a folder name you can edit',
          'Never overwrites an existing folder',
          'Uses your existing Git sign-in and never asks for or stores passwords',
          'Plain-language messages if a download fails',
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-06-29',
    summary: 'Quality-of-life improvements to the repository list and the overall experience.',
    sections: [
      {
        heading: 'Repository list',
        items: [
          'Search your projects by name or folder',
          'Sort by Needs action first, Name, Recently checked or Order added (remembered)',
          'Rename a project from the list (only the name shown in EasyGit)',
        ],
      },
      {
        heading: 'Experience',
        items: [
          'Action buttons show a spinner while they work',
          'Optional light theme and larger text size in Settings → Appearance',
        ],
      },
      {
        heading: 'Under the hood',
        items: ['Automated tests for the core logic'],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06-29',
    summary: 'First packaged Windows release.',
    sections: [
      {
        heading: 'Highlights',
        items: [
          'Simple flow: On this computer ⇄ Online project',
          'Upload my changes with one clear action',
          'Download the latest version from the online project',
          'Auto-find Git repositories on your computer',
          'Smart suggestions for describing your changes',
          'Detailed save/upload steps available in Settings',
          'Windows installer and portable version',
        ],
      },
    ],
  },
];

/** Compare two "X.Y.Z" versions numerically (negative when a < b). */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Releases, newest first (defensive copy, sorted). */
export function releasesNewestFirst(list = CHANGELOG) {
  return list.slice().sort((a, b) => compareVersions(b.version, a.version));
}

/** "2026-10-20" → "20 October 2026" (empty when unknown). */
export function formatReleaseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}
