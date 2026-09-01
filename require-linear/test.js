'use strict';

// Run with: node --test require-linear/test.js

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const { decide, predictSubject, hasKey, loadKeys, shouldSkip } = require('./check');

// The action defaults to this file, so the tests should too — if a key is added
// there and the regex cannot cope, these fail rather than production.
const KEYS = fs
  .readFileSync(path.join(__dirname, '..', 'linear-team-keys'), 'utf8')
  .trim();

const base = {
  prTitle: 'RUN-1 | fix(x): thing',
  prBody: '',
  prBranch: 'x',
  squashTitle: 'COMMIT_OR_PR_TITLE',
  allowsMerge: false,   // the API returns a JSON boolean
  nCommits: '1',
  firstSubject: 'RUN-1 | fix(x): thing',
  keys: KEYS,
  enforce: 'true',
};

const decideWith = (over) => decide({ ...base, ...over });

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('fails when no key appears anywhere', () => {
  const r = decideWith({ prTitle: 'chore: bump', firstSubject: 'chore: bump', prBranch: 'deps/bump' });
  assert.equal(r.ok, false);
  assert.equal(r.level, 'error');
});

test('fails when the key is only in the body, since it will not survive', () => {
  const r = decideWith({ prTitle: 'fix: x', firstSubject: 'fix: x', prBody: 'Fixes RUN-1' });
  assert.equal(r.ok, false);
  assert.equal(r.level, 'error');
});

// ---------------------------------------------------------------------------
// Which subject the merge produces
// ---------------------------------------------------------------------------

test('PR_TITLE repos always use the PR title', () => {
  assert.equal(predictSubject({ squashTitle: 'PR_TITLE', prTitle: 'a', firstSubject: 'b', nCommits: '1' }).subject, 'a');
  assert.equal(predictSubject({ squashTitle: 'PR_TITLE', prTitle: 'a', firstSubject: 'b', nCommits: '5' }).subject, 'a');
});

test('COMMIT_OR_PR_TITLE uses the commit title only on a single-commit PR', () => {
  assert.equal(predictSubject({ squashTitle: 'COMMIT_OR_PR_TITLE', prTitle: 'a', firstSubject: 'b', nCommits: '1' }).subject, 'b');
  assert.equal(predictSubject({ squashTitle: 'COMMIT_OR_PR_TITLE', prTitle: 'a', firstSubject: 'b', nCommits: '2' }).subject, 'a');
});

// ---------------------------------------------------------------------------
// The case this whole check exists for
// ---------------------------------------------------------------------------

test('single-commit PR with the key only in the PR title fails', () => {
  const r = decideWith({ firstSubject: 'fix(x): thing' });
  assert.equal(r.ok, false);
  assert.equal(r.level, 'error');
  assert.match(r.message, /would NOT reach the merge commit subject/);
});

test('same case passes clean once the commit carries the key', () => {
  assert.equal(decideWith({}).level, 'none');
});

test('multi-commit PR is fine on the PR title alone', () => {
  assert.equal(decideWith({ nCommits: '3', firstSubject: 'wip' }).level, 'none');
});

// ---------------------------------------------------------------------------
// Escape hatches
// ---------------------------------------------------------------------------

test('accepts allowsMerge as a string too, in case a caller passes one', () => {
  const r = decideWith({ prTitle: 'fix: x', firstSubject: 'fix: x', prBranch: 'run-1-x', allowsMerge: 'true' });
  assert.equal(r.level, 'notice');
});

test('a merge-commit repo is saved by the branch name', () => {
  const r = decideWith({ prTitle: 'fix: x', firstSubject: 'fix: x', prBranch: 'run-1-x', allowsMerge: true });
  assert.equal(r.ok, true);
  assert.equal(r.level, 'notice');
});

test('opting out downgrades the failure to a warning', () => {
  const r = decideWith({ firstSubject: 'fix(x): thing', enforce: 'false' });
  assert.equal(r.ok, true);
  assert.equal(r.level, 'warning');
});

test('unknown merge settings degrade to a notice, never a failure', () => {
  const r = decideWith({ squashTitle: '', firstSubject: 'fix(x): thing' });
  assert.equal(r.ok, true);
  assert.equal(r.level, 'notice');
});

// ---------------------------------------------------------------------------
// Key matching
// ---------------------------------------------------------------------------

test('every team key in linear-team-keys matches', () => {
  for (const key of KEYS.split('|')) {
    assert.ok(hasKey(`${key}-12 | fix: thing`, KEYS), `${key} should match`);
  }
});

test('does not match a key embedded in a longer word', () => {
  assert.equal(hasKey('fix: FOORUN-12 handling', KEYS), false);
});

test('does not match a zero or zero-padded issue number', () => {
  assert.equal(hasKey('fix: RUN-0', KEYS), false);
  assert.equal(hasKey('fix: RUN-007', KEYS), false);
});

test('does not match unrelated hyphenated tokens', () => {
  assert.equal(hasKey('chore: bump to UTF-8', KEYS), false);
  assert.equal(hasKey('fix: patch CVE-2024-1234', KEYS), false);
});

test('matches the trailing-parenthesis form we use', () => {
  assert.ok(hasKey('ci(release): export current_version (RUN-1088)', KEYS));
});

// ---------------------------------------------------------------------------
// When the check does not run at all
// ---------------------------------------------------------------------------

test('skips merge_group, which carries no pull request payload', () => {
  assert.match(shouldSkip({ eventName: 'merge_group' }), /carries no pull request/);
});

test('runs on pull_request and pull_request_target', () => {
  assert.equal(shouldSkip({ eventName: 'pull_request', userLogin: 'a', userType: 'User' }), null);
  assert.equal(shouldSkip({ eventName: 'pull_request_target', userLogin: 'a', userType: 'User' }), null);
});

test('skips any Bot-type author, and the named bot accounts', () => {
  assert.match(shouldSkip({ eventName: 'pull_request', userLogin: 'x[bot]', userType: 'Bot' }), /bot user/);
  assert.match(shouldSkip({ eventName: 'pull_request', userLogin: 'keyval-release-bot', userType: 'User' }), /keyval-release-bot/);
});

// ---------------------------------------------------------------------------
// Team keys come from the file, with no hardcoded fallback
// ---------------------------------------------------------------------------

test('loadKeys reads the shared file', () => {
  assert.equal(loadKeys(), KEYS);
  assert.ok(KEYS.includes('|'), 'expected a pipe-separated list');
});

test('decide falls back to the shared file when no keys are seeded', () => {
  const { keys, ...noKeys } = base;
  assert.equal(decide({ ...noKeys, firstSubject: 'fix(x): thing' }).level, 'error');
  assert.equal(decide({ ...noKeys }).level, 'none');
});
