'use strict';

/**
 * updater.js
 * ----------
 * Check → download → verify → install, run entirely in the main process.
 * No Electron imports, so it is tested against a local Git repository.
 *
 *  - check:    `git ls-remote --tags` finds the newest vX.Y.Z release. If it is
 *              newer, a metadata-only clone of that tag (no file contents)
 *              reads versions/vX.Y.Z/update.json and validates it.
 *  - download: fetches ONLY the installer (or portable exe) object from that tag,
 *              with progress, into a private staging folder. When the tag does
 *              not contain the exe (releases published on GitHub), it is
 *              downloaded over HTTPS from the matching GitHub Release instead.
 *  - verify:   size + SHA-256 must match update.json, or the file is deleted.
 *  - install:  re-verifies, then hands the file to `launch` (main.js), which
 *              runs the installer / portable helper and quits.
 *
 * Git runs with an argument array (never a shell string) and prompts disabled.
 * The renderer can only call check/download/install: it never supplies a URL,
 * path or version.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const core = require('./updateCore');
const config = require('./updateConfig');

/** Run git with arguments; resolves {code, stdout, stderr}. */
function runGit(args, { cwd, timeoutMs = config.gitTimeoutMs, onStderr, input, stdoutFile } = {}) {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' },
    });
    let stdout = '';
    let stderr = '';
    let out = null;
    if (stdoutFile) {
      out = fs.createWriteStream(stdoutFile);
      child.stdout.pipe(out);
    } else {
      child.stdout.on('data', (d) => { stdout += d; });
    }
    child.stderr.on('data', (d) => {
      stderr += d;
      if (onStderr) onStderr(String(d));
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    if (input != null) child.stdin.end(input);
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (out) out.end(() => resolve({ code, stdout, stderr }));
      else resolve({ code, stdout, stderr });
    };
    child.on('error', (e) => { stderr += String(e && e.message); finish(-1); });
    child.on('close', (code) => finish(code));
  });
}

class UpdateError extends Error {
  constructor(kind, detail) {
    super(detail || kind);
    this.kind = kind;
  }
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

/**
 * Download a GitHub Release asset over HTTPS into `dest`, following GitHub's
 * redirects (HTTPS only), never writing more than `maxBytes`.
 */
function httpsDownload({ url, dest, maxBytes, onBytes = () => {}, timeoutMs = config.gitTimeoutMs, redirects = 5 }) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    if (!/^https:\/\//.test(url)) return reject(new UpdateError('download', 'only https downloads are allowed'));
    const req = https.get(url, { headers: { 'User-Agent': 'EasyGit-updater', Accept: 'application/octet-stream' } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new UpdateError('download', 'too many redirects'));
        const next = new URL(res.headers.location, url).href;
        return resolve(httpsDownload({ url: next, dest, maxBytes, onBytes, timeoutMs, redirects: redirects - 1 }));
      }
      if (code !== 200) {
        res.resume();
        return reject(new UpdateError(code === 404 ? 'metadata' : code === 401 || code === 403 ? 'access' : 'unavailable', `HTTP ${code}`));
      }
      const out = fs.createWriteStream(dest);
      let got = 0;
      res.on('data', (chunk) => {
        got += chunk.length;
        if (maxBytes && got > maxBytes) {
          req.destroy();
          out.destroy();
          reject(new UpdateError('download', 'larger than expected'));
          return;
        }
        onBytes(got);
      });
      res.on('error', () => reject(new UpdateError('download')));
      out.on('error', () => reject(new UpdateError('disk')));
      out.on('finish', () => resolve());
      res.pipe(out);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => reject(e instanceof UpdateError ? e : new UpdateError('offline', String(e && e.message))));
  });
}

/**
 * @param {object} opts
 * @param {string} opts.currentVersion
 * @param {'installed'|'portable'|'development'|'unsupported'} opts.buildKind
 * @param {string} opts.workDir          private folder for metadata clones + downloads
 * @param {(state: object) => void} [opts.onState]
 * @param {(action: {kind: string, file: string}) => Promise<void>|void} [opts.launch]
 * @param {() => string} [opts.source]   update repository (from updateConfig)
 * @param {typeof runGit} [opts.git]
 * @param {typeof httpsDownload} [opts.fetchAsset]  GitHub Release asset download
 * @param {(version: string, file: string) => string|null} [opts.assetUrl]
 */
