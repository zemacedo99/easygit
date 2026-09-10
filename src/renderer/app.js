/**
 * app.js (renderer)
 * -----------------
 * The UI controller. Holds the small bit of front-end state, wires up buttons,
 * and talks to the main process through the `window.easygit` bridge (preload).
 *
 * It contains NO Git logic – every Git operation is an IPC call. Rendering is
 * delegated to ui.js.
 */

import * as ui from './ui.js';
import { sortAndFilterRepos } from './repoSort.mjs';

const api = window.easygit;

/** Front-end state. */
const state = {
  repos: [],            // decorated repos from the main process
  selectedId: null,     // currently selected repo id
  details: {},          // id -> last status-check result details
  checking: new Set(),  // ids currently being checked (for the spinner badge)
  filter: '',           // current repo-list search text (not persisted)
  settings: { showAdvanced: false, showBranch: false, sortBy: 'attention' }, // persisted preferences
};

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  // Warn early if Git isn't installed – nothing will work without it.
  try {
    const git = await api.checkGitInstalled();
    document.getElementById('git-warning').hidden = !!git.installed;
  } catch (e) {
    /* ignore – non-fatal */
  }

  // Load persisted preferences (simple/advanced mode, branch details, appearance).
  try {
    state.settings = await api.getSettings();
  } catch (e) {
    /* ignore – keep defaults */
  }
  applyAppearance(state.settings);

  subscribeProgress();
  wireGlobalButtons();
  await refreshRepos();
}

/** Reload the persisted repo list and re-render. */
async function refreshRepos() {
  state.repos = await api.listRepos();
  rerender();
}

function rerender() {
  const shown = sortAndFilterRepos(state.repos, state.filter, state.settings.sortBy);
  // The search/sort toolbar only appears once there are enough projects to
  // benefit from it, keeping the default experience uncluttered.
  const toolbar = document.getElementById('list-toolbar');
  if (toolbar) toolbar.hidden = state.repos.length < 2;
  const removeAllBtn = document.getElementById('btn-remove-all');
  if (removeAllBtn) removeAllBtn.hidden = state.repos.length === 0;
  ui.renderRepoList(shown, state.selectedId, selectRepo, state.checking, {
    total: state.repos.length,
    query: state.filter,
    onRename: renameRepoById,
    onRemove: removeRepoById,
  });
  const repo = currentRepo();
  ui.renderDetails(repo, repo ? state.details[repo.id] : null, detailHandlers(), state.settings);
}

/** Rename a repository directly from the list (reuses the rename dialog + IPC). */
function renameRepoById(id) {
  const repo = state.repos.find((r) => r.id === id);
  if (!repo) return;
  ui.showRenameModal(repo.name, async (name) => {
    const res = await api.renameRepo(repo.id, name);
    if (res.ok) {
      replaceRepo(res.repo);
      rerender();
    }
  });
}

function currentRepo() {
  return state.repos.find((r) => r.id === state.selectedId) || null;
}

