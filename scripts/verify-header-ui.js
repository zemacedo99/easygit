'use strict';
// Run: .\node_modules\.bin\electron.cmd scripts/verify-header-ui.js [shotsDir]
// Real main/preload/renderer with an isolated profile and one disposable Git
// project. Checks the header version, Settings in the header (with zero, unselected
// and selected projects), version history, themes/text sizes and persistence.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const shots = process.argv.slice(2).filter((a) => !a.endsWith('.js') && !a.startsWith('-'))[0];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-header-'));
app.setPath('userData', path.join(temp, 'userData'));
const project = path.join(temp, 'sample');
fs.mkdirSync(project);
const git = (...args) => execFileSync('git', args, { cwd: project, windowsHide: true, stdio: 'pipe' });
git('init', '-q'); git('config', 'user.name', 'UI Test'); git('config', 'user.email', 'ui@example.invalid');
fs.writeFileSync(path.join(project, 'README.md'), '# sample\n'); git('add', '.'); git('commit', '-qm', 'Initial');
const expectedVersion = require('../package.json').version;
// Started as a script, Electron can't see EasyGit's package.json and would report
// its own version; `npm start` and the packaged app read it automatically.
app.setVersion(expectedVersion);

const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (p, what) => { for (let i = 0; i < 150; i++) { if (p()) return; await sleep(40); } throw Error('Timed out: ' + what); };
  const assert = (c, m) => { if (!c) throw Error(m); };
  const click = text => { const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().includes(text)).at(-1); if (!b) throw Error('Missing button ' + text); b.click(); };
  const shot = name => new Promise(r => { window.__shotDone = r; document.title = 'shot:' + name; });
  const openSettings = async () => { document.getElementById('btn-settings').click(); await waitFor(() => document.querySelector('.settings-list'), 'settings opens'); };
  const closeTop = async () => { const n = document.querySelectorAll('.modal-overlay').length; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await waitFor(() => document.querySelectorAll('.modal-overlay').length === n - 1, 'top modal closes'); };
  const setChoice = async (title, value) => { const sel = [...document.querySelectorAll('.setting-row')].find(r => r.textContent.includes(title)).querySelector('select'); sel.value = value; sel.dispatchEvent(new Event('change')); await sleep(250); };
`;

const STEPS = `
  const api = window.easygit;
  // 1-2. Version in the header, from the app metadata (not hardcoded).
  await waitFor(() => document.getElementById('app-version').textContent, 'version');
  const runtime = await api.getVersion();
  const header = document.getElementById('app-version').textContent;
  assert(header === 'v' + runtime && runtime === ${JSON.stringify(expectedVersion)}, 'header version ' + header + ' / ' + runtime);
  // 5. Zero repositories: empty state, Settings still opens from the header.
  assert(!document.getElementById('empty-state').hidden && document.querySelectorAll('.repo-card').length === 0, 'expected empty state');
  await openSettings();
  assert(document.body.textContent.includes('Current version: v' + runtime), 'About section version');
  assert([...document.querySelectorAll('button')].some(b => b.textContent.includes('Check for updates')), 'Check for updates missing');
  await shot('settings-zero-repos');
  // 7-10. Version history from Settings, newest first, grounded content, scrolls.
  click('What’s new & version history');
  await waitFor(() => document.querySelector('.changelog'), 'history');
  const versions = [...document.querySelectorAll('.changelog-version')].map(e => e.textContent);
  assert(JSON.stringify(versions) === JSON.stringify(['v1.3.0', 'v1.2.0', 'v1.1.0', 'v1.0.0']) || versions[0] === 'v' + runtime, 'order ' + versions);
  const open = [...document.querySelectorAll('.changelog-release')].filter(d => d.open).map(d => d.querySelector('.changelog-version').textContent);
  assert(open.length === 1 && open[0] === 'v' + runtime, 'only the running version starts open: ' + open);
  assert(document.querySelector('.changelog-current').closest('.changelog-release').querySelector('.changelog-version').textContent === 'v' + runtime, 'current marker');
  document.querySelectorAll('.changelog-release').forEach(d => d.open = true);
  const body = document.querySelector('.changelog').closest('.modal-body');
  await sleep(100);
  assert(body.scrollHeight > body.clientHeight, 'history should scroll when expanded');
  assert(body.closest('.modal').getBoundingClientRect().height <= window.innerHeight * 0.86, 'modal taller than 85vh');
  body.scrollTop = body.scrollHeight; await sleep(50);
  assert(body.scrollTop > 0, 'did not scroll');
  body.scrollTop = 0;
  const firstItems = [...document.querySelectorAll('.changelog-release')][0].textContent;
  await shot('history-dark');
  await closeTop(); // Escape closes only the history, Settings stays open
  assert(document.querySelector('.settings-list'), 'Escape closed Settings too');
  // 11-12. Light theme + larger text: history still usable.
  await setChoice('Theme', 'light');
  await setChoice('Text size', 'larger');
  click('What’s new & version history'); await waitFor(() => document.querySelector('.changelog'), 'history light');
  assert(document.documentElement.dataset.theme === 'light', 'light theme');
  const lightBody = document.querySelector('.changelog').closest('.modal-body');
  assert(lightBody.scrollWidth <= lightBody.clientWidth + 1, 'horizontal overflow at larger text');
  await shot('history-light-larger');
  await closeTop(); await closeTop();
  await shot('header-light-larger');
  // 13. Toggles still persist.
  await openSettings();
  const vs = [...document.querySelectorAll('.setting-row')].find(r => r.textContent.includes('Open in VS Code')).querySelector('input');
  vs.click(); await sleep(250);
  await closeTop();
  const saved = await api.getSettings();
  assert(saved.showVSCode === false && saved.theme === 'light' && saved.fontSize === 'larger', 'settings not persisted');
  // 4/3. With a project: Settings opens with none selected, then with one selected.
  const added = await api.addRepo(${JSON.stringify(project)});
  assert(added.ok, 'add failed');
  return { runtime, header, versions, firstItems: firstItems.slice(0, 120) };
