'use strict';
// Run three times with the same profile folder (each run is a real app restart):
//   .\node_modules\.bin\electron.cmd scripts/verify-organization-ui.js <profileDir> 1 [shotsDir]
//   .\node_modules\.bin\electron.cmd scripts/verify-organization-ui.js <profileDir> 2 [shotsDir]
//   .\node_modules\.bin\electron.cmd scripts/verify-organization-ui.js <profileDir> 3 [shotsDir]
// Real main/preload/renderer with an isolated profile and disposable Git projects
// (ACME/…, GLOBEX/…, projects/easy_git). No user project is used.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [profile, phaseArg, shots] = process.argv.slice(-3).filter((a) => !a.endsWith('.js'));
const phase = Number(phaseArg);
if (!profile || ![1, 2, 3].includes(phase)) {
  console.error('Usage: electron scripts/verify-organization-ui.js <profileDir> <1|2|3> [shotsDir]');
  process.exit(2);
}
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', path.join(profile, 'userData'));

const projects = path.join(profile, 'projects');
const REPO_DIRS = ['ACME/documentation', 'ACME/management', 'GLOBEX/documentation', 'GLOBEX/management', 'projects/easy_git'];
const snapshotFolders = () =>
  REPO_DIRS.map((d) => {
    const full = path.join(profile, d);
    return `${d}:${fs.existsSync(path.join(full, '.git'))}:${fs.readdirSync(full).sort().join(',')}`;
  });

if (phase === 1) {
  for (const dir of REPO_DIRS) {
    const root = path.join(profile, dir);
    fs.mkdirSync(root, { recursive: true });
    const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.name', 'UI Test');
    git('config', 'user.email', 'ui@example.invalid');
    fs.writeFileSync(path.join(root, 'README.md'), `# ${dir}\n`);
    git('add', '.');
    git('commit', '-qm', 'Initial');
  }
  fs.writeFileSync(path.join(profile, 'folders-before.json'), JSON.stringify(snapshotFolders()));
}

// Helpers injected into the page for every phase.
const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (p, what) => { for (let i = 0; i < 150; i++) { if (p()) return; await sleep(40); } throw Error('Timed out: ' + what); };
  const assert = (c, m) => { if (!c) throw Error(m); };
  const button = text => { const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim().includes(text) && !b.disabled).at(-1); if (!b) throw Error('Missing button ' + text); return b; };
  const click = text => button(text).click();
  const paths = () => [...document.querySelectorAll('#repo-list .repo-card .repo-path')].map(e => e.textContent.replace(/\\\\/g, '/').split('/').slice(-2).join('/'));
  const card = frag => [...document.querySelectorAll('#repo-list .repo-card')].find(c => c.querySelector('.repo-path').textContent.replace(/\\\\/g, '/').endsWith(frag));
  const header = name => [...document.querySelectorAll('.group-header')].find(h => h.querySelector('.group-name').textContent === name);
  const groups = () => [...document.querySelectorAll('.repo-group')].map(g => g.querySelector('.group-name').textContent + '[' + [...g.querySelectorAll('.repo-path')].map(p => p.textContent.replace(/\\\\/g, '/').split('/').slice(-2).join('/')).join(',') + ']' + (g.querySelector('.group-body').hidden ? '(collapsed)' : ''));
  const drag = (src, dst, where = 'before') => {
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const box = dst.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 10, clientY: where === 'after' ? box.bottom - 2 : box.top + 2 };
    dst.dispatchEvent(new DragEvent('dragenter', o));
    dst.dispatchEvent(new DragEvent('dragover', o));
    dst.dispatchEvent(new DragEvent('drop', o));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  };
  const openSettings = async () => { document.getElementById('btn-settings').click(); await waitFor(() => document.querySelector('.settings-list'), 'settings'); };
  const settingBox = title => [...document.querySelectorAll('.setting-row')].find(r => r.textContent.includes(title)).querySelector('input');
  const setSetting = async (title, on) => { const cb = settingBox(title); if (cb.checked !== on) { cb.click(); await sleep(250); } };
  const closeModal = async () => { click('Done'); await waitFor(() => !document.querySelector('.modal-overlay'), 'modal closed'); };
  const sortTo = async v => { const s = document.getElementById('repo-sort'); s.value = v; s.dispatchEvent(new Event('change')); await sleep(250); };
  const search = async q => { const s = document.getElementById('repo-search'); s.value = q; s.dispatchEvent(new Event('input')); await sleep(50); };
