'use strict';

/**
 * demo/shoot-simple.js  (DEMO ONLY)
 * Captures simple mode (default), the upload dialog, the settings dialog, and
 * advanced mode after toggling the setting.
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
  // Retry until the compositor produces a non-empty frame (first-paint race).
  for (let i = 0; i < 12; i++) {
    const img = await win.webContents.capturePage();
    const buf = img.toPNG();
    if (buf.length > 0) {
      fs.writeFileSync(path.join(OUT, name), buf);
      console.log('saved', name, buf.length);
      return;
    }
    await wait(200);
  }
  console.log('FAILED to capture', name);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(SEED, '1');

  win = new BrowserWindow({
    width: 1280,
    height: 960,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      offscreen: true, // reliable capturePage regardless of window visibility
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setFrameRate(30);
  await win.loadFile(INDEX);
  await new Promise((r) => win.webContents.once('paint', r)); // wait for first frame
  await wait(700);

  // Simple mode (default): two areas.
  await run("window.__demo.clickRepoByName('mobile-app')");
  await wait(250);
  await run("window.__demo.clickByText('Check changes')");
  await wait(900);
  await shot('19-simple-overview.png');

  // Upload my changes dialog.
  await run("window.__demo.clickByText('Upload my changes')");
  await wait(450);
  await shot('20-simple-upload-dialog.png');
  await run("window.__demo.closeModal()");
  await wait(200);

  // Settings dialog.
  await run("window.__demo.clickByText('⚙')");
  await wait(450);
  await shot('21-settings-dialog.png');

  // Turn on advanced mode + branch details, then close to reveal the 4-area flow.
  await run("window.__demo.clickSettingByText('Show detailed save/upload steps')");
  await run("window.__demo.clickSettingByText('Show version line details')");
  await wait(300);
  await run("window.__demo.closeModal()");
  await wait(500);
  const isAdvanced = await run("!!document.querySelector('.area-ready') && !!document.querySelector('.version-line-card')");
  console.log('advanced flow + version line present:', isAdvanced);
  await shot('22-advanced-mode.png');

  try { fs.unlinkSync(SEED); } catch (e) {}
  await wait(200);
  app.quit();
});
