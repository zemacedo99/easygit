/**
 * labels.js (renderer)
 * --------------------
 * Small presentation helpers for the UI: friendly time formatting and the
 * definitions of the per-repository action buttons.
 *
 * Friendly status wording itself lives in the main process (messages.js /
 * statusInterpreter.js) and arrives ready-to-show; this file is purely about
 * how the renderer lays things out.
 */

/**
 * Turn an ISO timestamp into a friendly "Last checked" phrase.
 * @param {string|null} iso
 * @returns {string}
 */
export function formatLastChecked(iso) {
  if (!iso) return 'Never checked';
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now - then;
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);

  if (sec < 45) return 'Checked just now';
  if (min < 60) return `Checked ${min} minute${min === 1 ? '' : 's'} ago`;
  if (hr < 24) return `Checked ${hr} hour${hr === 1 ? '' : 's'} ago`;
  if (day < 7) return `Checked ${day} day${day === 1 ? '' : 's'} ago`;
  return `Checked on ${then.toLocaleDateString()}`;
}

/**
 * The per-repository actions, in display order. Each maps to a handler key the
 * app wires up. `primary` styles the button more prominently.
 */
export const REPO_ACTIONS = [
  { key: 'check', icon: '🔎', label: 'Check changes', primary: true },
  { key: 'checkOnline', icon: '🌐', label: 'Check online version' },
  { key: 'save', icon: '💾', label: 'Save a version' },
  { key: 'download', icon: '⬇️', label: 'Download latest version' },
  { key: 'upload', icon: '⬆️', label: 'Upload my saved changes' },
  { key: 'openFolder', icon: '📂', label: 'Open folder' },
  { key: 'openRemote', icon: '🔗', label: 'Open online repository' },
];
