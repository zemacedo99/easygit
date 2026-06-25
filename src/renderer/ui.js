/**
 * ui.js (renderer)
 * ----------------
 * All DOM building and rendering. No app logic, no IPC – app.js calls these
 * functions and passes in handlers.
 *
 * We build DOM with a small `h()` helper and set text via textContent (never
 * innerHTML) so repository names/paths from disk can never inject markup.
 */

import { formatLastChecked, REPO_ACTIONS } from './labels.js';

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
 * @param {object} handlers  { onAction(key), onRemove(), onRename() }
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

  // Header: name + path + status badge, with rename/remove.
  const header = h('div', { className: 'details-header' }, [
    h('div', { className: 'details-title' }, [
      h('h2', { text: repo.name }),
      h('p', { className: 'repo-path', text: repo.path }),
    ]),
    statusBadge(repo.statusTone, repo.statusLabel),
  ]);
  detailsEl.appendChild(header);

  // Friendly explanation (from the status check, or a gentle prompt if none yet).
  const explanationText = details
    ? details.explanation
    : (repo.statusShort || 'This repository has not been checked yet. Use “Check changes” to see its current state.');
  const tone = details ? details.tone || repo.statusTone : repo.statusTone;
  detailsEl.appendChild(
    h('div', { className: `explanation tone-${tone || 'neutral'}`, text: explanationText })
  );

  // If the last fetch failed, surface it gently.
  if (details && details.fetchError) {
    detailsEl.appendChild(
      h('div', { className: 'explanation tone-changes' }, [
        h('strong', { text: details.fetchError.title + '. ' }),
        details.fetchError.detail,
      ])
    );
  }

  // Info boxes: version line, local + online summaries, online repository.
  const infoGrid = h('div', { className: 'info-grid' }, [
    infoBox('Current version line', (details && details.branch) || repo.branch || '—'),
    infoBox('Local changes', details ? details.localSummary : 'Not checked yet'),
    infoBox('Online comparison', details ? details.onlineSummary : 'Not checked yet'),
    infoBox(
      'Online repository',
      repo.provider ? `${repo.provider}` : repo.remoteUrl ? 'Connected' : 'Not connected'
    ),
  ]);
  detailsEl.appendChild(infoGrid);

  // Changed files list
  if (details && details.files && details.files.length > 0) {
    const fileItems = details.files
      .slice(0, 50)
      .map((f) =>
        h('li', {}, [
          h('span', { className: 'file-path', text: f.path }),
          h('span', { className: 'file-kind', text: f.kind }),
        ])
      );
    detailsEl.appendChild(
      section('What changed on this computer', h('ul', { className: 'list' }, fileItems))
    );
    if (details.files.length > 50) {
      detailsEl.appendChild(h('p', { className: 'muted', text: `…and ${details.files.length - 50} more.` }));
    }
  }

  // Recent history (saved versions)
  if (details && details.history && details.history.length > 0) {
    const histItems = details.history.map((entry) =>
      h('li', {}, [
        h('span', { className: 'hist-subject', text: entry.subject }),
        h('span', { className: 'hist-meta', text: `${entry.author} · ${entry.when}` }),
      ])
    );
    detailsEl.appendChild(section('Recent saved versions', h('ul', { className: 'list' }, histItems)));
  }

  // Action buttons
  const actionButtons = REPO_ACTIONS.map((action) => {
    const disabled =
      (action.key === 'openRemote' && !repo.remoteUrl) ||
      ((action.key === 'download' || action.key === 'upload') && !repo.remoteUrl);
    return h(
      'button',
      {
        className: 'btn' + (action.primary ? ' btn-primary' : ''),
        onClick: () => handlers.onAction(action.key),
        disabled,
        title: disabled ? 'This repository is not connected to an online repository yet.' : '',
      },
      [h('span', { className: 'btn-icon', text: action.icon }), ' ' + action.label]
    );
  });
  detailsEl.appendChild(section('Actions', h('div', { className: 'actions-grid' }, actionButtons)));

  // Manage row (rename / remove)
  detailsEl.appendChild(
    h('div', { className: 'actions-grid' }, [
      h('button', { className: 'btn btn-sm', onClick: handlers.onRename }, [
        h('span', { className: 'btn-icon', text: '✏️' }),
        ' Rename',
      ]),
      h('button', { className: 'btn btn-sm btn-danger', onClick: handlers.onRemove }, [
        h('span', { className: 'btn-icon', text: '🗑️' }),
        ' Remove from EasyGit',
      ]),
    ])
  );
}

function infoBox(title, value) {
  return h('div', { className: 'info-box' }, [
    h('h4', { text: title }),
    h('div', { className: 'info-value', text: value }),
  ]);
}

function section(title, contentNode) {
  return h('div', { className: 'section' }, [h('h3', { text: title }), contentNode]);
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
 * Show scan results and let the user pick which to add.
 * @param {Array<{name: string, path: string, alreadyAdded: boolean}>} found
 * @param {number} scannedFolders
 * @param {(paths: string[]) => void} onAdd
 */
export function showScanResultsModal(found, scannedFolders, onAdd) {
  const addable = found.filter((f) => !f.alreadyAdded);

  if (found.length === 0) {
    openModalSimple(
      'No repositories found',
      `EasyGit looked through ${scannedFolders} folder${scannedFolders === 1 ? '' : 's'} but did not find any Git repositories there. Try choosing a different folder.`
    );
    return;
  }

  const checkboxes = new Map();
  const items = found.map((f) => {
    const cb = h('input', {
      type: 'checkbox',
      checked: !f.alreadyAdded,
      disabled: f.alreadyAdded,
    });
    checkboxes.set(f.path, cb);
    return h('li', { className: 'scan-item' + (f.alreadyAdded ? ' disabled' : '') }, [
      cb,
      h('div', {}, [
        h('div', { className: 'scan-name', text: f.name }),
        h('div', { className: 'scan-path', text: f.path }),
      ]),
      f.alreadyAdded ? h('span', { className: 'already', text: '✓ Already added' }) : null,
    ]);
  });

  const close = openModal({
    title: 'Repositories found',
    subtitle: `Found ${found.length} repositor${found.length === 1 ? 'y' : 'ies'} in ${scannedFolders} folder${
      scannedFolders === 1 ? '' : 's'
    }. Choose which ones to add.`,
    body: h('ul', { className: 'scan-list' }, items),
    footer: [
      h('button', { className: 'btn', onClick: () => close() }, 'Cancel'),
      h(
        'button',
        {
          className: 'btn btn-primary',
          disabled: addable.length === 0,
          onClick: () => {
            const chosen = [];
            for (const [pth, cb] of checkboxes) {
              if (cb.checked && !cb.disabled) chosen.push(pth);
            }
            close();
            if (chosen.length > 0) onAdd(chosen);
          },
        },
        addable.length === 0 ? 'All already added' : `Add selected`
      ),
    ],
  });
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
