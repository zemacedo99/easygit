/**
 * ui.js (renderer)
 * ----------------
 * All DOM building and rendering. No app logic, no IPC – app.js calls these
 * functions and passes in handlers.
 *
 * We build DOM with a small `h()` helper and set text via textContent (never
 * innerHTML) so repository names/paths from disk can never inject markup.
 */

import { formatLastChecked, changeTypeInfo, splitPath } from './labels.js';

/* ------------------------------------------------------------------ */
/* Tiny DOM helper                                                     */
/* ------------------------------------------------------------------ */

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [attrs]  className, text, onClick, hidden, and any attribute.
 * @param {Array<Node|string>} [children]
 */
export function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // only used with trusted, static strings
    else if (key === 'onClick') node.addEventListener('click', value);
    else if (key === 'onInput') node.addEventListener('input', value);
    else if (key === 'hidden') node.hidden = !!value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {{type?: 'info'|'success'|'error'|'warn', title: string, body?: string}} opts
 */
export function showToast({ type = 'info', title, body = '' }) {
  const container = document.getElementById('toast-container');
  const toast = h('div', { className: `toast ${type}` }, [
    h('div', { className: 'toast-title', text: title }),
    body ? h('div', { className: 'toast-body', text: body }) : null,
  ]);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

/* ------------------------------------------------------------------ */
/* Modal                                                              */
/* ------------------------------------------------------------------ */

/**
 * Open a modal dialog.
 * @param {{title: string, subtitle?: string, body: Node, footer: Node[]}} opts
 * @returns {() => void} close function
 */
export function openModal({ title, subtitle, body, footer = [] }) {
  const root = document.getElementById('modal-root');

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  const overlay = h('div', { className: 'modal-overlay' }, [
    h('div', { className: 'modal' }, [
      h('div', { className: 'modal-header' }, [
        h('h2', { text: title }),
        subtitle ? h('p', { text: subtitle }) : null,
      ]),
      h('div', { className: 'modal-body' }, [body]),
      h('div', { className: 'modal-footer' }, footer),
    ]),
  ]);

  // Click on the dark backdrop closes the modal.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  root.appendChild(overlay);
  return close;
}

/* ------------------------------------------------------------------ */
/* Repository list                                                     */
/* ------------------------------------------------------------------ */

/** A status badge element built from a repo's status tone + label. */
function statusBadge(tone, label, checking = false) {
  if (checking) {
    return h('span', { className: 'badge checking' }, [
      h('span', { className: 'dot' }),
      'Checking…',
    ]);
  }
  return h('span', { className: `badge tone-${tone || 'neutral'}` }, [
    h('span', { className: 'dot' }),
    label || 'Not checked yet',
  ]);
}

/**
 * Render the list of repositories.
 * @param {object[]} repos
 * @param {string|null} selectedId
 * @param {(id: string) => void} onSelect
 * @param {Set<string>} checkingIds  repos currently being checked
 */
export function renderRepoList(repos, selectedId, onSelect, checkingIds = new Set()) {
  const listEl = document.getElementById('repo-list');
  const emptyEl = document.getElementById('empty-state');
  const countEl = document.getElementById('repo-count');

  countEl.textContent = String(repos.length);
  listEl.textContent = '';

  if (repos.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  for (const repo of repos) {
    const card = h(
      'div',
      {
        className: 'repo-card' + (repo.id === selectedId ? ' selected' : ''),
        onClick: () => onSelect(repo.id),
      },
      [
        h('div', { className: 'repo-card-top' }, [
          h('div', {}, [
            h('p', { className: 'repo-name', text: repo.name }),
            h('p', { className: 'repo-path', text: repo.path }),
          ]),
          statusBadge(repo.statusTone, repo.statusLabel, checkingIds.has(repo.id)),
        ]),
        h('div', { className: 'repo-meta' }, [
          h('span', {}, [
            h('span', { className: 'meta-label', text: 'Current version line: ' }),
            repo.branch || '—',
          ]),
          h('span', { text: formatLastChecked(repo.lastChecked) }),
        ]),
      ]
    );
    listEl.appendChild(card);
  }
}

/* ------------------------------------------------------------------ */
/* Repository details panel                                            */
/* ------------------------------------------------------------------ */

/**
 * Render the details panel for a selected repository.
 * @param {object} repo
 * @param {object|null} details  result of a status check, or null if not checked
 * @param {object} handlers  onCheck, onStage, onStageAll, onUnstage, onSaveVersion,
 *   onUpload, onDownload, onSwitchBranch, onReveal, onOpenFolder, onOpenRemote,
 *   onRename, onRemove
 */
export function renderDetails(repo, details, handlers) {
  const detailsEmpty = document.getElementById('details-empty');
  const detailsEl = document.getElementById('details');

  if (!repo) {
    detailsEmpty.hidden = false;
    detailsEl.hidden = true;
    detailsEl.textContent = '';
    return;
  }

  detailsEmpty.hidden = true;
  detailsEl.hidden = false;
  detailsEl.textContent = '';

  // Header: name + path + status badge.
  detailsEl.appendChild(
    h('div', { className: 'details-header' }, [
      h('div', { className: 'details-title' }, [
        h('h2', { text: repo.name }),
        h('p', { className: 'repo-path', text: repo.path }),
      ]),
      statusBadge(repo.statusTone, repo.statusLabel),
    ])
  );

  // A) Status banner – the colored, plain-language explanation.
  const tone = details ? details.tone || repo.statusTone : repo.statusTone;
  const explanationText = details
    ? details.explanation
    : repo.statusShort || 'This repository has not been checked yet. Use “Check changes” to see its current state.';
  detailsEl.appendChild(h('div', { className: `explanation tone-${tone || 'neutral'}`, text: explanationText }));

  // Not checked yet: offer a gentle first action and stop here.
  if (!details) {
    detailsEl.appendChild(
      h('div', { className: 'utility-row' }, [
        actionButton('🔎', 'Check changes', () => handlers.onCheck(false), true),
        actionButton('📂', 'Open folder', () => handlers.onOpenFolder()),
      ])
    );
    return;
  }

  // Repository unavailable (folder moved/deleted or no longer a Git repo):
  // show only the safe utilities, never a misleading empty flow.
  if (details.error || details.status === 'error') {
    detailsEl.appendChild(
      h('div', { className: 'utility-row' }, [
        actionButton('🔄', 'Check again', () => handlers.onCheck(true), true),
        actionButton('📂', 'Open folder', () => handlers.onOpenFolder()),
        dangerButton('🗑️', 'Remove from EasyGit', () => handlers.onRemove()),
      ])
    );
    return;
  }

  // Current version line (branch) card.
  detailsEl.appendChild(renderVersionLineCard(details, handlers));

  // B) The visual project flow: This computer -> Ready to save -> Saved -> Online.
  detailsEl.appendChild(renderFlow(repo, details, handlers));

  // Utility actions (always available and safe).
  detailsEl.appendChild(
    h('div', { className: 'utility-row' }, [
      actionButton('🔄', 'Check again', () => handlers.onCheck(true)),
      actionButton('📂', 'Open folder', () => handlers.onOpenFolder()),
      details.browserUrl ? actionButton('🔗', 'Open online repository', () => handlers.onOpenRemote()) : null,
      actionButton('✏️', 'Rename', () => handlers.onRename()),
      dangerButton('🗑️', 'Remove from EasyGit', () => handlers.onRemove()),
    ])
  );
}

/* ------------------------------------------------------------------ */
/* Repository details – helpers for the visual flow                    */
/* ------------------------------------------------------------------ */

function actionButton(icon, label, onClick, primary) {
  return h('button', { className: 'btn btn-sm' + (primary ? ' btn-primary' : ''), onClick }, [
    h('span', { className: 'btn-icon', text: icon }),
    ' ' + label,
  ]);
}

function dangerButton(icon, label, onClick) {
  return h('button', { className: 'btn btn-sm btn-danger', onClick }, [
    h('span', { className: 'btn-icon', text: icon }),
    ' ' + label,
  ]);
}

function emptyNode(text) {
  return h('div', { className: 'area-empty', text });
}

function flowArrow() {
  return h('div', { className: 'flow-arrow', text: '›' });
}

/** The "current version line" card with an optional safe branch switcher. */
function renderVersionLineCard(details, handlers) {
  const branch = details.branch || '—';
  const parts = [];
  parts.push(details.upstream ? `Connected to online “${details.upstream}”.` : 'Not linked to an online version line yet.');
  if (details.ahead > 0) parts.push(`${details.ahead} saved version${details.ahead === 1 ? '' : 's'} only on this computer.`);
  if (details.behind > 0) parts.push(`${details.behind} newer version${details.behind === 1 ? '' : 's'} online.`);

  const left = h('div', { className: 'vl-main' }, [
    h('div', { className: 'vl-label', text: 'Current version line' }),
    h('div', { className: 'vl-name' }, [h('span', { className: 'vl-icon', text: '🌿' }), h('span', { text: branch })]),
    h('div', { className: 'vl-sub', text: parts.join(' ') }),
  ]);

  let switcher = null;
  const branches = details.branches || [];
  const onAknownBranch = branches.includes(branch);
  if (branches.length > 1 || (branches.length >= 1 && !onAknownBranch)) {
    const sel = h('select', { className: 'vl-select' });
    // Detached / unknown current line: a disabled placeholder so the dropdown
    // never claims a line the user is not actually on, while still letting them
    // pick a real one to recover.
    if (!onAknownBranch) {
      const ph = h('option', { value: '', text: 'On a temporary line — pick one' });
      ph.disabled = true;
      ph.selected = true;
      sel.appendChild(ph);
    }
    branches.forEach((b) => {
      const opt = h('option', { value: b, text: b });
      if (b === branch) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v && v !== branch) handlers.onSwitchBranch(v);
    });
    switcher = h('div', { className: 'vl-switch' }, [h('label', { className: 'vl-switch-label', text: 'Switch line' }), sel]);
  }

  return h('div', { className: 'version-line-card' }, [left, switcher]);
}

/** A selectable, draggable list of files. Returns helpers to read the selection. */
function selectableFileList(files, fromArea, handlers) {
  const checks = new Map();
  const countListeners = [];
  const notify = () => {
    const n = getChecked().length;
    const total = checks.size;
    countListeners.forEach((fn) => fn(n, total));
  };
  const items = files.map((f) => fileRow(f, fromArea, handlers, checks, notify));
  const node = h('ul', { className: 'file-list' }, items);

  function getChecked() {
    const out = [];
    for (const [p, cb] of checks) if (cb.checked) out.push(p);
    return out;
  }
  function selectAll(state) {
    for (const [, cb] of checks) cb.checked = state;
    notify();
  }
  return { node, getChecked, selectAll, onCountChange: (fn) => countListeners.push(fn) };
}

/** One file row: checkbox, change badge, name/path, reveal button, drag support. */
function fileRow(f, fromArea, handlers, checks, notify) {
  const info = changeTypeInfo(f.type);
  const { name, dir } = splitPath(f.path);
  const cb = h('input', { type: 'checkbox', className: 'file-check' });
  cb.addEventListener('change', () => notify && notify());
  checks.set(f.path, cb);

  const row = h('li', { className: 'file-row', draggable: 'true' }, [
    cb,
    h('span', { className: `ct-badge ${info.cls}`, title: info.label, text: info.icon }),
    h('div', { className: 'file-meta' }, [
      h('div', { className: 'file-name', text: name }),
      dir ? h('div', { className: 'file-dir', text: dir }) : null,
    ]),
    h('span', { className: 'file-type', text: info.label }),
    h('button', {
      className: 'icon-btn',
      title: 'Show this file in the folder',
      onClick: (e) => { e.stopPropagation(); handlers.onReveal(f.path); },
    }, '📂'),
  ]);

  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'file', from: fromArea, path: f.path, orig: f.orig || null }));
    // A marker type readable during dragover so only valid areas highlight.
    e.dataTransfer.setData(markerType('file:' + fromArea), '');
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  return row;
}

