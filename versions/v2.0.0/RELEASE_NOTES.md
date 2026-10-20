# EasyGit v2.0.0

EasyGit can now update itself, uploads can take a single click, and Settings is
always one click away. Fully backwards-compatible with v1.3.0: your projects,
groups and settings load unchanged, and every new option is off by default, so
the app behaves as before until you choose otherwise.

## Highlights

### Updates from inside EasyGit

- **Check for updates** in Settings → *About EasyGit*, plus one quiet check
  shortly after EasyGit starts. A small **Update available** label appears next
  to the version when a newer EasyGit exists. Nothing installs until you choose.
- Read **What's new** for the new version before updating.
- The update downloads in the background with progress and is **checked against
  the official release** (size + SHA-256) before anything runs; a file that
  doesn't match is deleted.
- **Restart and update**: the installed EasyGit upgrades in place (no uninstall)
  and starts again; the portable version replaces its own file and restarts.
- Updates come from the EasyGit project on Bitbucket, using the sign-in your
  computer already has for it. EasyGit never asks for or stores passwords.
  People without access to the project see a friendly message and can keep
  downloading new versions manually.

### Saving and uploading (optional)

In Settings → *Saving and uploading*:

- **Automatically prepare the description** — the description of your changes
  is already filled in when you upload or save; you can still edit it.
- **Default description** (optional) — use your own fixed text; leave it empty
  to have EasyGit describe the files you actually changed.
- **Save and upload without asking** — *Upload my changes* saves and uploads in
  one click, with the description chosen for you.
- **✨ Suggest fixed** — it now sees new files inside new folders and describes
  mixed changes properly (for example "Add login screen and update readme")
  instead of generic or misleading text.

### Everyday improvements

- **Settings is always available** from the ⚙ button at the top of the window,
  even before you add any projects.
- The **EasyGit version** is shown next to the app name.
- **What's new & version history** inside Settings.
- Optional **Automatically close notifications** — success and information
  messages close after a few seconds; warnings and errors stay until you close
  them.

### Also included (first released in v1.3.0)

If you are coming from v1.2.0 or older, v2.0.0 also brings:

- Optional repository organization: your own order, collapsible groups and
  group suggestions based on your project folders (groups never move folders).
- Open in VS Code.
- In detailed mode: set changes aside for later, view the changes in a saved
  version, and move a file to the Recycle Bin (with two confirmations).
- Long file lists scroll while headers and counts stay visible.

## Upgrading from v1.3.0 or older (one time)

v2.0.0 is the first version that can update itself, so this one upgrade is
manual:

- **Installed:** download and run `EasyGit Setup 2.0.0.exe`. It installs over
  your current EasyGit — no need to uninstall — and keeps your projects and
  settings.
- **Portable:** replace your old portable file with `EasyGit-2.0.0-portable.exe`.

From v2.0.0 on, use Settings → *Check for updates*.

## Requirements

- Node.js is not required to run the packaged app.
- Git must still be installed on the user's machine.
- The installer is unsigned, so Windows SmartScreen may show a warning on first launch.

## Files

- `EasyGit Setup 2.0.0.exe` — recommended installer
- `EasyGit-2.0.0-portable.exe` — portable version
- `SHA256SUMS.txt` — checksums for both files
- `update.json` — information used by the in-app updater

## Git version

Tag: `v2.0.0`