`;

const AFTER_RELOAD = `
  await waitFor(() => document.querySelector('.repo-card'), 'card');
  assert(document.getElementById('app-version').textContent === 'v' + await window.easygit.getVersion(), 'version after reload');
  const saved = await window.easygit.getSettings();
  assert(saved.showVSCode === false && document.documentElement.dataset.theme === 'light', 'settings lost after reload');
  assert(!document.querySelector('#details:not([hidden])'), 'nothing should be selected yet');
  await openSettings(); await closeTop();
  document.querySelector('.repo-card').click();
  await waitFor(() => document.querySelector('.details-header'), 'details');
  // 6. The old details-panel gear is gone; only the header entry point remains.
  assert(!document.querySelector('.details-header button') && !document.querySelector('.settings-gear'), 'details still has a Settings button');
  assert(document.querySelectorAll('[title="Settings"]').length === 1, 'more than one Settings entry point');
  await openSettings();
  await shot('settings-selected');
  await closeTop();
  // Back to dark/normal so the default look is captured too.
  await window.easygit.setSettings({ theme: 'dark', fontSize: 'normal', showVSCode: true });
  return 'reload';
`;

const FINAL = `
  await waitFor(() => document.querySelector('.repo-card'), 'card');
  document.querySelector('.repo-card').click();
  await waitFor(() => document.querySelector('.details-header'), 'details');
  await shot('header-dark-normal');
  return 'done';
`;

const timeout = setTimeout(() => { console.error('Header UI verification timed out'); app.exit(1); }, 90000);
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
        if (!img.isEmpty()) { fs.writeFileSync(path.join(shots, `header-${title.slice(5)}.png`), img.toPNG()); break; }
      }
    }
    await win.webContents.executeJavaScript('window.__shotDone && window.__shotDone()');
  });
  const run = (body) => win.webContents.executeJavaScript(`(async () => { ${HELPERS} ${body} })()`, true);
  const reload = async () => { const loaded = new Promise((r) => win.webContents.once('did-finish-load', r)); win.reload(); await loaded; };
  win.webContents.once('did-finish-load', async () => {
    try {
      win.show();
      const result = await run(STEPS);
      await reload();
      await run(AFTER_RELOAD);
      await reload();
      await run(FINAL);
      console.log('HEADER UI PASSED', JSON.stringify(result, null, 1));
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error('HEADER UI FAILED', error); clearTimeout(timeout); app.exit(1); }
  });
});
require('../src/main/main');
