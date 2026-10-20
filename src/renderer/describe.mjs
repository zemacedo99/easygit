/**
 * describe.mjs (renderer, pure)
 * -----------------------------
 * How "Upload my changes" / "Save a version" get their description, following
 * the optional Settings → "Saving and uploading" choices:
 *
 *   manual    (default)  ask the user, empty box (✨ Suggest available)
 *   prepared             ask the user, box already filled in (still editable)
 *   one-click            don't ask: save + upload with the chosen description
 *
 * The description is always chosen the same way (and ✨ Suggest uses the same
 * local suggestion): the user's default text if set, otherwise a suggestion
 * from the actual changed files, otherwise a safe generic fallback.
 */

export const FALLBACK_DESCRIPTION = 'Update project files';
const MAX_DESCRIPTION = 200;

/** 'manual' | 'prepared' | 'one-click' */
export function describeMode(settings) {
  const s = settings || {};
  if (!s.autoCommitMessage) return 'manual';
  return s.autoUploadNoPrompt ? 'one-click' : 'prepared';
}

/** The user's default description, cleaned (empty string when not set). */
export function customDefault(settings) {
  return String((settings && settings.commitDefaultMessage) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION);
}

/**
 * Choose a description.
 * @param {object} settings
 * @param {() => Promise<{ok: boolean, message?: string}>} suggest  the local ✨ Suggest call
 * @returns {Promise<{message: string, source: 'default'|'suggested'|'fallback'}>}
 */
export async function prepareDescription(settings, suggest) {
  const custom = customDefault(settings);
  if (custom) return { message: custom, source: 'default' };
  try {
    const res = suggest ? await suggest() : null;
    const text = res && res.ok && typeof res.message === 'string' ? res.message.trim() : '';
    if (text) return { message: text.slice(0, MAX_DESCRIPTION), source: 'suggested' };
  } catch (e) {
    /* fall through to the safe fallback */
  }
  return { message: FALLBACK_DESCRIPTION, source: 'fallback' };
}
