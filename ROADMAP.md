# EasyGit Roadmap

This file tracks what is done and what could come next. EasyGit deliberately
started as a small, safe MVP — *a working simple version beats an incomplete
complex one*. Everything below "Future ideas" is optional and not yet built.

---

## ✅ Done (MVP)

- [x] Choose and justify the tech stack (Electron + Node + plain HTML/CSS/JS).
- [x] Clean project structure with clear separation of concerns.
- [x] Manual "Add repository folder" with validation.
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

- [x] **Edit the friendly name** inline from the list (pencil on each card;
      reuses the rename dialog).
- [ ] **Auto-refresh on a timer** (opt-in), e.g. re-check every N minutes.
- [x] **Search / filter** the repository list (slim search box, shown when there
      are 2+ projects).
- [x] **Sort** by status (default "needs action first"; also Name, Recently
      checked, Order added — persisted in settings).
- [x] **Light theme** and text-size option for accessibility (both off by
      default, in Settings → Appearance).
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
- [ ] **View a saved version's changes** (a friendly diff viewer).
- [ ] **Undo last save** (a guarded, clearly-explained `git reset --soft HEAD~1`).
- [ ] **Credential help**: detect auth failures and guide the user to fix sign-in.

---

## 🛡️ Conflict & advanced handling (carefully)

These are intentionally **not** in the MVP. They need careful, beginner-safe UX
before being added:

- [ ] **Guided conflict resolution** when a download can't merge automatically.
- [ ] `stash` (temporarily set aside local changes) — exposed as
      "Set my changes aside for now".
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
- [ ] **Auto-update support — still pending.** Needs a release/update *hosting
      strategy* first (e.g. a GitHub Releases or S3 feed) before wiring in
      `electron-updater`. Deliberately not enabled yet: no release server URL,
      tokens, or credentials are hardcoded. See the note below.
- [ ] Optional **brand logo** integration once the official asset file
      is available (documented placeholder path:
      `src/renderer/assets/brand-logo.png`).

> **Auto-update (future):** EasyGit is structured so auto-update can be added
> later without rework — packaging already produces versioned artifacts. To enable
> it, decide where releases will be hosted, publish artifacts there, add
> `electron-updater`, and check for updates on startup. This is intentionally left
> as a documented follow-up rather than half-implemented.

---

## 🧪 Quality

- [x] Unit tests for the pure logic modules (`statusInterpreter`, `urls`,
      `scanner`, error classification in `gitService`, plus `suggestMessage`,
      `messages`, and the list `repoSort` helper). Run with `npm test`.
- [ ] Integration tests that run against throwaway temporary Git repositories.
- [ ] Continuous integration to run the tests on each change.
