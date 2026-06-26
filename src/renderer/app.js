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

const api = window.easygit;

/** Front-end state. */
const state = {
  repos: [],            // decorated repos from the main process
  selectedId: null,     // currently selected repo id
  details: {},          // id -> last status-check result details
  checking: new Set(),  // ids currently being checked (for the spinner badge)
  settings: { showAdvanced: false, showBranch: false }, // persisted preferences
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

  // Load persisted preferences (simple/advanced mode, branch details).
  try {
    state.settings = await api.getSettings();
  } catch (e) {
    /* ignore – keep defaults */
  }

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
  ui.renderRepoList(state.repos, state.selectedId, selectRepo, state.checking);
  const repo = currentRepo();
  ui.renderDetails(repo, repo ? state.details[repo.id] : null, detailHandlers(), state.settings);
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
}

/** "Add repository folder" – pick a folder and validate it's a repo. */
async function onAdd() {
  const folder = await api.pickFolder('Choose a repository folder to add');
  if (!folder) return;

  const res = await api.addRepo(folder);
  if (!res.ok) {
    ui.openModalSimple(res.error.title, res.error.detail);
    return;
  }
  await refreshRepos();
  selectRepo(res.repo.id);
  ui.showToast({ type: 'success', title: 'Repository added', body: res.repo.name });
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
  const text = document.getElementById('global-status-text');
  const track = document.getElementById('progress-track');
  track.hidden = true;

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
  return {
    onCheck: (fetch) => { const r = currentRepo(); if (r) checkRepo(r.id, !!fetch); },
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
      ui.showSaveVersionModal(async (message) => {
        const res = await api.commitStaged(repo.id, message);
        if (!res.ok) ui.showToast({ type: 'warn', title: res.error.title, body: res.error.detail });
        else ui.showToast({ type: 'success', title: 'Version saved', body: res.message });
        await checkRepo(repo.id, false);
      });
    },

    onUpload: () => { const r = currentRepo(); if (r) runAction(r, () => api.upload(r.id), 'Uploading your saved versions…'); },
    onDownload: () => { const r = currentRepo(); if (r) handleDownload(r); },
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
    onRemove: () => {
      const repo = currentRepo();
      if (!repo) return;
      ui.showConfirm(
        {
          title: 'Remove from EasyGit?',
          message: `“${repo.name}” will be removed from EasyGit. The folder and its contents on your computer are NOT deleted.`,
          confirmLabel: 'Remove',
          danger: true,
        },
        async () => {
          await api.removeRepo(repo.id);
          if (state.selectedId === repo.id) state.selectedId = null;
          delete state.details[repo.id];
          await refreshRepos();
          ui.showToast({ type: 'success', title: 'Removed', body: `${repo.name} was removed from EasyGit.` });
        }
      );
    },
  };
}

let mutating = false; // guards against overlapping git index writes (index.lock races)

/** Run a repo-mutating IPC call, surface any error, then refresh the details. */
async function mutate(fn) {
  const repo = currentRepo();
  if (!repo || mutating) return;
  mutating = true;
  try {
    const res = await fn(repo.id);
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
    const res = await api.switchBranch(repo.id, name);
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
    rerender();
  });
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
  const runUpload = async (message) => {
    const res = await api.uploadChanges(repo.id, message);
    if (!res.ok) {
      // Changes may have appeared on disk since the last check: if the main
      // process now needs a description, ask for it and retry instead of erroring.
      if (res.error && /description/i.test(res.error.title)) {
        ui.showUploadMessageModal(runUpload);
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

  if (hasFileChanges) {
    ui.showUploadMessageModal((message) => {
      ui.showToast({ type: 'info', title: 'Saving and uploading your changes…' });
      runUpload(message);
    });
  } else {
    ui.showToast({ type: 'info', title: 'Uploading your saved changes…' });
    runUpload(null); // only saved versions waiting (or nothing) – no description needed
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
    doDownload();
  }
}

/** Run an action that returns {ok, message|error}, then refresh the repo. */
async function runAction(repo, fn, busyText) {
  ui.showToast({ type: 'info', title: busyText });
  const res = await fn();
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
  if (res.ok) {
    replaceRepo(res.repo);
    state.details[id] = res.details;
  } else if (res.error) {
    ui.showToast({ type: 'error', title: res.error.title, body: res.error.detail });
  }
  rerender();
}

/* ------------------------------------------------------------------ */

init();
