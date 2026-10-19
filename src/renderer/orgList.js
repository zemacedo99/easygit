/**
 * orgList.js (renderer)
 * ---------------------
 * The OPTIONAL organized repository list: custom order, collapsible groups,
 * drag-and-drop, and the small dialogs to manage groups and folder suggestions.
 * Only used when "Organize your repository list" is on in Settings; otherwise
 * app.js keeps using ui.renderRepoList exactly as before.
 *
 * Groups are EasyGit-only organization: every action here just calls back into
 * app.js, which updates the saved layout. Nothing ever moves folders on disk.
 */

import { h, openModal, buildRepoCard } from './ui.js';

/** What is being dragged right now (same window only, so a variable is enough). */
let dragging = null; // { type: 'repo', id, from } | { type: 'group', id }

const DROP_CLASSES = ['drop-before', 'drop-after', 'drop-into'];

function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((el) => el.classList.remove(...DROP_CLASSES));
}

/** Before or after an element, from the pointer's vertical position. */
function isAfter(el, e) {
  const box = el.getBoundingClientRect();
  return e.clientY > box.top + box.height / 2;
}

/**
 * Wire an element as a drop target.
 * @param {HTMLElement} el
 * @param {(e: DragEvent) => string|null} classify  returns a DROP_CLASSES entry, or null when not allowed
 * @param {(mark: string) => void} onDrop
 */
function dropTarget(el, classify, onDrop) {
  el.addEventListener('dragover', (e) => {
    if (!dragging) return;
    const mark = classify(e);
    if (!mark) return; // not allowed here – the browser shows "no drop"
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (!el.classList.contains(mark)) {
      clearDropMarks();
      el.classList.add(mark);
    }
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove(...DROP_CLASSES);
  });
  el.addEventListener('drop', (e) => {
    if (!dragging) return;
    const mark = classify(e);
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    if (mark) onDrop(mark);
    dragging = null;
  });
}

function makeDraggable(el, payload) {
  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', (e) => {
    dragging = payload;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', payload.id); // required for the drag to start
    // Defer so the drag image is taken before the "being dragged" style applies.
    setTimeout(() => el.classList.add('dragging'), 0);
    e.stopPropagation();
  });
  el.addEventListener('dragend', () => {
    dragging = null;
    el.classList.remove('dragging');
    clearDropMarks();
  });
}

/**
 * Render the organized list.
 * @param {object} view  from repoLayout.buildListView
 * @param {object} ctx   see app.js (rerender) for the full set of fields
 */
