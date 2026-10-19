/**
 * ui.js (renderer)
 * ----------------
 * All DOM building and rendering. No app logic, no IPC – app.js calls these
 * functions and passes in handlers.
 *
 * We build DOM with a small `h()` helper and set text via textContent (never
 * innerHTML) so repository names/paths from disk can never inject markup.
 */

import {
  formatLastChecked,
  changeTypeInfo,
  splitPath,
  onlineChangeLabel,
  localGroupKey,
  LOCAL_GROUP_TITLES,
  LOCAL_GROUP_ORDER,
} from './labels.js';

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
const MAX_TOASTS = 5;

export function showToast({ type = 'info', title, body = '' }) {
  const container = document.getElementById('toast-container');
  const toast = h('div', { className: `toast ${type}` }, [
    h('button', {
      className: 'toast-close',
      title: 'Dismiss',
      'aria-label': 'Dismiss',
      onClick: () => {
        toast.remove();
        refreshClearAll(container);
      },
    }, '×'),
    h('div', { className: 'toast-title', text: title }),
    body ? h('div', { className: 'toast-body', text: body }) : null,
  ]);
  // Notifications stay until the user closes them (no auto-dismiss). Cap the
  // count so they can't pile up forever – drop the oldest beyond the limit.
  container.appendChild(toast);
  const toasts = container.querySelectorAll('.toast');
  for (let i = 0; i < toasts.length - MAX_TOASTS; i++) toasts[i].remove();
  refreshClearAll(container);
}

