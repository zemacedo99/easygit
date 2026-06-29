# EasyGit

**Manage your projects without learning Git.**

EasyGit is a friendly desktop app that helps you keep your project folders up to
date — saving your work, downloading the newest changes, and uploading yours —
**without needing to understand Git or type any commands**.

If you know how to work with files and folders, you already know enough to use
EasyGit.

---

## What EasyGit is

Many projects (code, documents, websites) are stored in something called a *Git
repository*. Git is powerful, but it speaks in confusing terms like "commit",
"push", "remote", and "HEAD is detached".

EasyGit hides all of that. It gives you:

- A single window listing all your project folders.
- Plain-English status for each one (e.g. *"There are newer versions available
  online"*).
- Big, clear buttons like **Save a version**, **Download latest version**, and
  **Upload my saved changes**.
- A short explanation, in normal language, of what's going on and what (if
  anything) you should do next.

## Who it is for

People who:

- Understand **files and folders**, but
- Do **not** understand Git, and
- Just want to keep their projects saved, backed up online, and up to date.

Examples: writers, designers, students, researchers, hobbyist makers, or anyone
collaborating on a shared project who was told "just use Git" and would rather
not.

---

## Download the latest version

**Latest release: v1.1.0.** Pick a download below, then follow
[Installing EasyGit](#installing-easygit). Node.js is **not** required; **Git**
must be installed.

| Download | Best for | File |
| --- | --- | --- |
| **Installer** *(recommended)* | Most users — installs EasyGit and adds Start-menu / desktop shortcuts | [`EasyGit Setup 1.1.0.exe`](versions/v1.1.0/EasyGit%20Setup%201.1.0.exe) |
| **Portable** | Anyone who doesn't want to install — just double-click to run | [`EasyGit-1.1.0-portable.exe`](versions/v1.1.0/EasyGit-1.1.0-portable.exe) |

- The app is currently **unsigned**, so Windows SmartScreen may warn on first
  launch ("Windows protected your PC" → **More info** → **Run anyway**).
- **Verify your download** against the checksums in
  [`versions/v1.1.0/SHA256SUMS.txt`](versions/v1.1.0/SHA256SUMS.txt):
  ```powershell
  Get-FileHash ".\versions\v1.1.0\EasyGit Setup 1.1.0.exe" -Algorithm SHA256
  ```
- Full notes: [`versions/v1.1.0/RELEASE_NOTES.md`](versions/v1.1.0/RELEASE_NOTES.md).

**Older releases** are kept under [`versions/`](versions/) (for example,
`versions/v1.0.0/`).

---

## Installing EasyGit

**For everyday users — no Node.js, no commands, no terminal.**

Download the EasyGit installer (or the portable `.exe`) and run it like any other
desktop app:

1. Get the EasyGit installer or portable app from your team's shared location (or
   build it yourself — see **Building EasyGit** below).
2. **Windows:**
   - *Installer* — `EasyGit Setup <version>.exe`: double-click it, choose where to
     install, and EasyGit is added to your Start menu (and, if you want, the
     desktop).
   - *Portable* — `EasyGit-<version>-portable.exe`: just double-click to run; no
     installation needed.
3. Launch EasyGit from the Start menu, the desktop shortcut, or the portable file.
   You'll see the EasyGit icon in the window and taskbar.

### What you need

| You need | For the packaged app? | Notes |
| --- | --- | --- |
| **Git** | ✅ **Required** | EasyGit runs Git for you. Get it free from https://git-scm.com/downloads. EasyGit checks for Git at startup and tells you clearly — including where to download it — if it's missing. |
| **Node.js** | ❌ **Not required** | Node.js is bundled inside the packaged app. You only need it if you build EasyGit from source. |

> **In short:** the packaged EasyGit app does **not** need Node.js, but it still
> needs **Git** installed on the computer.

---

## Building EasyGit

*For developers / maintainers. You need [Node.js](https://nodejs.org) (v18 or
newer) and Git to build EasyGit.*

### Run from source (no packaging)

The quick scripts install dependencies the first time, then launch the app:

- **Windows:** double-click **`run.cmd`**.
- **macOS / Linux:** run **`./run.sh`** in a terminal.

Or do it manually:

```bash
npm install     # one time only
npm start       # launches EasyGit
npm run dev     # same, but with developer tools open
```

### Running the tests

The pure logic modules (status interpretation, URL conversion, scanning helpers,
Git error classification, commit-message suggestions, and the list sorting/
filtering) have unit tests using Node's built-in test runner — no extra
dependencies:

```bash
npm test
```

### Build installable desktop apps

