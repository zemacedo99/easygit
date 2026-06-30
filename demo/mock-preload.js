'use strict';

/**
 * demo/mock-preload.js  (DEMO ONLY — not part of the shipped app)
 * --------------------------------------------------------------
 * A stand-in for the real preload bridge, used purely to capture screenshots.
 *
 * It exposes the SAME `window.easygit` API the real app uses, but backed by
 * in-memory sample data instead of real Git/IPC. This lets us render the REAL
 * UI (index.html / styles.css / app.js / ui.js) with realistic content, with no
 * real repositories or native dialogs required.
 *
 * It reuses the app's OWN friendly-text modules so the wording is identical to
 * production: messages.js (status labels), urls.js (remote links),
 * statusInterpreter.js (explanations).
 */

const path = require('path');
const fs = require('fs');

const { STATUS_INFO, Status } = require('../src/main/messages');
const urls = require('../src/main/urls');
const interpreter = require('../src/main/statusInterpreter');

const SEED_FLAG = path.join(__dirname, '.seed');

// --- sample data -----------------------------------------------------------

function minutesAgo(m) {
  return new Date(Date.now() - m * 60000).toISOString();
}

function buildSamples() {
  return [
    {
      id: 'r1',
      name: 'company-website',
      path: 'C:\\Users\\alex\\Documents\\company-website',
      branch: 'main',
      lastStatus: Status.NEEDS_DOWNLOAD,
      remoteUrl: 'git@github.com:acme/company-website.git',
      lastChecked: minutesAgo(8),
    },
    {
      id: 'r2',
      name: 'mobile-app',
      path: 'C:\\Users\\alex\\Dev\\mobile-app',
      branch: 'main',
      lastStatus: Status.NEEDS_UPLOAD_AND_DOWNLOAD,
      remoteUrl: 'https://github.com/acme/mobile-app.git',
      lastChecked: minutesAgo(3),
    },
    {
      id: 'r3',
      name: 'research-notes',
      path: 'C:\\Users\\alex\\Documents\\research-notes',
      branch: 'main',
      lastStatus: Status.UP_TO_DATE,
      remoteUrl: 'git@gitlab.com:team/research-notes.git',
      lastChecked: minutesAgo(15),
    },
    {
      id: 'r4',
      name: 'old-archive',
      path: 'C:\\Users\\alex\\Desktop\\old-archive',
      branch: 'main',
      lastStatus: Status.NEEDS_UPLOAD,
      remoteUrl: 'https://bitbucket.org/acme/old-archive.git',
      lastChecked: minutesAgo(120),
    },
    {
      id: 'r5',
      name: 'budget-2026',
      path: 'C:\\Users\\alex\\Documents\\budget-2026',
      branch: 'main',
      lastStatus: Status.LOCAL_CHANGES,
      remoteUrl: 'https://github.com/acme/budget-2026.git',
      lastChecked: minutesAgo(40),
    },
    {
      id: 'r6',
      name: 'holiday-photos-project',
      path: 'C:\\Users\\alex\\Pictures\\holiday-photos-project',
      branch: 'main',
      lastStatus: Status.NO_REMOTE,
      remoteUrl: null,
      lastChecked: minutesAgo(1440),
    },
  ];
}

// Per-repo "facts" used to build a realistic details panel on demand.
const FACTS = {
  r1: { hasRemote: true, hasUpstream: true, localChangeCount: 0, ahead: 0, behind: 3, fetched: true },
  r2: { hasRemote: true, hasUpstream: true, localChangeCount: 2, ahead: 2, behind: 1, fetched: true },
  r3: { hasRemote: true, hasUpstream: true, localChangeCount: 0, ahead: 0, behind: 0, fetched: true },
  r4: { hasRemote: true, hasUpstream: true, localChangeCount: 0, ahead: 5, behind: 0, fetched: true },
  r5: { hasRemote: true, hasUpstream: true, localChangeCount: 3, ahead: 0, behind: 0, fetched: true },
  r6: { hasRemote: false, hasUpstream: false, localChangeCount: 2, ahead: 0, behind: 0, fetched: false },
};

// Per-repo working/staged/conflicted file models (the new details flow).
const FILE_MODELS = {
  r2: {
    working: [
      { path: 'src/screens/LoginScreen.js', type: 'modified' },
      { path: 'assets/logo-new.png', type: 'untracked' },
      { path: 'README.md', type: 'modified' },
    ],
    staged: [{ path: 'src/theme/colors.js', type: 'modified' }],
    conflicted: [],
  },
  r5: {
    working: [
      { path: 'Q1-budget.xlsx', type: 'modified' },
      { path: 'Q2-budget.xlsx', type: 'modified' },
      { path: 'notes.txt', type: 'untracked' },
    ],
    staged: [],
    conflicted: [],
  },
};

