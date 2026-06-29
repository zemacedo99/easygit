'use strict';

/**
 * suggestMessage.js  —  LocalCommitMessageSuggestionService
 * ---------------------------------------------------------
 * Generates a short, friendly change description from the list of changed files
 * ONLY (their paths + change types). It never reads file contents and never
 * contacts any external service, so it is fully private and offline.
 *
 * This is intentionally a clean, self-contained abstraction: a future
 * ClaudeCommitMessageSuggestionService could implement the same shape
 * (`suggestCommitMessage(files) -> string`) behind a setting, without changing
 * any callers.
 */

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg']);

/** Bucket a single file path into a coarse, friendly category. */
function categorize(p) {
  const lower = String(p).replace(/\\/g, '/').toLowerCase();
  const base = lower.split('/').pop();
  const ext = base.includes('.') ? base.split('.').pop() : '';

  // tests
  if (/(^|\/)(tests?|__tests__|__mocks__)\//.test(lower) || /\.(test|spec)\./.test(base)) return 'tests';
  // documentation
  if (
    base === 'readme.md' || base === 'changelog.md' || base.startsWith('license') ||
    lower.includes('/docs/') || lower.startsWith('docs/') || ext === 'md'
  ) return 'docs';
  // assets / branding
  if (IMAGE_EXTS.has(ext) || lower.includes('/assets/') || base.includes('logo') || base.includes('icon')) return 'assets';
  // configuration
  if (
    ['package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', '.npmrc', '.editorconfig'].includes(base) ||
    ['yml', 'yaml', 'toml', 'ini', 'lock'].includes(ext) ||
    /\.(config|conf)\.[a-z]+$/.test(base) || base === 'dockerfile' ||
    base.includes('webpack') || base.includes('vite') || base.includes('rollup') ||
    base.includes('babel') || base.includes('eslint') || base.includes('prettier') ||
    lower.includes('/config/')
  ) return 'config';
  // repository discovery
  if (base.includes('scan') || lower.includes('scanner') || lower.includes('discover')) return 'scan';
  // git operation flow
  if (
    base.includes('gitservice') || base === 'repomanager.js' || base.includes('statusinterpreter') ||
    /\b(commit|push|pull|upload|download|remote|fetch|status)\b/.test(base) || base.includes('git')
  ) return 'gitflow';
  // error / bug handling
  if (base.includes('error') || base.includes('exception')) return 'bugfix';
  // user interface
  if (
    ['css', 'scss', 'sass', 'less', 'html', 'htm', 'jsx', 'tsx', 'vue'].includes(ext) ||
    lower.includes('/renderer/') || lower.includes('/components/') ||
    ['ui.js', 'app.js', 'styles.css', 'index.html', 'labels.js'].includes(base)
  ) return 'ui';
  // app entry / plumbing
  if (['main.js', 'index.js', 'preload.js', 'storage.js'].includes(base) || lower.includes('/main/')) return 'app';
  return 'other';
}

/** Turn a file path into a readable phrase, e.g. "LoginScreen.js" -> "login screen". */
function prettyName(p) {
  let base = String(p).replace(/\\/g, '/').split('/').pop();
  base = base.replace(/\.[^.]+$/, ''); // drop extension
  base = base.replace(/[-_.]+/g, ' '); // separators -> spaces
  base = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2'); // split camelCase
  base = base.replace(/\s+/g, ' ').trim().toLowerCase();
  return base || 'files';
}

/** Broad message for when one category dominates a multi-file change. */
const BROAD = {
  docs: 'Update documentation',
  ui: 'Improve user interface',
  config: 'Update app configuration',
  assets: 'Update branding assets',
  tests: 'Update tests',
  scan: 'Improve repository discovery',
  gitflow: 'Improve Git operation flow',
  bugfix: 'Fix app behavior',
  app: 'Update project files',
  other: 'Update project files',
};

/**
 * Suggest a friendly change description.
 * @param {Array<{path: string, type?: string}>} files
 * @returns {string}
 */
function suggestCommitMessage(files) {
  if (!files || files.length === 0) return 'Update project files';

  // Single file: be as specific as is safe.
  if (files.length === 1) {
    const f = files[0];
    const cat = categorize(f.path);
    if (cat === 'docs') return 'Update documentation';
    if (cat === 'tests') return 'Update tests';
    if (cat === 'assets') return 'Update branding assets';
    if (cat === 'config') return 'Update app configuration';
    if (cat === 'scan') return 'Improve repository discovery';
    if (cat === 'bugfix') return 'Fix app behavior';
    // Otherwise name the file specifically — unless it's a generic core file
    // (e.g. "ui.js", "app.js"), where the broad category message reads better.
    const name = prettyName(f.path);
    const GENERIC = new Set(['ui', 'app', 'index', 'main', 'src', 'lib', 'core', 'util', 'utils']);
    if (GENERIC.has(name)) return BROAD[cat] || 'Update project files';
    const verb = f.type === 'added' || f.type === 'untracked' ? 'Add' : f.type === 'deleted' ? 'Remove' : 'Update';
    return `${verb} ${name}`;
  }

  // Multiple files: reason about the mix of categories.
  const cats = new Set(files.map((f) => categorize(f.path)));
  cats.delete('other'); // don't let unclassified files dominate
  if (cats.size === 0) cats.add('other');

  if (cats.size === 1) return BROAD[[...cats][0]];

  const only = (...cs) => [...cats].every((c) => cs.includes(c));
  if (only('config', 'docs')) return 'Update project settings and documentation';
  if (only('ui', 'assets')) return 'Update the interface and branding';
  if (only('assets', 'docs')) return 'Update branding and documentation';
  if (only('gitflow', 'scan')) return 'Improve Git operations';
  if (only('gitflow', 'scan', 'app', 'tests')) return 'Improve app behavior';

  return 'Update project files';
}

module.exports = { suggestCommitMessage, categorize, prettyName };
