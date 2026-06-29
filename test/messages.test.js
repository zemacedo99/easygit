'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Status, STATUS_INFO, friendlyError } = require('../src/main/messages');
const { GitErrorCode } = require('../src/main/gitService');

test('STATUS_INFO has a complete entry for every Status', () => {
  for (const code of Object.values(Status)) {
    const info = STATUS_INFO[code];
    assert.ok(info, `missing STATUS_INFO for ${code}`);
    assert.equal(typeof info.label, 'string');
    assert.ok(info.label.length > 0);
    assert.equal(typeof info.tone, 'string');
    assert.equal(typeof info.short, 'string');
  }
});

test('friendlyError returns a usable title + detail for every error code', () => {
  for (const code of Object.values(GitErrorCode)) {
    const r = friendlyError(code);
    assert.equal(typeof r.title, 'string');
    assert.ok(r.title.length > 0, `empty title for ${code}`);
    assert.equal(typeof r.detail, 'string');
    assert.ok(r.detail.length > 0, `empty detail for ${code}`);
  }
});

test('friendlyError: git-not-installed points the user to git-scm.com', () => {
  const r = friendlyError(GitErrorCode.GIT_NOT_INSTALLED);
  assert.match(r.detail, /git-scm\.com/i);
});

test('friendlyError: unknown code falls back, preferring raw detail when given', () => {
  assert.match(friendlyError('NOT_A_REAL_CODE').title, /something went wrong/i);
  assert.equal(friendlyError(GitErrorCode.UNKNOWN, 'raw git text').detail, 'raw git text');
});

test('friendlyError: auth failure never exposes raw Git jargon in the title', () => {
  const r = friendlyError(GitErrorCode.AUTH_FAILED);
  assert.doesNotMatch(r.title, /\b(fatal|stderr|publickey)\b/i);
});
