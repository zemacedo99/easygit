'use strict';
// Run: .\node_modules\.bin\electron.cmd scripts/verify-describe-ui.js [shotsDir]
// Real main/preload/renderer, isolated profile, one disposable project whose
// "online" copy is a LOCAL bare repository (nothing is pushed anywhere real).
// Covers: normal / assisted / one-click "Upload my changes", ✨ Suggest,
// custom default description, and notification auto-close (on/off, stacked).
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const shots = process.argv.slice(2).filter((a) => !a.endsWith('.js') && !a.startsWith('-'))[0];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-describe-ui-'));
app.setPath('userData', path.join(temp, 'userData'));
app.setVersion(require('../package.json').version); // a script entry can't see package.json
const remote = path.join(temp, 'online.git');
const project = path.join(temp, 'project');
execFileSync('git', ['init', '-q', '--bare', remote]);
execFileSync('git', ['clone', '-q', remote, project], { stdio: 'pipe' });
const git = (...a) => execFileSync('git', a, { cwd: project, encoding: 'utf8', stdio: 'pipe' }).trim();
git('config', 'user.name', 'UI Test'); git('config', 'user.email', 'ui@example.invalid');
fs.writeFileSync(path.join(project, 'README.md'), '# sample\n'); git('add', '.'); git('commit', '-qm', 'Initial'); git('push', '-q', 'origin', 'HEAD');
const onlineSubject = () => execFileSync('git', ['--git-dir', remote, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
const change = (rel, text = `${Date.now()}\n`) => {
  fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
  fs.writeFileSync(path.join(project, rel), text);
};

const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (p, what, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = p(); if (v) return v; await sleep(40); } throw Error('Timed out: ' + what); };
  const assert = (c, m) => { if (!c) throw Error(m); };
  const btn = t => [...document.querySelectorAll('button')].filter(b => b.textContent.includes(t) && !b.disabled).at(-1);
  const click = t => { const b = btn(t); if (!b) throw Error('Missing button ' + t); b.click(); };
  const shot = name => new Promise(r => { window.__shotDone = r; document.title = 'shot:' + name; });
  const toasts = () => [...document.querySelectorAll('#toast-container .toast')];
  const lastToast = () => toasts().at(-1);
  const settings = async (patch) => { await window.easygit.setSettings(patch); };
  const openRepo = async () => {
    await waitFor(() => document.querySelector('.repo-card'), 'card');
    document.querySelector('.repo-card').click();
    await waitFor(() => btn('Check changes'), 'check'); click('Check changes');
    await waitFor(() => btn('Upload my changes') && !document.querySelector('#details.busy'), 'upload button');
  };
  const clearToasts = () => toasts().forEach(t => t.querySelector('.toast-close').click());
  const uploaded = async () => { await waitFor(() => toasts().some(t => /Uploaded/.test(t.textContent)), 'Uploaded toast', 30000); return lastToast().textContent; };
`;

const STEPS = {
  // 1. Defaults: normal upload asks, empty box; ✨ Suggest fills, then replaces after confirming.
  normal: `
    await openRepo();
    const s = await window.easygit.getSettings();
    assert(!s.autoCommitMessage && !s.autoUploadNoPrompt && !s.autoCloseToasts && s.commitDefaultMessage === '', 'defaults should be off');
    click('Upload my changes');
    const ta = await waitFor(() => document.querySelector('.modal textarea'), 'upload dialog');
    assert(ta.value === '', 'normal mode must start empty');
    click('Suggest');
    await waitFor(() => ta.value, 'Suggest filled the box');
    const suggested = ta.value;
    ta.value = 'My own words';
    click('Suggest');
    await waitFor(() => btn('Replace'), 'replace confirmation'); click('Replace');
    await waitFor(() => ta.value === suggested, 'Suggest replaced the box');
    await shot('normal-suggest');
    ta.value = 'Normal upload by hand';
    click('Save and upload');
    await uploaded();
    return { suggested };
  `,
  // 2. Assisted: the box is prepared from the changes, still editable.
  assisted: `
    await openRepo();
    clearToasts();
    click('Upload my changes');
    const ta = await waitFor(() => document.querySelector('.modal textarea'), 'upload dialog');
    await waitFor(() => ta.value, 'prepared text');
    const prepared = ta.value;
    await shot('assisted-prepared');
    ta.value = prepared + ' (edited)';
    click('Save and upload');
    await uploaded();
    return { prepared };
  `,
  // 3. Assisted with a custom default: pre-filled with exactly that text.
  assistedDefault: `
    await openRepo();
    clearToasts();
    click('Upload my changes');
    const ta = await waitFor(() => document.querySelector('.modal textarea'), 'upload dialog');
    await waitFor(() => ta.value, 'prepared text');
    const prepared = ta.value;
    click('Cancel');
    return { prepared };
  `,
  // 4. One-click: no dialog; save + upload in one go.
  oneClick: `
    await openRepo();
    clearToasts();
    click('Upload my changes');
    await sleep(300);
    assert(!document.querySelector('.modal textarea'), 'one-click must not open the dialog');
    const text = await uploaded();
    await shot('one-click-toast');
    return { toast: text };
  `,
  // 5. Notifications: off = stay; on = success/info close, errors stay, each on its own timer.
  toasts: `
    const ui = await import('./ui.js');
    clearToasts();
    ui.setToastAutoClose(false);
    ui.showToast({ type: 'success', title: 'Stays 1' });
    await sleep(5600);
    assert(toasts().length === 1, 'auto-close OFF must not dismiss');
    clearToasts();
    ui.setToastAutoClose(true);
    ui.showToast({ type: 'success', title: 'A success' });
    ui.showToast({ type: 'error', title: 'An error' });
    ui.showToast({ type: 'warn', title: 'A warning' });
    await sleep(2500);
    ui.showToast({ type: 'info', title: 'Later info' });
    ui.showToast({ type: 'success', title: 'Closed by hand' });
    await shot('toasts-stacked');
    toasts().find(t => t.textContent.includes('Closed by hand')).querySelector('.toast-close').click();
    await sleep(3000); // first success expired, later info not yet
    const mid = toasts().map(t => t.querySelector('.toast-title').textContent);
    assert(!mid.includes('A success') && mid.includes('Later info') && mid.includes('An error') && mid.includes('A warning'), 'timers mixed up: ' + mid);
    await sleep(2800);
    const end = toasts().map(t => t.querySelector('.toast-title').textContent);
    assert(JSON.stringify(end) === JSON.stringify(['An error', 'A warning']), 'errors/warnings must stay: ' + end);
    return { mid, end };
  `,
  persisted: `
    // Settings are applied during startup (before the version is shown).
    await waitFor(() => document.getElementById('app-version').textContent, 'startup finished');
    const s = await window.easygit.getSettings();
    assert(s.autoCloseToasts === true, 'auto-close setting not persisted');
    // The real setting (not the test hook) drives toasts after a restart.
    const ui = await import('./ui.js');
    clearToasts();
    ui.showToast({ type: 'success', title: 'After restart' });
    await sleep(5600);
    assert(toasts().length === 0, 'persisted auto-close not applied');
    return 'ok';
  `,
  // 6. Settings UI: nested options appear only with the parent option.
  settingsUi: `
    await waitFor(() => document.getElementById('app-version').textContent, 'startup finished');
    document.getElementById('btn-settings').click();
    await waitFor(() => document.querySelector('.settings-list'), 'settings');
    const row = t => [...document.querySelectorAll('.setting-row')].find(r => r.textContent.includes(t));
    const nested = row('Save and upload without asking').closest('.settings-nested');
    const parent = row('Automatically prepare the description').querySelector('input');
    if (parent.checked) { parent.click(); await sleep(300); }
    assert(nested.hidden, 'one-click option visible without the parent option');
    parent.click(); await sleep(300);
    assert(!nested.hidden, 'nested options should show');
    const input = row('Default description').querySelector('input');
    input.value = 'Typed in Settings'; input.dispatchEvent(new Event('change'));
    await sleep(300);
    await shot('settings');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const s = await window.easygit.getSettings();
    assert(s.autoCommitMessage && s.commitDefaultMessage === 'Typed in Settings', 'settings not saved');
    return 'ok';
  `,
};

const timeout = setTimeout(() => { console.error('Describe UI verification timed out'); app.exit(1); }, 240000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('renderer:', message); });
  win.webContents.on('page-title-updated', async (e, title) => {
    if (!title.startsWith('shot:')) return;
    e.preventDefault();
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const img = await win.webContents.capturePage();
        if (!img.isEmpty()) { fs.writeFileSync(path.join(shots, `describe-${title.slice(5)}.png`), img.toPNG()); break; }
      }
    }
    await win.webContents.executeJavaScript('window.__shotDone && window.__shotDone()');
  });
  const run = (body) => win.webContents.executeJavaScript(`(async () => { ${HELPERS} ${body} })()`, true);
  const reload = async () => { const loaded = new Promise((r) => win.webContents.once('did-finish-load', r)); win.reload(); await loaded; };
  win.webContents.once('did-finish-load', async () => {
    try {
      win.show();
      const out = {};
      await run(`await window.easygit.addRepo(${JSON.stringify(project)}); return 1;`);
      await reload();

      change('src/InvoiceList.js');
      out.normal = await run(STEPS.normal);
      if (onlineSubject() !== 'Normal upload by hand') throw Error('normal upload: ' + onlineSubject());

      await run(`await window.easygit.setSettings({ autoCommitMessage: true }); return 1;`);
      await reload();
      change('reports/Q3 summary.docx');
      out.assisted = await run(STEPS.assisted);
      if (out.assisted.prepared !== 'Add q3 summary') throw Error('assisted prepared: ' + out.assisted.prepared);
      if (onlineSubject() !== 'Add q3 summary (edited)') throw Error('assisted upload: ' + onlineSubject());

      await run(`await window.easygit.setSettings({ commitDefaultMessage: 'Weekly project update' }); return 1;`);
      await reload();
      change('notes.txt');
      out.assistedDefault = await run(STEPS.assistedDefault);
      if (out.assistedDefault.prepared !== 'Weekly project update') throw Error('custom default not prefilled');

      await run(`await window.easygit.setSettings({ autoUploadNoPrompt: true }); return 1;`);
      await reload();
      out.oneClickDefault = await run(STEPS.oneClick);
      if (onlineSubject() !== 'Weekly project update') throw Error('one-click custom default: ' + onlineSubject());

      await run(`await window.easygit.setSettings({ commitDefaultMessage: '' }); return 1;`);
      await reload();
      change('src/CustomerCard.js');
      out.oneClickGenerated = await run(STEPS.oneClick);
      if (onlineSubject() !== 'Add customer card') throw Error('one-click generated: ' + onlineSubject());
      if (git('status', '--porcelain') !== '') throw Error('one-click left changes behind');

      out.toasts = await run(STEPS.toasts);
      await run(`await window.easygit.setSettings({ autoCloseToasts: true }); return 1;`);
      await reload();
      out.persisted = await run(STEPS.persisted);

      await run(`await window.easygit.setSettings({ autoCommitMessage: false, autoUploadNoPrompt: false, commitDefaultMessage: '' }); return 1;`);
      await reload();
      out.settingsUi = await run(STEPS.settingsUi);

      out.onlineHistory = execFileSync('git', ['--git-dir', remote, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
      console.log('DESCRIBE UI PASSED', JSON.stringify(out, null, 1));
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error('DESCRIBE UI FAILED', error); clearTimeout(timeout); app.exit(1); }
  });
});
require('../src/main/main');
