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
  ui.renderDetails(repo, repo ? state.details[repo.id] : null, detailHandlers());
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

/** "Find repositories on this PC" – pick a folder, scan it, offer results. */
async function onScan() {
  const folder = await api.pickFolder('Choose a folder to scan for repositories');
  if (!folder) return;

  ui.showToast({ type: 'info', title: 'Scanning…', body: 'Looking for repositories. This may take a moment.' });
  const result = await api.scan(folder);

  ui.showScanResultsModal(result.found, result.scannedFolders, async (paths) => {
    const added = await api.addManyRepos(paths);
    await refreshRepos();
    ui.showToast({
      type: 'success',
      title: 'Repositories added',
      body: `Added ${added.added.length}${added.skipped ? `, skipped ${added.skipped}` : ''}.`,
    });
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
    onAction: (key) => handleAction(key),
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

async function handleAction(key) {
  const repo = currentRepo();
  if (!repo) return;

  switch (key) {
    case 'check':
      await checkRepo(repo.id, false);
      break;

    case 'checkOnline':
      await checkRepo(repo.id, true);
      break;

    case 'save':
      ui.showSaveVersionModal(async (message) => {
        const res = await api.saveVersion(repo.id, message);
        if (!res.ok) {
          ui.showToast({ type: 'warn', title: res.error.title, body: res.error.detail });
        } else {
          ui.showToast({ type: 'success', title: 'Version saved', body: res.message });
        }
        await checkRepo(repo.id, false);
      });
      break;

    case 'download':
      await handleDownload(repo);
      break;

    case 'upload':
      await runAction(repo, () => api.upload(repo.id), 'Uploading your saved changes…');
      break;

    case 'openFolder': {
      const res = await api.openFolder(repo.path);
      if (!res.ok) {
        ui.showToast({ type: 'error', title: 'Could not open folder', body: res.error || '' });
      }
      break;
    }

    case 'openRemote': {
      const res = await api.openRemote(repo.remoteUrl);
      if (!res.ok) {
        ui.showToast({ type: 'warn', title: 'No online repository', body: res.error || '' });
      }
      break;
    }
  }
}

/** Download, with a friendly warning first if there are unsaved local changes. */
async function handleDownload(repo) {
  const unsaved = await api.hasUnsaved(repo.id);
  const doDownload = () => runAction(repo, () => api.download(repo.id), 'Downloading the latest version…');

  if (unsaved) {
    ui.showConfirm(
      {
        title: 'You have unsaved local changes',
        message:
          'You have local changes that are not saved yet. It is safer to save a version first, otherwise you may need help resolving conflicts. Do you want to download anyway?',
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
