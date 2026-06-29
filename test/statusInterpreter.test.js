'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { interpret, decideStatus } = require('../src/main/statusInterpreter');
const { Status } = require('../src/main/messages');

const facts = (over = {}) => ({
  hasRemote: true,
  hasUpstream: true,
  localChangeCount: 0,
  ahead: 0,
  behind: 0,
  fetched: true,
  ...over,
});

test('decideStatus: no remote wins regardless of local changes', () => {
  assert.equal(decideStatus(facts({ hasRemote: false, localChangeCount: 3 })), Status.NO_REMOTE);
});

test('decideStatus: ahead and behind → needs upload AND download', () => {
  assert.equal(decideStatus(facts({ ahead: 2, behind: 1 })), Status.NEEDS_UPLOAD_AND_DOWNLOAD);
});

test('decideStatus: behind only → needs download', () => {
  assert.equal(decideStatus(facts({ behind: 4 })), Status.NEEDS_DOWNLOAD);
});

test('decideStatus: ahead only → needs upload', () => {
  assert.equal(decideStatus(facts({ ahead: 1 })), Status.NEEDS_UPLOAD);
});

test('decideStatus: only local file changes → local changes', () => {
  assert.equal(decideStatus(facts({ localChangeCount: 2 })), Status.LOCAL_CHANGES);
});

test('decideStatus: nothing pending → up to date', () => {
  assert.equal(decideStatus(facts()), Status.UP_TO_DATE);
});

test('interpret: up-to-date carries the friendly label + good tone', () => {
  const r = interpret(facts());
  assert.equal(r.status, Status.UP_TO_DATE);
  assert.equal(r.label, 'Up to date');
  assert.equal(r.tone, 'good');
  assert.match(r.explanation, /up to date/i);
});

test('interpret: conflicts are explained as needing a person', () => {
  const r = interpret(facts({ conflictedCount: 1, workingCount: 1 }));
  assert.match(r.explanation, /person/i);
});

test('simpleExplanation never leaks Git jargon', () => {
  const scenarios = [
    facts({ workingCount: 2 }),
    facts({ ahead: 1 }),
    facts({ behind: 2 }),
    facts({ ahead: 1, behind: 1, workingCount: 1 }),
    facts({ hasRemote: false, workingCount: 1 }),
    facts({ conflictedCount: 1 }),
    facts(),
  ];
  const jargon = /\b(commit|push|pull|stage|staged|branch|remote|upstream|HEAD|merge)\b/i;
  for (const f of scenarios) {
    const msg = interpret(f).simpleExplanation;
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
    assert.doesNotMatch(msg, jargon, `jargon leaked in: "${msg}"`);
  }
});