const BRANCHES = {
  r2: ['main', 'feature/login', 'bugfix/crash'],
};

// Files changed online (for the simple "Online project" area), shown when behind.
const ONLINE_FILES = {
  r1: [
    { path: 'index.html', type: 'modified' },
    { path: 'styles/site.css', type: 'modified' },
    { path: 'about.html', type: 'added' },
  ],
  r2: [{ path: 'src/api/client.js', type: 'modified' }],
};

const HISTORY = {
  r2: [
    { hash: 'a1b2c3d', when: '2 hours ago', author: 'You', subject: 'Fix login button alignment' },
    { hash: '9f8e7d6', when: 'yesterday', author: 'You', subject: 'Add dark mode colours' },
    { hash: '4c3b2a1', when: '3 days ago', author: 'Maria', subject: 'Set up the mobile app project' },
    { hash: '7d6e5f4', when: 'last week', author: 'Maria', subject: 'First version' },
  ],
};

// Mutable per-repo file state so stage/unstage actually move items in the demo.
const MUT = {};
function getMut(id) {
  if (!MUT[id]) {
    const m = FILE_MODELS[id];
    MUT[id] = m ? JSON.parse(JSON.stringify(m)) : { working: [], staged: [], conflicted: [] };
  }
  return MUT[id];
}

// --- decoration (mirrors repoManager.decorate) -----------------------------

function decorate(repo) {
  const info = STATUS_INFO[repo.lastStatus] || STATUS_INFO[Status.UNKNOWN];
  return {
    ...repo,
    statusLabel: info.label,
    statusTone: info.tone,
    statusShort: info.short,
    browserUrl: urls.toBrowserUrl(repo.remoteUrl),
    provider: urls.providerName(repo.remoteUrl),
  };
}

function buildDetails(repo) {
  const facts = FACTS[repo.id] || { hasRemote: !!repo.remoteUrl, hasUpstream: !!repo.remoteUrl, ahead: 0, behind: 0, fetched: true };
  const mut = getMut(repo.id);
  const interpreted = interpreter.interpret({
    hasRemote: facts.hasRemote,
    hasUpstream: facts.hasUpstream,
    localChangeCount: mut.working.length + mut.staged.length + mut.conflicted.length,
    workingCount: mut.working.length,
    stagedCount: mut.staged.length,
    conflictedCount: mut.conflicted.length,
    untrackedCount: mut.working.filter((f) => f.type === 'untracked').length,
    ahead: facts.ahead,
    behind: facts.behind,
    fetched: facts.fetched,
  });
  const history = (HISTORY[repo.id] || []).map((h, i) => ({
    full: 'full-' + repo.id + '-' + i,
    hash: h.hash,
    when: h.when,
    author: h.author,
    subject: h.subject,
    local: i < (facts.ahead || 0), // the newest `ahead` versions are local-only
  }));
  return {
    ...interpreted,
    branch: repo.branch,
    branches: BRANCHES[repo.id] || [repo.branch],
    onlineFiles: ONLINE_FILES[repo.id] || [],
    upstream: facts.hasUpstream ? `origin/${repo.branch}` : null,
    hasRemote: facts.hasRemote,
    remoteUrl: repo.remoteUrl,
    provider: urls.providerName(repo.remoteUrl),
    browserUrl: urls.toBrowserUrl(repo.remoteUrl),
    ahead: facts.ahead,
    behind: facts.behind,
    fetched: facts.fetched,
    lastChecked: new Date().toISOString(),
    working: mut.working,
    staged: mut.staged,
    conflicted: mut.conflicted,
    history,
    counts: {
      working: mut.working.length,
      staged: mut.staged.length,
      conflicted: mut.conflicted.length,
      history: history.length,
    },
    fetchError: null,
  };
}

// --- mutable state ---------------------------------------------------------

