# EasyGit Release Process

This document describes how EasyGit is released, so a new release can be produced
consistently without re-explaining the steps each time.

The current latest release is **`v2.1.1`**.

---

## Release model

Releases are published as **GitHub Releases** of
[`zemacedo99/easygit`](https://github.com/zemacedo99/easygit/releases). Every
release has **three** things that travel together:

1. **An annotated Git tag** — e.g. `v2.2.0`.
2. **A versioned folder committed in the repo** — e.g. `versions/v2.2.0/` — with
   the release notes, the checksums and the in-app updater metadata (text only).
3. **A GitHub Release for that tag** with the installer and the portable `.exe`
   attached as release assets.

A Git tag points to a **commit**, not to a folder. So the tag for a release must
point to the commit that *contains* that release's `versions/vX.Y.Z/` folder.

```text
versions/vX.Y.Z/                 # committed
  RELEASE_NOTES.md               # human-readable notes for this version
  SHA256SUMS.txt                 # checksums for the two .exe files
  update.json                    # in-app updater metadata (from v2.0.0 on)

GitHub Release vX.Y.Z            # attached assets (never committed)
  EasyGit Setup X.Y.Z.exe        # installer (recommended for users)
  EasyGit-X.Y.Z-portable.exe     # portable executable
```

> Executables are **never** committed: `dist/` and `*.exe` are ignored everywhere
> by [`.gitignore`](../.gitignore), including under `versions/`. Releases up to
> v2.1.0 keep only their release notes in this repository.

---

## Version numbering (semantic versioning)

Use `MAJOR.MINOR.PATCH`:

| Change | New version | Example |
| --- | --- | --- |
| **Patch** — bug fixes, no new features, no breaking changes | bump PATCH | `1.0.0` → `1.0.1` |
| **Minor** — new features, backwards-compatible | bump MINOR, reset PATCH | `1.0.1` → `1.1.0` |
| **Major** — breaking changes | bump MAJOR, reset MINOR + PATCH | `1.1.0` → `2.0.0` |

Rules:

- **`v1.0.0` must never be modified.** It is a fixed historical release.
- The same applies to **every** released version — once `versions/vX.Y.Z/` is
  pushed and tagged and its GitHub Release is published, treat it as immutable.
- If you find a mistake after a release, **do not** edit the old release. Ship a
  new patch version instead (e.g. `v1.0.0` mistake → release `v1.0.1`, or
  `v1.0.1` → `v1.0.2`).

---

## Step-by-step: producing a new release

The example below produces a **`v1.0.1`** patch release. Substitute the real
version number throughout.

### 1. Check the current state

```bash
git status
git branch --show-current
git log --oneline -5
git tag --list
```

### 2. Confirm you are on `master`

`git branch --show-current` must print `master`, and the working tree should be
clean (commit or stash any unrelated work first).

### 3. Decide the new version number

For this example:

```text
1.0.1
```

### 4. Update the version in the project metadata

Set the new version in:

```text
package.json        ->  "version": "1.0.1"
package-lock.json   ->  update the "version" field(s) to 1.0.1
```

The simplest reliable way to update both at once:

```bash
npm version 1.0.1 --no-git-tag-version
```

> `npm version ... --no-git-tag-version` updates `package.json` **and**
> `package-lock.json` without creating its own Git tag or commit (we create the
> tag ourselves, later, on the correct commit).

### 4a. Update the in-app “What's new” changelog (required, before building)

EasyGit shows its version history inside the app (Settings → **What's new &
version history**). That list is bundled with the app, so it must be updated
**before** `npm run dist:win`, or the new build will not mention itself.

1. Add the new release at the **top** of `CHANGELOG` in
   [`src/renderer/changelog.mjs`](../src/renderer/changelog.mjs): `version`,
   `date` (the release/tag date, `YYYY-MM-DD`), a one-line `summary`, and
   `sections` of short, plain-language bullets. Keep it grounded in the release
   notes you write in step 12 — never invent features.
2. Update the README **Download the latest version** section to the new version
   number (the downloads themselves are on the GitHub Releases page).
3. Run `npm test`. `test/changelog.test.mjs` **fails** if the `package.json`
   version is not the newest changelog entry, if entries are out of order, or if
   a released `versions/` folder is missing from the changelog — so a forgotten
   changelog blocks the release.

The running version shown in the header (`EasyGit vX.Y.Z`) comes from the app
metadata (`app.getVersion()`), so it updates automatically with step 4.

### 5. Commit any app/code changes first

If this release includes code changes, commit them now (normal commits), so the
release-artifacts commit only adds the version folder and the version bump.

### 6. Build the Windows release

```bash
npm run dist:win
```

> First-time build note (Windows): electron-builder downloads signing tools whose
> archive contains symlinks. If extraction fails with "a required privilege is not
> held", enable **Windows Developer Mode** (Settings → Privacy & security → For
> developers) or run the build once from an elevated terminal. See
> [README → Building EasyGit](../README.md#building-easygit).

### 7. Confirm the generated files exist in `dist/`

```text
dist/EasyGit Setup 1.0.1.exe
dist/EasyGit-1.0.1-portable.exe
```

### 8. Test that the packaged app launches

Double-click `dist/win-unpacked/EasyGit.exe` (or the installer) and confirm it
opens, with no Node.js or terminal required. Check the EasyGit icon appears and
the main flow works. Confirm the header shows the **new version** and that
⚙ → **What's new & version history** lists it first.

### 9. Create the new version folder

```text
versions/v1.0.1/
```

### 10. Copy the artifacts from `dist/` into the version folder (local only)

Copy (do **not** move) the two executables. Git ignores them; they are copied
here only so the checksums and `update.json` can be generated from the real
files, and they are uploaded to the GitHub Release in step 15a:

```text
versions/v1.0.1/EasyGit Setup 1.0.1.exe
versions/v1.0.1/EasyGit-1.0.1-portable.exe
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path versions\v1.0.1 | Out-Null
Copy-Item "dist\EasyGit Setup 1.0.1.exe"    versions\v1.0.1 -Force
Copy-Item "dist\EasyGit-1.0.1-portable.exe" versions\v1.0.1 -Force
```

### 11. Generate SHA-256 checksums

Write them to `versions/v1.0.1/SHA256SUMS.txt` in `<HASH>  <filename>` format
(two spaces), one line per file.

PowerShell:

```powershell
Get-ChildItem versions\v1.0.1\*.exe | ForEach-Object {
  "{0}  {1}" -f (Get-FileHash $_ -Algorithm SHA256).Hash, $_.Name
} | Set-Content -Encoding ascii versions\v1.0.1\SHA256SUMS.txt
```

Then re-verify the copies match the originals from `dist/` before committing.

### 11a. Generate the in-app update metadata (required from v2.0.0)

EasyGit updates itself from this repository and its GitHub Releases (see
[In-app updates](#in-app-updates)). It needs `versions/vX.Y.Z/update.json`,
generated from the real files:

```bash
node scripts/make-update-metadata.mjs 1.0.1
```

The script hashes both executables, checks them against `SHA256SUMS.txt`, copies
this version's "What's new" from `src/renderer/changelog.mjs`, validates the
result exactly as EasyGit will, and writes `update.json`. It **refuses** versions
older than v2.0.0 and versions that are already tagged, so released folders are
never touched. Then run `npm test`: while the executables are in the folder,
`test/updateMetadata.test.mjs` **fails** if a release folder from v2.0.0 onward
has no `update.json`, or if it doesn't match the files or the changelog.

### 12. Create the release notes

Create `versions/v1.0.1/RELEASE_NOTES.md`. Use the previous version's notes as a
template (see [`versions/v1.0.0/RELEASE_NOTES.md`](../versions/v1.0.0/RELEASE_NOTES.md))
and describe what changed in this version. Keep the **Requirements** reminders:

- Node.js is not required to run the packaged app.
- Git must still be installed on the user's machine.
- The installer is unsigned, so Windows SmartScreen may warn on first launch.

### 13. Commit the release artifacts

Stage the version folder (only its text files are tracked; the `.exe` files stay
ignored) plus the version bump (adjust to what actually changed):

```bash
git add versions/v1.0.1 package.json package-lock.json src/renderer/changelog.mjs README.md
git status --short   # must NOT list any .exe
git commit -m "Add v1.0.1 release metadata"
```

### 14. Create an annotated tag on this commit

```bash
git tag -a v1.0.1 -m "EasyGit v1.0.1"
```

Because you just committed, `HEAD` is the release-artifacts commit, so the tag
points to the right place. (To be explicit you can tag a specific commit:
`git tag -a v1.0.1 <commit> -m "EasyGit v1.0.1"`.)

### 15. Push `master` and the tag

```bash
git push origin master
git push origin v1.0.1
```

### 15a. Publish the GitHub Release

Create a GitHub Release for tag `v1.0.1` (title `EasyGit v1.0.1`, body = the
release notes) and attach **exactly** the two files named in `update.json`:

```bash
gh release create v1.0.1 --title "EasyGit v1.0.1" --notes-file versions/v1.0.1/RELEASE_NOTES.md \
  "versions/v1.0.1/EasyGit Setup 1.0.1.exe" "versions/v1.0.1/EasyGit-1.0.1-portable.exe"
```

Do not rename the assets: the in-app updater downloads
`https://github.com/zemacedo99/easygit/releases/download/vX.Y.Z/<file name>` and
rejects anything whose size or SHA-256 differs from `update.json`.

### 16. Verify

```bash
git status
git log --oneline -5
git tag -n
git ls-tree -r v1.0.1 -- versions/v1.0.1
git ls-remote --tags origin v1.0.1
```

Confirm: working tree clean; the tag lists for `v1.0.1`; `RELEASE_NOTES.md`,
`SHA256SUMS.txt` and `update.json` appear under `versions/v1.0.1/` (no `.exe`);
`dist/` is still ignored; the remote tag matches; and the GitHub Release lists
both executables.

---

## Important rules (do / don't)

- ✅ **Do** create a brand-new `versions/vX.Y.Z/` folder for each release.
- ✅ **Do** create a brand-new annotated tag for each release, pointing at the
  commit that contains that version folder.
- ❌ **Do not** modify existing version folders, such as `versions/v1.0.0/`.
- ❌ **Do not** move or recreate old tags — unless you are *intentionally* fixing
  a release mistake and have decided to do so deliberately.
- ❌ **Do not** commit the `dist/` folder.
- ❌ **Do not** commit generated `.exe` files anywhere — they belong on the
  GitHub Release.
- ❌ **Do not** change the updater itself as part of a normal release; a release
  only adds `versions/vX.Y.Z/update.json` (step 11a).
- 🔁 If a mistake is found **after** a release, ship a new patch version (e.g.
  `v1.0.2`) rather than altering the released one.

---

## In-app updates

From **v2.0.0**, EasyGit can update itself (Settings → *About EasyGit* →
**Check for updates**; it also checks quietly once after starting).

- **Source:** the public GitHub repository
  `https://github.com/zemacedo99/easygit.git`, configured in one place:
  [`src/main/updateConfig.js`](../src/main/updateConfig.js). The newest `vX.Y.Z`
  tag is the latest release; its `versions/vX.Y.Z/update.json` lists the files,
  sizes and SHA-256 checksums.
- **Access:** EasyGit reads the tags and `update.json` with **Git** (prompts
  disabled); a public repository needs no sign-in. EasyGit never asks for,
  stores or logs credentials.
- **Download:** only the one file needed (installer or portable exe) is fetched
  over HTTPS from the GitHub Release assets of that tag. (If a tag contains the
  exe itself, as in a local test repository, it is fetched from the tag.)
- **Verification:** the file's size and SHA-256 must match `update.json`, or it is
  deleted and nothing runs. It is checked again right before installing.
- **Installed (NSIS):** EasyGit runs the new installer silently
  (`/S --updated --easygit-restart`): it upgrades in place, keeps settings, and
  starts the new version (the restart is done by
  [`build/installer.nsh`](../build/installer.nsh), because electron-builder's own
  `--force-run` relaunch does not work on every Windows setup). No uninstall
  needed.
- **Portable:** the verified new exe is started as a helper; it waits for the old
  exe to close, swaps itself into the same file name (rolling back on any error)
  and restarts it.
- **Testing:** set `EASYGIT_UPDATE_SOURCE=file:///C:/path/to/test-repo` to point a
  build at a local test repository instead of GitHub (for a `file://` source the
  executables must be inside the tag's `versions/vX.Y.Z/` folder).
- **First self-updating release:** users on v1.3.0 or older don't have the
  updater, so they install v2.0.0 once manually; after that, updates are in-app.

## How users update (manual)

For versions before v2.0.0, or for people without access to the update source,
updating is a manual download-and-run.

### Installer users

Users who installed EasyGit with the installer should download and run the new
installer:

```text
EasyGit Setup 1.0.1.exe
```

It installs **over** the previous version (same app, upgraded in place).

### Portable users

Users running the portable build should simply replace their old portable file
with the new one:

```text
EasyGit-1.0.1-portable.exe
```

### User data

EasyGit stores its data (the repository list, settings) in **Electron's per-user
app data folder**, not inside the app folder. This means user data **normally
survives updates** — replacing the executable or reinstalling does not wipe the
saved repository list. (On Windows this lives under
`%APPDATA%\EasyGit`.)

---

## "When I am ready for a new release"

When the maintainer says something like:

```text
I am ready for a new EasyGit release
```

Claude should:

1. **Ask or infer the next version number** (patch / minor / major — see the
   table above). If it's ambiguous, ask.
2. **Follow this release process** end to end.
3. **Update the in-app changelog** (`src/renderer/changelog.mjs`) and the README
   download links **before building**, and make sure `npm test` passes.
4. **Build the app** with `npm run dist:win`.
5. **Create the new `versions/vX.Y.Z/` folder**, copy in the installer and
   portable (ignored by Git), write `SHA256SUMS.txt` and `RELEASE_NOTES.md`, then
   generate `update.json` with `node scripts/make-update-metadata.mjs X.Y.Z` and
   run `npm test` again.
6. **Commit the release metadata** with `Add vX.Y.Z release metadata` (plus the
   version bump, the changelog and the README update) — no `.exe` files.
7. **Create and push the new annotated tag** `vX.Y.Z`, pointing at that commit,
   and push `master`.
8. **Publish the GitHub Release** for the tag with both executables attached.
9. **Report** the tagged commit, the GitHub Release URL and the SHA-256
   checksums.

Claude should **not** modify previous releases, move old tags, commit `dist/`, or
change the updater as part of this flow.