/** Non-selectable group for conflicted files (need a person to resolve). */
function conflictGroup(conflicted, handlers) {
  return h('div', { className: 'conflict-group' }, [
    h('div', { className: 'group-title', text: '⚠️ Needs attention' }),
    h('ul', { className: 'file-list' }, conflicted.map((f) => {
      const { name, dir } = splitPath(f.path);
      return h('li', { className: 'file-row conflict' }, [
        h('span', { className: 'ct-badge ct-conflict', title: 'Needs attention', text: '⚠️' }),
        h('div', { className: 'file-meta' }, [
          h('div', { className: 'file-name', text: name }),
          dir ? h('div', { className: 'file-dir', text: dir }) : null,
        ]),
        h('span', { className: 'file-type', text: 'Needs a person' }),
        h('button', { className: 'icon-btn', title: 'Show this file in the folder', onClick: () => handlers.onReveal(f.path) }, '📂'),
      ]);
    })),
  ]);
}

/** A timeline of saved versions, newest first. */
function renderTimeline(history) {
  if (!history.length) return emptyNode('No saved versions yet.');
  return h('ul', { className: 'timeline' }, history.map((c, i) =>
    h('li', { className: 'timeline-item' + (i === 0 ? ' newest' : '') }, [
      h('span', { className: 'timeline-dot ' + (c.local ? 'is-local' : 'is-online') }),
      h('div', { className: 'timeline-body' }, [
        h('div', { className: 'tl-subject', text: c.subject }),
        h('div', { className: 'tl-meta', text: `${c.author ? c.author + ' · ' : ''}${c.when}${i === 0 ? ' · newest' : ''}` }),
        h('div', { className: 'tl-tags' }, [
          h('span', { className: 'tl-loc ' + (c.local ? 'loc-local' : 'loc-online'), text: c.local ? 'On this computer only' : 'Uploaded' }),
          h('span', { className: 'tl-hash', text: c.hash }),
        ]),
      ]),
    ])
  ));
}

