'use strict';

/**
 * demo/shoot-details.js  (DEMO ONLY)
 * Captures the new repository details screen: the visual flow, file selection
 * moving into "Ready to save", and the save-version dialog.
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
  fs.writeFileSync(SEED, '1');

  win = new BrowserWindow({
    width: 1220,
    height: 1180, // tall so the whole vertical flow fits in one capture
    show: true,
    backgroundColor: '#0f172a',
    webPreferences: { preload: PRELOAD, contextIsolation: false, nodeIntegration: false, sandbox: false },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile(INDEX);
  await wait(700);

  // Open the deep-dive repo and check it -> rich details flow.
  await run("window.__demo.clickRepoByName('mobile-app')");
  await wait(250);
  await run("window.__demo.clickByText('Check changes')");
  await wait(900);
  await shot('15-details-overview.png');

  // Select all changed files -> they move into "Ready to save".
  await run("window.__demo.clickByText('Select all to save')");
  await wait(700);
  await shot('16-details-ready-to-save.png');

  // Scroll down to show the "Saved on this computer" timeline + "Online repository" card.
  await run("document.querySelector('.panel-details').scrollTo(0, 99999)");
  await wait(350);
  await shot('18-details-lower-areas.png');
  await run("document.querySelector('.panel-details').scrollTo(0, 0)");
  await wait(200);

  // Save a version dialog.
  await run("window.__demo.clickByText('Save a version')");
  await wait(450);
  await shot('17-details-save-dialog.png');

  try { fs.unlinkSync(SEED); } catch (e) {}
  await wait(200);
  app.quit();
});
