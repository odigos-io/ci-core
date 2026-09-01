'use strict';

// Run with: node --test require-linear/test.js

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const { decide, missingCarriers, hasKey, loadKeys, shouldSkip } = require('./check');

// loadKeys() reads a fixed path, so exercise its validation through a temp file.
const os = require('node:os');
function loadKeysFrom(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
  fs.writeFileSync(path.join(dir, 'linear-team-keys'), contents);
  fs.mkdirSync(path.join(dir, 'require-linear'));
  fs.copyFileSync(path.join(__dirname, 'check.js'), path.join(dir, 'require-linear', 'check.js'));
  return require(path.join(dir, 'require-linear', 'check.js')).loadKeys();
}

// The action reads this file, so the tests should too — if a key is added there
// and the regex cannot cope, these fail rather than production.
const KEYS = loadKeys();

const base = {
  prTitle: 'RUN-1 | fix(x): thing',
  prBody: '',
  prBranch: 'x',
  commitSubjects: ['RUN-1 | fix(x): thing'],
  keys: KEYS,
  enforce: 'true',
};

const decideWith = (over) => decide({ ...base, ...over });

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('fails when no key appears anywhere', () => {
  const r = decideWith({ prTitle: 'chore: bump', commitSubjects: ['chore: bump'], prBranch: 'deps/bump' });
  assert.equal(r.ok, false);
  assert.equal(r.level, 'error');
});

test('fails when the key is only in the body, since it will not survive', () => {
  const r = decideWith({ prTitle: 'fix: x', commitSubjects: ['fix: x'], prBody: 'Fixes RUN-1' });
  assert.equal(r.ok, false);
  assert.equal(r.level, 'error');
});

// ---------------------------------------------------------------------------
// What has to carry the key. Squash can use either the PR title or the commit
// subject, rebase uses only commits, merge preserves commits and the branch —
// and the merger picks at merge time, so both are required.
// ---------------------------------------------------------------------------

test('nothing missing when both the title and a commit carry it', () => {
  assert.deepEqual(missingCarriers({ prTitle: 'RUN-1 x', commitSubjects: ['RUN-1 x'] }, KEYS), []);
});

test('flags the PR title when only a commit carries it', () => {
  const m = missingCarriers({ prTitle: 'fix: x', commitSubjects: ['RUN-1 x'] }, KEYS);
  assert.equal(m.length, 1);
  assert.match(m[0], /PR title/);
});

test('flags the commits when only the title carries it — this is the rebase hole', () => {
  const m = missingCarriers({ prTitle: 'RUN-1 x', commitSubjects: ['wip', 'more wip'] }, KEYS);
  assert.equal(m.length, 1);
  assert.match(m[0], /commit subject/);
});

test('any one commit carrying it is enough, since rebase replays them all', () => {
  assert.deepEqual(
    missingCarriers({ prTitle: 'RUN-1 x', commitSubjects: ['wip', 'RUN-1 real', 'more'] }, KEYS),
    [],
  );
});

// ---------------------------------------------------------------------------
// The case this whole check exists for
// ---------------------------------------------------------------------------

test('single-commit PR with the key only in the PR title fails', () => {
  const r = decideWith({ commitSubjects: ['fix(x): thing'] });
  assert.equal(r.ok, false);
  assert.equal(r.level, 'error');
  assert.match(r.message, /missing from every commit subject/);
});

test('same case passes clean once the commit carries the key', () => {
  assert.equal(decideWith({}).level, 'none');
});

test('multi-commit PR is NOT fine on the PR title alone — rebase would drop it', () => {
  const r = decideWith({ commitSubjects: ['wip', 'wip2', 'wip3'] });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// Escape hatches
// ---------------------------------------------------------------------------

test('opting out downgrades the failure to a warning', () => {
  const r = decideWith({ commitSubjects: ['fix(x): thing'], enforce: 'false' });
  assert.equal(r.ok, true);
  assert.equal(r.level, 'warning');
});

test('an unreadable commit list degrades to a notice, never a failure', () => {
  const r = decideWith({ commitSubjects: undefined });
  assert.equal(r.ok, true);
  assert.equal(r.level, 'notice');
});

test('a branch-name-only key still fails, since the merge method is unknowable', () => {
  const r = decideWith({ prTitle: 'fix: x', commitSubjects: ['fix: x'], prBranch: 'run-1-x' });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// Key matching
// ---------------------------------------------------------------------------

test('every team key in linear-team-keys matches', () => {
  for (const key of KEYS) {
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

test('decide falls back to the shared file when no keys are seeded', () => {
  const { keys, ...noKeys } = base;
  assert.equal(decide({ ...noKeys, commitSubjects: ['fix(x): thing'] }).level, 'error');
  assert.equal(decide({ ...noKeys }).level, 'none');
});