/** A visual status card for the online repository. */
function renderOnlineCard(details) {
  if (!details.hasRemote) {
    return emptyNode('Not connected to an online repository. Saved versions stay on this computer.');
  }
  const row = (k, v, cls) => h('div', { className: 'online-row' }, [
    h('span', { className: 'online-key', text: k }),
    h('span', { className: 'online-val ' + (cls || ''), text: v }),
  ]);
  const rows = [
    row('Provider', details.provider || 'Online repository'),
  ];
  if (details.browserUrl || details.remoteUrl) rows.push(row('Address', details.browserUrl || details.remoteUrl));
  rows.push(row('To upload', details.ahead > 0 ? `${details.ahead} saved version${details.ahead === 1 ? '' : 's'}` : 'Nothing waiting', details.ahead > 0 ? 'val-up' : ''));
  rows.push(row('To download', details.behind > 0 ? `${details.behind} newer version${details.behind === 1 ? '' : 's'}` : 'Nothing new', details.behind > 0 ? 'val-down' : ''));
  rows.push(row('Last checked', formatLastChecked(details.lastChecked)));
  if (details.fetchError) {
    rows.push(h('div', { className: 'online-warn' }, [h('strong', { text: details.fetchError.title + '. ' }), details.fetchError.detail]));
  }
  return h('div', { className: 'online-card' }, rows);
}