let repos = fs.existsSync(SEED_FLAG) ? buildSamples() : [];
let addMode = 'valid';
let settings = { showAdvanced: false, showBranch: false };
const progressListeners = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// --- auto-scan simulation (demo only) ---
let scanCancelled = false;
const scanProgressListeners = [];
const SCAN_FINDINGS = [
  { name: 'company-website', path: 'C:\\Users\\alex\\Dev\\company-website', alreadyAdded: true },
  { name: 'invoice-generator', path: 'C:\\Users\\alex\\Dev\\invoice-generator', alreadyAdded: false },
  { name: 'portfolio-site', path: 'C:\\Users\\alex\\Dev\\portfolio-site', alreadyAdded: false },
  { name: 'data-scripts', path: 'C:\\Users\\alex\\Dev\\tools\\data-scripts', alreadyAdded: false },
  { name: 'mobile-app', path: 'C:\\Users\\alex\\Dev\\mobile-app', alreadyAdded: true },
  { name: 'experiments', path: 'C:\\Users\\alex\\Documents\\experiments', alreadyAdded: false },
];
const SCAN_STEPS = [
  'C:\\Users\\alex\\Dev',
  'C:\\Users\\alex\\Dev\\company-website',
  'C:\\Users\\alex\\Documents\\Projects',
  'C:\\Users\\alex\\Dev\\portfolio-site\\src',
  'C:\\Users\\alex\\Source\\repos',
  'C:\\Users\\alex\\Documents\\experiments',
  'C:\\Users\\alex\\Dev\\tools',
  'C:\\Users\\alex\\Desktop',
];

// --- the API the renderer talks to ----------------------------------------