export function renderOrganizedList(view, ctx) {
  const listEl = document.getElementById('repo-list');
  const emptyEl = document.getElementById('empty-state');
  const countEl = document.getElementById('repo-count');

  // The count always means projects, never groups.
  const filtering = !!(ctx.query && ctx.query.trim());
  countEl.textContent = filtering ? `${view.shown}/${ctx.total}` : String(ctx.total);
  listEl.textContent = '';
  dragging = null;

  if (ctx.total === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const bar = orgBar(ctx);
  if (bar) listEl.appendChild(bar);

  if (filtering && view.shown === 0) {
    listEl.appendChild(
      h('div', { className: 'list-nomatch' }, [
        h('div', { className: 'empty-emoji', text: '🔍' }),
        h('p', { text: 'No projects match your search.' }),
      ])
    );
    return;
  }

  if (!view.grouped) {
    const ids = view.repos.map((r) => r.id);
    for (const repo of view.repos) listEl.appendChild(card(repo, undefined, ids, ctx));
    return;
  }

  const hasGroups = view.sections.some((s) => s.id);
  for (const section of view.sections) {
    if (!section.id && !hasGroups) {
      // No groups yet: the projects simply show as the normal list.
      const ids = section.repos.map((r) => r.id);
      for (const repo of section.repos) listEl.appendChild(card(repo, null, ids, ctx));
    } else {
      listEl.appendChild(groupSection(section, ctx, filtering));
    }
  }
}

/** The compact bar above the list: suggestions, "New group", and drag hint. */
function orgBar(ctx) {
  const items = [];
  const n = ctx.suggestions ? ctx.suggestions.length : 0;
  if (n > 0) {
    items.push(
      h('div', { className: 'org-suggest', role: 'status' }, [
        h('span', { className: 'org-suggest-icon', text: '💡' }),
        h('span', {
          className: 'org-suggest-text',
          text: `EasyGit found ${n} possible group${n === 1 ? '' : 's'} based on your project folders.`,
        }),
        h('button', { className: 'btn btn-sm btn-primary', onClick: () => ctx.onReviewSuggestions() }, 'Review'),
        h(
          'button',
          {
            className: 'icon-btn org-suggest-close',
            title: 'Not now — don’t suggest these groups again',
            'aria-label': 'Dismiss group suggestions',
            onClick: () => ctx.onDismissSuggestions(),
          },
          '✕'
        ),
      ])
    );
  }
  const row = [];
  if (ctx.canEditGroups) {
    row.push(
      h(
        'button',
        {
          className: 'btn btn-sm org-new-group',
          title: 'Add a group to organize this list. No folder is created on your computer.',
          onClick: () => ctx.onNewGroup(),
        },
        '➕ New group'
      )
    );
  }
  if (ctx.hint) row.push(h('span', { className: 'org-hint', text: ctx.hint }));
  if (row.length) items.push(h('div', { className: 'org-row' }, row));
  return items.length ? h('div', { className: 'org-bar' }, items) : null;
}

/**
 * A repository card, draggable when reordering is allowed.
 * @param {string|null|undefined} sectionId  group id, null = "Not in a group", undefined = flat list
 * @param {string[]} sectionIds  the ids shown in this section, in order
 */
function card(repo, sectionId, sectionIds, ctx) {
  const el = buildRepoCard(repo, ctx.selectedId, ctx.onSelect, ctx.checkingIds, ctx.cardOpts);
  if (!ctx.dragEnabled || !ctx.canReorder) return el;
  el.classList.add('is-draggable');
  el.title = 'Drag to rearrange — this only changes the list in EasyGit';
  makeDraggable(el, { type: 'repo', id: repo.id, from: sectionId });
  dropTarget(
    el,
    (e) => {
      if (!dragging || dragging.type !== 'repo' || dragging.id === repo.id) return null;
      if (dragging.from !== sectionId && !ctx.canMoveAcross) return null;
      return isAfter(el, e) ? 'drop-after' : 'drop-before';
    },
    (mark) => {
      const at = sectionIds.indexOf(repo.id);
      let beforeId = mark === 'drop-after' ? sectionIds[at + 1] || null : repo.id;
      if (beforeId === dragging.id) beforeId = sectionIds[sectionIds.indexOf(beforeId) + 1] || null;
      ctx.onDropRepo({ repoId: dragging.id, groupId: sectionId, beforeId });
    }
  );
  return el;
}

function groupSection(section, ctx, filtering) {
  const isGroup = !!section.id;
  const count = filtering ? `${section.repos.length}/${section.total}` : String(section.total);
  const open = !section.collapsed;

  const toggle = h(
    'button',
    {
      className: 'group-toggle',
      'aria-expanded': String(open),
      title: filtering ? 'Showing matches for your search' : open ? 'Collapse this group' : 'Expand this group',
      disabled: filtering ? 'disabled' : null,
      onClick: () => ctx.onToggleGroup(section.id, open),
    },
    [
      h('span', { className: 'group-caret', text: open ? '▾' : '▸', 'aria-hidden': 'true' }),
      h('span', { className: 'group-name', text: section.name }),
      h('span', { className: 'group-count pill', text: count, title: `${section.total} project${section.total === 1 ? '' : 's'}` }),
    ]
  );

  const actions = [];
  if (isGroup && ctx.canEditGroups) {
    actions.push(
      h(
        'button',
        { className: 'icon-btn group-action', title: 'Rename group', 'aria-label': `Rename group ${section.name}`, onClick: () => ctx.onRenameGroup(section.id) },
        '✏️'
      ),
      h(
        'button',
        {
          className: 'icon-btn group-action',
          title: 'Delete group — its projects stay in EasyGit and no files are touched',
          'aria-label': `Delete group ${section.name}`,
          onClick: () => ctx.onDeleteGroup(section.id),
        },
        '🗑️'
      )
    );
  }

  const header = h('div', { className: 'group-header' + (isGroup ? '' : ' group-header-loose') }, [
    toggle,
    actions.length ? h('div', { className: 'group-actions' }, actions) : null,
  ]);
  if (isGroup) header.title = 'A group in EasyGit — only organizes this list, no folder on disk';

  const ids = section.repos.map((r) => r.id);
  const body = h('div', { className: 'group-body', hidden: !open });
  // A collapsed group renders no cards at all (it is redrawn when expanded).
  if (open) for (const repo of section.repos) body.appendChild(card(repo, section.id, ids, ctx));
  if (open && section.repos.length === 0) {
    body.appendChild(
      h('div', {
        className: 'group-empty',
        text: ctx.canEditGroups && ctx.dragEnabled ? 'Empty group — drag projects here' : 'No projects in this group yet',
      })
    );
  }

  const wrap = h('div', { className: 'repo-group' + (isGroup ? '' : ' repo-group-loose') }, [header, body]);
  if (isGroup) wrap.dataset.groupId = section.id;

  if (ctx.dragEnabled) {
    // Group headers accept projects (move into / out of a group) and other groups (reorder).
    dropTarget(
      header,
      (e) => {
        if (!dragging) return null;
        if (dragging.type === 'repo') {
          if (dragging.from === section.id) return ctx.canReorder ? 'drop-into' : null;
          return ctx.canMoveAcross ? 'drop-into' : null;
        }
        if (!ctx.canEditGroups || dragging.id === section.id) return null;
        if (!isGroup) return 'drop-before'; // dropping on "Not in a group" = make it the last group
        return isAfter(header, e) ? 'drop-after' : 'drop-before';
      },
      (mark) => {
        if (dragging.type === 'repo') {
          ctx.onDropRepo({ repoId: dragging.id, groupId: section.id, beforeId: null });
          return;
        }
        let beforeGroupId = null;
        if (isGroup) {
          const groups = ctx.groupIds.filter((id) => id !== dragging.id);
          beforeGroupId = mark === 'drop-after' ? groups[groups.indexOf(section.id) + 1] || null : section.id;
        }
        ctx.onDropGroup({ groupId: dragging.id, beforeGroupId });
      }
    );
    if (section.repos.length === 0) {
      dropTarget(
        body,
        () => (dragging && dragging.type === 'repo' && ctx.canMoveAcross ? 'drop-into' : null),
        () => ctx.onDropRepo({ repoId: dragging.id, groupId: section.id, beforeId: null })
      );
    }
    if (isGroup && ctx.canEditGroups) {
      header.classList.add('is-draggable');
      makeDraggable(header, { type: 'group', id: section.id });
    }
  }
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

const GROUP_NOTE = 'Groups only organize this list inside EasyGit. No folders are created, moved or renamed on your computer.';

/** Ask for a group name ("New group" / "Rename group"). */
export function showGroupNameModal({ title, initial = '', confirmLabel = 'Save' }, onSave) {
  const input = h('input', { className: 'input', type: 'text', value: initial, maxlength: '60', placeholder: 'For example: Client A' });
  const save = () => {
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    close();
    onSave(name);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });
  const close = openModal({
    title,
    subtitle: GROUP_NOTE,
    body: h('div', { className: 'field' }, [h('label', { text: 'Group name' }), input]),
    footer: [
      h('button', { className: 'btn', onClick: () => close() }, 'Cancel'),
      h('button', { className: 'btn btn-primary', onClick: save }, confirmLabel),
    ],
  });
  setTimeout(() => input.select(), 50);
}

/**
 * Choose a group for a project (an alternative to drag-and-drop).
 * @param {{name: string}} repo
 * @param {Array<{id: string, name: string}>} groups
 * @param {string|null} currentGroupId
 * @param {(groupId: string|null) => void} onPick
 * @param {() => void} onNewGroup
 */
export function showMoveToGroupModal(repo, groups, currentGroupId, onPick, onNewGroup) {
  const choice = (id, label, icon) =>
    h(
      'button',
      {
        className: 'move-choice' + (id === currentGroupId ? ' current' : ''),
        disabled: id === currentGroupId ? 'disabled' : null,
        onClick: () => {
          close();
          onPick(id);
        },
      },
      [h('span', { text: icon, 'aria-hidden': 'true' }), h('span', { text: label }), id === currentGroupId ? h('span', { className: 'move-current', text: 'current' }) : null]
    );
  const list = h('div', { className: 'move-choices' }, [
    ...groups.map((g) => choice(g.id, g.name, '📂')),
    choice(null, 'Not in a group', '📄'),
  ]);
  const close = openModal({
    title: `Move “${repo.name}” to a group`,
    subtitle: GROUP_NOTE,
    body: list,
    footer: [
      h(
        'button',
        {
          className: 'btn',
          onClick: () => {
            close();
            onNewGroup();
          },
        },
        '➕ New group…'
      ),
      h('button', { className: 'btn btn-primary', onClick: () => close() }, 'Cancel'),
    ],
  });
}

/**
 * Review folder-based group suggestions one by one.
 * @param {Array<{signature, name, parent, repoIds}>} suggestions
 * @param {Map<string, {name: string}>} reposById
 * @param {{onAccept: (s) => void, onDismiss: (s) => void}} handlers
 */
export function showSuggestionsModal(suggestions, reposById, handlers) {
  let remaining = suggestions.slice();
  const list = h('div', { className: 'suggest-list' });

  const render = () => {
    list.textContent = '';
    if (remaining.length === 0) {
      close();
      return;
    }
    for (const s of remaining) {
      const names = s.repoIds.map((id) => (reposById.get(id) || {}).name || id);
      const done = (fn) => () => {
        remaining = remaining.filter((x) => x !== s);
        fn(s);
        render();
      };
      list.appendChild(
        h('div', { className: 'suggest-item' }, [
          h('div', { className: 'suggest-info' }, [
            h('div', { className: 'suggest-name' }, [h('span', { text: '📂 ' }), s.name, h('span', { className: 'pill', text: String(names.length) })]),
            h('div', { className: 'suggest-path', text: `Projects in ${s.parent}` }),
            h('div', { className: 'suggest-repos', text: names.join(', ') }),
          ]),
          h('div', { className: 'suggest-actions' }, [
            h('button', { className: 'btn btn-sm btn-primary', onClick: done(handlers.onAccept) }, 'Create group'),
            h('button', { className: 'btn btn-sm', title: 'Don’t suggest this group again', onClick: done(handlers.onDismiss) }, 'Dismiss'),
          ]),
        ])
      );
    }
  };

  const close = openModal({
    title: 'Suggested groups',
    subtitle: 'Based on the folders your projects are in. ' + GROUP_NOTE,
    body: list,
    footer: [h('button', { className: 'btn btn-primary', onClick: () => close() }, 'Done')],
  });
  render();
}