EasyGit is packaged with [electron-builder](https://www.electron.build/), so end
users don't need Node.js.

```bash
npm install            # one time only
npm run dist           # build installer(s) for the current OS
npm run package        # quick UNPACKED build, no installer (fastest to test)
npm run dist:win       # build the Windows targets specifically
```

**Where the output goes:** everything is written to **`dist/`**, which is
git-ignored — generated installers are never committed.

On Windows, `npm run dist` produces:

| File in `dist/` | What it is |
| --- | --- |
| `EasyGit Setup <version>.exe` | NSIS installer (lets the user pick the install folder, adds Start-menu/desktop shortcuts) |
| `EasyGit-<version>-portable.exe` | Portable single-file app (run without installing) |
| `win-unpacked/EasyGit.exe` | The unpacked app (also produced on its own by `npm run package`) |

> macOS (`.dmg`) and Linux (`AppImage`) targets are configured too, but must be
> built on (or targeted from) those platforms. **Windows is the priority and the
> only target verified so far.**

> **Windows build note:** the first build downloads electron-builder's signing
> tools, whose archive contains macOS symlinks. Extracting them needs the
> "Create symbolic links" privilege — enable **Windows Developer Mode**
> (Settings → Privacy & security → For developers) or run the first build from an
> elevated (admin) terminal. The app itself is **not** code-signed (no
> certificate), so Windows SmartScreen may warn on first launch; signing is a
> future step that needs a code-signing certificate.

### Testing the packaged app

1. Run `npm run package` (fastest — unpacked, no installer download needed).
2. Double-click `dist/win-unpacked/EasyGit.exe`. **No `npm start`, no Node.js, no
   terminal** — this is exactly the end-user experience.
3. Confirm: the EasyGit icon shows in the window/taskbar; the header logo and the
   credits/footer render with no broken images; Simple mode and the **✨ Suggest**
   button work.

### Updating the app icon / branding

The app icon is generated from the EasyGit logo at
`src/renderer/assets/logo.svg` (which is also the in-app header logo).

1. Replace `src/renderer/assets/logo.svg`.
2. Regenerate the packaging icons:
   ```bash
   npm run make-icons
   ```
   This writes **`build/icon.png`** (512px — used for Linux/macOS) and
   **`build/icon.ico`** (multi-size Windows icon). Both are committed to the repo.
3. Rebuild with `npm run dist`.

### Optional: brand logo

EasyGit currently ships **without** a separate brand logo image, and
the UI does not depend on one, so nothing breaks. When the official asset becomes
available, add it at:

```
src/renderer/assets/brand-logo.png
```

and wire it into the header where appropriate. Do **not** commit an unofficial or
placeholder version.

### Releasing a new version

EasyGit releases are versioned with a Git tag (e.g. `v1.0.0`) and a committed
`versions/vX.Y.Z/` folder containing the installer, portable `.exe`,
`SHA256SUMS.txt`, and release notes. For the full step-by-step process, see
[Release Process](docs/RELEASE_PROCESS.md).

---

## What you can do

### Main actions (top of the window)

| Button | What it does |
| --- | --- |
| **Auto-find Git repositories** | Searches the usual places on your computer for Git projects, with three choices: **Quick scan** (your usual project/code folders), **Deeper scan** (also Desktop, Documents and Downloads), or **Choose a folder…** (search inside one folder you pick). It shows live progress, can be stopped at any time, and lets you review and pick which projects to add. It never blindly scans your whole drive. |
| **Add repository folder** | Pick one folder yourself. EasyGit checks it really is a repository before adding it. |
| **Check if everything is updated** | Checks every repository in the background, refreshing online information, and shows a summary. The window stays responsive while it works. |

### Per-repository actions (when one is selected)

| Button | What it does |
| --- | --- |
| **Check changes** | Looks at what changed on your computer (no internet needed). |
| **Check online version** | Refreshes the comparison with the online repository. |
| **Save a version** | Saves your current work as a named version on your computer. |
| **Download latest version** | Gets the newest version from online. |
| **Upload my saved changes** | Sends your saved versions to the online repository. |
| **Open folder** | Opens the project folder in your file explorer. |
| **Open online repository** | Opens the project's online page (GitHub, GitLab, Bitbucket…) in your browser. |

### Status badges

Each repository shows one of these:

| Badge | Meaning |
| --- | --- |
| **Up to date** | Everything is updated. No action needed. |
| **Local changes** | You have changes on this computer not yet saved as a version. |
| **Needs upload** | You have saved versions that haven't been uploaded. |
| **Needs download** | There are newer versions online you don't have yet. |
| **Needs upload and download** | Both of the above. |
| **Not connected to online repository** | This project isn't linked to an online repository. |
| **Error** | Something went wrong (e.g. the folder was moved). |

### Finding and organizing your projects

When you have more than one project, a small search box and a **Sort** control
appear above the list. You can search by name or folder, and sort by **Needs
action first** (the default — projects that need your attention float to the
top), **Name**, **Recently checked**, or **Order added**. Hover a project to
rename it inline (this only changes the name shown in EasyGit). The sort choice
is remembered.

### Settings (the ⚙ button)

Everything extra is optional and off by default, so the app stays simple:

- **Show detailed save/upload steps** — turns on the advanced flow.
- **Show version line details** — shows/switches branches.
- **Appearance** — a **light theme** and a larger **text size** for readability.

---

## What Git commands are used internally

EasyGit is just a friendly face over normal Git. Here is exactly what each action
runs, so technical users (or curious ones) know precisely what happens.

| EasyGit action | What it means | Git command(s) |
| --- | --- | --- |
| Check changes | See what changed locally | `git status --porcelain`, `git branch --show-current`, `git rev-list --left-right --count HEAD...@{u}` |
| Check online version | Refresh info from online, then compare | `git fetch --all --prune` then the checks above |
| Save a version | Save current work locally | `git add -A` + `git commit -m "<your message>"` |
| Download latest version | Get newest online changes | `git pull` |
| Upload my saved changes | Send saved work online | `git push` |
| Open online repository | Find the online address | `git remote get-url origin` (converted to a web link) |
| Recent saved versions | Show recent history | `git log -n5 --pretty=...` |
| Validate a folder | Confirm it's a repository | `git rev-parse --is-inside-work-tree` |

### Friendly translations

EasyGit never shows raw Git output. Some examples of what it shows instead:

| Git says | EasyGit says |
| --- | --- |
| `Your branch is ahead of 'origin/main' by 2 commits.` | "You have 2 saved versions on this computer that have not been uploaded yet." |
| `Your branch is behind 'origin/main' by 3 commits.` | "There are 3 newer versions available online." |
| `working tree clean` | "Everything is clean. No local changes." |
| `fatal: not a git repository` | "This folder does not look like a Git repository." |
| `Authentication failed` | "The online repository did not accept your sign-in…" |
| `CONFLICT (content): Merge conflict in …` | "The online changes and your local changes affect the same things… this one needs a person to help." |

---

## How your data is stored

EasyGit remembers your list of repositories in a small JSON file inside your
operating system's per-user app data folder (not inside any of your projects).
For each repository it stores: the friendly name, the local folder path, the last
known status, when it was last checked, and the online repository URL (if any).

The path to this file is determined at runtime; EasyGit never writes into your
project folders except when *you* click an action that does (Save / Download /
Upload).

---

## How it's built (for maintainers)

EasyGit is an **Electron** desktop app. Electron is used because the app needs to
do things a normal website cannot: open native folder pickers that return real
file paths, open the system file explorer, and run Git on the local machine.

The code is split by responsibility — **no Git logic lives in the UI**:

```
src/
  main/                 # Electron main process (Node.js) – has filesystem + Git access
    main.js             #   app startup, window, and IPC wiring (thin)
    gitService.js       #   the ONLY place that runs Git commands (safe execFile)
    scanner.js          #   finds repositories on disk
    storage.js          #   saves/loads the repo list (JSON)
    statusInterpreter.js#   turns raw Git facts into a friendly status
    messages.js         #   all user-facing wording + error translations
    repoManager.js      #   orchestrates everything above
    urls.js             #   converts SSH/HTTPS remotes into browser links
  preload/
    preload.js          # secure bridge exposing a small window.easygit API
  renderer/             # the UI (no Node access, no Git access)
    index.html
    styles.css
    app.js              #   controller: state + event wiring
    ui.js               #   DOM building / rendering
    labels.js           #   presentation helpers (time, action list)
    assets/
      logo.svg          #   EasyGit logo (header) + source for the app icon
build/                  # packaging resources (committed): icon.ico, icon.png
scripts/
  make-icons.js         # regenerates build/ icons from the logo (not shipped)
```

Packaging is configured in the `build` section of `package.json` (electron-builder).
Build output goes to `dist/` (git-ignored).

**Security:** the renderer runs with `contextIsolation` on and `nodeIntegration`
off. It can only call the handful of functions exposed in `preload.js`.

---

## Current limitations

EasyGit is intentionally a simple, safe MVP. It does **not** (yet):

- Resolve merge conflicts. If a download causes a conflict, EasyGit tells you a
  person needs to help and changes nothing automatically.
- Handle multiple branches / switching "version lines".
- Support stashing, rebasing, resetting, force-pushing, or deleting branches.
- Handle Git submodules.
- Manage sign-in credentials. It relies on Git's existing credential setup on
  your machine (e.g. a credential manager or SSH key).

EasyGit will **never** run upload, download, save, reset, checkout, merge,
rebase, delete, or force operations on its own — only when you click a clear
button.

## Future improvements

See [ROADMAP.md](ROADMAP.md) for the planned next steps.

---

## Credits

Project vision: Inês Caetano  
Developed by: José Dantas Macedo, with Claude

The EasyGit logo (shown in the app header) lives at
`src/renderer/assets/logo.svg`. It merges the brand mark (red square
with the top-right sail cut), the mascot mark (the two nodes as eyes), and
the Git branch/merge graph.

---

## License

MIT — see the `license` field in `package.json`.
