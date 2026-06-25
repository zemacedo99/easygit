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

## How to install and run

### Requirements

| You need | Why | Where to get it |
| --- | --- | --- |
| **Git** | EasyGit runs Git for you behind the scenes | https://git-scm.com/downloads |
| **Node.js** (v18 or newer) | Needed to run the app | https://nodejs.org |

> EasyGit checks whether Git is installed when it starts and warns you clearly if
> it isn't.

### The easy way

- **Windows:** double-click **`run.cmd`**.
- **macOS / Linux:** run **`./run.sh`** in a terminal.

These scripts install everything needed the first time, then launch the app.

### The manual way

```bash
npm install     # one time only
npm start       # launches EasyGit
```

For development (opens developer tools):

```bash
npm run dev
```

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
```

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

## License

MIT — see the `license` field in `package.json`.