/** Custom drag marker type for an accept key (visible during dragover). */
function markerType(key) {
  return 'application/x-easygit-' + key.replace(':', '-');
}

/** A draggable handle used to drag a whole area onto the next one. */
function dragHandle(kind, title) {
  const handle = h('span', { className: 'drag-handle', title, draggable: 'true', text: '⠿' });
  handle.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ kind }));
    e.dataTransfer.setData(markerType(kind), '');
    e.dataTransfer.effectAllowed = 'move';
  });
  return handle;
}

/** Make an element accept drops of the given kinds, calling onDrop(payload). */
function makeDropZone(el, accepts, onDrop) {
  el.addEventListener('dragover', (e) => {
    // Only highlight + allow the drop when this zone actually accepts the item.
    const ok = accepts.some((k) => Array.from(e.dataTransfer.types).includes(markerType(k)));
    if (!ok) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', (e) => {
    // relatedTarget is where the cursor went; if it left the area entirely, clear.
    if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    let payload;
    try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
    if (!payload) return;
    const key = payload.kind === 'file' ? `file:${payload.from}` : payload.kind;
    if (accepts.includes(key)) onDrop(payload);
  });
}

/** Generic flow-area card. */
function buildArea({ key, icon, title, subtitle, count, countTone, dim, body, actions, handle }) {
  const header = h('div', { className: 'area-header' }, [
    h('span', { className: 'area-icon', text: icon }),
    h('div', { className: 'area-titles' }, [
      h('div', { className: 'area-title', text: title }),
      h('div', { className: 'area-sub', text: subtitle }),
    ]),
    count != null ? h('span', { className: `count-badge ${countTone || ''}`, text: String(count) }) : null,
    handle || null,
  ]);
  const dimmed = dim != null ? dim : count === 0;
  return h('div', { className: `flow-area area-${key}` + (dimmed ? ' is-empty' : '') }, [
    header,
    body,
    actions && actions.length ? h('div', { className: 'area-actions' }, actions) : null,
  ]);
}