function createUpdater({ currentVersion, buildKind, workDir, onState = () => {}, launch = () => {}, source = () => config.updateSource(), git = runGit, fetchAsset = httpsDownload, assetUrl = (version, file) => config.releaseAssetUrl(source(), version, file), lastCheckedAt = null }) {
  let state = { status: 'idle', currentVersion, buildKind, lastCheckedAt };
  let repoDir = null; // metadata-only clone of the latest release tag
  let busy = false;

  const set = (status, patch) => {
    state = core.transition(state, status, patch);
    onState(publicState());
    return state;
  };
  /** What the renderer may see: no paths, no URLs. */
  const publicState = () => {
    const s = { ...state };
    delete s.file;
    return s;
  };

  const fail = (err) => {
    const kind = err instanceof UpdateError ? err.kind : 'unavailable';
    if (state.status === 'downloading' || state.status === 'verifying' || state.status === 'installing' || state.status === 'checking') {
      set('error', { error: core.friendlyError(kind) });
    }
    return publicState();
  };

  async function gitOrThrow(args, opts) {
    const res = await git(args, opts);
    if (res.code !== 0) throw new UpdateError(core.classifyGitError(res.stderr), res.stderr);
    return res;
  }

  /** Find the newest release and, if newer, read + validate its update.json. */
  async function check() {
    if (busy || state.status === 'downloading' || state.status === 'verifying' || state.status === 'installing') return publicState();
    busy = true;
    try {
      set('checking', { latest: undefined });
      const tags = await gitOrThrow(['ls-remote', '--tags', '--refs', source()]);
      const latest = core.latestFromTags(tags.stdout);
      if (!latest) throw new UpdateError('unavailable');
      const relation = core.compareToLatest(currentVersion, latest.version);
      const checkedAt = new Date().toISOString();
      if (relation !== 'available') {
        return set(relation, { latest: { version: latest.version }, lastCheckedAt: checkedAt }) && publicState();
      }
      const metadata = await readMetadata(latest);
      return set('available', { latest: metadata, lastCheckedAt: checkedAt }) && publicState();
    } catch (err) {
      return fail(err);
    } finally {
      busy = false;
    }
  }

  async function readMetadata(latest) {
    fs.mkdirSync(workDir, { recursive: true });
    if (repoDir) rmrf(repoDir);
    repoDir = path.join(workDir, 'release-info');
    rmrf(repoDir);
    await gitOrThrow(['clone', '--quiet', '--filter=blob:none', '--no-checkout', '--depth', '1', '--branch', latest.tag, source(), repoDir]);
    const metaPath = `${config.releaseFolder(latest.version)}/update.json`;
    const res = await git(['cat-file', '-p', `HEAD:${metaPath}`], { cwd: repoDir });
    if (res.code !== 0) {
      if (/does not exist|exists on disk, but not in|Not a valid object name|path .* does not exist/i.test(res.stderr)) throw new UpdateError('metadata');
      throw new UpdateError(core.classifyGitError(res.stderr), res.stderr);
    }
    const valid = core.validateMetadata(res.stdout, latest.version);
    if (!valid.ok) throw new UpdateError('metadata', valid.reason);
    return valid.metadata;
  }

  /** Size + SHA-256 must match update.json; then the file is staged as ready. */
  async function verifyAndStage(partial, finalFile, artifact) {
    state = { ...state, progress: 100 };
    set('verifying');
    const verdict = await core.verifyFile(partial, artifact);
    if (!verdict.ok) {
      rmrf(partial);
      throw new UpdateError(verdict.reason === 'checksum' ? 'checksum' : 'download');
    }
    fs.renameSync(partial, finalFile);
    return set('ready', { file: finalFile }) && publicState();
  }

  /** Download + verify the artifact for this build kind. */
  async function download() {
    if (busy || !(state.status === 'available' || (state.status === 'error' && state.latest && state.latest.installer))) return publicState();
    if (buildKind !== 'installed' && buildKind !== 'portable') {
      return set('downloading', { progress: 0 }) && fail(new UpdateError('unsupported'));
    }
    busy = true;
    const meta = state.latest;
    const artifact = buildKind === 'portable' ? meta.portable : meta.installer;
    const stagingDir = path.join(workDir, 'download');
    const partial = path.join(stagingDir, `${artifact.file}.partial`);
    const finalFile = path.join(stagingDir, artifact.file);
    try {
      set('downloading', { progress: 0, phase: 'connecting' });
      rmrf(stagingDir);
      try {
        fs.mkdirSync(stagingDir, { recursive: true });
      } catch (e) {
        throw new UpdateError('disk');
      }
      const treePath = `${config.releaseFolder(meta.version)}/${artifact.file}`;
      const ls = await gitOrThrow(['ls-tree', 'HEAD', '--', treePath], { cwd: repoDir });
      const m = /^\d+ blob ([0-9a-f]{40,64})\t/.exec(ls.stdout);
      if (!m) {
        // The tag carries only update.json: the executable is attached to the
        // GitHub Release instead. The same size + SHA-256 checks apply below.
        const url = assetUrl(meta.version, artifact.file);
        if (!url) throw new UpdateError('metadata', 'artifact not in the release');
        let lastAssetPct = 0;
        await fetchAsset({
          url,
          dest: partial,
          maxBytes: artifact.size,
          onBytes: (got) => {
            const pct = Math.min(99, Math.floor((got / artifact.size) * 100));
            if (pct > lastAssetPct) {
              lastAssetPct = pct;
              state = { ...state, progress: pct, phase: 'downloading' };
              onState(publicState());
            }
          },
        });
        return await verifyAndStage(partial, finalFile, artifact);
      }
      const oid = m[1];
      // Fetch just this one object (what Git does internally for a partial clone),
      // reading progress from Git's "Receiving objects: …, 12.3 MiB" lines.
      let lastPct = 0;
      await gitOrThrow(['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '--progress', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--filter=blob:none', '--stdin', 'origin'], {
        cwd: repoDir,
        input: `${oid}\n`,
        onStderr: (chunk) => {
          for (const line of chunk.split(/[\r\n]+/)) {
            const got = core.receivedBytes(line);
            if (got == null) continue;
            const pct = Math.min(99, Math.floor((got / artifact.size) * 100));
            if (pct > lastPct) {
              lastPct = pct;
              state = { ...state, progress: pct, phase: 'downloading' };
              onState(publicState());
            }
          }
        },
      });
      const written = await git(['cat-file', 'blob', oid], { cwd: repoDir, stdoutFile: partial });
      if (written.code !== 0) throw new UpdateError('download', written.stderr);
      return await verifyAndStage(partial, finalFile, artifact);
    } catch (err) {
      rmrf(partial);
      if (err instanceof UpdateError) return fail(err);
      return fail(new UpdateError(err && /ENOSPC|EACCES|EPERM/.test(String(err.code)) ? 'disk' : 'download'));
    } finally {
      busy = false;
    }
  }

  /** Re-verify the staged file, then hand it to the trusted launcher. */
  async function install() {
    if (state.status !== 'ready' || !state.file) return publicState();
    const meta = state.latest;
    const artifact = buildKind === 'portable' ? meta.portable : meta.installer;
    const file = state.file;
    set('installing');
    const verdict = await core.verifyFile(file, artifact);
    if (!verdict.ok) {
      rmrf(file);
      return fail(new UpdateError('checksum'));
    }
    try {
      await launch({ kind: buildKind, file, version: meta.version });
    } catch (e) {
      return fail(new UpdateError('install'));
    }
    return publicState();
  }

  /** Remove leftovers from earlier sessions (never the file being installed). */
  function cleanup() {
    rmrf(path.join(workDir, 'release-info'));
    rmrf(path.join(workDir, 'download'));
  }

  return { check, download, install, cleanup, getState: publicState };
}

module.exports = { createUpdater, runGit, httpsDownload, UpdateError };
