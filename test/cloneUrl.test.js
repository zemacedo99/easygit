'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { suggestFolderName, sanitizeFolderName, isProbablyGitUrl } = require('../src/main/urls');
const { friendlyCloneError } = require('../src/main/messages');
const { GitErrorCode } = require('../src/main/gitService');

test('suggestFolderName: HTTPS URL → repo name', () => {
  assert.equal(suggestFolderName('https://git.example.com/users/someone/repos/easygit.git'), 'easygit');
});

test('suggestFolderName: scp-style SSH → repo name', () => {
  assert.equal(suggestFolderName('git@git.example.com:users/someone/repos/easygit.git'), 'easygit');
});

test('suggestFolderName: ssh:// URL → repo name', () => {
  assert.equal(suggestFolderName('ssh://git@host/team/project.git'), 'project');
});

test('suggestFolderName: trailing slash and query are ignored', () => {
  assert.equal(suggestFolderName('https://host/a/b/'), 'b');
  assert.equal(suggestFolderName('https://host/a/repo.git?ref=main'), 'repo');
});

test('suggestFolderName: empty / junk falls back to new-project', () => {
  assert.equal(suggestFolderName(''), 'new-project');
  assert.equal(suggestFolderName(null), 'new-project');
});

test('sanitizeFolderName: strips Windows-forbidden characters', () => {
  assert.equal(sanitizeFolderName('my:proj*name?'), 'myprojname');
  assert.equal(sanitizeFolderName('a/b\\c'), 'abc');
});

test('sanitizeFolderName: trims trailing dot/space and empties junk', () => {
  assert.equal(sanitizeFolderName('  hello .  '), 'hello');
  assert.equal(sanitizeFolderName('   '), '');
});

test('sanitizeFolderName: avoids reserved Windows device names', () => {
  assert.equal(sanitizeFolderName('con'), 'con-project');
  assert.equal(sanitizeFolderName('COM1'), 'COM1-project');
});

test('isProbablyGitUrl: accepts common link shapes', () => {
  assert.ok(isProbablyGitUrl('https://host/u/r.git'));
  assert.ok(isProbablyGitUrl('http://host/u/r'));
  assert.ok(isProbablyGitUrl('ssh://git@host/u/r.git'));
  assert.ok(isProbablyGitUrl('git@host:u/r.git'));
});

test('isProbablyGitUrl: rejects empty / non-links', () => {
  assert.equal(isProbablyGitUrl(''), false);
  assert.equal(isProbablyGitUrl(null), false);
  assert.equal(isProbablyGitUrl('just some text'), false);
  assert.equal(isProbablyGitUrl('easygit'), false);
});

test('friendlyCloneError: friendly, actionable, no raw jargon or secrets', () => {
  const cases = [GitErrorCode.AUTH_FAILED, GitErrorCode.NETWORK_UNAVAILABLE, GitErrorCode.TIMEOUT, GitErrorCode.UNKNOWN, 'NOT_A_REAL_CODE'];
  for (const code of cases) {
    const r = friendlyCloneError(code);
    assert.equal(typeof r.title, 'string');
    assert.ok(r.title.length > 0);
    assert.ok(r.detail.length > 0);
    assert.doesNotMatch(r.detail, /\b(fatal|stderr|remote:|publickey)\b/i);
  }
  assert.match(friendlyCloneError(GitErrorCode.AUTH_FAILED).detail, /sign|access/i);
  assert.match(friendlyCloneError(GitErrorCode.NETWORK_UNAVAILABLE).detail, /connection|reach/i);
});
