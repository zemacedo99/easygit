'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Refuse directories, links/junctions, metadata and ambiguous Windows paths.
// Validate each component: realpath alone would follow links outside the root.
async function validateTrashPath(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\x00-\x1f:]/.test(relative) ||
      path.isAbsolute(relative) || path.win32.isAbsolute(relative)) throw new Error('Choose a file inside this project.');
  const parts = relative.split(/[\\/]/);
  if (parts.some(p => !p || p === '.' || p === '..' || /^\.git$/i.test(p) || /[. ]$/.test(p))) {
    throw new Error('Choose a file inside this project, outside its Git metadata.');
  }
  const base = await fs.realpath(root);
  let target = base;
  for (const part of parts) {
    target = path.join(target, part);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('Linked files and folders cannot be moved from EasyGit.');
  }
  const real = await fs.realpath(target);
  const rel = path.relative(base, real);
  if (!rel || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || !(await fs.stat(real)).isFile()) {
    throw new Error('Only a file inside this project can be moved.');
  }
  return real;
}

async function trashFile(root, relative, trashItem) {
  try {
    const target = await validateTrashPath(root, relative);
    await trashItem(target); // No permanent-delete fallback.
    return { ok: true, message: 'The file was moved to the Recycle Bin.' };
  } catch (error) {
    return { ok: false, error: { title: 'Could not move this file', detail: error.code === 'ENOENT'
      ? 'This file is no longer here. Check changes to refresh the list.'
      : 'EasyGit could not safely move this file to the Recycle Bin. It may be linked, outside the project, or in use. No permanent deletion was attempted.' } };
  }
}

async function findCode(env = process.env, platform = process.platform, exists = async p => {
  try { return (await fs.stat(p)).isFile(); } catch { return false; }
}) {
  for (const dir of (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const join = platform === 'win32' ? path.win32.join : path.posix.join;
    if (platform !== 'win32') {
      const command = join(dir, 'code');
      if (await exists(command)) return command;
    } else {
      // code.cmd is a shell script: launch its sibling Code.exe directly.
      for (const command of [join(dir, 'code.exe'), join(dir, '..', 'Code.exe')]) {
        if (await exists(command)) return command;
      }
    }
  }
  const candidates = platform === 'win32' ? [
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
    env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe'),
  ] : ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'];
  for (const command of candidates.filter(Boolean)) if (await exists(command)) return command;
  return null;
}

async function openCode(root, deps = {}) {
  const unavailable = { ok: false, error: { title: 'Could not open VS Code', detail: "EasyGit couldn't find Visual Studio Code on this computer. Install it or enable its code command, then try again." } };
  try {
    const command = await (deps.findCode || findCode)();
    if (!command) return unavailable;
    const folder = await fs.realpath(root);
    if (!(await fs.stat(folder)).isDirectory()) return unavailable;
    return await new Promise(resolve => {
      const child = (deps.spawn || spawn)(command, ['--new-window', folder], {
        shell: false, windowsHide: true, detached: true, stdio: 'ignore',
      });
      child.once('error', () => resolve(unavailable));
      child.once('spawn', () => { child.unref(); resolve({ ok: true }); });
    });
  } catch { return unavailable; }
}

module.exports = { validateTrashPath, trashFile, findCode, openCode };
