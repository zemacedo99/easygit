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

## Optional project tools

These additions are included in v1.3.0.

- **Open in VS Code** opens the project with your installed editor, even before
  checking changes. Hide it with Settings → Show “Open in VS Code” button.
  Windows uses the executable alongside the `code` command or a standard VS Code
  installation folder. Nothing is installed automatically and no shell is opened.
- Enable **Show detailed save/upload steps** for **Set aside for later** (Git stash).
  “Set changes aside” includes all tracked changes, staged changes and new files;
  ignored files stay in place. Add an optional description. Show/refresh the stack
  to see newest entries first, then expand an entry to inspect its files.
  “Restore changes” takes the selected entry out of the stack after success,
  preserving the Ready to save selection where possible. Save or set aside current
  changes before restoring. A failed restore keeps the entry and may leave files
  needing attention; resolve them in your editor. EasyGit never resolves conflicts
  automatically. Avoid changing the stack in another Git tool during these actions.
- In Detailed mode, local file rows offer **Move to Recycle Bin**, protected by
  two confirmations. This affects the actual file, unlike “Remove from EasyGit”.
  It never uses permanent deletion or `git rm`. Linked files/folders, directories,
  Git metadata and paths outside the project are refused. Restore a recycled file
  through your operating system if needed.
- **View changes** on a saved version opens its changed files, then a read-only
  line-numbered diff. Merge commits are compared with their first parent. Binary
  files show an explanation. Diffs start at 600 lines; “Load more” extends to a
  10,000-line display limit. Output over 2 MiB is left to your editor.
- File areas scroll after 360 pixels while headers/counts stay visible. No files
  are omitted; commit and stack file lists and diffs also scroll.

Simple mode keeps its existing computer ⇄ online flow. Stack, file removal and
diff controls are only available in Detailed mode. A stack is temporary storage,
not an online backup. No automatic update is involved.

Developer verification: `npm test` includes offline temporary-repository tests.
On a Windows desktop, run
`./node_modules/.bin/electron.cmd scripts/verify-detailed-ui.js` for the real-app
UI harness. It uses an isolated temporary profile and 250 disposable files,
recycles one test file, and leaves its temporary profile/screenshot path in the
output for inspection. It never uses your saved projects.
`scripts/verify-organization-ui.js` (list organization, three restarts) and
`scripts/verify-header-ui.js` (header version, Settings and version history) and
`scripts/verify-describe-ui.js` (upload descriptions, ✨ Suggest, notifications) work
the same way.

## Download the latest version

**Latest release: v1.3.0.** Pick a download below, then follow
[Installing EasyGit](#installing-easygit). Node.js is **not** required; **Git**
must be installed.

| Download | Best for | File |
| --- | --- | --- |
| **Installer** *(recommended)* | Most users — installs EasyGit and adds Start-menu / desktop shortcuts | [`EasyGit Setup 1.3.0.exe`](versions/v1.3.0/EasyGit%20Setup%201.3.0.exe) |
| **Portable** | Anyone who doesn't want to install — just double-click to run | [`EasyGit-1.3.0-portable.exe`](versions/v1.3.0/EasyGit-1.3.0-portable.exe) |

- The app is currently **unsigned**, so Windows SmartScreen may warn on first
  launch ("Windows protected your PC" → **More info** → **Run anyway**).
- **Verify your download** against the checksums in
  [`versions/v1.3.0/SHA256SUMS.txt`](versions/v1.3.0/SHA256SUMS.txt):
  ```powershell
  Get-FileHash ".\versions\v1.3.0\EasyGit Setup 1.3.0.exe" -Algorithm SHA256
  ```
- Full notes: [`versions/v1.3.0/RELEASE_NOTES.md`](versions/v1.3.0/RELEASE_NOTES.md).

**Older releases** are kept under [`versions/`](versions/) (for example,
`versions/v1.2.0/`, `versions/v1.1.0/` and `versions/v1.0.0/`).

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
Git error classification, commit-message suggestions, the list sorting/
filtering, and the optional list organization model) have unit tests using Node's built-in test runner — no extra
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
| **Auto-find Git repositories** | Searches the usual places on your computer for Git projects, with three choices: **Quick scan** (your usual project/code folders), **Deeper scan** (also Desktop, Documents and Downloads), or **Choose a folder…** (search inside one folder you pick). It shows live progress, can be stopped at any time, and lets you review and pick which projects to add. It never blindly scans your whole drive. It also offers **Add repository from link or SSH** — paste an online project link (`https://…`, `git@…`, or `ssh://…`), choose where to save it, and EasyGit downloads it to your computer and adds it. Your existing Git/SSH/HTTPS sign-in is used; EasyGit never asks for or stores passwords, and never overwrites an existing folder. |
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

