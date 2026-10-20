# EasyGit Release Process

This document describes how EasyGit is released, so a new release can be produced
consistently without re-explaining the steps each time.

The current latest release is **`v1.3.0`**.

---

## Release model

Every EasyGit release has **two** things that travel together:

1. **An annotated Git tag** — e.g. `v1.0.0`.
2. **A versioned folder committed in the repo** — e.g. `versions/v1.0.0/`.

A Git tag points to a **commit**, not to a folder. So the tag for a release must
point to the commit that *contains* that release's `versions/vX.Y.Z/` folder.

Each version folder contains:

```text
versions/vX.Y.Z/
  EasyGit Setup X.Y.Z.exe        # installer (recommended for users)
  EasyGit-X.Y.Z-portable.exe     # portable executable
  SHA256SUMS.txt                 # checksums for the two .exe files
  RELEASE_NOTES.md               # human-readable notes for this version
```

> The generated `dist/` folder is **always ignored** and is **never** committed.
> Only the *copied* artifacts inside `versions/vX.Y.Z/` are tracked in Git. This is
> enabled by a scoped exception in [`.gitignore`](../.gitignore)
> (`!versions/**/*.exe`) — `dist/` and `*.exe` everywhere else stay ignored.

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
  pushed and tagged, treat it as immutable.
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
   (installer, portable, `SHA256SUMS.txt`, `RELEASE_NOTES.md` links), keeping the
   older releases listed.
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

### 10. Copy the artifacts from `dist/` into the version folder

Copy (do **not** move) the two executables:

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

### 12. Create the release notes

Create `versions/v1.0.1/RELEASE_NOTES.md`. Use the previous version's notes as a
template (see [`versions/v1.0.0/RELEASE_NOTES.md`](../versions/v1.0.0/RELEASE_NOTES.md))
and describe what changed in this version. Keep the **Requirements** reminders:

- Node.js is not required to run the packaged app.
- Git must still be installed on the user's machine.
- The installer is unsigned, so Windows SmartScreen may warn on first launch.

### 13. Commit the release artifacts

Stage the version folder plus the version bump (adjust to what actually changed):

```bash
git add versions/v1.0.1 package.json package-lock.json src/renderer/changelog.mjs README.md
git commit -m "Add v1.0.1 release artifacts"
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

### 16. Verify

```bash
git status
git log --oneline -5
git tag -n
git ls-tree -r v1.0.1 -- versions/v1.0.1
git ls-remote --tags origin v1.0.1
```

Confirm: working tree clean; the tag lists for `v1.0.1`; the four files appear
under `versions/v1.0.1/`; `dist/` is still ignored; and the remote tag matches.

---

## Important rules (do / don't)

- ✅ **Do** create a brand-new `versions/vX.Y.Z/` folder for each release.
- ✅ **Do** create a brand-new annotated tag for each release, pointing at the
  commit that contains that version folder.
- ❌ **Do not** modify existing version folders, such as `versions/v1.0.0/`.
- ❌ **Do not** move or recreate old tags — unless you are *intentionally* fixing
  a release mistake and have decided to do so deliberately.
- ❌ **Do not** commit the `dist/` folder.
- ❌ **Do not** commit generated `.exe` files from anywhere **except**
  `versions/vX.Y.Z/`.
- ❌ **Do not** implement auto-update as part of a normal manual release. (Auto-
  update is a separate, deliberately-deferred roadmap item — see
  [ROADMAP.md](../ROADMAP.md).)
- 🔁 If a mistake is found **after** a release, ship a new patch version (e.g.
  `v1.0.2`) rather than altering the released one.

---

## How users update (manual)

EasyGit has no auto-update yet, so updating is a manual download-and-run.

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

When José says something like:

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
5. **Create the new `versions/vX.Y.Z/` folder** and copy in the installer,
   portable, `SHA256SUMS.txt`, and `RELEASE_NOTES.md`.
6. **Commit the release artifacts** with `Add vX.Y.Z release artifacts` (plus the
   version bump, the changelog and the README update).
7. **Create and push the new annotated tag** `vX.Y.Z`, pointing at that commit,
   and push `master`.
8. **Report** the tagged commit, the executable paths under `versions/vX.Y.Z/`,
   and the SHA-256 checksums.

Claude should **not** modify previous releases, move old tags, commit `dist/`, or
implement auto-update as part of this flow.
