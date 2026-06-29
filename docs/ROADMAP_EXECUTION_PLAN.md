# Roadmap Execution Plan — Polish Cycle

A short, working plan for the current cycle. Source of truth is
[ROADMAP.md](../ROADMAP.md); this records *what* was picked, *why*, and *how* it
is verified. It guides implementation — it does not replace it.

Guiding principle (unchanged): **Manage your projects without learning Git.** The
default experience stays *On this computer ⇄ Online project*. Anything that adds
complexity is **optional, off by default, and toggleable in Settings**.

## Selected for this cycle (high value, low risk)

From **🔜 Near-term polish** and **🧪 Quality**:

1. **Unit tests for pure logic modules** (Quality). Safety net first, zero UX
   risk. Covers `urls`, `statusInterpreter`, `suggestMessage`, `scanner`
   (`normalizePath`), `gitService.classifyError`, and `messages.friendlyError`.
2. **Search / filter the repository list** (Near-term). Slim search box, shown
   only when there are 2+ repositories. Filters by name/path. Ephemeral.
3. **Sort by status / needs-action first** (Near-term). Small sort control;
   choice persisted in Settings. Pure, tested helper (`repoSort.js`).
4. **Inline rename from the list** (Near-term). Subtle pencil affordance on each
   card → reuses the existing rename dialog + IPC. (Detail-panel rename already
   existed.)
5. **Clearer per-action busy/spinner on the buttons** (Near-term). The clicked
   action button shows an inline spinner while its operation runs, on top of the
   existing contextual status. Safe: only long-running handlers that return a
   promise spin; modal-openers do not.
6. **Light theme + font-size option** (Near-term, accessibility). Both **default
   off** and live-applied from Settings. Theme via a `data-theme` attribute over
   the existing CSS-variable palette; font size via Electron zoom factor.

## Implementation order (safest first)

1. Tests for existing pure modules → establishes the net before touching UI.
2. Repository list polish (search + sort + inline rename), incl. tested
   `repoSort` helper.
3. Per-action button busy feedback.
4. Appearance options (light theme + font size), behind Settings.
5. Docs + roadmap checkbox updates.

## Risk assessment

| Item | Risk | Notes |
| --- | --- | --- |
| Unit tests | none | additive; no app code change |
| Search/filter | low | additive UI; default unchanged when <2 repos |
| Sort | low–med | changes default list order to "needs action first" (persisted, reversible) |
| Inline rename | low | reuses existing rename modal + IPC |
| Per-button busy | low | presentational; only promise-returning handlers spin |
| Light theme/font | low | off by default, behind Settings, variable-based CSS |

## Expected files/areas

- `test/*.test.js`, `test/*.test.mjs`, `package.json` (test script).
- `src/renderer/repoSort.js` (new, pure), `src/renderer/app.js`,
  `src/renderer/ui.js`, `src/renderer/index.html`, `src/renderer/styles.css`.
- `src/preload/preload.js` (zoom), `src/main/repoManager.js` (default settings).
- `README.md`, `ROADMAP.md`.

## Verification approach

- `npm test` (node:test) — pure-logic unit tests must pass.
- `node --check` / ESM check on every changed file.
- Boot the real app and confirm: simple mode unchanged by default; search/sort
  appear with 2+ repos; inline rename works; buttons show a spinner; light
  theme + larger font toggle cleanly and persist; turning everything off restores
  the original simple experience.

## Left for later (deliberately)

- Auto-refresh on a timer; common scan shortcuts surfacing (scan roots already
  persisted in storage).
- Medium/advanced Git features (per-file save UI exists in Advanced; undo,
  conflict resolution, stash, branch delete) — need careful, specced UX first.
- macOS/Linux distributables; auto-update (needs a hosting strategy); CI.
