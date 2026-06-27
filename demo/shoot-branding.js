'use strict';

/**
 * demo/shoot-branding.js  (DEMO ONLY)
 * Captures the header + credits footer so the EasyGit logo can be reviewed.
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
async function shot(name) {
  for (let i = 0; i < 12; i++) {
    const buf = (await win.webContents.capturePage()).toPNG();
    if (buf.length > 0) { fs.writeFileSync(path.join(OUT, name), buf); console.log('saved', name, buf.length); return; }
    await wait(200);
  }
  console.log('FAILED', name);
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
  await shot('24-logo-branding.png');

  try { fs.unlinkSync(SEED); } catch (e) {}
  await wait(150);
  app.quit();
});
