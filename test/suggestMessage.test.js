'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { suggestCommitMessage, categorize, prettyName } = require('../src/main/suggestMessage');

test('categorize: buckets files by name/extension/folder', () => {
  assert.equal(categorize('README.md'), 'docs');
  assert.equal(categorize('src/renderer/styles.css'), 'ui');
  assert.equal(categorize('package.json'), 'config');
  assert.equal(categorize('assets/logo.png'), 'assets');
  assert.equal(categorize('test/foo.test.js'), 'tests');
  assert.equal(categorize('src/main/scanner.js'), 'scan');
});

test('prettyName: humanises a path', () => {
  assert.equal(prettyName('app/LoginScreen.js'), 'login screen');
  assert.equal(prettyName('src/user_profile.ts'), 'user profile');
});

test('single file: specific message when the name is meaningful', () => {
  assert.equal(suggestCommitMessage([{ path: 'app/models/client.js', type: 'added' }]), 'Add client');
});

test('single file: generic core file falls back to a broad message', () => {
  assert.equal(suggestCommitMessage([{ path: 'src/renderer/ui.js' }]), 'Improve user interface');
});

test('single file: category-led messages', () => {
  assert.equal(suggestCommitMessage([{ path: 'README.md' }]), 'Update documentation');
  assert.equal(suggestCommitMessage([{ path: 'src/main/scanner.js' }]), 'Improve repository discovery');
});

test('multiple files: config + docs combine sensibly', () => {
  assert.equal(
    suggestCommitMessage([{ path: 'package.json' }, { path: 'README.md' }]),
    'Update project settings and documentation'
  );
});

test('empty input is safe', () => {
  assert.equal(suggestCommitMessage([]), 'Update project files');
  assert.equal(suggestCommitMessage(null), 'Update project files');
});
