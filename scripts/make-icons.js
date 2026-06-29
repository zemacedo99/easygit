'use strict';

/**
 * scripts/make-icons.js  (build tooling — not shipped in the app)
 * ---------------------------------------------------------------
 * Rasterises the EasyGit logo (src/renderer/assets/logo.svg) into the icon
 * files electron-builder uses:
 *   build/icon.png  (512x512, used for Linux + as the source for other formats)
 *   build/icon.ico  (multi-size Windows icon: 16..256)
 *
 * Run with:  electron scripts/make-icons.js   (Electron is already a devDep)
 */

const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'src', 'renderer', 'assets');
const BUILD = path.join(ROOT, 'build');
const TMP_HTML = path.join(ASSETS, '_icon_tmp.html');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Assemble a Windows .ico from a set of {size, png} entries (PNG-encoded). */
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  images.forEach((im, i) => {
    const e = i * 16;
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, e + 0); // width (0 = 256)
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, e + 1); // height (0 = 256)
    dir.writeUInt8(0, e + 2); // palette count
    dir.writeUInt8(0, e + 3); // reserved
    dir.writeUInt16LE(1, e + 4); // colour planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(im.png.length, e + 8); // image size
    dir.writeUInt32LE(offset, e + 12); // image offset
    offset += im.png.length;
    blobs.push(im.png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.writeFileSync(
    TMP_HTML,
    `<!doctype html><html><head><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;background:transparent}
     img{display:block;width:512px;height:512px}</style></head>
     <body><img src="./logo.svg"></body></html>`
  );

  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(30);
  await win.loadFile(TMP_HTML);
  await new Promise((r) => win.webContents.once('paint', r)).catch(() => {});
  await wait(500);

  // Capture at 512, retrying until a non-empty frame is produced.
  let base;
  for (let i = 0; i < 15; i++) {
    base = await win.webContents.capturePage();
    if (base.toPNG().length > 0 && !base.isEmpty()) break;
    await wait(200);
  }

  // build/icon.png (512)
  fs.writeFileSync(path.join(BUILD, 'icon.png'), base.toPNG());
  console.log('wrote build/icon.png', base.getSize().width + 'x' + base.getSize().height);

  // build/icon.ico (16..256), resized from the 512 capture
  const sizes = [16, 32, 48, 64, 128, 256];
  const entries = sizes.map((s) => ({
    size: s,
    png: base.resize({ width: s, height: s, quality: 'best' }).toPNG(),
  }));
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(entries));
  console.log('wrote build/icon.ico with sizes', sizes.join(','));

  try { fs.unlinkSync(TMP_HTML); } catch (e) {}
  app.quit();
});
