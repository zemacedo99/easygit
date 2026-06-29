'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { normalizePath, IGNORED_DIR_NAMES } = require('../src/main/scanner');

test('normalizePath: trailing separators are removed', () => {
  assert.equal(normalizePath('/a/b/c/'), normalizePath('/a/b/c'));
  assert.equal(normalizePath('/a/b/c///'), normalizePath('/a/b/c'));
});

test('normalizePath: result is lower-cased (case-insensitive matching)', () => {
  assert.equal(normalizePath('/Foo/Bar'), normalizePath('/foo/bar'));
});

test('normalizePath: equivalent relative/absolute forms resolve equal', () => {
  const abs = path.resolve('some/dir');
  assert.equal(normalizePath('some/dir'), normalizePath(abs));
});

test('IGNORED_DIR_NAMES: heavy/noise folders are skipped', () => {
  assert.ok(IGNORED_DIR_NAMES.has('node_modules'));
  assert.ok(IGNORED_DIR_NAMES.has('.git'));
});