window.easygit = {
  checkGitInstalled: async () => ({ installed: true, version: 'git version 2.33.0' }),
  getStoragePath: async () => 'C:\\Users\\alex\\AppData\\Roaming\\easygit\\repositories.json',

  listRepos: async () => repos.map(decorate),
  removeRepo: async (id) => {
    repos = repos.filter((r) => r.id !== id);
    return { ok: true };
  },
  removeAllRepos: async () => {
    const removed = repos.length;
    repos = [];
    return { ok: true, removed };
  },
  renameRepo: async (id, name) => {
    const r = repos.find((x) => x.id === id);
    if (r) r.name = name;
    return { ok: true, repo: decorate(r) };
  },

  addRepo: async (folderPath) => {
    if (addMode === 'invalid') {
      return {
        ok: false,
        error: {
          title: 'Not a Git repository',
          detail:
            'This folder does not look like a Git repository. Choose another folder, or create a Git repository here first.',
        },
      };
    }
    const repo = {
      id: 'added-' + (repos.length + 1),
      name: 'invoice-generator',
      path: 'C:\\Users\\alex\\Desktop\\invoice-generator',
      branch: 'main',
      lastStatus: Status.UNKNOWN,
      remoteUrl: 'https://github.com/acme/invoice-generator.git',
      lastChecked: null,
    };
    repos.push(repo);
    return { ok: true, repo: decorate(repo) };
  },
  addManyRepos: async (paths) => ({ added: paths.map((p) => ({ name: p })), skipped: 0 }),

  scan: async () => ({
    found: [
      { name: 'company-website', path: 'C:\\Users\\alex\\Dev\\company-website', alreadyAdded: true },
      { name: 'invoice-generator', path: 'C:\\Users\\alex\\Dev\\invoice-generator', alreadyAdded: false },
      { name: 'portfolio-site', path: 'C:\\Users\\alex\\Dev\\portfolio-site', alreadyAdded: false },
      { name: 'data-scripts', path: 'C:\\Users\\alex\\Dev\\tools\\data-scripts', alreadyAdded: false },
    ],
    scannedFolders: 214,
    errors: [],
  }),

  checkOne: async (id) => {
    await delay(450); // let the "Checking…" badge show briefly
    const repo = repos.find((r) => r.id === id);
    if (!repo) return { ok: false, error: { title: 'Not found', detail: 'Gone.' } };
    repo.lastChecked = new Date().toISOString();
    return { ok: true, repo: decorate(repo), details: buildDetails(repo) };
  },

  checkAll: async () => {
    const total = repos.length;
    let done = 0;
    for (const repo of repos) {
      await delay(250);
      repo.lastChecked = new Date().toISOString();
      done++;
      const result = { ok: true, repo: decorate(repo), details: buildDetails(repo) };
      progressListeners.forEach((cb) => cb({ id: repo.id, done, total, result }));
    }
    return { total, checked: done, byStatus: {} };
  },
  onCheckProgress: (cb) => {
    progressListeners.push(cb);
    return () => {
      const i = progressListeners.indexOf(cb);
      if (i >= 0) progressListeners.splice(i, 1);
    };
  },

  saveVersion: async () => ({ ok: true, message: 'Your version was saved on this computer.' }),
  download: async () => ({ ok: true, message: 'You now have the latest version from online.' }),
  upload: async () => ({ ok: true, message: 'Your saved changes were uploaded to the online repository.' }),
  hasUnsaved: async (id) => id === 'r2', // mobile-app has unsaved changes -> triggers the warning

  // Selection / staging (mutate the in-memory model so the flow is interactive)
  stage: async (id, paths) => {
    const m = getMut(id);
    const moved = m.working.filter((f) => paths.includes(f.path));
    m.working = m.working.filter((f) => !paths.includes(f.path));
    m.staged.push(...moved.map((f) => ({ ...f, type: f.type === 'untracked' ? 'added' : f.type })));
    return { ok: true };
  },
  stageAll: async (id) => {
    const m = getMut(id);
    m.staged.push(...m.working.map((f) => ({ ...f, type: f.type === 'untracked' ? 'added' : f.type })));
    m.working = [];
    return { ok: true };
  },
  unstage: async (id, paths) => {
    const m = getMut(id);
    const moved = m.staged.filter((f) => paths.includes(f.path));
    m.staged = m.staged.filter((f) => !paths.includes(f.path));
    m.working.push(...moved);
    return { ok: true };
  },
  commitStaged: async (id, message) => {
    const m = getMut(id);
    if (!m.staged.length) return { ok: false, error: { title: 'Nothing selected to save', detail: 'Move at least one change into “Ready to save” first.' } };
    m.staged = [];
    return { ok: true, message: 'Your version was saved on this computer.' };
  },
  switchBranch: async (id, name) => {
    const r = repos.find((x) => x.id === id);
    if (r) r.branch = name;
    return { ok: true, message: `You are now on version line “${name}”.` };
  },
  revealFile: async () => ({ ok: true }),

  uploadChanges: async (id, message) => {
    const m = getMut(id);
    if (m.conflicted.length) {
      return { ok: false, error: { title: 'Some files need attention', detail: 'Some files need attention before EasyGit can safely upload. Ask someone technical to help with this project.' } };
    }
    const hasFileChanges = m.working.length + m.staged.length > 0;
    if (hasFileChanges) {
      m.working = [];
      m.staged = [];
      return { ok: true, message: 'Your changes were saved and uploaded online.' };
    }
    return { ok: true, message: 'Your saved changes were uploaded online.' };
  },

  getSettings: async () => ({ ...settings }),
  setSettings: async (partial) => {
    settings = { ...settings, ...partial };
    return { ...settings };
  },

  pickFolder: async (title) => {
    if (title && title.toLowerCase().includes('scan')) return 'C:\\Users\\alex\\Dev';
    return addMode === 'invalid'
      ? 'C:\\Users\\alex\\Documents\\just-a-folder'
      : 'C:\\Users\\alex\\Desktop\\invoice-generator';
  },
  openFolder: async () => ({ ok: true }),
  openRemote: async () => ({ ok: true, url: 'https://github.com/acme/mobile-app' }),

  autoScan: async () => {
    scanCancelled = false;
    let scanned = 0;
    let found = 0;
    for (let i = 0; i < SCAN_STEPS.length; i++) {
      if (scanCancelled) break;
      scanned += 37;
      if (i % 2 === 1) found++;
      scanProgressListeners.forEach((cb) => cb({ scannedFolders: scanned, found, currentPath: SCAN_STEPS[i] }));
      await delay(280);
    }
    scanProgressListeners.forEach((cb) => cb({ scannedFolders: scanned, found, currentPath: null, done: true }));
    const list = scanCancelled ? SCAN_FINDINGS.slice(0, 3) : SCAN_FINDINGS;
    const newCount = list.filter((f) => !f.alreadyAdded).length;
    return {
      found: list,
      roots: [],
      scannedFolders: scanned,
      cancelled: scanCancelled,
      errorCount: 2,
      limitReached: false,
      summary: { total: list.length, new: newCount, already: list.length - newCount },
    };
  },
  cancelScan: async () => {
    scanCancelled = true;
    return { ok: true };
  },
  onScanProgress: (cb) => {
    scanProgressListeners.push(cb);
    return () => {
      const i = scanProgressListeners.indexOf(cb);
      if (i >= 0) scanProgressListeners.splice(i, 1);
    };
  },
};

// --- helpers the screenshot driver (shoot.js) uses -------------------------

window.__demo = {
  setAddMode: (m) => {
    addMode = m;
  },
  clickByText: (text) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text));
    if (btn) btn.click();
    return !!btn;
  },
  clickRepoByName: (name) => {
    const cards = [...document.querySelectorAll('.repo-card')];
    const card = cards.find((c) => {
      const n = c.querySelector('.repo-name');
      return n && n.textContent.trim() === name;
    });
    if (card) card.click();
    return !!card;
  },
  closeModal: () => {
    const o = document.querySelector('.modal-overlay');
    if (o) o.remove();
  },
  clickSettingByText: (text) => {
    const row = [...document.querySelectorAll('.setting-row')].find((r) => r.textContent.includes(text));
    if (row) {
      const cb = row.querySelector('input');
      if (cb) cb.click();
      return true;
    }
    return false;
  },
};
