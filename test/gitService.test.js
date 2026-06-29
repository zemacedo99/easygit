'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classifyError, GitErrorCode } = require('../src/main/gitService');

test('classifyError: not-a-repo', () => {
  assert.equal(classifyError('fatal: not a git repository (or any parent)'), GitErrorCode.NOT_A_REPO);
});

test('classifyError: authentication failures', () => {
  assert.equal(classifyError('remote: Authentication failed for ...'), GitErrorCode.AUTH_FAILED);
  assert.equal(classifyError('git@host: Permission denied (publickey).'), GitErrorCode.AUTH_FAILED);
});

test('classifyError: network problems', () => {
  assert.equal(classifyError('fatal: Could not resolve host: github.com'), GitErrorCode.NETWORK_UNAVAILABLE);
  assert.equal(classifyError('ssh: connect to host ... Connection timed out'), GitErrorCode.NETWORK_UNAVAILABLE);
});

test('classifyError: missing upstream', () => {
  assert.equal(
    classifyError('There is no tracking information for the current branch.'),
    GitErrorCode.NO_UPSTREAM
  );
});

test('classifyError: merge/pull conflict', () => {
  assert.equal(classifyError('CONFLICT (content): Merge conflict in file.txt'), GitErrorCode.PULL_CONFLICT);
});

test('classifyError: push rejected only when the command is a push', () => {
  assert.equal(
    classifyError('! [rejected] main -> main (non-fast-forward)', ['push']),
    GitErrorCode.PUSH_REJECTED
  );
  // Same text, but not a push command → not classified as push-rejected.
  assert.notEqual(classifyError('rejected non-fast-forward', ['status']), GitErrorCode.PUSH_REJECTED);
});

test('classifyError: unknown text falls back to UNKNOWN', () => {
  assert.equal(classifyError('something totally unexpected'), GitErrorCode.UNKNOWN);
  assert.equal(classifyError(''), GitErrorCode.UNKNOWN);
});