/** The four-area flow with arrows + drag-and-drop wiring. */
function renderFlow(repo, details, handlers) {
  const working = details.working || [];
  const conflicted = details.conflicted || [];
  const staged = details.staged || [];
  const history = details.history || [];

  /* Area 1: This computer (working changes + conflicts) */
  const workingList = selectableFileList(working, 'working', handlers);
  const moveBtn = actionButton('➡️', 'Move selected to Ready to save', () => {
    const p = workingList.getChecked();
    if (p.length) handlers.onStage(p);
  }, true);
  moveBtn.disabled = true;
  workingList.onCountChange((n) => { moveBtn.disabled = n === 0; });

  const a1Children = [];
  if (working.length) {
    const master = h('input', { type: 'checkbox', className: 'file-check' });
    master.addEventListener('change', () => workingList.selectAll(master.checked));
    // Keep the master checkbox in sync with manual per-file selection.
    workingList.onCountChange((n, total) => {
      master.checked = total > 0 && n === total;
      master.indeterminate = n > 0 && n < total;
    });
    a1Children.push(h('label', { className: 'select-all' }, [master, ' Select all changed files']));
    a1Children.push(workingList.node);
  }
  if (conflicted.length) a1Children.push(conflictGroup(conflicted, handlers));
  const a1Body = a1Children.length ? h('div', {}, a1Children) : emptyNode('No changes on this computer.');

  const a1Actions = [];
  if (working.length) {
    a1Actions.push(moveBtn);
    a1Actions.push(actionButton('✅', 'Move all to Ready to save', () => handlers.onStageAll()));
  }
  const area1 = buildArea({
    key: 'computer', icon: '💻', title: 'This computer',
    subtitle: 'Files changed but not selected to save yet.',
    count: working.length + conflicted.length, body: a1Body, actions: a1Actions,
  });
  makeDropZone(area1, ['file:staged'], (p) => handlers.onUnstage([p.path]));

  /* Area 2: Ready to save (selected/staged changes) */
  const stagedList = selectableFileList(staged, 'staged', handlers);
  const backBtn = actionButton('⬅️', 'Move selected back', () => {
    const p = stagedList.getChecked();
    if (p.length) handlers.onUnstage(p);
  });
  backBtn.disabled = true;
  stagedList.onCountChange((n) => { backBtn.disabled = n === 0; });

  const a2Body = staged.length ? h('div', {}, [stagedList.node]) : emptyNode('Nothing selected yet. Pick changes on the left.');
  const a2Actions = [];
  if (staged.length) {
    a2Actions.push(actionButton('💾', 'Save a version', () => handlers.onSaveVersion(), true));
    a2Actions.push(backBtn);
  }
  const a2Handle = staged.length ? dragHandle('staged-set', 'Drag onto “Saved on this computer” to save a version') : null;
  const area2 = buildArea({
    key: 'ready', icon: '🎯', title: 'Ready to save',
    subtitle: 'Changes selected to be saved as a version.',
    count: staged.length, body: a2Body, actions: a2Actions, handle: a2Handle,
  });
  makeDropZone(area2, ['file:working'], (p) => handlers.onStage([p.path]));

  /* Area 3: Saved on this computer (local versions) */
  const a3Actions = [];
  if (details.hasRemote && details.ahead > 0) {
    a3Actions.push(actionButton('⬆️', `Upload ${details.ahead} saved version${details.ahead === 1 ? '' : 's'}`, () => handlers.onUpload(), true));
  }
  const a3Handle = details.hasRemote && details.ahead > 0 ? dragHandle('local-commits', 'Drag onto “Online repository” to upload') : null;
  const area3 = buildArea({
    key: 'saved', icon: '💾', title: 'Saved on this computer',
    subtitle: 'Versions already saved here.',
    count: history.length, dim: history.length === 0, body: renderTimeline(history), actions: a3Actions, handle: a3Handle,
  });
  makeDropZone(area3, ['staged-set'], () => handlers.onSaveVersion());

  /* Area 4: Online repository (remote) */
  const a4Actions = [];
  if (details.hasRemote) {
    if (details.behind > 0) a4Actions.push(actionButton('⬇️', `Download ${details.behind} newer version${details.behind === 1 ? '' : 's'}`, () => handlers.onDownload(), true));
    if (details.ahead > 0) a4Actions.push(actionButton('⬆️', 'Upload saved versions', () => handlers.onUpload()));
    if (details.browserUrl) a4Actions.push(actionButton('🔗', 'Open online repository', () => handlers.onOpenRemote()));
  }
  const area4 = buildArea({
    key: 'online', icon: '☁️', title: 'Online repository',
    subtitle: 'Versions uploaded online.',
    count: null, dim: !details.hasRemote, body: renderOnlineCard(details), actions: a4Actions,
  });
  makeDropZone(area4, ['local-commits'], () => handlers.onUpload());

  return h('div', { className: 'flow' }, [area1, flowArrow(), area2, flowArrow(), area3, flowArrow(), area4]);
}

