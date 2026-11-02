'use strict';
// Run: .\node_modules\.bin\electron.cmd scripts/verify-remote-ui.js [shotsDir]
// Real main/preload/renderer, isolated profile, four disposable projects:
// local-only, HTTPS "origin", SSH remote named "company", and multiple remotes.
// Only local checks are used (no fetch), so the fake remote hosts are never contacted.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const shots = process.argv.slice(2).filter((a) => !a.endsWith('.js') && !a.startsWith('-'))[0];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-remote-ui-'));
app.setPath('userData', path.join(temp, 'userData'));
app.setVersion(require('../package.json').version); // a script entry can't see package.json

const PROJECTS = {
  'local-notes': [],
  'web-portal': [['origin', 'https://git.example.com/scm/~someone/web-portal.git']],
  'company-tools': [['company', 'git@github.com:team/company-tools.git']],
  'multi-remote': [['origin', 'https://git.example.com/scm/~someone/multi.git'], ['backup', 'git@github.com:team/multi.git'], ['mirror', 'file:///C:/mirrors/multi.git']],
};
const dirs = {};
for (const [name, remotes] of Object.entries(PROJECTS)) {
  const dir = path.join(temp, name);
  fs.mkdirSync(dir);
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`); git('add', '.'); git('commit', '-qm', 'Initial');
  for (const [r, url] of remotes) git('remote', 'add', r, url);
  dirs[name] = dir;
}
const remoteConfig = () => Object.values(dirs).map((d) => { try { return execFileSync('git', ['config', '--get-regexp', '^remote\\.'], { cwd: d, encoding: 'utf8' }); } catch { return ''; } }).join('|');
const before = remoteConfig();

const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (p, what, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = p(); if (v) return v; await sleep(40); } throw Error('Timed out: ' + what); };
  const assert = (c, m) => { if (!c) throw Error(m); };
  const btn = t => [...document.querySelectorAll('button')].filter(b => b.textContent.includes(t) && !b.disabled).at(-1);
  const shot = name => new Promise(r => { window.__shotDone = r; document.title = 'shot:' + name; });
  const card = name => [...document.querySelectorAll('#repo-list .repo-card')].find(c => c.querySelector('.repo-name').textContent === name);
  const cardStatus = name => { const s = card(name) && card(name).querySelector('.remote-status'); return s ? s.textContent.trim() : null; };
  const select = async name => { card(name).click(); await waitFor(() => document.querySelector('.details-header h2')?.textContent === name, 'details ' + name); };
  const hasOpenOnline = () => !!btn('Open online project');
  const detailLine = () => document.querySelector('.remote-status-detail')?.textContent.trim() || null;
  const started = () => waitFor(() => document.getElementById('app-version').textContent && document.querySelectorAll('.repo-card').length === 4, 'startup');
`;

const STEPS = {
  off: `
    await started();
    const s = await window.easygit.getSettings();
    assert(s.showRemoteStatus === false, 'default must be off');
    assert(!document.querySelector('.remote-status, .remote-status-detail'), 'remote status visible while off');
    await select('local-notes'); const localBtn = hasOpenOnline();
    await select('web-portal'); const httpsBtn = hasOpenOnline();
    await select('company-tools'); const otherBtn = hasOpenOnline();
    assert(!localBtn && httpsBtn && !otherBtn, 'off must keep today’s Open online rule: ' + [localBtn, httpsBtn, otherBtn]);
    await shot('off');
    return { localBtn, httpsBtn, otherBtn };
  `,
  turnOn: `
    await started();
    document.getElementById('btn-settings').click();
    await waitFor(() => document.querySelector('.settings-list'), 'settings');
    [...document.querySelectorAll('.setting-row')].find(r => r.textContent.includes('Show online repository status')).querySelector('input').click();
    await sleep(300);
    btn('Done').click();
    await waitFor(() => ['local-notes', 'web-portal', 'company-tools', 'multi-remote'].every(n => cardStatus(n) && !/Checking/.test(cardStatus(n))), 'statuses');
    const cards = Object.fromEntries(['local-notes', 'web-portal', 'company-tools', 'multi-remote'].map(n => [n, cardStatus(n)]));
    assert(/Only on this computer/.test(cards['local-notes']), 'local: ' + cards['local-notes']);
    assert(/Online repository: git\\.example\\.com$/.test(cards['web-portal']), 'https: ' + cards['web-portal']);
    assert(/Online repository: github\\.com$/.test(cards['company-tools']), 'ssh: ' + cards['company-tools']);
    assert(/Online repository: git\\.example\\.com \\(\\+2 more\\)/.test(cards['multi-remote']), 'multi: ' + cards['multi-remote']);
    const tooltip = card('multi-remote').querySelector('.remote-status').title;
    assert(/backup: github\\.com/.test(tooltip) && /mirror: a folder on this computer/.test(tooltip), 'multi tooltip: ' + tooltip);
    await select('local-notes');
    const localDetail = detailLine(); const localBtn = hasOpenOnline();
    assert(/No online repository connected/.test(localDetail) && !localBtn, 'local details: ' + localDetail);
    await select('company-tools');
    const otherDetail = detailLine(); const otherBtn = hasOpenOnline();
    assert(otherBtn && /isn’t set up/.test(otherDetail), 'company remote: ' + otherDetail);
    await select('web-portal');
    const httpsBtn = hasOpenOnline();
    assert(httpsBtn && !/isn’t set up/.test(detailLine()), 'https details');
    await shot('on-simple');
    return { cards, localDetail, otherDetail, httpsBtn };
  `,
  detailed: `
    await started();
    await waitFor(() => cardStatus('web-portal') && !/Checking/.test(cardStatus('web-portal')), 'persisted status after restart');
    await select('web-portal');
    btn('Check changes').click();
    await waitFor(() => document.querySelector('.flow-area, .simple-flow, .area-computer'), 'flow after local check');
    assert(/Online repository: git/.test(detailLine()), 'detailed details line');
    assert(hasOpenOnline(), 'detailed: open online');
    await select('local-notes');
    assert(/No online repository connected/.test(detailLine()) && !hasOpenOnline(), 'detailed local');
    await shot('on-detailed');
    return 'ok';
  `,
  listTools: `
    await started();
    await waitFor(() => cardStatus('multi-remote') && !/Checking/.test(cardStatus('multi-remote')), 'status');
    const search = document.getElementById('repo-search');
    search.value = 'company'; search.dispatchEvent(new Event('input')); await sleep(100);
    const found = [...document.querySelectorAll('#repo-list .repo-card .repo-name')].map(e => e.textContent);
    assert(found.length === 1 && found[0] === 'company-tools' && cardStatus('company-tools'), 'search');
    search.value = ''; search.dispatchEvent(new Event('input')); await sleep(100);
    const sort = document.getElementById('repo-sort'); sort.value = 'name'; sort.dispatchEvent(new Event('change')); await sleep(300);
    const order = [...document.querySelectorAll('#repo-list .repo-card .repo-name')].map(e => e.textContent);
    // Sorting applies inside each group: "Work" first, then "Not in a group".
    assert(JSON.stringify(order) === JSON.stringify(['multi-remote', 'web-portal', 'company-tools', 'local-notes']), 'sort ' + order);
    const groups = document.querySelectorAll('.repo-group').length;
    assert(groups > 0 && document.querySelectorAll('.repo-group .remote-status').length === 4, 'grouped list keeps status');
    await shot('on-grouped');
    return { found, order, groups };
  `,
  offAgain: `
    await started();
    assert(!document.querySelector('.remote-status, .remote-status-detail'), 'off again: clean');
    return 'ok';
  `,
};

const timeout = setTimeout(() => { console.error('Remote UI verification timed out'); app.exit(1); }, 180000);
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
        if (!img.isEmpty()) { fs.writeFileSync(path.join(shots, `remote-${title.slice(5)}.png`), img.toPNG()); break; }
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
      await run(`for (const d of ${JSON.stringify(Object.values(dirs))}) await window.easygit.addRepo(d); return 1;`);
      await reload();
      out.off = await run(STEPS.off);
      out.on = await run(STEPS.turnOn);
      await run(`await window.easygit.setSettings({ showAdvanced: true }); return 1;`);
      await reload(); // restart: status must persist
      out.detailed = await run(STEPS.detailed);
      await run(`await window.easygit.setSettings({ showAdvanced: false, organizeRepos: true, orgGroups: true, sortBy: 'name' });
        const repos = await window.easygit.listRepos();
        const ids = n => repos.find(r => r.name === n).id;
        await window.easygit.setLayout({ order: repos.map(r => r.id), groups: [{ id: 'g1', name: 'Work', collapsed: false, repoIds: [ids('web-portal'), ids('multi-remote')] }] });
        return 1;`);
      await reload();
      out.listTools = await run(STEPS.listTools);
      await run(`await window.easygit.setSettings({ showRemoteStatus: false, organizeRepos: false, orgGroups: false }); return 1;`);
      await reload();
      out.offAgain = await run(STEPS.offAgain);
      out.remotesUnchanged = remoteConfig() === before;
      if (!out.remotesUnchanged) throw Error('Git remotes were changed!');
      console.log('REMOTE UI PASSED', JSON.stringify(out, null, 1));
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error('REMOTE UI FAILED', error); clearTimeout(timeout); app.exit(1); }
  });
});
require('../src/main/main');