function replaceRepo(updated) {
  const idx = state.repos.findIndex((r) => r.id === updated.id);
  if (idx >= 0) state.repos[idx] = updated;
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

function selectRepo(id) {
  state.selectedId = id;
  rerender();
}

/* ------------------------------------------------------------------ */
/* Global buttons                                                      */
/* ------------------------------------------------------------------ */

function wireGlobalButtons() {
  document.getElementById('btn-scan').addEventListener('click', onScan);
  document.getElementById('btn-add').addEventListener('click', onAdd);
  document.getElementById('btn-check-all').addEventListener('click', onCheckAll);

  const removeAllBtn = document.getElementById('btn-remove-all');
  if (removeAllBtn) removeAllBtn.addEventListener('click', removeAll);

  // Repository list search + sort.
  const search = document.getElementById('repo-search');
  if (search) {
    search.addEventListener('input', () => {
      state.filter = search.value;
      rerender();
    });
  }
  const sort = document.getElementById('repo-sort');
  if (sort) {
    sort.value = state.settings.sortBy || 'attention';
    sort.addEventListener('change', async () => {
      state.settings = await api.setSettings({ sortBy: sort.value });
      rerender();
    });
  }
}

/** "Add repository folder" – pick a folder and validate it's a repo. */
async function onAdd() {
  const folder = await api.pickFolder('Choose a repository folder to add');
  if (!folder) return;

  const btn = document.getElementById('btn-add');
  if (btn) btn.disabled = true;
  try {
    const res = await withBusy('Adding repository…', () => api.addRepo(folder), { scope: 'header' });
    if (!res.ok) {
      ui.openModalSimple(res.error.title, res.error.detail);
      return;
    }
    await refreshRepos();
    selectRepo(res.repo.id);
    ui.showToast({ type: 'success', title: 'Repository added', body: res.repo.name });
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * "Auto-find Git repositories" – open the guided scan modal. The modal (ui.js)
 * owns the step-by-step UI; here we just supply the IPC-backed handlers and keep
 * the repo list in sync after adding.
 */
let scanModalOpen = false; // guards against opening a second scan at once

function onScan() {
  if (scanModalOpen) return; // only one scan / scan modal at a time
  scanModalOpen = true;
  const btn = document.getElementById('btn-scan');
  if (btn) btn.disabled = true;

  ui.showAutoScanModal({
    pickFolder: () => api.pickFolder('Choose a folder to search inside'),

    // "Add repository from link or SSH" (download an online project).
    pickParentFolder: () => api.pickFolder('Choose where to save the project'),
    suggestFolderName: (url) => api.suggestFolderName(url),
    cloneRepo: (opts) => api.cloneRepo(opts),
    onCloned: async (repo) => {
      await refreshRepos();
      selectRepo(repo.id);
      ui.showToast({ type: 'success', title: 'Project downloaded', body: `${repo.name} was downloaded and added to EasyGit.` });
      checkRepo(repo.id, false); // do an initial local status check, like other flows
    },

    startScan: (preset, customPath, onProgress) => {
      // Subscribe to live progress for the duration of this scan only.
      const unsubscribe = api.onScanProgress(onProgress);
      return api.autoScan(preset, customPath).finally(() => unsubscribe());
    },
    cancelScan: () => api.cancelScan(),
    addRepos: async (paths) => {
      const added = await api.addManyRepos(paths);
      await refreshRepos();
      ui.showToast({
        type: 'success',
        title: 'Repositories added',
        body: `Added ${added.added.length} repositor${added.added.length === 1 ? 'y' : 'ies'}${
          added.skipped ? `, skipped ${added.skipped}` : ''
        }.`,
      });
      return added;
    },
    onClose: () => {
      scanModalOpen = false;
      if (btn) btn.disabled = false;
    },
  });
}

/** "Check if everything is updated" – check every repo with an online refresh. */
async function onCheckAll() {
  if (state.repos.length === 0) {
    ui.showToast({ type: 'info', title: 'No repositories yet', body: 'Add a repository first.' });
    return;
  }

  const btn = document.getElementById('btn-check-all');
  btn.disabled = true;

  // Mark all as checking and show progress.
  state.repos.forEach((r) => state.checking.add(r.id));
  showGlobalProgress(0, state.repos.length);
  rerender();

  // The main process streams progress via onCheckProgress (see subscribeProgress);
  // we just await the final summary here.
  await api.checkAll();

  btn.disabled = false;
  showGlobalSummary();
}

/** Live updates as each repo finishes during "Check all". */
function subscribeProgress() {
  api.onCheckProgress(({ id, done, total, result }) => {
    state.checking.delete(id);
    // The repo may have been removed while the check was still running; ignore
    // the late result instead of resurrecting stale details for a gone repo.
    if (!state.repos.some((r) => r.id === id)) {
      delete state.details[id];
      return;
    }
    if (result && result.ok) {
      replaceRepo(result.repo);
      state.details[id] = result.details;
    }
    showGlobalProgress(done, total);
    rerender();
  });
}

/* ------------------------------------------------------------------ */
/* Global status banner                                                */
/* ------------------------------------------------------------------ */

function showGlobalProgress(done, total) {
  const banner = document.getElementById('global-status');
  const text = document.getElementById('global-status-text');
  const track = document.getElementById('progress-track');
  const bar = document.getElementById('progress-bar');

  banner.hidden = false;
  track.hidden = false;
  text.textContent = `Checking your repositories… (${done} of ${total})`;
  bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
}

function showGlobalSummary() {
  const banner = document.getElementById('global-status');
  const text = document.getElementById('global-status-text');
  const track = document.getElementById('progress-track');
  track.hidden = true;

  // If everything was removed while the check ran, there is nothing to summarise.
  if (state.repos.length === 0) {
    banner.hidden = true;
    return;
  }

  // Build a friendly summary by counting the (already friendly) status labels.
  const counts = {};
  for (const r of state.repos) {
    counts[r.statusLabel] = (counts[r.statusLabel] || 0) + 1;
  }
  const parts = Object.entries(counts).map(([label, n]) => `${n} ${label}`);
  text.textContent = `Checked ${state.repos.length} repositor${
    state.repos.length === 1 ? 'y' : 'ies'
  }. ${parts.join(' · ')}`;
}

/* ------------------------------------------------------------------ */
/* Per-repository actions                                              */
/* ------------------------------------------------------------------ */

function detailHandlers() {
  const selected = currentRepo();
  const report = res => {
    if (!res.ok) ui.showToast({ type: 'warn', title: res.error.title, body: res.error.detail });
    else if (res.message) ui.showToast({ type: 'success', title: 'Project updated', body: res.message });
    return res;
  };
  const change = async fn => {
    if (!selected) return;
    const result = await withBusy('Updating your project…', fn);
    report(result);
    await checkRepo(selected.id, false);
    return result;
  };
  return {
    onOpenCode: state.settings.showVSCode !== false ? async () => report(await api.openCode(selected.id)) : null,
    onTrash: file => ui.confirmTrash(file, () => change(() => api.trashFile(selected.id, file))),
    onStashList: () => api.stashList(selected.id),
    onStashFiles: oid => api.stashFiles(selected.id, oid),
    onStashChange: (operation, value) => change(() => api.stashChange(selected.id, operation, value)),
    onCommitFiles: oid => api.commitFiles(selected.id, oid),
    onCommitDiff: (oid, file, limit) => api.commitDiff(selected.id, oid, file, limit),
    // Return the promises so the clicked button can show a spinner while the
    // (long) action runs. Modal-openers below intentionally return nothing.
    onCheck: (fetch) => { const r = currentRepo(); if (r) return doCheck(r.id, !!fetch); },
    onSettings: () => openSettings(),

    // Simple mode: one-click "Upload my changes" (save + upload as needed)
    onUploadChanges: () => uploadChanges(),

    // Selection / staging
    onStage: (paths) => mutate((id) => api.stage(id, paths)),
    onStageAll: () => mutate((id) => api.stageAll(id)),
    onUnstage: (paths) => mutate((id) => api.unstage(id, paths)),

    // Save a version from the ready-to-save (staged) changes only.
    onSaveVersion: () => {
      const repo = currentRepo();
      if (!repo) return;
      ui.showSaveVersionModal({
        onSave: async (message) => {
          const res = await withBusy('Saving your version…', () => api.commitStaged(repo.id, message));
          if (!res.ok) ui.showToast({ type: 'warn', title: res.error.title, body: res.error.detail });
          else ui.showToast({ type: 'success', title: 'Version saved', body: res.message });
          await checkRepo(repo.id, false);
        },
        // Advanced "Save a version" commits the staged changes, so base the
        // suggestion on those.
        onSuggest: () => api.suggestMessage(repo.id, { staged: true }),
      });
    },

    onUpload: () => { const r = currentRepo(); if (r) return runAction(r, () => api.upload(r.id), 'Uploading your saved versions…'); },
    onDownload: () => { const r = currentRepo(); if (r) return handleDownload(r); },
    onSwitchBranch: (name) => switchVersionLine(name),
    onReveal: (relPath) => { const r = currentRepo(); if (r) api.revealFile(r.id, relPath); },

    onOpenFolder: async () => {
      const r = currentRepo();
      if (!r) return;
      const res = await api.openFolder(r.path);
      if (!res.ok) ui.showToast({ type: 'error', title: 'Could not open folder', body: res.error || '' });
    },
    onOpenRemote: async () => {
      const r = currentRepo();
      if (!r) return;
      const res = await api.openRemote(r.remoteUrl);
      if (!res.ok) ui.showToast({ type: 'warn', title: 'No online repository', body: res.error || '' });
    },

    onRename: () => {
      const repo = currentRepo();
      if (!repo) return;
      ui.showRenameModal(repo.name, async (name) => {
        const res = await api.renameRepo(repo.id, name);
        if (res.ok) {
          replaceRepo(res.repo);
          rerender();
        }
      });
    },
    onRemove: () => { const r = currentRepo(); if (r) removeRepoById(r.id); },
  };
}

/**
 * Remove a single repository from EasyGit (after a friendly confirmation).
 * Shared by the details panel and the left-list card. Never touches the folder
 * on disk.
 */
function removeRepoById(id) {
  const repo = state.repos.find((r) => r.id === id);
  if (!repo) return;
  ui.showConfirm(
    {
      title: 'Remove from EasyGit?',
      message: `Remove “${repo.name}” from EasyGit? Your project folder will stay on your computer. You can add it again later.`,
      confirmLabel: 'Remove',
      danger: true,
    },
    async () => {
      await api.removeRepo(repo.id);
      if (state.selectedId === repo.id) state.selectedId = null;
      delete state.details[repo.id];
      await refreshRepos();
      ui.showToast({ type: 'success', title: 'Removed', body: `${repo.name} was removed from EasyGit. Your folder is untouched.` });
    }
  );
}

/**
 * Remove ALL repositories from EasyGit, behind a deliberate two-step
 * confirmation (users understandably fear losing real files — they don't).
 */
function removeAll() {
  if (state.repos.length === 0) return;
  ui.showConfirm(
    {
      title: 'Remove all repositories from EasyGit?',
      message:
        'This will only remove them from EasyGit. Your project folders will stay on your computer. You can add them again later.',
      confirmLabel: 'Continue',
    },
    () => {
      ui.showConfirm(
        {
          title: 'Are you absolutely sure?',
          message:
            'Are you absolutely sure you want to remove all repositories from EasyGit? Your project folders will stay on your computer.',
          confirmLabel: 'Yes, remove all',
          danger: true,
        },
        async () => {
          await api.removeAllRepos();
          state.selectedId = null;
          state.details = {};
          state.checking.clear();
          state.filter = '';
          const search = document.getElementById('repo-search');
          if (search) search.value = '';
          // Clear any "Check if everything is updated" banner that may be running.
          const banner = document.getElementById('global-status');
          if (banner) banner.hidden = true;
          await refreshRepos();
          ui.showToast({
            type: 'success',
            title: 'All removed',
            body: 'All repositories were removed from EasyGit. Your folders are untouched.',
          });
        }
      );
    }
  );
}

let mutating = false; // guards against overlapping git index writes (index.lock races)

/** Run a repo-mutating IPC call, surface any error, then refresh the details. */
async function mutate(fn) {
  const repo = currentRepo();
  if (!repo || mutating) return;
  mutating = true;
  try {
    const res = await withBusy('Updating…', () => fn(repo.id));
    if (res && res.ok === false && res.error) {
      ui.showToast({ type: 'error', title: res.error.title, body: res.error.detail });
    }
    await checkRepo(repo.id, false);
  } finally {
    mutating = false;
  }
}

/** Switch version line (branch), warning first if there are unsaved changes. */
function switchVersionLine(name) {
  const repo = currentRepo();
  if (!repo) return;
  const details = state.details[repo.id];
  const counts = (details && details.counts) || { working: 0, staged: 0, conflicted: 0 };
  const hasChanges = counts.working > 0 || counts.staged > 0 || counts.conflicted > 0;

  // Snap the dropdown back to the real current line. A confirmed switch rebuilds
  // it via checkRepo; if the user cancels, the card already shows the true line.
  rerender();

  const doSwitch = async () => {
    const res = await withBusy('Switching version line…', () => api.switchBranch(repo.id, name));
    if (!res.ok) ui.showToast({ type: 'error', title: res.error.title, body: res.error.detail });
    else ui.showToast({ type: 'success', title: 'Switched version line', body: res.message });
    await checkRepo(repo.id, false);
  };

  if (hasChanges) {
    ui.showConfirm(
      {
        title: 'You have unsaved changes',
        message: `Switching version line may move or hide your current changes. It is safer to save a version first. Switch to “${name}” anyway?`,
        confirmLabel: 'Switch anyway',
      },
      doSwitch
    );
  } else {
    doSwitch();
  }
}

/** Open the settings dialog; changes apply live and are persisted. */
function openSettings() {
  ui.showSettingsModal(state.settings, async (newSettings) => {
    state.settings = await api.setSettings(newSettings);
    applyAppearance(state.settings);
    rerender();
  });
}

/** Map the font-size preference to a whole-UI zoom factor. */
const FONT_ZOOM = { normal: 1, large: 1.15, larger: 1.3 };

/**
 * Apply appearance preferences (theme + font size). Both default to the
 * original look, so the simple experience is unchanged unless the user opts in.
 */
function applyAppearance(settings) {
  const theme = settings && settings.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  if (api.setZoom) api.setZoom(FONT_ZOOM[(settings && settings.fontSize) || 'normal'] || 1);
}

/**
 * Simple-mode "Upload my changes": asks for a description only when there are
 * local file changes, then runs the combined save + upload via the main process.
 */
function uploadChanges() {
  const repo = currentRepo();
  if (!repo) return;
  const details = state.details[repo.id];
  const counts = (details && details.counts) || { working: 0, staged: 0, conflicted: 0 };

  if (counts.conflicted > 0) {
    ui.showToast({
      type: 'warn',
      title: 'Some files need attention',
      body: 'Some files need attention before EasyGit can safely upload. Ask someone technical to help with this project.',
    });
    return;
  }

  const hasFileChanges = counts.working + counts.staged > 0;
  let uploadHandlers; // defined below; referenced when re-prompting on retry
  const runUpload = async (message) => {
    const res = await withBusy(
      hasFileChanges ? 'Saving and uploading your changes…' : 'Uploading your saved changes…',
      () => api.uploadChanges(repo.id, message)
    );
    if (!res.ok) {
      // Changes may have appeared on disk since the last check: if the main
      // process now needs a description, ask for it and retry instead of erroring.
      if (res.error && /description/i.test(res.error.title)) {
        ui.showUploadMessageModal(uploadHandlers);
        return;
      }
      ui.showToast({ type: 'error', title: res.error.title, body: res.error.detail });
    } else if (res.noop) {
      ui.showToast({ type: 'info', title: 'Already uploaded', body: res.message });
    } else {
      ui.showToast({ type: 'success', title: 'Uploaded', body: res.message });
    }
    await checkRepo(repo.id, false);
  };

  uploadHandlers = {
    onSubmit: runUpload,
    // Simple-mode upload saves all local changes, so suggest from those.
    onSuggest: () => api.suggestMessage(repo.id, { staged: false }),
  };

  if (hasFileChanges) {
    ui.showUploadMessageModal(uploadHandlers);
  } else {
    return runUpload(null); // only saved versions waiting (or nothing) – no description needed
  }
}

/** Download, with a friendly warning first if there are local changes. */
async function handleDownload(repo) {
  const unsaved = await api.hasUnsaved(repo.id);
  const doDownload = () => runAction(repo, () => api.download(repo.id), 'Downloading the latest version…');

  if (unsaved) {
    ui.showConfirm(
      {
        title: 'You have changes on this computer',
        message:
          'You have changes on this computer. Downloading may require help if the same files were changed online. EasyGit will not delete your changes automatically. Download anyway?',
        confirmLabel: 'Download anyway',
      },
      doDownload
    );
  } else {
    return doDownload();
  }
}

/** Run an action that returns {ok, message|error}, then refresh the repo. */
async function runAction(repo, fn, busyText) {
  const res = await withBusy(busyText, fn);
  if (!res.ok) {
    ui.showToast({ type: 'error', title: res.error.title, body: res.error.detail });
  } else {
    ui.showToast({ type: 'success', title: 'Done', body: res.message });
  }
  await checkRepo(repo.id, false);
}

/** Check a single repository's status and update the UI. */
async function checkRepo(id, fetch) {
  state.checking.add(id);
  rerender();

  const res = await api.checkOne(id, { fetch });

  state.checking.delete(id);
  // Removed while the check was in flight – don't recreate its details or toast.
  if (!state.repos.some((r) => r.id === id)) {
    delete state.details[id];
    rerender();
    return;
  }
  if (res.ok) {
    replaceRepo(res.repo);
    state.details[id] = res.details;
  } else if (res.error) {
    ui.showToast({ type: 'error', title: res.error.title, body: res.error.detail });
  }
  rerender();
}

/**
 * Show a small, NON-blocking busy indicator while an async operation runs.
 * - scope 'repo' (default): inline status at the top of the details panel and
 *   the selected repo's action buttons are disabled (prevents double-clicks).
 * - scope 'header': a small status in the top header (for non-repo actions).
 * The inline status is deferred so instant actions never flash it, but the
 * controls are disabled immediately. The rest of the app stays visible/usable.
 * @param {string} message
 * @param {() => Promise<any>} fn
 * @param {{scope?: 'repo'|'header', delay?: number}} [opts]
 */
async function withBusy(message, fn, opts = {}) {
  const scope = opts.scope || 'repo';
  const delay = opts.delay != null ? opts.delay : 150;
  if (scope === 'repo') ui.setRepoBusy(true); // disable repo actions right away

  let shown = false;
  const timer = setTimeout(() => {
    if (scope === 'header') ui.showHeaderBusy(message);
    else ui.showRepoBusy(message);
    shown = true;
  }, delay);

  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    if (shown) {
      if (scope === 'header') ui.hideHeaderBusy();
      else ui.hideRepoBusy();
    }
    if (scope === 'repo') ui.setRepoBusy(false);
  }
}

/** A status check started from an explicit "Check" button, with wait feedback. */
function doCheck(id, fetch) {
  return withBusy(fetch ? 'Checking the online project…' : 'Checking your changes…', () => checkRepo(id, fetch));
}

/* ------------------------------------------------------------------ */

init();
