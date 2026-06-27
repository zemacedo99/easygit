'use strict';

/**
 * demo/shoot-busy.js  (DEMO ONLY)
 * Captures the "please wait" overlay during a status check and a download.
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
  for (let i = 0; i < 12; i++) {
    const buf = (await win.webContents.capturePage()).toPNG();
    if (buf.length > 0) { fs.writeFileSync(path.join(OUT, name), buf); console.log('saved', name, buf.length); return; }
    await wait(150);
  }
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(SEED, '1');
  win = new BrowserWindow({
    width: 1280, height: 860, show: false, backgroundColor: '#0f172a',
    webPreferences: { preload: PRELOAD, contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setFrameRate(30);
  await win.loadFile(INDEX);
  await new Promise((r) => win.webContents.once('paint', r));
  await wait(700);

  // company-website: no local changes, behind 3 -> download goes straight through.
  await run("window.__demo.clickRepoByName('company-website')");
  await wait(250);

  // Capture the "Checking…" overlay (mock check takes ~450ms).
  await run("window.__demo.clickByText('Check changes')");
  await wait(280);
  await shot('25-busy-checking.png');
  await wait(900);

  // Capture the "Downloading…" overlay (mock download takes ~1100ms).
  await run("window.__demo.clickByText('Download latest version')");
  await wait(500);
  await shot('26-busy-download.png');
  await wait(1200);

  try { fs.unlinkSync(SEED); } catch (e) {}
  await wait(150);
  app.quit();
});
