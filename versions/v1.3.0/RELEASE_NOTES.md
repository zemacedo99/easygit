# EasyGit v1.3.0

Organize your repository list your own way — optional and off by default — plus
new project tools. Fully backwards-compatible with v1.2.0; your saved projects
and settings load unchanged, and the default experience stays the same.

## Highlights

### Optional repository organization

Turn it on in **Settings → Organize your repository list**. While it is off, the
list looks and behaves exactly as before.

- **Your own order** — drag projects up and down the list.
- **Groups** — collapsible groups (one level) with a project count on each
  header, so a long list takes less space.
- **Your own groups** — create, rename, delete and reorder groups, and move
  projects between them by dragging or with the 📂 button on a project.
- **Drag and drop** — clear drop markers show where a project or group will go.
- **Group suggestions from project folders** — when two or more projects share
  the same folder (for example `C:\Git\CLIENT\…`), EasyGit offers a group. You
  review each one; nothing changes until you click **Create group**, and
  dismissed suggestions don't keep coming back. Broad folders (a drive, your user
  folder, Documents, Git, Projects…) are never suggested.
- **Works with search and sort** — a new **Custom order** sort shows your
  arrangement; other sorts (such as *Needs action first*) apply inside each group
  without changing it. Search finds projects even inside collapsed groups.
- **Remembered** — your order, groups and collapsed groups survive restarts.
  Turning the option off keeps them, and they come back when you turn it on again.
- **Safe** — groups exist only inside EasyGit. No folder is ever created, moved
  or renamed on your computer, and deleting a group never removes projects.

### Project tools

- **Open in VS Code** — open a project in your installed Visual Studio Code
  (shown by default; hide it in Settings).
- In **Show detailed save/upload steps** mode:
  - **Set aside for later** — put current changes aside (Git stash) with an
    optional description, inspect them, and restore them later.
  - **View changes** of a saved version — a read-only list of changed files and
    a line-numbered view of each change.
  - **Move to Recycle Bin** for a local file, protected by two confirmations
    (never a permanent delete).
  - Long file lists now scroll while headers and counts stay visible.

## Requirements

- Node.js is not required to run the packaged app.
- Git must still be installed on the user's machine.
- The installer is unsigned, so Windows SmartScreen may show a warning on first launch.

## Files

- `EasyGit Setup 1.3.0.exe` — recommended installer
- `EasyGit-1.3.0-portable.exe` — portable version

## Git version

Tag: `v1.3.0`
