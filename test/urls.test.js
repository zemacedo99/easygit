'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { toBrowserUrl, providerName } = require('../src/main/urls');

test('toBrowserUrl: scp-style SSH → https', () => {
  assert.equal(toBrowserUrl('git@github.com:user/repo.git'), 'https://github.com/user/repo');
});

test('toBrowserUrl: full ssh:// URL (nested path, with .git) → https', () => {
  assert.equal(toBrowserUrl('ssh://git@gitlab.com/group/sub/repo.git'), 'https://gitlab.com/group/sub/repo');
});

test('toBrowserUrl: ssh:// with port is stripped', () => {
  assert.equal(toBrowserUrl('ssh://git@example.com:2222/u/r.git'), 'https://example.com/u/r');
});

test('toBrowserUrl: https stays https and loses the .git suffix', () => {
  assert.equal(toBrowserUrl('https://github.com/user/repo.git'), 'https://github.com/user/repo');
});

test('toBrowserUrl: http is preserved (not forced to https)', () => {
  assert.equal(toBrowserUrl('http://host.local/u/r'), 'http://host.local/u/r');
});

test('toBrowserUrl: git:// protocol → https', () => {
  assert.equal(toBrowserUrl('git://github.com/user/repo.git'), 'https://github.com/user/repo');
});

test('toBrowserUrl: null / unknown shapes return null', () => {
  assert.equal(toBrowserUrl(null), null);
  assert.equal(toBrowserUrl(''), null);
  assert.equal(toBrowserUrl('not-a-url'), null);
});

test('providerName: well-known hosts', () => {
  assert.equal(providerName('git@github.com:u/r.git'), 'GitHub');
  assert.equal(providerName('https://gitlab.com/u/r.git'), 'GitLab');
  assert.equal(providerName('https://bitbucket.org/u/r.git'), 'Bitbucket');
  assert.equal(providerName('https://dev.azure.com/org/proj/_git/repo'), 'Azure DevOps');
});

test('providerName: generic host falls back to hostname; null stays null', () => {
  assert.equal(providerName('https://git.example.com/u/r.git'), 'git.example.com');
  assert.equal(providerName(null), null);
  assert.equal(providerName('garbage'), null);
});
