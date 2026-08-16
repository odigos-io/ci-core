'use strict';

// Run with: node --test semver-info/test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calculate } = require('./calculate');

function makeExecSync({ tags = [], branches = [] } = {}) {
  return (cmd, opts = {}) => {
    if (cmd === 'git tag -l') {
      return tags.join('\n');
    }
    if (cmd.includes('git ls-remote --heads origin')) {
      return branches
        .map((b) => {
          const name = b.startsWith('releases/') ? b : `releases/${b}`;
          return `abc123\trefs/heads/${name}`;
        })
        .join('\n');
    }
    throw new Error(`unexpected command: ${cmd} cwd=${opts.cwd}`);
  };
}

function calc(tags, branches) {
  return calculate({ execSync: makeExecSync({ tags, branches }) });
}

test('no tags and no branches → error', () => {
  assert.throws(() => calc([], []), { message: /no stable tags or release branches/ });
});

test('latest stable v1.21.4, no release branches, no pres → v1.22.0-pre0', () => {
  const r = calc(['v1.21.4', 'v1.21.3', 'v1.20.0']);
  assert.equal(r.latest_stable, 'v1.21.4');
  assert.equal(r.last_release_line, 'v1.21.0');
  assert.equal(r.last_release_branch, '');
  assert.equal(r.next_release, 'v1.22.0');
  assert.equal(r.next_pre, 'v1.22.0-pre0');
  assert.equal(r.latest_pre, '');
  assert.equal(r.has_pre, 'false');
  assert.equal(r.next_rc, 'v1.22.0-rc0');
  assert.equal(r.has_rc, 'false');
});

test('existing pres on next release → increment pre number', () => {
  const r = calc(['v1.21.4', 'v1.22.0-pre0', 'v1.22.0-pre2']);
  assert.equal(r.next_release, 'v1.22.0');
  assert.equal(r.latest_pre, 'v1.22.0-pre2');
  assert.equal(r.next_pre, 'v1.22.0-pre3');
  assert.equal(r.has_pre, 'true');
});

test('pre numbers increment numerically (pre9 → pre10)', () => {
  const r = calc(['v1.21.0', 'v1.22.0-pre9']);
  assert.equal(r.next_pre, 'v1.22.0-pre10');
});

test('unpublished release branch is last_release_line even without a stable tag', () => {
  const r = calc(['v1.21.4'], ['releases/v1.22.0']);
  assert.equal(r.latest_stable, 'v1.21.4');
  assert.equal(r.last_release_line, 'v1.22.0');
  assert.equal(r.last_release_branch, 'releases/v1.22.0');
  assert.equal(r.next_release, 'v1.23.0');
  assert.equal(r.next_pre, 'v1.23.0-pre0');
});

test('pres on the version after an unpublished release branch', () => {
  const r = calc(['v1.21.4', 'v1.23.0-pre1'], ['releases/v1.22.0']);
  assert.equal(r.last_release_line, 'v1.22.0');
  assert.equal(r.next_release, 'v1.23.0');
  assert.equal(r.latest_pre, 'v1.23.0-pre1');
  assert.equal(r.next_pre, 'v1.23.0-pre2');
});

test('highest of multiple release branches wins', () => {
  const r = calc(['v1.21.4'], ['releases/v1.21.0', 'releases/v1.22.0']);
  assert.equal(r.last_release_line, 'v1.22.0');
  assert.equal(r.last_release_branch, 'releases/v1.22.0');
  assert.equal(r.next_release, 'v1.23.0');
  assert.equal(r.next_pre, 'v1.23.0-pre0');
});

test('release branch older than latest stable does not go backwards', () => {
  const r = calc(['v1.21.4'], ['releases/v1.21.0']);
  assert.equal(r.last_release_line, 'v1.21.0');
  assert.equal(r.next_release, 'v1.22.0');
  assert.equal(r.next_pre, 'v1.22.0-pre0');
});

test('module tags and unrelated tags are ignored', () => {
  const r = calc(['v1.21.4', 'common/v1.21.4', 'v1.22.0-beta1', 'v1.22.0-prefoo']);
  assert.equal(r.latest_stable, 'v1.21.4');
  assert.equal(r.next_pre, 'v1.22.0-pre0');
});

test('existing rc tags on next_release are reported', () => {
  const r = calc(['v1.21.4', 'v1.22.0-rc0', 'v1.22.0-rc1']);
  assert.equal(r.next_rc, 'v1.22.0-rc2');
  assert.equal(r.latest_rc, 'v1.22.0-rc1');
  assert.equal(r.has_rc, 'true');
  assert.equal(r.next_pre, 'v1.22.0-pre0');
});

test('no stable tags, only a release branch', () => {
  const r = calc([], ['releases/v1.22.0']);
  assert.equal(r.latest_stable, '');
  assert.equal(r.last_release_line, 'v1.22.0');
  assert.equal(r.next_release, 'v1.23.0');
  assert.equal(r.next_pre, 'v1.23.0-pre0');
});

test('git commands run in DIRECTORY', () => {
  const seen = [];
  const execSync = (cmd, opts = {}) => {
    seen.push(opts.cwd);
    return makeExecSync({ tags: ['v1.21.4'] })(cmd, opts);
  };
  calculate({ execSync, env: { DIRECTORY: '/tmp/odigos' } });
  assert.ok(seen.length > 0);
  assert.ok(seen.every((cwd) => cwd === '/tmp/odigos'));
});
