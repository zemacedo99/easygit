'use strict';

/**
 * preload.js
 * ----------
 * The secure bridge between the UI (renderer) and the app (main process).
 *
 * With contextIsolation ON and nodeIntegration OFF, the renderer cannot touch
 * Node, the filesystem, or Git directly. Instead we expose a small, explicit
 * `window.easygit` API. Each method just forwards to a named IPC channel.
 *
 * Keep this list minimal and intentional – it is the app's whole attack surface.
 */

const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('easygit', {
  openCode: id => ipcRenderer.invoke('repos:openCode', id),
  trashFile: (id, file) => ipcRenderer.invoke('repos:trashFile', id, file),
  stashList: id => ipcRenderer.invoke('repos:stashList', id),
  stashFiles: (id, oid) => ipcRenderer.invoke('repos:stashFiles', id, oid),
  stashChange: (id, operation, value) => ipcRenderer.invoke('repos:stashChange', id, operation, value),
  commitFiles: (id, oid) => ipcRenderer.invoke('repos:commitFiles', id, oid),
  commitDiff: (id, oid, file, limit) => ipcRenderer.invoke('repos:commitDiff', id, oid, file, limit),
  // Environment
  checkGitInstalled: () => ipcRenderer.invoke('git:checkInstalled'),
  getStoragePath: () => ipcRenderer.invoke('app:storagePath'),

  // Repository list
  listRepos: () => ipcRenderer.invoke('repos:list'),
  removeRepo: (id) => ipcRenderer.invoke('repos:remove', id),
  removeAllRepos: () => ipcRenderer.invoke('repos:removeAll'),
  renameRepo: (id, name) => ipcRenderer.invoke('repos:rename', id, name),

  // Add
  addRepo: (folderPath) => ipcRenderer.invoke('repos:add', folderPath),
  addManyRepos: (folderPaths) => ipcRenderer.invoke('repos:addMany', folderPaths),
  // Download an online project (git clone) into a new local folder, then add it.
  cloneRepo: (options) => ipcRenderer.invoke('repos:clone', options),
  suggestFolderName: (url) => ipcRenderer.invoke('repos:suggestFolderName', url),

  // Scan
  scan: (rootPath) => ipcRenderer.invoke('repos:scan', rootPath),
  // Automatic scan: preset is 'quick' | 'deeper' | 'custom' (customPath required
  // for 'custom'). Resolves with the full result (found list + summary).
  autoScan: (preset, customPath) => ipcRenderer.invoke('repos:autoScan', { preset, customPath }),
  cancelScan: () => ipcRenderer.invoke('repos:cancelScan'),
  // Subscribe to live scan progress. Returns an unsubscribe function.
  onScanProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('repos:scanProgress', listener);
    return () => ipcRenderer.removeListener('repos:scanProgress', listener);
  },

  // Status
  checkOne: (id, options) => ipcRenderer.invoke('repos:checkOne', id, options),
  checkAll: () => ipcRenderer.invoke('repos:checkAll'),
  // Subscribe to progressive "check all" updates. Returns an unsubscribe fn.
  onCheckProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('repos:checkProgress', listener);
    return () => ipcRenderer.removeListener('repos:checkProgress', listener);
  },

  // Actions
  saveVersion: (id, message) => ipcRenderer.invoke('repos:saveVersion', id, message),
  download: (id) => ipcRenderer.invoke('repos:download', id),
  upload: (id) => ipcRenderer.invoke('repos:upload', id),
  hasUnsaved: (id) => ipcRenderer.invoke('repos:hasUnsaved', id),

  // Selection / staging / saving (details screen)
  stage: (id, paths) => ipcRenderer.invoke('repos:stage', id, paths),
  stageAll: (id) => ipcRenderer.invoke('repos:stageAll', id),
  unstage: (id, paths) => ipcRenderer.invoke('repos:unstage', id, paths),
  commitStaged: (id, message) => ipcRenderer.invoke('repos:commitStaged', id, message),
  uploadChanges: (id, message) => ipcRenderer.invoke('repos:uploadChanges', id, message),
  suggestMessage: (id, options) => ipcRenderer.invoke('repos:suggestMessage', id, options),
  switchBranch: (id, name) => ipcRenderer.invoke('repos:switchBranch', id, name),
  revealFile: (id, relPath) => ipcRenderer.invoke('repos:revealFile', id, relPath),

  // Settings (persisted)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),

  // Appearance: zoom the whole UI for the font-size option. Renderer-local
  // (no IPC); scales fonts and layout uniformly, like the browser zoom.
  setZoom: (factor) => {
    try {
      webFrame.setZoomFactor(factor);
    } catch (e) {
      /* ignore – non-fatal */
    }
  },

  // OS integrations
  pickFolder: (title) => ipcRenderer.invoke('dialog:pickFolder', title),
  openFolder: (folderPath) => ipcRenderer.invoke('shell:openFolder', folderPath),
  openRemote: (remoteUrl) => ipcRenderer.invoke('shell:openRemote', remoteUrl),
});
