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

- [ ] **Edit the friendly name** inline from the list (rename exists in details).
- [ ] **Auto-refresh on a timer** (opt-in), e.g. re-check every N minutes.
- [ ] **Search / filter** the repository list when there are many repos.
- [ ] **Sort** by status (e.g. show "needs action" first).
- [ ] **Light theme** and font-size option for accessibility.
- [ ] Remember the **last scanned folder** and offer common shortcuts
      (Desktop, Documents, a Development folder).
- [ ] Show a clearer per-action **busy/spinner state** on the buttons themselves.

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

- [ ] Package as installable desktop apps with **electron-builder**
      (`.exe` / `.dmg` / `AppImage`) so users don't need Node.js installed.
- [ ] Auto-update support.
- [ ] App icon and branding assets.

---

## 🧪 Quality

- [ ] Unit tests for the pure logic modules (`statusInterpreter`, `urls`,
      `scanner`, error classification in `gitService`).
- [ ] Integration tests that run against throwaway temporary Git repositories.
- [ ] Continuous integration to run the tests on each change.
