#!/usr/bin/env node
// Makes sure the Electron binary is installed in node_modules/electron.
//
// Why: Electron's own postinstall step (node_modules/electron/install.js)
// extracts its zip with extract-zip 2.0.1. On newer Node.js releases (seen on
// Node 26) that extractor lets the process exit after the first file, so
// `npm install` "succeeds" but `npm start` fails with
// "Electron failed to install correctly". Newer npm versions may also skip
// dependency install scripts that are not listed in package.json "allowScripts".
//
// This script is a no-op when Electron is already installed. Otherwise it
// downloads the same artifact Electron would (reusing its cache) and extracts
// it with the operating system's own tool (tar on Windows/macOS, unzip on Linux),
// then writes the files Electron's index.js expects.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const electronDir = path.dirname(require.resolve('electron/package.json'));
const { version } = require(path.join(electronDir, 'package.json'));
const distDir = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(electronDir, 'dist');

function platformPath () {
  switch (process.platform) {
    case 'win32': return 'electron.exe';
    case 'darwin': return 'Electron.app/Contents/MacOS/Electron';
    default: return 'electron';
  }
}

function isInstalled () {
  try {
    const v = fs.readFileSync(path.join(distDir, 'version'), 'utf8').trim().replace(/^v/, '');
    const p = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8');
    return v === version && p === platformPath() && fs.existsSync(path.join(distDir, p));
  } catch {
    return false;
  }
}

function extract (zipPath) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  if (process.platform === 'linux') {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', distDir], { stdio: 'inherit' });
  } else if (process.platform === 'win32') {
    // Windows 10+ ships bsdtar, which reads zip archives. Use its full path so a
    // GNU tar earlier on PATH (e.g. from Git Bash) is not picked up instead.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', zipPath, '-C', distDir], { stdio: 'inherit' });
  } else {
    // macOS ships bsdtar, which reads zip archives.
    execFileSync('/usr/bin/tar', ['-xf', zipPath, '-C', distDir], { stdio: 'inherit' });
  }
  const typeDefs = path.join(distDir, 'electron.d.ts');
  if (fs.existsSync(typeDefs)) fs.renameSync(typeDefs, path.join(electronDir, 'electron.d.ts'));
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath());
}

async function main () {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD || isInstalled()) return;

  console.log(`[ensure-electron] Installing Electron ${version} binary...`);
  const { downloadArtifact } = require('@electron/get');
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.env.npm_config_platform || process.platform,
    arch: process.env.npm_config_arch || process.arch
  });
  extract(zipPath);

  if (!isInstalled()) {
    throw new Error('Electron binary is still missing after extraction');
  }
  console.log('[ensure-electron] Done.');
}

main().catch((err) => {
  console.error('[ensure-electron] Failed:', err && err.message ? err.message : err);
  process.exit(1);
});
