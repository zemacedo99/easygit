# EasyGit v1.1.0

Polish release — quality-of-life improvements to the repository list and the
overall experience. Fully backwards-compatible with v1.0.0; the default flow is
unchanged (On this computer ⇄ Online project).

## Highlights

- **Search your projects** — a slim search box appears above the list once you
  have a few projects, filtering by name or folder.
- **Sort the list** — "Needs action first" (default), Name, Recently checked, or
  Order added. Your choice is remembered.
- **Rename from the list** — hover a project and click the pencil to rename it
  (this only changes the name shown in EasyGit).
- **Clearer loading feedback** — action buttons show a spinner while they work.
- **Light theme and larger text size** — both optional, in Settings → Appearance,
  off by default.
- **Under the hood** — unit tests for the core logic (status interpretation, URL
  handling, scanning, error classification, and the new list sorting/filtering).

Everything new is optional or invisible until needed, so the app stays as simple
as before by default.

## Requirements

- Node.js is not required to run the packaged app.
- Git must still be installed on the user's machine.
- The installer is unsigned, so Windows SmartScreen may show a warning on first launch.

## Files

- `EasyGit Setup 1.1.0.exe` — recommended installer
- `EasyGit-1.1.0-portable.exe` — portable version

## Git version

Tag: `v1.1.0`
