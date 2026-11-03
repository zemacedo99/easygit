# EasyGit v2.1.0

See at a glance which projects are connected to an online repository, and
Auto-find now finds projects kept inside other projects. Fully
backwards-compatible with v2.0.0; the new option is off by default.

## Highlights

### Online repository status (optional)

Turn on **Settings → Show online repository status**:

- Each project shows whether it is connected to an online repository — for
  example **🌐 Online repository: git.example.com** — or is
  **⚪ Only on this computer**.
- Projects with several online repositories show them all (“+N more”), whatever
  they are called.
- EasyGit reads this from the project's own settings: it doesn't go online, and
  it never adds, changes or removes anything. "Connected" means an online
  repository is set up, not that it can be reached or is up to date.
- **Open online project** only appears when there is something to open.

### Fixes

- **Auto-find** now finds projects that sit inside another project's folder
  (nested projects and submodule-style projects). Dependency and build folders
  are still skipped. Run Auto-find again to pick them up.

## Updating

- From v2.0.0: Settings → *About EasyGit* → **Check for updates**.
- From v1.3.0 or older: install this version manually once (installer or
  portable below); in-app updates work from then on.

## Requirements

- Node.js is not required to run the packaged app.
- Git must still be installed on the user's machine.
- The installer is unsigned, so Windows SmartScreen may show a warning on first launch.

## Files

- `EasyGit Setup 2.1.0.exe` — recommended installer
- `EasyGit-2.1.0-portable.exe` — portable version
- `SHA256SUMS.txt` — checksums for both files
- `update.json` — information used by the in-app updater

## Git version

Tag: `v2.1.0`
