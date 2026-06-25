'use strict';

/**
 * demo/shoot-scan.js  (DEMO ONLY)
 * Captures the new "Auto-find Git repositories" flow: preset chooser,
 * live progress, and the review-and-add results screen.
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

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(SEED, '1'); // start with the sample repo list populated

  win = new BrowserWindow({
    width: 1180,
    height: 800,
    show: true,
    backgroundColor: '#0f172a',
    webPreferences: { preload: PRELOAD, contextIsolation: false, nodeIntegration: false, sandbox: false },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile(INDEX);
  await wait(700);

  // Step 1: open the auto-find modal -> preset chooser
  await run("window.__demo.clickByText('Auto-find Git repositories')");
  await wait(400);
  await shot('12-autofind-choose.png');

  // Step 2: start a quick scan -> live progress (capture mid-scan)
  await run("window.__demo.clickByText('Quick scan')");
  await wait(650);
  await shot('13-autofind-progress.png');

  // Step 3: let the scan finish -> review & add results
  await wait(2200);
  await shot('14-autofind-results.png');

  try { fs.unlinkSync(SEED); } catch (e) {}
  await wait(200);
  app.quit();
});
