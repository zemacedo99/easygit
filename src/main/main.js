'use strict';

/**
 * main.js
 * -------
 * Electron main process entry point.
 *
 * Responsibilities:
 *   - Create the application window.
 *   - Initialise storage and the repository manager.
 *   - Wire up IPC: the renderer (UI) talks to the app ONLY through these
 *     channels, which delegate to repoManager. No git logic lives here.
 *   - Provide OS integrations the UI cannot do on its own: native folder
 *     pickers, opening the file explorer, and opening web links.
 *
 * Security: contextIsolation is ON and nodeIntegration is OFF. The renderer has
 * no direct Node access; everything goes through the preload bridge + IPC.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

const storage = require('./storage');
const repoManager = require('./repoManager');
const git = require('./gitService');
const urls = require('./urls');
const projectTools = require('./projectTools');

let mainWindow = null;

// Tracks the currently-running scan so it can be cancelled from the UI.
let activeScanToken = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'EasyGit',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Hide the default menu bar – non-technical users don't need it.
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  // Persist data in the per-user app data folder.
  storage.init(app.getPath('userData'));
  repoManager.load();

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * All IPC handlers. Each is a thin wrapper that calls repoManager and returns
 * its result straight back to the renderer.
 */
function registerIpcHandlers() {
  const projectAction = (channel, action) => ipcMain.handle(channel, async (_event, id, ...args) => {
    const root = repoManager.getRepoPath(id);
    if (!root) return { ok: false, error: { title: 'Project unavailable', detail: 'Add or select this project again.' } };
    try { return await action(root, ...args); }
    catch { return { ok: false, error: { title: 'Action unavailable', detail: 'Check the project and try again.' } }; }
  });
  projectAction('repos:openCode', root => projectTools.openCode(root));
  projectAction('repos:trashFile', (root, file) => projectTools.trashFile(root, file, target => shell.trashItem(target)));
  projectAction('repos:stashList', git.stashList);
  projectAction('repos:stashFiles', git.stashFiles);
  projectAction('repos:stashChange', git.stashChange);
  projectAction('repos:commitFiles', git.commitFiles);
  projectAction('repos:commitDiff', git.commitDiff);
  // --- Environment ---------------------------------------------------------
  ipcMain.handle('git:checkInstalled', async () => git.checkGitInstalled());
  ipcMain.handle('app:storagePath', async () => repoManager.getStoragePath());

  // --- Repository list -----------------------------------------------------
  ipcMain.handle('repos:list', async () => repoManager.listRepos());
  ipcMain.handle('repos:remove', async (_e, id) => repoManager.removeRepo(id));
  ipcMain.handle('repos:removeAll', async () => repoManager.removeAllRepos());
  ipcMain.handle('repos:rename', async (_e, id, name) => repoManager.renameRepo(id, name));

  // --- Add (manual) --------------------------------------------------------
  ipcMain.handle('repos:add', async (_e, folderPath) => repoManager.addRepo(folderPath));
  ipcMain.handle('repos:addMany', async (_e, folderPaths) => repoManager.addManyRepos(folderPaths));
  ipcMain.handle('repos:clone', async (_e, options) => repoManager.cloneRepo(options || {}));
  ipcMain.handle('repos:suggestFolderName', async (_e, url) => repoManager.suggestFolderName(url));

  // --- Scan ----------------------------------------------------------------
  // Legacy single-folder scan (kept for compatibility).
  ipcMain.handle('repos:scan', async (_e, rootPath) => repoManager.scan(rootPath));

  // Automatic, cancellable scan that streams progress to the UI so it never
  // freezes. preset is 'quick' | 'deeper' | 'custom'.
  ipcMain.handle('repos:autoScan', async (event, params = {}) => {
    const { preset, customPath } = params;

    // Only one scan at a time: stop any previous scan, then take ownership with
    // a fresh cancellation token.
    if (activeScanToken) activeScanToken.cancelled = true;
    const token = { cancelled: false };
    activeScanToken = token;

    // Throttle progress events so we don't flood IPC (always send the final one).
    let lastSent = 0;
    const onProgress = (p) => {
      const now = Date.now();
      if (!p.done && now - lastSent < 80) return;
      lastSent = now;
      if (!event.sender.isDestroyed()) {
        event.sender.send('repos:scanProgress', p);
      }
    };

    try {
      return await repoManager.autoScan(preset, customPath, { onProgress, token });
    } finally {
      if (activeScanToken === token) activeScanToken = null;
    }
  });

  // Ask the running scan to stop. It will resolve with whatever it found so far.
  ipcMain.handle('repos:cancelScan', async () => {
    if (activeScanToken) activeScanToken.cancelled = true;
    return { ok: true };
  });

  // --- Status checks -------------------------------------------------------
  ipcMain.handle('repos:checkOne', async (_e, id, options) => repoManager.checkStatus(id, options || {}));

  // Check ALL repositories, reporting progress to the UI as each one finishes
  // so the list updates progressively and the UI never freezes.
  ipcMain.handle('repos:checkAll', async (event) => {
    const all = repoManager.listRepos();
    const summary = { total: all.length, checked: 0, byStatus: {} };

    for (const repo of all) {
      const result = await repoManager.checkStatus(repo.id, { fetch: true });
      summary.checked++;
      if (result.ok) {
        const s = result.repo.lastStatus;
        summary.byStatus[s] = (summary.byStatus[s] || 0) + 1;
      }
      // Progressive update for this single repo.
      event.sender.send('repos:checkProgress', {
        id: repo.id,
        done: summary.checked,
        total: summary.total,
        result,
      });
    }

    return summary;
  });

  // --- Actions -------------------------------------------------------------
  ipcMain.handle('repos:saveVersion', async (_e, id, message) => repoManager.saveVersion(id, message));
  ipcMain.handle('repos:download', async (_e, id) => repoManager.download(id));
  ipcMain.handle('repos:upload', async (_e, id) => repoManager.upload(id));
  ipcMain.handle('repos:hasUnsaved', async (_e, id) => repoManager.hasUnsavedChanges(id));

  // --- Selection / staging / saving (details screen) -----------------------
  ipcMain.handle('repos:stage', async (_e, id, paths) => repoManager.stageFiles(id, paths));
  ipcMain.handle('repos:stageAll', async (_e, id) => repoManager.stageAll(id));
  ipcMain.handle('repos:unstage', async (_e, id, paths) => repoManager.unstageFiles(id, paths));
  ipcMain.handle('repos:commitStaged', async (_e, id, message) => repoManager.commitStaged(id, message));
  ipcMain.handle('repos:uploadChanges', async (_e, id, message) => repoManager.uploadChanges(id, message));
  ipcMain.handle('repos:suggestMessage', async (_e, id, options) => repoManager.suggestMessage(id, options || {}));
  ipcMain.handle('repos:switchBranch', async (_e, id, name) => repoManager.switchBranch(id, name));

  // --- Settings (simple/advanced mode, branch details) ---------------------
  ipcMain.handle('settings:get', async () => repoManager.getSettings());
  ipcMain.handle('settings:set', async (_e, partial) => repoManager.setSettings(partial));
  // Optional list organization (custom order + EasyGit-only groups).
  ipcMain.handle('layout:get', async () => repoManager.getLayout());
  ipcMain.handle('layout:set', async (_e, layout) => repoManager.setLayout(layout));

  // Reveal a specific file in the system file explorer.
  ipcMain.handle('repos:revealFile', async (_e, id, relPath) => {
    const repoPath = repoManager.getRepoPath(id);
    if (!repoPath) return { ok: false, error: 'Repository not found.' };
    shell.showItemInFolder(path.join(repoPath, relPath));
    return { ok: true };
  });

  // --- OS integrations -----------------------------------------------------

  // Native folder picker. Returns the chosen absolute path, or null if cancelled.
  ipcMain.handle('dialog:pickFolder', async (_e, title) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Choose a folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Open a repository folder in the system file explorer.
  ipcMain.handle('shell:openFolder', async (_e, folderPath) => {
    const errorMessage = await shell.openPath(folderPath);
    // openPath returns '' on success, or an error string on failure.
    return { ok: errorMessage === '', error: errorMessage || null };
  });

  // Open the online repository in the default browser.
  ipcMain.handle('shell:openRemote', async (_e, remoteUrl) => {
    const web = urls.toBrowserUrl(remoteUrl);
    if (!web) return { ok: false, error: 'No online repository link is available.' };
    await shell.openExternal(web);
    return { ok: true, url: web };
  });
}
