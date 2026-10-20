// Generate versions/vX.Y.Z/update.json — what the in-app updater reads.
//
//   node scripts/make-update-metadata.mjs            (uses package.json version)
//   node scripts/make-update-metadata.mjs 1.4.0
//
// Run it AFTER copying the installer + portable into versions/vX.Y.Z/ and writing
// SHA256SUMS.txt (see docs/RELEASE_PROCESS.md). It hashes the real files, checks
// they match SHA256SUMS.txt, adds the release's "What's new" from
// src/renderer/changelog.mjs, and validates the result exactly like EasyGit will.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { validateMetadata, compareVersions } = require('../src/main/updateCore.js');

/** The first release that can update itself (older releases have no update.json). */
export const FIRST_SELF_UPDATING = '1.4.0';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * Build (and validate) update.json for a release folder.
 * @returns {object} the metadata
 */
export function buildMetadata({ dir, version, changelog }) {
  const files = { installer: `EasyGit Setup ${version}.exe`, portable: `EasyGit-${version}-portable.exe` };
  const sumsFile = path.join(dir, 'SHA256SUMS.txt');
  if (!fs.existsSync(sumsFile)) throw new Error(`Missing ${sumsFile}`);
  const sums = new Map(
    fs.readFileSync(sumsFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(l.trim());
      if (!m) throw new Error(`Bad line in SHA256SUMS.txt: ${l}`);
      return [m[2], m[1].toLowerCase()];
    })
  );
  const artifact = (name) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
    const hash = sha256(file);
    if (sums.get(name) !== hash) throw new Error(`${name} does not match SHA256SUMS.txt`);
    return { file: name, size: fs.statSync(file).size, sha256: hash };
  };
  if (!changelog || changelog.version !== version) throw new Error(`Add v${version} to src/renderer/changelog.mjs first`);
  const metadata = {
    schema: 1,
    version,
    date: changelog.date,
    installer: artifact(files.installer),
    portable: artifact(files.portable),
    changelog,
  };
  const check = validateMetadata(metadata, version);
  if (!check.ok) throw new Error(`Invalid update metadata: ${check.reason}`);
  return metadata;
}

/** Released folders are immutable: refuse pre-updater versions and already-tagged ones. */
function assertWritable(version) {
  if (compareVersions(version, FIRST_SELF_UPDATING) < 0) {
    throw new Error(`v${version} was released before in-app updates (first: v${FIRST_SELF_UPDATING}); old releases are never changed`);
  }
  const tagged = execFileSync('git', ['tag', '--list', `v${version}`], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  if (tagged) throw new Error(`v${version} is already tagged (released); its folder must not change`);
}

async function main() {
  const version = process.argv[2] || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  assertWritable(version);
  const { CHANGELOG } = await import(pathToFileURL(path.join(root, 'src', 'renderer', 'changelog.mjs')).href);
  const dir = path.join(root, 'versions', `v${version}`);
  const metadata = buildMetadata({ dir, version, changelog: CHANGELOG.find((r) => r.version === version) });
  fs.writeFileSync(path.join(dir, 'update.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Wrote versions/v${version}/update.json`);
  console.log(`  installer ${metadata.installer.sha256}  ${metadata.installer.size} bytes`);
  console.log(`  portable  ${metadata.portable.sha256}  ${metadata.portable.size} bytes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`make-update-metadata: ${e.message}`);
    process.exit(1);
  });
}
