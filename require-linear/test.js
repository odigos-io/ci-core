'use strict';

// Run with: node --test require-linear/test.js

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const os       = require('node:os');
const path     = require('node:path');

const { decide, hasKey, loadKeys, shouldSkip } = require('./check');

// The action reads this file, so the tests should too — if a key is added there
// and the regex cannot cope, these fail rather than production.
const KEYS = loadKeys();

const base = { prTitle: 'RUN-1 | fix(x): thing', prBody: '', prBranch: 'x', keys: KEYS, enforce: 'true' };
const decideWith = (over) => decide({ ...base, ...over });

// loadKeys() reads a fixed path, so exercise its validation through a temp copy.
function loadKeysFrom(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
  fs.writeFileSync(path.join(dir, 'linear-team-keys'), contents);
  fs.mkdirSync(path.join(dir, 'require-linear'));
  fs.copyFileSync(path.join(__dirname, 'check.js'), path.join(dir, 'require-linear', 'check.js'));
  return require(path.join(dir, 'require-linear', 'check.js')).loadKeys();
}

// ---------------------------------------------------------------------------
// The rule: the PR title is the only thing that reaches the default branch
// ---------------------------------------------------------------------------

test('passes when the key is in the PR title', () => {
  assert.equal(decideWith({}).level, 'none');
});

test('fails when the key is only in the body', () => {
  const r = decideWith({ prTitle: 'fix(x): thing', prBody: 'Fixes RUN-1' });
  assert.equal(r.ok, false);
  assert.match(r.message, /in the PR body but not in the PR title/);
});

test('fails when the key is only in the branch name', () => {
  const r = decideWith({ prTitle: 'fix(x): thing', prBranch: 'run-1-thing' });
  assert.equal(r.ok, false);
  assert.match(r.message, /in the branch name but not in the PR title/);
});

test('fails with a plainer message when there is no key anywhere', () => {
  const r = decideWith({ prTitle: 'chore: bump', prBranch: 'deps/bump' });
  assert.equal(r.ok, false);
  assert.match(r.message, /No Linear issue reference in the PR title/);
});

test('the near-miss message suggests a corrected title', () => {
  const r = decideWith({ prTitle: 'fix(x): thing', prBranch: 'run-1-thing' });
  assert.match(r.message, /RUN-123 \| fix\(x\): thing/);
});

test('opting out downgrades the failure to a warning', () => {
  const r = decideWith({ prTitle: 'fix(x): thing', prBranch: 'run-1-thing', enforce: 'false' });
  assert.equal(r.ok, true);
  assert.equal(r.level, 'warning');
});

test('decide falls back to the shared file when no keys are seeded', () => {
  const { keys, ...noKeys } = base;
  assert.equal(decide({ ...noKeys }).level, 'none');
  assert.equal(decide({ ...noKeys, prTitle: 'chore: bump' }).ok, false);
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
// Key matching
// ---------------------------------------------------------------------------

test('every team key in linear-team-keys matches', () => {
  for (const key of KEYS) assert.ok(hasKey(`${key}-12 | fix: thing`, KEYS), `${key} should match`);
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
// Team keys come from the file, with no hardcoded fallback
// ---------------------------------------------------------------------------

test('a key that is not a bare uppercase token is rejected', () => {
  // An empty alternative would make \b(A||B)-[1-9] match things like "UTF-8",
  // passing every PR instead of failing it.
  assert.equal(hasKey('chore: bump to UTF-8', 'DEVOPS||RUN'), true, 'precondition: the empty alternative does match');
  assert.throws(() => loadKeysFrom('RUN\nDEVOPS||RUN'), /not uppercase team keys/);
  assert.throws(() => loadKeysFrom('run'), /not uppercase team keys/);
  assert.throws(() => loadKeysFrom('# only a comment'), /lists no team keys/);
});

test('blank lines and comments are ignored', () => {
  assert.deepEqual(loadKeysFrom('# a comment\n\nRUN\n  CORE  \n\n'), ['RUN', 'CORE']);
});

test('loadKeys reads the shared file as one key per line', () => {
  assert.ok(Array.isArray(KEYS) && KEYS.length > 1);
  assert.ok(KEYS.includes('RUN'));
});