/* ------------------------------------------------------------------ */
/* Specialised modals                                                  */
/* ------------------------------------------------------------------ */

/**
 * Ask the user for a description, then call onSave(message).
 * @param {(message: string) => void} onSave
 */
export function showSaveVersionModal(onSave) {
  const textarea = h('textarea', {
    className: 'input',
    placeholder: 'For example: Updated the homepage text',
  });

  const close = openModal({
    title: 'Save a version',
    subtitle: 'Describe what this saved version contains, so it is easy to recognise later.',
    body: h('div', { className: 'field' }, [
      h('label', { text: 'Short description' }),
      textarea,
    ]),
    footer: [
      h('button', { className: 'btn', onClick: () => close() }, 'Cancel'),
      h(
        'button',
        {
          className: 'btn btn-primary',
          onClick: () => {
            const msg = textarea.value.trim();
            if (!msg) {
              textarea.focus();
              return;
            }
            close();
            onSave(msg);
          },
        },
        'Save version'
      ),
    ],
  });

  setTimeout(() => textarea.focus(), 50);
}

/**
 * Generic confirm dialog.
 * @param {{title: string, message: string, confirmLabel?: string, danger?: boolean}} opts
 * @param {() => void} onConfirm
 */
export function showConfirm({ title, message, confirmLabel = 'Continue', danger = false }, onConfirm) {
  const close = openModal({
    title,
    body: h('p', { text: message, className: 'muted' }),
    footer: [
      h('button', { className: 'btn', onClick: () => close() }, 'Cancel'),
      h(
        'button',
        {
          className: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'),
          onClick: () => {
            close();
            onConfirm();
          },
        },
        confirmLabel
      ),
    ],
  });
}

/**
 * The full "Auto-find Git repositories" experience: a single modal with three
 * steps — choose how to scan, watch live progress (cancellable), then review
 * and add. Stays free of IPC: app.js supplies the async handlers.
 *
 * @param {object} handlers
 * @param {() => Promise<string|null>} handlers.pickFolder    Native folder picker (custom scan).
 * @param {(preset: string, customPath: string|null, onProgress: Function) => Promise<object>} handlers.startScan
 * @param {() => Promise<any>} handlers.cancelScan            Ask the running scan to stop.
 * @param {(paths: string[]) => Promise<{added: any[], skipped: number}>} handlers.addRepos
 * @returns {() => void} close function
 */
