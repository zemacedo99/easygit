'use strict';

/**
 * demo/shoot.js  (DEMO ONLY — not part of the shipped app)
 * -------------------------------------------------------
 * Loads the REAL renderer with the mock preload, drives it through each screen,
 * and saves a clean PNG of just the app surface using Electron's capturePage().
 *
 * Run with:  electron demo/shoot.js
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'screenshots');
const SEED = path.join(__dirname, '.seed');
const INDEX = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const PRELOAD = path.join(__dirname, 'mock-preload.js');

let win;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (js) => win.webContents.executeJavaScript(js, true);

async function shot(name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log('saved', name);
}

async function reloadAndWait() {
  win.webContents.reload();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await wait(600);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  try { fs.unlinkSync(SEED); } catch (e) {}

  win = new BrowserWindow({
    width: 1180,
    height: 800,
    show: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: false, // demo only, so the mock can set window.easygit directly
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);

  await win.loadFile(INDEX);
  await wait(700);

  // 1) Empty / initial state
  await shot('01-empty-state.png');

  // 2) Repository list (seed sample data, reload so the app picks it up)
  fs.writeFileSync(SEED, '1');
  await reloadAndWait();
  await shot('02-repository-list.png');

  // 3) Find repositories / scan flow
  await run("window.__demo.clickByText('Find repositories on this PC')");
  await wait(600);
  await shot('03-scan-results.png');
  await run("window.__demo.closeModal()");

  // 4) Add repository – invalid folder message
  await run("window.__demo.setAddMode('invalid'); window.__demo.clickByText('Add repository folder')");
  await wait(500);
  await shot('04-add-invalid.png');
  await run("window.__demo.closeModal()");

  // 5) Add repository – success
  await run("window.__demo.setAddMode('valid'); window.__demo.clickByText('Add repository folder')");
  await wait(500);
  await shot('05-add-success.png');

  // 6) Repository details + status checking result (deep-dive on mobile-app)
  await run("window.__demo.clickRepoByName('mobile-app')");
  await wait(250);
  await run("window.__demo.clickByText('Check changes')");
  await wait(900);
  await shot('06-details-panel.png');

  // 7) Save a version dialog
  await run("window.__demo.clickByText('Save a version')");
  await wait(450);
  await shot('07-save-version-dialog.png');
  await run("window.__demo.closeModal()");

  // 8) Download latest version – unsaved-changes warning
  await run("window.__demo.clickByText('Download latest version')");
  await wait(450);
  await shot('08-download-warning-dialog.png');
  await run("window.__demo.closeModal()");

  // 9) Upload my saved changes – result toast
  await run("window.__demo.clickByText('Upload my saved changes')");
  await wait(600);
  await shot('09-upload-result.png');
  await wait(900); // let the post-action re-check settle

  // 10) Check if everything is updated – progress + summary
  await run("window.__demo.clickByText('Check if everything is updated')");
  await wait(700);
  await shot('10-check-all-progress.png');
  await wait(1600);
  await shot('11-check-all-summary.png');

  try { fs.unlinkSync(SEED); } catch (e) {}
  await wait(300);
  app.quit();
});
