# EasyGit Roadmap

This file tracks what is done and what could come next. EasyGit deliberately
started as a small, safe MVP — *a working simple version beats an incomplete
complex one*. Everything below "Future ideas" is optional and not yet built.

---

## ✅ Done (MVP)

- [x] Choose and justify the tech stack (Electron + Node + plain HTML/CSS/JS).
- [x] Clean project structure with clear separation of concerns.
- [x] Manual "Add repository folder" with validation.
- [x] **Add a repository from an online link or SSH** (guided download / `git clone`):
      pick where to save it, edit the auto-suggested folder name, never overwrite
      an existing folder, and let the installed Git handle sign-in.
- [x] Persistent repository list (local JSON in the user data folder).
- [x] Status check for a single repository.
- [x] Status check for **all** repositories, running in the background with
      progressive UI updates and a final summary.
- [x] Folder scanning for `.git` repositories (with a folder picker, depth limit,
      and ignored folders — never scans the whole drive).
- [x] Basic actions: **Save a version**, **Download latest version**,
      **Upload my saved changes**.
- [x] Open folder in the file explorer.
- [x] Open online repository in the browser (SSH → HTTPS conversion for GitHub,
      GitLab, Bitbucket, Azure DevOps, and generic hosts).
- [x] Friendly status badges, explanations, and error translations.
- [x] Safety: nothing runs automatically; every change requires a button click.
      A warning is shown before downloading over unsaved local changes.
- [x] README and this roadmap.

---

## 🔜 Near-term polish

- [x] Optional, persisted **Open in VS Code** shortcut (enabled by default).
- [x] Bounded, scrollable file areas with visible counts and headers.
- [x] Detailed-only **Move to Recycle Bin**, with two confirmations and project-path validation.

- [x] **Edit the friendly name** inline from the list (pencil on each card;
      reuses the rename dialog).
- [x] **Running version in the header** (from the app metadata), **Settings in
      the header** (available with no projects), and an in-app **What's new &
      version history** bundled with the app.
- [ ] **Auto-refresh on a timer** (opt-in), e.g. re-check every N minutes.
- [x] **Search / filter** the repository list (slim search box, shown when there
      are 2+ projects).
- [x] **Sort** by status (default "needs action first"; also Name, Recently
      checked, Order added — persisted in settings).
- [x] **Light theme** and text-size option for accessibility (both off by
      default, in Settings → Appearance).
- [x] Optional **list organization** (off by default, Settings → Organize your
      repository list): drag-and-drop custom order, one level of collapsible
      EasyGit-only groups (create/rename/delete/reorder, move projects), and
      reviewable group suggestions from shared parent folders. A "Custom order"
      sort preserves the arrangement, and no folders on disk are ever touched.
- [ ] Remember the **last scanned folder** and offer common shortcuts
      (Desktop, Documents, a Development folder). *(Scan roots are already
      persisted; surfacing them as shortcuts is still to do.)*
- [x] Show a clearer per-action **busy/spinner state** on the buttons themselves.

---

## 🧭 Medium-term features

- [ ] **Multiple branches** ("version lines"): see them and switch safely.
- [ ] **Set up an online repository** for a project that doesn't have one yet
      (guided `git remote add` + first push).
- [ ] **Per-file save**: choose which changes go into a saved version, with a
      simple checklist (instead of always saving everything).
- [x] **View a saved version's changes** (Detailed-only lazy, read-only file/diff viewer).
- [ ] **Undo last save** (a guarded, clearly-explained `git reset --soft HEAD~1`).
- [ ] **Credential help**: detect auth failures and guide the user to fix sign-in.

---

## 🛡️ Conflict & advanced handling (carefully)

These are intentionally **not** in the MVP. They need careful, beginner-safe UX
before being added:

- [ ] **Guided conflict resolution** when a download can't merge automatically.
- [x] `stash` — Detailed-only **Set aside for later** stack, descriptions,
      expandable files and selected-entry restore; failed restores keep the entry.
- [ ] `rebase`, `reset --hard`, `force push`, branch delete — only behind clear
      warnings, if at all.
- [ ] **Submodules** support.

---

## 📦 Distribution

- [x] Package as an installable **Windows** desktop app with **electron-builder**
      (NSIS installer + portable `.exe`) so users don't need Node.js installed.
- [x] App icon and branding assets for EasyGit (generated from the logo into
      `build/icon.ico` / `build/icon.png`; wired into the window, taskbar, and
      installer via `package.json` → `build`).
- [ ] Add macOS (`.dmg`) and Linux (`AppImage`) distributables. The
      electron-builder config for these already exists, but they must be built on
      their own platforms and have not been verified yet.
- [x] **In-app updates** (from v2.0.0): Settings → *Check for updates* plus one
      quiet check after start; download with progress, SHA-256 verification,
      then a silent in-place NSIS upgrade or a portable self-replace, and restart.
      Source: the release tags of this Bitbucket repository, read with Git and the
      user's existing sign-in (no stored credentials). See
      [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md#in-app-updates).
- [x] Optional **online repository status** on each project (configured remote
      vs. only on this computer), read locally from Git; never changes remotes.
- [ ] **Code-sign** the installer/portable (a signed publisher would add a second
      integrity check and stop SmartScreen warnings).
- [ ] An update source that doesn't require Bitbucket access (e.g. an internal
      HTTPS file server), for users outside the repository.
- [ ] Optional **brand logo** integration once the official asset file
      is available (documented placeholder path:
      `src/renderer/assets/brand-logo.png`).

---

## 🧪 Quality

- [x] Unit tests for the pure logic modules (`statusInterpreter`, `urls`,
      `scanner`, error classification in `gitService`, plus `suggestMessage`,
      `messages`, the list `repoSort` helper and the `repoLayout` organization
      model). Run with `npm test`.
- [x] Integration tests against temporary Git repositories for cloning, stash and
      history/diffs; OS integration safety tests and isolated Electron UI harnesses
      (`scripts/verify-detailed-ui.js`, `scripts/verify-organization-ui.js`,
      `scripts/verify-header-ui.js`).
- [ ] Continuous integration to run the tests on each change.