export function showAutoScanModal(handlers) {
  const root = document.getElementById('modal-root');

  let scanning = false; // true while a scan is in flight (so close() can cancel it)
  let closed = false; // true once the modal has been dismissed

  const header = h('div', { className: 'modal-header' });
  const body = h('div', { className: 'modal-body' });
  const footer = h('div', { className: 'modal-footer' });
  const overlay = h('div', { className: 'modal-overlay' }, [
    h('div', { className: 'modal' }, [header, body, footer]),
  ]);

  const close = () => {
    if (closed) return;
    closed = true;
    if (scanning) handlers.cancelScan(); // don't leave an orphan scan running
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (handlers.onClose) handlers.onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  function setHeader(title, subtitle) {
    header.textContent = '';
    header.appendChild(h('h2', { text: title }));
    if (subtitle) header.appendChild(h('p', { text: subtitle }));
  }
  function setBody(node) {
    body.textContent = '';
    body.appendChild(node);
  }
  function setFooter(nodes) {
    footer.textContent = '';
    nodes.forEach((n) => n && footer.appendChild(n));
  }

  /* ---- Step 1: choose how to scan ---- */
  function renderChoose() {
    setHeader('Auto-find Git repositories', 'EasyGit can look for Git projects in the usual places on this computer.');

    const option = (icon, title, desc, onClick) =>
      h('button', { className: 'scan-preset', onClick }, [
        h('span', { className: 'scan-preset-icon', text: icon }),
        h('span', { className: 'scan-preset-text' }, [
          h('span', { className: 'scan-preset-title', text: title }),
          h('span', { className: 'scan-preset-desc', text: desc }),
        ]),
      ]);

    setBody(
      h('div', { className: 'scan-presets' }, [
        option('⚡', 'Quick scan', 'Looks in your usual project and code folders. Fastest.', () => beginScan('quick', null)),
        option('🔎', 'Deeper scan', 'Also looks across Desktop, Documents and Downloads. Slower, finds more.', () => beginScan('deeper', null)),
        option('📁', 'Choose a folder…', 'Pick one folder and search the folders inside it.', chooseCustom),
      ])
    );
    setFooter([h('button', { className: 'btn', onClick: close }, 'Cancel')]);
  }

  async function chooseCustom() {
    const folder = await handlers.pickFolder();
    if (!folder) return; // OS picker cancelled – stay on the choose step
    beginScan('custom', folder);
  }

  /* ---- Step 2: scanning (live progress) ---- */
  let scannedEl, foundEl, currentEl, cancelBtn;

  function renderScanning(preset) {
    setHeader('Searching for Git projects…', presetLabel(preset));
    scannedEl = h('strong', { text: '0' });
    foundEl = h('strong', { text: '0' });
    currentEl = h('div', { className: 'scan-current', text: 'Starting…' });

    setBody(
      h('div', {}, [
        h('div', { className: 'progress-track' }, [h('div', { className: 'progress-bar indeterminate' })]),
        h('div', { className: 'scan-stats' }, [
          h('div', {}, ['Folders looked in: ', scannedEl]),
          h('div', {}, ['Git projects found so far: ', foundEl]),
        ]),
        currentEl,
      ])
    );

    cancelBtn = h('button', { className: 'btn btn-danger', onClick: requestCancel }, 'Stop scan');
    setFooter([cancelBtn]);
  }

  function requestCancel() {
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Stopping…';
    }
    handlers.cancelScan();
  }

  function updateProgress(p) {
    if (closed || !scannedEl) return;
    scannedEl.textContent = String(p.scannedFolders || 0);
    foundEl.textContent = String(p.found || 0);
    if (p.done) currentEl.textContent = 'Finishing up…';
    else if (p.currentPath) currentEl.textContent = p.currentPath;
  }

  async function beginScan(preset, customPath) {
    renderScanning(preset);
    scanning = true;
    let result;
    try {
      result = await handlers.startScan(preset, customPath || null, updateProgress);
    } catch (e) {
      result = { found: [], scannedFolders: 0, cancelled: false, summary: { total: 0, new: 0, already: 0 } };
    }
    scanning = false;
    if (closed) return; // user dismissed the modal mid-scan; nothing to render
    renderResults(result);
  }

  /* ---- Step 3: review and add ---- */
  function renderResults(result) {
    const {
      found = [],
      summary = { total: 0, new: 0, already: 0 },
      cancelled,
      scannedFolders = 0,
      limitReached,
      errorCount,
    } = result;

    if (found.length === 0) {
      setHeader('No Git projects found', '');
      const msg = cancelled
        ? `The scan was stopped early after looking in ${scannedFolders} folder${scannedFolders === 1 ? '' : 's'}. No Git projects were found yet.`
        : `EasyGit looked in ${scannedFolders} folder${scannedFolders === 1 ? '' : 's'} but did not find any Git projects. You could try a deeper scan or choose a specific folder.`;
      setBody(h('p', { className: 'muted', text: msg }));
      setFooter([
        h('button', { className: 'btn', onClick: close }, 'Close'),
        h('button', { className: 'btn btn-primary', onClick: renderChoose }, 'Scan again'),
      ]);
      return;
    }

    setHeader('Git projects found', summaryLine(summary, cancelled));

    const checkboxes = new Map();
    const items = found.map((f) => {
      const cb = h('input', { type: 'checkbox', checked: !f.alreadyAdded, disabled: f.alreadyAdded });
      checkboxes.set(f.path, cb);
      return h('li', { className: 'scan-item' + (f.alreadyAdded ? ' disabled' : '') }, [
        cb,
        h('div', {}, [
          h('div', { className: 'scan-name', text: f.name }),
          h('div', { className: 'scan-path', text: f.path }),
        ]),
        h('span', {
          className: 'scan-tag ' + (f.alreadyAdded ? 'tag-added' : 'tag-new'),
          text: f.alreadyAdded ? '✓ Already added' : 'New',
        }),
      ]);
    });

    const newItems = found.filter((f) => !f.alreadyAdded);
    const toggleAll = (state) => {
      for (const [, cb] of checkboxes) if (!cb.disabled) cb.checked = state;
    };

    setBody(
      h('div', {}, [
        newItems.length
          ? h('div', { className: 'scan-tools' }, [
              h('button', { className: 'btn btn-sm', onClick: () => toggleAll(true) }, 'Select all new'),
              h('button', { className: 'btn btn-sm', onClick: () => toggleAll(false) }, 'Clear selection'),
            ])
          : null,
        h('ul', { className: 'scan-list' }, items),
        limitReached || errorCount
          ? h('p', { className: 'muted scan-note', text: noteText(limitReached, errorCount) })
          : null,
      ])
    );

    const addBtn = h(
      'button',
      {
        className: 'btn btn-primary',
        disabled: newItems.length === 0,
        onClick: async () => {
          const chosen = [];
          for (const [pth, cb] of checkboxes) if (cb.checked && !cb.disabled) chosen.push(pth);
          if (chosen.length === 0) {
            close();
            return;
          }
          addBtn.disabled = true;
          addBtn.textContent = 'Adding…';
          await handlers.addRepos(chosen);
          close();
        },
      },
      newItems.length === 0 ? 'All already added' : 'Add selected repositories'
    );

    setFooter([h('button', { className: 'btn', onClick: close }, 'Cancel'), addBtn]);
  }

  /* ---- small text helpers ---- */
  function presetLabel(preset) {
    if (preset === 'quick') return 'Looking in your usual project folders…';
    if (preset === 'deeper') return 'Looking across your main user folders…';
    return 'Looking inside the folder you chose…';
  }
  function summaryLine(summary, cancelled) {
    const base = `Found ${summary.total} Git project${summary.total === 1 ? '' : 's'}. ${summary.new} ${
      summary.new === 1 ? 'is' : 'are'
    } new and ${summary.already} ${summary.already === 1 ? 'was' : 'were'} already added.`;
    return cancelled ? 'Scan stopped early. ' + base : base;
  }
  function noteText(limitReached, errorCount) {
    const parts = [];
    if (limitReached) parts.push('The scan reached its size limit, so some folders were not checked.');
    if (errorCount) parts.push(`${errorCount} folder${errorCount === 1 ? '' : 's'} could not be opened and were skipped.`);
    return parts.join(' ');
  }

  root.appendChild(overlay);
  renderChoose();
  return close;
}

/** A minimal info-only modal. */
export function openModalSimple(title, message) {
  const close = openModal({
    title,
    body: h('p', { className: 'muted', text: message }),
    footer: [h('button', { className: 'btn btn-primary', onClick: () => close() }, 'OK')],
  });
}

/**
 * Rename dialog.
 * @param {string} currentName
 * @param {(name: string) => void} onRename
 */
export function showRenameModal(currentName, onRename) {
  const input = h('input', { className: 'input', type: 'text', value: currentName });
  const close = openModal({
    title: 'Rename repository',
    subtitle: 'This only changes the name shown in EasyGit. It does not rename the folder on disk.',
    body: h('div', { className: 'field' }, [h('label', { text: 'Name' }), input]),
    footer: [
      h('button', { className: 'btn', onClick: () => close() }, 'Cancel'),
      h(
        'button',
        {
          className: 'btn btn-primary',
          onClick: () => {
            const name = input.value.trim();
            close();
            if (name) onRename(name);
          },
        },
        'Save name'
      ),
    ],
  });
  setTimeout(() => input.select(), 50);
}