#### Optional: your own order and groups

If you prefer, you can organize the list yourself. Turn on **Settings → Organize
your repository list** and then pick any of these options:

- **Arrange projects in your own order** — drag projects up and down the list.
- **Show projects in groups** — collapsible groups such as one per client, with
  a project count on each group header.
- **Create and edit your own groups** — **New group**, rename, delete and reorder
  groups, and move projects between them by dragging or with the 📂 button on a
  project.
- **Suggest groups from project folders** — when two or more projects share the
  same folder (for example `C:\Git\ACME\documentation` and
  `C:\Git\ACME\management`), EasyGit offers a `ACME` group. Nothing
  changes until you click **Create group**, and a suggestion you dismiss is not
  shown again unless the projects in that folder change. Broad folders such as a
  drive, your user folder, `Documents`, `Git` or `Projects` are never suggested.

> **Groups only exist inside EasyGit.** They only change how this list looks.
> No folder is ever created, moved or renamed on your computer. Deleting a group
> keeps its projects in EasyGit under “Not in a group”.

How it works with search and sorting:

- Your arrangement shows under **Sort → Custom order** (which EasyGit picks for
  you when you turn ordering or groups on). Other sorts, such as **Needs action
  first**, sort projects *inside* each group. They never change your saved
  arrangement, and choosing **Custom order** brings it back. Dragging is
  available in Custom order.
- Search always looks in every project, including ones in collapsed groups.
  Matching groups open while you search, and groups without a match are hidden.
- The count next to “Your repositories” always counts projects, not groups.
- Turning the option off brings back the normal list and your previous sort. Your
  order and groups are kept, so they come back when you turn it on again.

### Settings (the ⚙ button)

The ⚙ button is in the top-right of the window, next to the main actions, so
Settings is always available — even before you add any projects. The EasyGit
version you are running is shown next to the app name (for example
`EasyGit v1.3.0`).

Everything extra is optional and off by default, so the app stays simple:

- **Show detailed save/upload steps** — turns on the advanced flow.
- **Show version line details** — shows/switches branches.
- **Saving and uploading** — optionally have the description of your changes
  **prepared automatically** (still editable), with an optional **default
  description**; and, under it, **Save and upload without asking**, so
  *Upload my changes* saves and uploads in one click using that description.
  The description comes from your default text, or else from the files you
  actually changed (the same local ✨ Suggest, never an online service), or
  else "Update project files".
- **Automatically close notifications** — success/information messages close
  after about 5 seconds (paused while you point at them); warnings and errors
  always stay until you close them. Off by default.
- **Organize your repository list** — your own order and EasyGit-only groups
  (see above).
- **Appearance** — a **light theme** and a larger **text size** for readability.
- **What's new & version history** (under *About EasyGit*) — every EasyGit
  release, newest first, with what each one added.
- **Check for updates** (under *About EasyGit*) — see below.

### Updating EasyGit from inside the app

From v1.4.0, EasyGit can update itself. Shortly after it starts it quietly checks
for a newer version; if there is one, a small **Update available** label appears
next to the version in the header. Nothing is installed until you choose to:

1. Open ⚙ Settings → *About EasyGit* (or click **Update available**).
2. Optionally read **What's new** for the new version.
3. Click **Update to vX.Y.Z** — it downloads in the background with progress,
   then is checked against the official checksum.
4. Click **Restart and update**. EasyGit closes, updates itself and starts again;
   your projects and settings are kept. The installed app upgrades in place (no
   uninstall); the portable app replaces its own file.

Updates come from the EasyGit repository on Bitbucket, using the sign-in your
computer already has for it — EasyGit never asks for or stores passwords. If you
can't open the EasyGit project in Bitbucket, the check shows a friendly "No
access" message and you can keep updating manually from the download links.
A download that doesn't match the official checksum is deleted and never run.

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
| Add repository from link or SSH | Download an online project | `git clone -- <link> <folder>` (run with a safe argument array; interactive prompts disabled) |

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
If you use the optional list organization, the same file also stores your
custom order, group names, which project is in which group, collapsed groups and
dismissed suggestions. This data refers to projects by EasyGit's internal id and
never changes your folders. Files from older versions load unchanged.

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
- Support rebasing, resetting, force-pushing, or deleting branches.
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