/** Show a "Clear all" control only while 2+ notifications are visible. */
function refreshClearAll(container) {
  let clear = container.querySelector('.toast-clear-all');
  const count = container.querySelectorAll('.toast').length;
  if (count >= 2 && !clear) {
    clear = h('button', {
      className: 'toast-clear-all',
      onClick: () => {
        container.querySelectorAll('.toast').forEach((t) => t.remove());
        refreshClearAll(container);
      },
    }, 'Clear all');
    container.insertBefore(clear, container.firstChild);
  } else if (count < 2 && clear) {
    clear.remove();
  }
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
 * @param {object[]} repos  the repos to show (already filtered + sorted)
 * @param {string|null} selectedId
 * @param {(id: string) => void} onSelect
 * @param {Set<string>} checkingIds  repos currently being checked
 * @param {{total?: number, query?: string, onRename?: (id: string) => void}} [opts]
 */
export function renderRepoList(repos, selectedId, onSelect, checkingIds = new Set(), opts = {}) {
  const listEl = document.getElementById('repo-list');
  const emptyEl = document.getElementById('empty-state');
  const countEl = document.getElementById('repo-count');

  const total = opts.total != null ? opts.total : repos.length;
  const filtering = !!(opts.query && opts.query.trim());
  // When filtering, show "shown/total" so it's clear some are hidden.
  countEl.textContent = filtering ? `${repos.length}/${total}` : String(total);
  listEl.textContent = '';

  // No repositories at all → the big empty state.
  if (total === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  // Repositories exist, but the search filtered them all out.
  if (repos.length === 0) {
    listEl.appendChild(
      h('div', { className: 'list-nomatch' }, [
        h('div', { className: 'empty-emoji', text: '🔍' }),
        h('p', { text: 'No projects match your search.' }),
      ])
    );
    return;
  }

  for (const repo of repos) listEl.appendChild(buildRepoCard(repo, selectedId, onSelect, checkingIds, opts));
}

/**
 * One repository card for the left list (shared by the flat and grouped lists).
 * opts.onMoveToGroup adds a "Move to group" button (only when custom groups are on).
 */
export function buildRepoCard(repo, selectedId, onSelect, checkingIds = new Set(), opts = {}) {
  const nameRow = [h('p', { className: 'repo-name', text: repo.name })];
  if (opts.onMoveToGroup) {
    nameRow.push(
      h(
        'button',
        {
          className: 'icon-btn repo-group-btn',
          title: 'Move to a group — only organizes this list, your folder is not moved',
          'aria-label': `Move ${repo.name} to a group`,
          onClick: (e) => {
            e.stopPropagation(); // don't also select the card
            opts.onMoveToGroup(repo.id);
          },
        },
        '📂'
      )
    );
  }
  if (opts.onRename) {
    nameRow.push(
      h(
        'button',
        {
          className: 'icon-btn repo-rename-btn',
          title: 'Rename this project',
          'aria-label': `Rename ${repo.name}`,
          onClick: (e) => {
            e.stopPropagation(); // don't also select the card
            opts.onRename(repo.id);
          },
        },
        '✏️'
      )
    );
  }
  if (opts.onRemove) {
    nameRow.push(
      h(
        'button',
        {
          className: 'icon-btn repo-remove-btn',
          title: 'Remove from EasyGit — your project folder stays on your computer',
          'aria-label': `Remove ${repo.name} from EasyGit (your folder stays on your computer)`,
          onClick: (e) => {
            e.stopPropagation(); // don't also select the card
            opts.onRemove(repo.id);
          },
        },
        '🗑️'
      )
    );
  }

  const card = h(
    'div',
    {
      className: 'repo-card' + (repo.id === selectedId ? ' selected' : ''),
      onClick: () => onSelect(repo.id),
    },
    [
      h('div', { className: 'repo-card-top' }, [
        h('div', { className: 'repo-card-id' }, [
          h('div', { className: 'repo-name-row' }, nameRow),
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
  return card;
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
export function renderDetails(repo, details, handlers, settings) {
  const detailsEmpty = document.getElementById('details-empty');
  const detailsEl = document.getElementById('details');
  const opts = settings || { showAdvanced: false, showBranch: false };

  if (!repo) {
    detailsEmpty.hidden = false;
    detailsEl.hidden = true;
    detailsEl.textContent = '';
    return;
  }

  detailsEmpty.hidden = true;
  detailsEl.hidden = false;
  detailsEl.textContent = '';

  // Header: name + path + status badge + settings gear.
  detailsEl.appendChild(
    h('div', { className: 'details-header' }, [
      h('div', { className: 'details-title' }, [
        h('h2', { text: repo.name }),
        h('p', { className: 'repo-path', text: repo.path }),
      ]),
      h('div', { className: 'details-header-right' }, [
        statusBadge(repo.statusTone, repo.statusLabel),
        h('button', { className: 'icon-btn settings-gear', title: 'Settings', onClick: () => handlers.onSettings() }, '⚙'),
      ]),
    ])
  );

  // A) Status banner – the colored, plain-language explanation. Simple mode uses
  // the plain "computer vs online" wording; advanced shows the detailed version.
  const tone = details ? details.tone || repo.statusTone : repo.statusTone;
  const explanationText = !details
    ? repo.statusShort || 'This repository has not been checked yet. Use “Check changes” to see its current state.'
    : opts.showAdvanced
    ? details.explanation
    : details.simpleExplanation || details.explanation;
  detailsEl.appendChild(h('div', { className: `explanation tone-${tone || 'neutral'}`, text: explanationText }));

  // Not checked yet: still offer the safe management actions (open, rename,
  // remove, open online if known) plus a primary "Check changes". The user
  // should never have to check just to reach these.
  if (!details) {
    detailsEl.appendChild(utilityRow(repo, null, handlers, 'first'));
    return;
  }

  // Repository unavailable (folder moved/deleted or no longer a Git repo):
  // show only the safe utilities, never a misleading empty flow.
  if (details.error || details.status === 'error') {
    detailsEl.appendChild(utilityRow(repo, details, handlers, 'recheck-primary'));
    return;
  }

  // Current version line (branch) card – only when the branch setting is on.
  if (opts.showBranch) {
    detailsEl.appendChild(renderVersionLineCard(details, handlers));
  }

  // B) The project flow. Simple mode by default (two areas); advanced mode shows
  // the detailed four-area save/upload flow.
  detailsEl.appendChild(
    opts.showAdvanced ? renderFlow(repo, details, handlers) : renderSimpleFlow(repo, details, handlers)
  );

  // Utility actions (always available and safe).
  detailsEl.appendChild(utilityRow(repo, details, handlers, 'recheck'));
  if (opts.showAdvanced) detailsEl.appendChild(renderStashArea(handlers));
}

/**
 * The repository-management actions that are always safe and available — even
 * before a status check. "Open online project" appears only when the online
 * address is already known (it is stored when the repo is added, so it works
 * before any check). `mode` selects the leading check button:
 *   'first'           → "Check changes" (primary, local check)
 *   'recheck-primary' → "Check again"   (primary, used on the error screen)
 *   'recheck'         → "Check again"   (secondary, alongside the normal flow)
 */
function utilityRow(repo, details, handlers, mode) {
  // browserUrl is derived from the stored remoteUrl, so it is non-null exactly
  // when onOpenRemote (which acts on remoteUrl) will succeed — safe to gate on.
  const browserUrl = (details && details.browserUrl) || repo.browserUrl;
  const buttons = [];
  if (mode === 'first') {
    buttons.push(actionButton('🔎', 'Check changes', () => handlers.onCheck(false), true));
  } else if (mode === 'recheck-primary') {
    buttons.push(actionButton('🔄', 'Check again', () => handlers.onCheck(true), true));
  } else {
    buttons.push(actionButton('🔄', 'Check again', () => handlers.onCheck(true)));
  }
  buttons.push(actionButton('📂', 'Open project folder', () => handlers.onOpenFolder()));
  if (handlers.onOpenCode) buttons.push(actionButton('↗', 'Open in VS Code', handlers.onOpenCode));
  if (browserUrl) buttons.push(actionButton('🔗', 'Open online project', () => handlers.onOpenRemote()));
  buttons.push(actionButton('✏️', 'Rename', () => handlers.onRename()));
  buttons.push(dangerButton('🗑️', 'Remove from EasyGit', () => handlers.onRemove()));
  return h('div', { className: 'utility-row' }, buttons);
}

/* ------------------------------------------------------------------ */
/* Repository details – helpers for the visual flow                    */
/* ------------------------------------------------------------------ */

function actionButton(icon, label, onClick, primary) {
  const btn = h('button', { className: 'btn btn-sm' + (primary ? ' btn-primary' : '') }, [
    h('span', { className: 'btn-icon', text: icon }),
    ' ' + label,
  ]);
  btn.addEventListener('click', () => runMaybeBusy(btn, onClick));
  return btn;
}

/**
 * Run a button's click handler. If the handler returns a promise (a real,
 * long-running action), show a spinner on that button and disable it until the
 * promise settles — clear per-action feedback. Handlers that just open a dialog
 * return nothing, so the button does not spin.
 */
function runMaybeBusy(btn, onClick) {
  const ret = onClick();
  if (ret && typeof ret.then === 'function' && !btn.classList.contains('btn-busy')) {
    btn.classList.add('btn-busy');
    btn.disabled = true;
    Promise.resolve(ret).finally(() => {
      btn.classList.remove('btn-busy');
      btn.disabled = false;
    });
  }
  return ret;
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
  if (f.type !== 'deleted' && handlers.onTrash) row.appendChild(h('button', {
    className: 'icon-btn', title: 'Move to Recycle Bin', 'aria-label': `Move ${f.path} to Recycle Bin`,
    onClick: e => { e.stopPropagation(); handlers.onTrash(f.path); },
  }, '🗑️'));
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
function renderTimeline(history, handlers) {
  if (!history.length) return emptyNode('No saved versions yet.');
  return h('ul', { className: 'timeline' }, history.map((c, i) =>
    h('li', { className: 'timeline-item' + (i === 0 ? ' newest' : '') }, [
      h('span', { className: 'timeline-dot ' + (c.local ? 'is-local' : 'is-online') }),
      h('div', { className: 'timeline-body' }, [
        h('div', { className: 'tl-subject', text: c.subject }),
        actionButton('🔎', 'View changes', () => showCommit(c, handlers)),
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
    h('div', { className: 'area-scroll', tabindex: '0' }, [body]),
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
    count: history.length, dim: history.length === 0, body: renderTimeline(history, handlers), actions: a3Actions, handle: a3Handle,
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
/* Simple mode – two big areas (On this computer  ⇄  Online project)   */
/* ------------------------------------------------------------------ */

/** Merge staged + working + conflicted into one simple per-file list. */
function mergeLocalChanges(details) {
  const map = new Map();
  (details.working || []).forEach((f) => map.set(f.path, f.type));
  (details.staged || []).forEach((f) => { if (!map.has(f.path)) map.set(f.path, f.type); });
  (details.conflicted || []).forEach((f) => map.set(f.path, 'conflicted'));
  return [...map].map(([path, type]) => ({ path, type }));
}

/** A read-only, draggable file row for simple mode. */
function simpleFileRow(f, dragKind, handlers) {
  const info = changeTypeInfo(f.type);
  const { name, dir } = splitPath(f.path);
  const row = h('li', { className: 'file-row', draggable: 'true' }, [
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
    e.dataTransfer.setData('text/plain', JSON.stringify({ kind: dragKind }));
    e.dataTransfer.setData(markerType(dragKind), '');
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  return row;
}

/** Local changes grouped by friendly type (New / Edited / Deleted / …). */
function simpleLocalList(localFiles, handlers) {
  const groups = {};
  for (const f of localFiles) {
    const key = localGroupKey(f.type);
    (groups[key] = groups[key] || []).push(f);
  }
  const sections = [];
  for (const key of LOCAL_GROUP_ORDER) {
    const items = groups[key];
    if (!items || !items.length) continue;
    sections.push(
      h('div', { className: 'simple-group' + (key === 'attention' ? ' attention' : '') }, [
        h('div', { className: 'group-title', text: LOCAL_GROUP_TITLES[key] }),
        h('ul', { className: 'file-list' }, items.map((f) => simpleFileRow(f, 'local-file', handlers))),
      ])
    );
  }
  return sections;
}

/** The simple "Online project" status body. */
function simpleOnlineBody(details) {
  if (!details.hasRemote) {
    return emptyNode('This project is not connected to an online project yet.');
  }
  const rows = [];
  const row = (k, v, cls) => h('div', { className: 'online-row' }, [
    h('span', { className: 'online-key', text: k }),
    h('span', { className: 'online-val ' + (cls || ''), text: v }),
  ]);
  rows.push(row('Connected to', details.provider || 'an online project', 'val-good'));
  if (details.browserUrl || details.remoteUrl) rows.push(row('Address', details.browserUrl || details.remoteUrl));
  rows.push(row('Last checked', formatLastChecked(details.lastChecked)));

  const children = [h('div', { className: 'online-card' }, rows)];

  if (details.behind > 0) {
    children.push(
      h('div', { className: 'online-newer' }, [
        h('strong', { text: `${details.behind} newer change${details.behind === 1 ? '' : 's'} available online.` }),
      ])
    );
    const files = details.onlineFiles || [];
    if (files.length) {
      children.push(
        h('ul', { className: 'file-list online-files' }, files.slice(0, 50).map((f) => {
          const info = changeTypeInfo(f.type);
          const { name, dir } = splitPath(f.path);
          return h('li', { className: 'file-row online-file' }, [
            h('span', { className: `ct-badge ${info.cls}`, title: onlineChangeLabel(f.type), text: info.icon }),
            h('div', { className: 'file-meta' }, [
              h('div', { className: 'file-name', text: name }),
              dir ? h('div', { className: 'file-dir', text: dir }) : null,
            ]),
            h('span', { className: 'file-type', text: onlineChangeLabel(f.type) }),
          ]);
        }))
      );
    }
  } else {
    children.push(h('div', { className: 'online-uptodate', text: 'You have the latest version.' }));
  }

  if (details.fetchError) {
    children.push(h('div', { className: 'online-warn' }, [h('strong', { text: details.fetchError.title + '. ' }), details.fetchError.detail]));
  }
  return h('div', {}, children);
}

/** The two-area simple flow with drag-and-drop (local ⇄ online). */
function renderSimpleFlow(repo, details, handlers) {
  const localFiles = mergeLocalChanges(details);
  const hasConflicts = (details.conflicted || []).length > 0;

  /* On this computer */
  const localBody = [];
  if (localFiles.length) localBody.push(...simpleLocalList(localFiles, handlers));
  // Always surface saved-but-not-uploaded versions, even alongside file changes.
  if (details.ahead > 0) {
    localBody.push(h('div', { className: 'area-note', text: `${details.ahead} change${details.ahead === 1 ? '' : 's'} saved here, waiting to upload.` }));
  }
  if (!localFiles.length && !(details.ahead > 0)) localBody.push(emptyNode('No changes on this computer.'));

  const uploadBtn = actionButton('⬆️', 'Upload my changes', () => handlers.onUploadChanges(), true);
  const localArea = buildArea({
    key: 'computer',
    icon: '💻',
    title: 'On this computer',
    subtitle: 'Your project folder and your changes.',
    // Badge counts the changed files (matches the list); waiting versions are
    // shown as a note in the body.
    count: localFiles.length > 0 ? localFiles.length : null,
    dim: localFiles.length === 0 && !(details.ahead > 0),
    body: h('div', {}, localBody),
    actions: [uploadBtn],
    handle: hasConflicts ? null : dragHandle('local-area', 'Drag onto “Online project” to upload your changes'),
  });
  // Dropping the online area here means: download the latest version.
  makeDropZone(localArea, ['online-area'], () => handlers.onDownload());

  /* Online project */
  const onlineActions = [];
  if (details.hasRemote) {
    onlineActions.push(actionButton('🌐', 'Check online project', () => handlers.onCheck(true)));
    if (details.behind > 0) {
      onlineActions.push(actionButton('⬇️', 'Download latest version', () => handlers.onDownload(), true));
    }
  }
  const onlineArea = buildArea({
    key: 'online',
    icon: '☁️',
    title: 'Online project',
    subtitle: 'The shared online version of the project.',
    // Badge only when there is something to download (avoids a bare "0").
    count: details.hasRemote && details.behind > 0 ? details.behind : null,
    countTone: details.behind > 0 ? 'tone-download' : '',
    dim: !details.hasRemote,
    body: simpleOnlineBody(details),
    actions: onlineActions,
    handle: details.hasRemote ? dragHandle('online-area', 'Drag onto “On this computer” to download the latest version') : null,
  });
  // Dropping local files / the local area here means: upload my changes.
  makeDropZone(onlineArea, ['local-area', 'local-file'], () => handlers.onUploadChanges());

  return h('div', { className: 'flow flow-simple' }, [localArea, h('div', { className: 'flow-arrow flow-arrow-2way', text: '⇄' }), onlineArea]);
}

/* ------------------------------------------------------------------ */
/* Specialised modals                                                  */
/* ------------------------------------------------------------------ */

/**
 * A description field with an optional "✨ Suggest" assistant button.
 * @param {string} labelText
 * @param {(() => Promise<{ok:boolean, message?:string, error?:string}>)|null} onSuggest
 * @returns {{ wrapper: HTMLElement, textarea: HTMLElement }}
 */
function buildDescribeField(labelText, onSuggest) {
  const textarea = h('textarea', {
    className: 'input',
    placeholder: 'For example: Updated the homepage text',
  });
  const status = h('div', { className: 'suggest-status', hidden: true });

  const headerChildren = [h('label', { text: labelText })];
  if (onSuggest) {
    const suggestBtn = h(
      'button',
      {
        className: 'btn btn-sm suggest-btn',
        type: 'button',
        title: 'Suggest a description',
        onClick: async () => {
          // Inline loading near the button only – never blocks the app.
          suggestBtn.disabled = true;
          status.hidden = false;
          status.className = 'suggest-status loading';
          status.textContent = '';
          status.appendChild(h('span', { className: 'spinner-sm' }));
          status.appendChild(h('span', { text: ' Looking at your changes…' }));

          let res;
          try {
            res = await onSuggest();
          } catch (e) {
            res = { ok: false, error: 'read' };
          }
          suggestBtn.disabled = false;

          if (res && res.ok && res.message) {
            const apply = () => {
              textarea.value = res.message;
              status.hidden = true;
              setTimeout(() => textarea.focus(), 0);
            };
            if (!textarea.value.trim()) {
              apply(); // empty box -> just fill it
            } else {
              status.hidden = true;
              showConfirm(
                {
                  title: 'Replace description?',
                  message: `Replace your current description with the suggestion: “${res.message}”?`,
                  confirmLabel: 'Replace',
                },
                apply
              );
            }
          } else {
            status.className = 'suggest-status note';
            status.textContent =
              res && res.error === 'none'
                ? 'No changes found to describe.'
                : 'EasyGit could not inspect your changes. You can still write the description yourself.';
          }
        },
      },
      [h('span', { className: 'btn-icon', text: '✨' }), ' Suggest']
    );
    headerChildren.push(suggestBtn);
  }

  const wrapper = h('div', { className: 'field' }, [
    h('div', { className: 'field-row' }, headerChildren),
    textarea,
    status,
  ]);
  return { wrapper, textarea };
}

/**
 * Ask the user for a description, then call onSave(message).
 * @param {((message: string) => void) | {onSave: Function, onSuggest?: Function}} handlers
 */
export function showSaveVersionModal(handlers) {
  const onSave = typeof handlers === 'function' ? handlers : handlers.onSave;
  const onSuggest = typeof handlers === 'function' ? null : handlers.onSuggest;
  const { wrapper, textarea } = buildDescribeField('Short description', onSuggest);

  const close = openModal({
    title: 'Save a version',
    subtitle: 'Describe what this saved version contains, so it is easy to recognise later.',
    body: wrapper,
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
 * Simple-mode "Upload my changes": ask for a description, then call onUpload.
 * @param {((message: string) => void) | {onSubmit: Function, onSuggest?: Function}} handlers
 */
export function showUploadMessageModal(handlers) {
  const onUpload = typeof handlers === 'function' ? handlers : handlers.onSubmit;
  const onSuggest = typeof handlers === 'function' ? null : handlers.onSuggest;
  const { wrapper, textarea } = buildDescribeField('Describe what you changed', onSuggest);

  const close = openModal({
    title: 'Upload my changes',
    subtitle: 'EasyGit will save these changes on your computer and upload them online.',
    body: wrapper,
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
            onUpload(msg);
          },
        },
        'Save and upload'
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
        h('div', { className: 'scan-divider', text: 'or' }),
        option('🔗', 'Add repository from link or SSH', 'Paste an online project link and download it to this computer.', renderClone),
      ])
    );
    setFooter([h('button', { className: 'btn', onClick: close }, 'Cancel')]);
  }

  /* ---- Add from an online link (git clone) ---- */
  function renderClone() {
    setHeader('Add repository from link or SSH', 'Paste an online project link and choose where to save it.');

    let parentDir = '';
    let nameEdited = false; // did the user hand-edit the folder name?
    let lastSuggestFor = ''; // guards against out-of-order suggestion responses

    const linkInput = h('input', { className: 'input', type: 'text', placeholder: 'https://…, git@… or ssh://…', autocomplete: 'off', spellcheck: 'false' });
    const parentInput = h('input', { className: 'input', type: 'text', readonly: 'readonly', placeholder: 'Choose a folder…' });
    const nameInput = h('input', { className: 'input', type: 'text', placeholder: 'new-project', autocomplete: 'off', spellcheck: 'false' });
    const statusEl = h('div', { className: 'clone-status', hidden: true });

    const chooseBtn = h('button', {
      className: 'btn',
      onClick: async () => {
        const dir = await handlers.pickParentFolder();
        if (dir) { parentDir = dir; parentInput.value = dir; updateEnabled(); }
      },
    }, 'Choose folder');

    function updateEnabled() {
      downloadBtn.disabled = !(linkInput.value.trim() && parentDir);
    }

    // Suggest a folder name from the link, unless the user typed their own.
    linkInput.addEventListener('input', async () => {
      updateEnabled();
      if (nameEdited) return;
      const url = linkInput.value.trim();
      lastSuggestFor = url;
      if (!url) { nameInput.value = ''; return; }
      try {
        const suggested = await handlers.suggestFolderName(url);
        if (!nameEdited && lastSuggestFor === url) nameInput.value = suggested || '';
      } catch (e) { /* ignore */ }
    });
    nameInput.addEventListener('input', () => { nameEdited = true; });

    function showStatus(kind, title, detail) {
      statusEl.hidden = false;
      statusEl.className = 'clone-status ' + (kind === 'error' ? 'is-error' : 'is-busy');
      statusEl.textContent = '';
      statusEl.appendChild(h('strong', { text: title }));
      if (detail) statusEl.appendChild(h('div', { className: 'clone-status-detail', text: detail }));
    }

    const downloadBtn = h('button', { className: 'btn btn-primary' }, '⬇️ Download project');
    downloadBtn.disabled = true;
    downloadBtn.addEventListener('click', async () => {
      const url = linkInput.value.trim();
      if (!url || !parentDir) return;
      downloadBtn.disabled = true;
      chooseBtn.disabled = true;
      downloadBtn.textContent = 'Downloading…';
      showStatus('busy', 'Downloading the project…', 'This can take a moment for larger projects.');
      let res;
      try {
        res = await handlers.cloneRepo({ url, parentDir, folderName: nameInput.value.trim() });
      } catch (e) {
        res = { ok: false, error: { title: 'Something went wrong', detail: 'The download could not be completed. Please try again.' } };
      }
      if (closed) return;
      if (res && res.ok) {
        if (handlers.onCloned) handlers.onCloned(res.repo);
        close();
        return;
      }
      chooseBtn.disabled = false;
      downloadBtn.textContent = '⬇️ Download project';
      updateEnabled();
      const err = (res && res.error) || { title: 'Could not download', detail: 'Please check the link and try again.' };
      showStatus('error', err.title, err.detail);
    });

    const field = (labelText, control) =>
      h('div', { className: 'clone-field' }, [h('label', { className: 'clone-label', text: labelText }), control]);

    setBody(
      h('div', { className: 'clone-form' }, [
        field('Online project link', linkInput),
        field('Save inside', h('div', { className: 'clone-row' }, [parentInput, chooseBtn])),
        field('Folder name', nameInput),
        h('p', {
          className: 'clone-note',
          text: 'EasyGit will download the online project into the selected folder. Your existing Git/SSH/HTTPS sign-in will be used by Git — EasyGit never asks for or stores passwords.',
        }),
        statusEl,
      ])
    );
    setFooter([
      h('button', { className: 'btn', onClick: renderChoose }, 'Back'),
      downloadBtn,
    ]);
    setTimeout(() => linkInput.focus(), 50);
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

/* ------------------------------------------------------------------ */
/* Contextual busy indicators (no global blocking overlay)             */
/* ------------------------------------------------------------------ */

/** Disable the selected repository's action buttons while an op runs. */
export function setRepoBusy(on) {
  const d = document.getElementById('details');
  if (d) d.classList.toggle('busy', !!on);
}

/** Show a small inline "working…" status at the top of the details panel. */
export function showRepoBusy(message) {
  const el = document.getElementById('repo-busy');
  if (!el) return;
  const t = el.querySelector('.repo-busy-text');
  if (t) t.textContent = message || 'Working…';
  el.hidden = false;
}

/** Hide the details-panel inline busy status. */
export function hideRepoBusy() {
  const el = document.getElementById('repo-busy');
  if (el) el.hidden = true;
}

/** Show a small inline busy status in the top header (for non-repo actions). */
export function showHeaderBusy(message) {
  const el = document.getElementById('header-busy');
  if (!el) return;
  const t = el.querySelector('.header-busy-text');
  if (t) t.textContent = message || 'Working…';
  el.hidden = false;
}

/** Hide the header inline busy status. */
export function hideHeaderBusy() {
  const el = document.getElementById('header-busy');
  if (el) el.hidden = true;
}

/**
 * Settings dialog: simple/advanced mode + branch details. Calls onChange with
 * the updated settings whenever a toggle changes (so it applies live).
 * @param {{showAdvanced:boolean, showBranch:boolean}} settings
 * @param {(settings: object) => void} onChange
 */
export function showSettingsModal(settings, onChange) {
  const current = { ...settings };
  const rows = {}; // key -> { row, cb }, used to show/enable the nested options

  const toggle = (key, title, desc) => {
    const cb = h('input', { type: 'checkbox', className: 'file-check' });
    if (current[key]) cb.checked = true;
    cb.addEventListener('change', () => {
      current[key] = cb.checked;
      syncOrganization();
      onChange({ ...current });
    });
    const row = h('label', { className: 'setting-row' }, [
      cb,
      h('div', {}, [
        h('div', { className: 'setting-title', text: title }),
        h('div', { className: 'setting-desc', text: desc }),
      ]),
    ]);
    rows[key] = { row, cb };
    return row;
  };

  // Repository organization: one master switch; its options only appear when
  // it is on, so the default Settings (and list) stay exactly as simple as before.
  const orgOptions = h('div', { className: 'settings-nested' }, [
    toggle('orgManualOrder', 'Arrange projects in your own order', 'Drag projects up and down the list. Choose “Custom order” in Sort to see your arrangement.'),
    toggle('orgGroups', 'Show projects in groups', 'Collapsible groups in the list, such as one per client. Groups exist only inside EasyGit — no folders are created or moved.'),
    h('div', { className: 'settings-nested settings-nested-deep' }, [
      toggle('orgCustomGroups', 'Create and edit your own groups', 'Add, rename, delete and reorder groups, and move projects between them.'),
      toggle('orgSuggestGroups', 'Suggest groups from project folders', 'When several projects sit in the same folder (for example C:\\Git\\CLIENT\\…), offer a group for them. You review each suggestion first.'),
    ]),
  ]);
  function syncOrganization() {
    if (!rows.organizeRepos) return; // still building
    orgOptions.hidden = !current.organizeRepos;
    // Editing and suggestions only make sense while groups are shown.
    for (const key of ['orgCustomGroups', 'orgSuggestGroups']) {
      const off = !current.orgGroups;
      rows[key].cb.disabled = off;
      rows[key].row.classList.toggle('setting-disabled', off);
      rows[key].row.title = off ? 'Turn on “Show projects in groups” first' : '';
    }
  }

  // A labelled dropdown setting (text on the left, choices on the right).
  const choice = (key, title, desc, options, fallback) => {
    const sel = h('select', { className: 'setting-select' });
    const value = current[key] || fallback;
    options.forEach(([val, label]) => {
      const o = h('option', { value: val, text: label });
      if (val === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      current[key] = sel.value;
      onChange({ ...current });
    });
    return h('label', { className: 'setting-row setting-row-choice' }, [
      h('div', { className: 'setting-grow' }, [
        h('div', { className: 'setting-title', text: title }),
        h('div', { className: 'setting-desc', text: desc }),
      ]),
      sel,
    ]);
  };

  const close = openModal({
    title: 'Settings',
    subtitle: 'These preferences are remembered between launches.',
    body: h('div', { className: 'settings-list' }, [
      toggle('showAdvanced', 'Show detailed save/upload steps', 'Adds the advanced flow: changed files, ready to save, saved versions, and online repository.'),
      toggle('showBranch', 'Show version line details', 'Shows which version line (branch) you are on and lets you switch between them.'),
      toggle('showVSCode', 'Show “Open in VS Code” button', 'Open this project in your installed Visual Studio Code editor.'),
      h('div', { className: 'settings-section', text: 'Your repository list' }),
      toggle('organizeRepos', 'Organize your repository list', 'Optional: your own order and groups for the list on the left. Only changes how EasyGit shows the list — your folders on disk are never moved or renamed.'),
      orgOptions,
      h('div', { className: 'settings-section', text: 'Appearance' }),
      choice('theme', 'Theme', 'Switch between the dark and light look.', [
        ['dark', 'Dark'],
        ['light', 'Light'],
      ], 'dark'),
      choice('fontSize', 'Text size', 'Make everything in EasyGit larger and easier to read.', [
        ['normal', 'Normal'],
        ['large', 'Large'],
        ['larger', 'Larger'],
      ], 'normal'),
    ]),
    footer: [h('button', { className: 'btn btn-primary', onClick: () => close() }, 'Done')],
  });
  syncOrganization();
}

/**
 * Rename dialog.
 * @param {string} currentName
 * @param {(name: string) => void} onRename
 */
export function confirmTrash(file, onConfirm) {
  showConfirm({ title: `Move “${file}” to the Recycle Bin?`, message: 'This changes the actual file on your computer, not just EasyGit.', confirmLabel: 'Continue', danger: true }, () => {
    showConfirm({ title: 'Are you sure?', message: `“${file}” will be removed from this project and moved to the Recycle Bin.`, confirmLabel: 'Yes, move it', danger: true }, onConfirm);
  });
}

// Stack and history requests start only after an explicit expansion. Every
// callback retains its repository's handlers, even if selection changes.
function renderStashArea(handlers) {
  const body = h('div', {}, [emptyNode('Keep unfinished work here temporarily. Newest entries appear first.')]);
  const load = async () => {
    const result = await handlers.onStashList();
    body.replaceChildren();
    if (!result.ok) { body.appendChild(emptyNode(result.error.detail)); return; }
    body.appendChild(h('p', { text: `${result.entries.length} entries · newest first` }));
    if (!result.entries.length) body.appendChild(emptyNode('No work set aside.'));
    for (const entry of result.entries) {
      const files = h('div');
      const expand = actionButton('▸', 'Show files', async () => {
        if (files.childNodes.length) { files.replaceChildren(); return; }
        const result = await handlers.onStashFiles(entry.oid);
        files.appendChild(result.ok ? changedFileList(result.files) : emptyNode(result.error.detail));
      });
      body.appendChild(h('section', { className: 'stash-entry' }, [
        h('strong', { text: entry.subject }), h('p', { className: 'tl-meta', text: new Date(entry.when).toLocaleString() }), expand,
        actionButton('↩', 'Restore changes', () => showConfirm({ title: 'Restore this work?', message: 'Your current changes must be saved or set aside first. After a successful restore, this entry leaves the stack.', confirmLabel: 'Restore changes' }, async () => { await handlers.onStashChange('pop', entry.oid); })), files,
      ]));
    }
  };
  return buildArea({ key: 'stash', icon: '📚', title: 'Set aside for later', subtitle: 'Git stash · temporary work, not a backup', count: null, body, actions: [
    actionButton('▤', 'Show / refresh stack', load),
    actionButton('+', 'Set changes aside', () => {
      const input = h('input', { className: 'input', maxlength: '500', placeholder: 'Optional description', 'aria-label': 'Description of work set aside' });
      const close = openModal({ title: 'Set changes aside', subtitle: 'All changed files, including Ready to save and new files, will be set aside. Ignored files stay here. This uses Git stash.', body: input, footer: [
        h('button', { className: 'btn', onClick: () => close() }, 'Cancel'),
        actionButton('📚', 'Set changes aside', async () => { const description = input.value; close(); await handlers.onStashChange('push', description); }, true),
      ] });
    }),
  ] });
}

function changedFileList(files, select) {
  return h('div', {}, [h('p', { text: `${files.length} file${files.length === 1 ? '' : 's'} changed` }), h('ul', { className: 'inspection-files' }, files.map(file => {
    const label = `${changeTypeInfo(file.type).label} · ${file.orig ? file.orig + ' → ' : ''}${file.path}`;
    return h('li', {}, [select ? actionButton('', label, () => select(file)) : h('span', { text: label })]);
  }))]);
}

async function showCommit(commit, handlers) {
  const body = h('div', { className: 'inspection-body' }, [emptyNode('Loading changed files…')]);
  const close = openModal({ title: commit.subject, subtitle: 'Saved version · read-only changes', body, footer: [h('button', { className: 'btn', onClick: () => close() }, 'Close')] });
  const result = await handlers.onCommitFiles(commit.full);
  if (!body.isConnected) return;
  body.replaceChildren();
  if (!result.ok) { body.appendChild(emptyNode(result.error.detail)); return; }
  const diff = h('div', { className: 'diff-panel' });
  let request = 0;
  const select = async (file, limit = 600) => {
    const current = ++request;
    diff.replaceChildren(emptyNode('Loading changes…'));
    const result = await handlers.onCommitDiff(commit.full, file.path, limit);
    if (!body.isConnected || request !== current) return;
    diff.replaceChildren(h('h3', { text: file.path }));
    if (!result.ok) { diff.appendChild(emptyNode(result.error.detail)); return; }
    if (result.binary) { diff.appendChild(emptyNode('This file changed, but it cannot be displayed as text.')); return; }
    diff.appendChild(renderDiff(result.text));
    if (!result.text.trim()) diff.appendChild(emptyNode('No text changes to display (for example, a rename or permission change).'));
    if (result.truncated) {
      diff.appendChild(emptyNode(`Showing the first ${result.limit} lines.`));
      if (result.limit < 10000) diff.appendChild(actionButton('+', 'Load more', () => select(file, result.limit + 1000)));
      else diff.appendChild(emptyNode('Display limit reached. Inspect the rest in your editor.'));
    }
  };
  body.append(changedFileList(result.files, select), diff);
}

function renderDiff(text) {
  let oldLine = 0, newLine = 0;
  const rows = [];
  for (const line of text.split('\n')) {
    const range = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (range) { oldLine = Number(range[1]); newLine = Number(range[2]); rows.push(h('div', { className: 'diff-context', text: 'Changed section' })); continue; }
    if (!oldLine && !newLine) continue; // Do not make raw Git headers the UI.
    let oldNumber = '', newNumber = '', tone = '';
    if (line.startsWith('+')) { tone = 'diff-add'; newNumber = newLine++; }
    else if (line.startsWith('-')) { tone = 'diff-remove'; oldNumber = oldLine++; }
    else if (line.startsWith(' ')) { oldNumber = oldLine++; newNumber = newLine++; }
    else continue;
    rows.push(h('div', { className: `diff-line ${tone}` }, [h('span', { className: 'diff-number', text: String(oldNumber) }), h('span', { className: 'diff-number', text: String(newNumber) }), h('code', { text: line })]));
  }
  return h('div', { className: 'diff-scroll', tabindex: '0', 'aria-label': 'Read-only changes: old and new line numbers' }, rows);
}

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