`;

const PHASES = {
  1: `
    const api = window.easygit;
    const dirs = ${JSON.stringify(REPO_DIRS.map((d) => path.join(profile, d)))};
    const added = await api.addManyRepos(dirs);
    assert(added.added.length === 5, 'add failed');
    return 'reload';
  `,
  '1b': `
    await waitFor(() => document.querySelectorAll('.repo-card').length === 5, 'cards');
    // 1. Organization OFF: the original flat list.
    assert(!document.querySelector('.repo-group, .org-bar, .is-draggable, .repo-group-btn'), 'organization UI leaked while OFF');
    assert(![...document.getElementById('repo-sort').options].some(o => o.value === 'custom'), 'Custom order offered while OFF');
    assert(document.getElementById('repo-count').textContent === '5', 'count');
    const offOrder = paths();
    await openSettings();
    assert([...document.querySelectorAll('.settings-nested')].find(n => n.textContent.includes('Arrange projects in your own order')).hidden, 'nested options visible while OFF');
    // 2-3. Enable organization + manual order.
    await setSetting('Organize your repository list', true);
    assert(![...document.querySelectorAll('.settings-nested')].find(n => n.textContent.includes('Arrange projects in your own order')).hidden, 'nested options hidden while ON');
    assert(settingBox('Create and edit your own groups').disabled, 'custom groups should need groups');
    await shot('settings-organization');
    await setSetting('Arrange projects in your own order', true);
    // A later toggle in the same dialog must not undo the switch to Custom order.
    await setSetting('Show projects in groups', true);
    await setSetting('Show projects in groups', false);
    await closeModal();
    assert(document.getElementById('repo-sort').value === 'custom', 'sort should switch to Custom order');
    const before = paths();
    drag(card('projects/easy_git'), card(before[0]), 'before');
    await sleep(300);
    const after = paths();
    assert(after[0] === 'projects/easy_git', 'drag reorder failed: ' + after);
    drag(card('ACME/documentation'), card(after.at(-1)), 'after');
    await sleep(300);
    const saved = (await window.easygit.getLayout()).order.length;
    assert(saved === 5, 'layout not saved');
    return { offOrder, manualOrder: paths() };
  `,
  2: `
    await waitFor(() => document.querySelectorAll('.repo-card').length === 5, 'cards');
    const restored = paths();
    // 5-6. Groups + custom groups.
    await openSettings();
    await setSetting('Show projects in groups', true);
    assert(!settingBox('Create and edit your own groups').disabled, 'custom groups still disabled');
    await setSetting('Create and edit your own groups', true);
    await closeModal();
    click('New group'); await waitFor(() => document.querySelector('.modal input.input'), 'name input');
    document.querySelector('.modal input.input').value = 'Personal'; click('Create group');
    await waitFor(() => header('Personal'), 'Personal group');
    click('New group'); await waitFor(() => document.querySelector('.modal input.input'), 'name input');
    document.querySelector('.modal input.input').value = 'Work'; click('Create group');
    await waitFor(() => header('Work'), 'Work group');
    // Move with the card button (non-drag alternative).
    card('projects/easy_git').querySelector('.repo-group-btn').click();
    await waitFor(() => document.querySelector('.move-choices'), 'move dialog');
    [...document.querySelectorAll('.move-choice')].find(b => b.textContent.includes('Personal')).click();
    await sleep(200);
    // 7. Drag into a group, between groups, and back out.
    drag(card('GLOBEX/documentation'), header('Work'));
    await sleep(200);
    drag(card('GLOBEX/management'), card('GLOBEX/documentation'), 'after');
    await sleep(200);
    const inWork = groups();
    drag(card('GLOBEX/management'), header('Personal'));
    await sleep(200);
    drag(card('GLOBEX/management'), header('Not in a group'));
    await sleep(200);
    drag(card('GLOBEX/documentation'), header('Not in a group'));
    await sleep(200);
    // Reorder groups: Work before Personal.
    drag(header('Work'), header('Personal'), 'before');
    await sleep(200);
    // 8. Collapse / expand.
    header('Personal').querySelector('.group-toggle').click(); await sleep(150);
    assert(!card('projects/easy_git'), 'collapsed group still shows its card');
    header('Work').querySelector('.group-toggle').click(); await sleep(150);
    header('Work').querySelector('.group-toggle').click(); await sleep(150);
    await shot('groups');
    return { restored, inWork, groups: groups(), count: document.getElementById('repo-count').textContent };
  `,
  3: `
    await waitFor(() => document.querySelector('.repo-group'), 'groups after restart');
    const restored = groups();
    // 10-12. Suggestions.
    await openSettings();
    await setSetting('Suggest groups from project folders', true);
    await closeModal();
    await waitFor(() => document.querySelector('.org-suggest'), 'suggestion banner');
    const banner = document.querySelector('.org-suggest-text').textContent;
    click('Review'); await waitFor(() => document.querySelector('.suggest-item'), 'suggestions');
    const offered = [...document.querySelectorAll('.suggest-item .suggest-name')].map(e => e.textContent);
    await shot('suggestions');
    const item = name => [...document.querySelectorAll('.suggest-item')].find(i => i.querySelector('.suggest-name').textContent.includes(name));
    [...item('ACME').querySelectorAll('button')].find(b => b.textContent === 'Create group').click(); await sleep(200);
    [...item('GLOBEX').querySelectorAll('button')].find(b => b.textContent === 'Dismiss').click(); await sleep(200);
    await waitFor(() => !document.querySelector('.modal-overlay'), 'suggestions closed');
    assert(header('ACME'), 'accepted group missing');
    assert(!document.querySelector('.org-suggest'), 'banner should be gone after accept + dismiss');
    // 13. Search inside a collapsed group.
    header('ACME').querySelector('.group-toggle').click(); await sleep(150);
    assert(!card('ACME/management'), 'ACME should be collapsed');
    await search('ACME');
    const searchGroups = groups(); const searchCount = document.getElementById('repo-count').textContent;
    assert(card('ACME/management') && card('ACME/documentation'), 'search did not reveal collapsed group');
    await search('easy_git');
    assert(card('projects/easy_git') && paths().length === 1, 'search in collapsed Personal failed');
    await shot('search-collapsed');
    await search('');
    assert(!card('ACME/management'), 'collapse should return after search');
    header('ACME').querySelector('.group-toggle').click(); await sleep(150);
    // 14. Automatic sort, then back to Custom order.
    const customLayout = groups();
    const savedBefore = JSON.stringify(await window.easygit.getLayout());
    await sortTo('attention');
    assert(!document.querySelector('.is-draggable'), 'drag should be off for automatic sorts');
    assert(document.querySelector('.org-hint'), 'missing Custom order hint');
    await sortTo('name');
    const nameView = groups();
    assert(JSON.stringify(await window.easygit.getLayout()) === savedBefore, 'automatic sort changed the saved layout');
    await sortTo('custom');
    assert(JSON.stringify(groups()) === JSON.stringify(customLayout), 'Custom order not restored');
    // 15. Delete a group.
    header('Personal').querySelector('[aria-label^="Delete group"]').click();
    await waitFor(() => document.querySelector('.modal-overlay'), 'confirm'); click('Delete group'); await sleep(200);
    assert(!header('Personal') && document.querySelectorAll('.repo-card').length === 5, 'delete group lost repositories');
    const afterDelete = groups();
    // 16. Disable organization -> the normal flat list.
    await openSettings(); await setSetting('Organize your repository list', false); await closeModal();
    assert(!document.querySelector('.repo-group, .org-bar, .is-draggable, .repo-group-btn'), 'organization UI visible while OFF');
    // Falls back to the last automatic sort chosen before "Custom order" (Name, above).
    assert(document.getElementById('repo-sort').value === 'name', 'sort did not fall back');
    assert(![...document.getElementById('repo-sort').options].some(o => o.value === 'custom'), 'Custom order option while OFF');
    const flat = paths();
    await shot('disabled-flat');
    // 17. Re-enable -> the organization comes back.
    await openSettings(); await setSetting('Organize your repository list', true); await closeModal();
    const reenabled = groups();
    assert(JSON.stringify(reenabled) === JSON.stringify(afterDelete), 'organization not restored');
    return { restored, banner, offered, searchGroups, searchCount, customLayout, nameView, afterDelete, flat, reenabled };
  `,
};

const timeout = setTimeout(() => { console.error('UI verification timed out'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('renderer:', message); });
  const shotFn = async (name) => {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const img = await win.webContents.capturePage();
      if (!img.isEmpty()) { fs.writeFileSync(path.join(shots, `${phase}-${name}.png`), img.toPNG()); return; }
    }
  };
  // Let the page ask for screenshots through the console-free title channel.
  win.webContents.on('page-title-updated', async (e, title) => {
    if (!title.startsWith('shot:')) return;
    e.preventDefault();
    await shotFn(title.slice(5));
    await win.webContents.executeJavaScript('window.__shotDone && window.__shotDone()');
  });
  const run = (body) => win.webContents.executeJavaScript(`(async () => {
    const shot = name => new Promise(r => { window.__shotDone = r; document.title = 'shot:' + name; });
    ${HELPERS}
    ${body}
  })()`, true);
  win.webContents.once('did-finish-load', async () => {
    try {
      win.show();
      let result = await run(PHASES[phase]);
      if (result === 'reload') {
        const loaded = new Promise((r) => win.webContents.once('did-finish-load', r));
        win.reload(); await loaded;
        result = await run(PHASES['1b']);
      }
      if (phase === 3) {
        const before = JSON.parse(fs.readFileSync(path.join(profile, 'folders-before.json'), 'utf8'));
        result.foldersUntouched = JSON.stringify(before) === JSON.stringify(snapshotFolders());
        if (!result.foldersUntouched) throw Error('Project folders changed!');
      }
      console.log(`PHASE ${phase} PASSED`, JSON.stringify(result, null, 1));
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error(`PHASE ${phase} FAILED`, error); clearTimeout(timeout); app.exit(1); }
  });
});
require('../src/main/main');
