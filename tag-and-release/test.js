'use strict';

// Run with: node --test tag-and-release/test.js

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { calculate } = require('./calculate');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a mock execSync that answers git tag queries from a flat tag list.
 *
 * - "git tag --merged HEAD ..."  → mergedTags (tags reachable from HEAD, i.e.
 *                                   stable + pre tags visible on current branch)
 * - "git tag --list 'v[0-9]*'"  → allTags filtered to stable only
 * - "git tag --list 'vMAJ.MIN.0-*'" → allTags filtered to that series' pre-releases
 * - "git rev-parse <tag>"        → succeeds iff tag is in existingTags
 *
 * @param {string[]} allTags      - all tags in the repo (stable + pre)
 * @param {string[]} [mergedTags] - tags reachable from HEAD (defaults to allTags)
 * @param {string[]} [existingTags] - tags that exist for rev-parse (defaults to allTags)
 */
function makeExecSync(allTags, mergedTags = allTags, existingTags = allTags) {
  return (cmd, opts = {}) => {
    if (opts.stdio === 'ignore') {
      // tagExists() call: git rev-parse "<tag>"
      const m = cmd.match(/"([^"]+)"/);
      const tag = m ? m[1] : '';
      if (existingTags.includes(tag)) return '';
      throw Object.assign(new Error('not found'), { status: 128 });
    }

    if (cmd.includes('--merged HEAD')) {
      return mergedTags.join('\n');
    }

    // git tag --list 'vMAJ.MIN.0-*'
    const preMatch = cmd.match(/git tag --list 'v(\d+)\.(\d+)\.0-\*'/);
    if (preMatch) {
      const maj = parseInt(preMatch[1], 10);
      const min = parseInt(preMatch[2], 10);
      return allTags
        .filter((t) => t.startsWith(`v${maj}.${min}.0-`))
        .join('\n');
    }

    // git tag --list 'v[0-9]*'  (getAllStableTags)
    if (cmd.includes("--list 'v[0-9]*'")) {
      return allTags.join('\n');
    }

    return '';
  };
}

/** Shorthand: run calculate with a tag set and env overrides. */
function calc(tags, env, mergedTags) {
  return calculate({
    execSync: makeExecSync(tags, mergedTags ?? tags),
    env: { BUMP: 'minor', BASE_BRANCH: 'main', ...env },
  });
}

// ---------------------------------------------------------------------------
// pre-major lifecycle
// ---------------------------------------------------------------------------

test('pre-major first run → v2.0.0-pre.0, creates branch', () => {
  const r = calc(['v1.2.3'], { BUMP: 'pre-major' });
  assert.equal(r.newVersion,    'v2.0.0-pre.0');
  assert.equal(r.createBranch, true);
  assert.equal(r.releaseBranch, 'releases/v2.0.x');
});

test('pre on pre (major) → increments pre number', () => {
  // v2.0.0-pre.0 exists on the release branch (NOT reachable from main)
  const allTags    = ['v1.2.3', 'v2.0.0-pre.0'];
  const mergedTags = ['v1.2.3'];                  // only stable reachable from main
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'pre-major', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v2.0.0-pre.1');
  assert.equal(r.currentVersion, 'v2.0.0-pre.0');
  assert.equal(r.createBranch, false);
});

test('rc on pre (major) → promotes to rc.0', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-pre.1'];
  const mergedTags = ['v1.2.3'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'rc-major', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v2.0.0-rc.0');
  assert.equal(r.currentVersion, 'v2.0.0-pre.1');
  assert.equal(r.createBranch, false);
});

test('rc on rc (major) → increments rc number', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-pre.0', 'v2.0.0-rc.0'];
  const mergedTags = ['v1.2.3'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'rc-major', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v2.0.0-rc.1');
  assert.equal(r.currentVersion, 'v2.0.0-rc.0');
  assert.equal(r.createBranch, false);
});

test('promote pre to stable (major) → v2.0.0, no new branch', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-pre.2'];
  const mergedTags = ['v1.2.3'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'major', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v2.0.0');
  assert.equal(r.currentVersion, 'v2.0.0-pre.2');
  assert.equal(r.createBranch, false);
});

test('promote rc to stable (major) → v2.0.0, picks latest of pre+rc', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-pre.0', 'v2.0.0-rc.1'];
  const mergedTags = ['v1.2.3'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'major', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v2.0.0');
  assert.equal(r.currentVersion, 'v2.0.0-rc.1');
  assert.equal(r.createBranch, false);
});

test('pre-major after rc → error (cannot go back)', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-rc.0'];
  const mergedTags = ['v1.2.3'];
  assert.throws(
    () => calculate({
      execSync: makeExecSync(allTags, mergedTags),
      env: { BUMP: 'pre-major', BASE_BRANCH: 'main' },
    }),
    /cannot follow an rc/,
  );
});

// ---------------------------------------------------------------------------
// pre-minor lifecycle
// ---------------------------------------------------------------------------

test('pre-minor first run → v1.3.0-pre.0, creates branch', () => {
  const r = calc(['v1.2.3'], { BUMP: 'pre-minor' });
  assert.equal(r.newVersion,    'v1.3.0-pre.0');
  assert.equal(r.createBranch, true);
  assert.equal(r.releaseBranch, 'releases/v1.3.x');
});

test('pre on pre (minor) → increments pre number', () => {
  const allTags    = ['v1.2.3', 'v1.3.0-pre.0'];
  const mergedTags = ['v1.2.3'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'pre-minor', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v1.3.0-pre.1');
  assert.equal(r.currentVersion, 'v1.3.0-pre.0');
  assert.equal(r.createBranch, false);
});

test('rc on pre (minor) → promotes to rc.0', () => {
  const allTags    = ['v1.2.3', 'v1.3.0-pre.1'];
  const mergedTags = ['v1.2.3'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'rc-minor', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v1.3.0-rc.0');
  assert.equal(r.currentVersion, 'v1.3.0-pre.1');
  assert.equal(r.createBranch, false);
});

test('rc on rc (minor) → increments rc number', () => {
  const allTags    = ['v1.2.3', 'v1.3.0-pre.0', 'v1.3.0-rc.2'];
  const mergedTags = ['v1.2.3'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'rc-minor', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v1.3.0-rc.3');
  assert.equal(r.currentVersion, 'v1.3.0-rc.2');
  assert.equal(r.createBranch, false);
});

test('promote pre to stable (minor) → v1.3.0', () => {
  const allTags    = ['v1.2.3', 'v1.3.0-pre.2'];
  const mergedTags = ['v1.2.3'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'minor', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v1.3.0');
  assert.equal(r.currentVersion, 'v1.3.0-pre.2');
  assert.equal(r.createBranch, false);
});

test('promote rc to stable (minor) → v1.3.0', () => {
  const allTags    = ['v1.2.3', 'v1.3.0-pre.0', 'v1.3.0-rc.1'];
  const mergedTags = ['v1.2.3'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'minor', BASE_BRANCH: 'main' },
  });
  assert.equal(r.newVersion,    'v1.3.0');
  assert.equal(r.currentVersion, 'v1.3.0-rc.1');
  assert.equal(r.createBranch, false);
});

test('pre-minor after rc → error (cannot go back)', () => {
  const allTags    = ['v1.2.3', 'v1.3.0-rc.0'];
  const mergedTags = ['v1.2.3'];
  assert.throws(
    () => calculate({
      execSync: makeExecSync(allTags, mergedTags),
      env: { BUMP: 'pre-minor', BASE_BRANCH: 'main' },
    }),
    /cannot follow an rc/,
  );
});

// ---------------------------------------------------------------------------
// rc-minor / rc-major first run (no prior pre) → creates branch
// ---------------------------------------------------------------------------

test('rc-minor first run (no prior pre) → v1.3.0-rc.0, creates branch', () => {
  const r = calc(['v1.2.3'], { BUMP: 'rc-minor' });
  assert.equal(r.newVersion,    'v1.3.0-rc.0');
  assert.equal(r.createBranch, true);
});

test('rc-major first run (no prior pre) → v2.0.0-rc.0, creates branch', () => {
  const r = calc(['v1.2.3'], { BUMP: 'rc-major' });
  assert.equal(r.newVersion,    'v2.0.0-rc.0');
  assert.equal(r.createBranch, true);
});

// ---------------------------------------------------------------------------
// patch on release branch
// ---------------------------------------------------------------------------

test('patch on release branch (stable) → normal increment', () => {
  // On releases/v1.3.x with v1.3.0 stable already tagged and reachable
  const allTags    = ['v1.2.3', 'v1.3.0'];
  const mergedTags = ['v1.2.3', 'v1.3.0'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'patch', BASE_BRANCH: 'releases/v1.3.x' },
  });
  assert.equal(r.newVersion, 'v1.3.1');
});

test('patch on release branch scopes to branch, ignores globally higher tags', () => {
  // Repo has v0.0.14 on releases/v0.0.x and v0.1.0, v0.2.0, v0.3.0 on other
  // branches. Only v0.0.14 is reachable from HEAD (releases/v0.0.x).
  // The calculate step must produce v0.0.15, NOT v0.3.1.
  const allTags    = ['v0.0.14', 'v0.1.0', 'v0.2.0', 'v0.3.0'];
  const mergedTags = ['v0.0.14'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'patch', BASE_BRANCH: 'releases/v0.0.x' },
  });
  assert.equal(r.currentVersion, 'v0.0.14');
  assert.equal(r.newVersion,     'v0.0.15');
});

test('patch on release branch (pre only, no stable base) → promotes to stable', () => {
  // releases/v1.3.x has v1.3.0-pre.1 but v1.3.0 stable not yet released
  const allTags    = ['v1.2.3', 'v1.3.0-pre.1'];
  const mergedTags = ['v1.2.3', 'v1.3.0-pre.1'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'patch', BASE_BRANCH: 'releases/v1.3.x' },
  });
  assert.equal(r.newVersion,    'v1.3.0');
  assert.equal(r.currentVersion, 'v1.3.0-pre.1');
});

test('patch on release branch (rc only, no stable base) → promotes rc to stable', () => {
  const allTags    = ['v1.2.3', 'v1.3.0-rc.0'];
  const mergedTags = ['v1.2.3', 'v1.3.0-rc.0'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'patch', BASE_BRANCH: 'releases/v1.3.x' },
  });
  assert.equal(r.newVersion,    'v1.3.0');
  assert.equal(r.currentVersion, 'v1.3.0-rc.0');
});

// ---------------------------------------------------------------------------
// pre-major / rc-major from release branch (second+ iteration)
// ---------------------------------------------------------------------------

test('pre on pre (major) from release branch → increments pre number', () => {
  // Running pre-major from releases/v2.0.x — pre.0 is on the release branch begin commit
  const allTags    = ['v1.2.3', 'v2.0.0-pre.0'];
  const mergedTags = ['v1.2.3', 'v2.0.0-pre.0'];  // reachable from releases/v2.0.x HEAD
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'pre-major', BASE_BRANCH: 'releases/v2.0.x' },
  });
  assert.equal(r.newVersion,    'v2.0.0-pre.1');
  assert.equal(r.currentVersion, 'v2.0.0-pre.0');
  assert.equal(r.createBranch, false);
});

test('rc on pre (major) from release branch → promotes to rc.0', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-pre.1'];
  const mergedTags = ['v1.2.3', 'v2.0.0-pre.1'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'rc-major', BASE_BRANCH: 'releases/v2.0.x' },
  });
  assert.equal(r.newVersion,    'v2.0.0-rc.0');
  assert.equal(r.currentVersion, 'v2.0.0-pre.1');
  assert.equal(r.createBranch, false);
});

test('rc on rc (major) from release branch → increments rc number', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-pre.0', 'v2.0.0-rc.0'];
  const mergedTags = ['v1.2.3', 'v2.0.0-pre.0', 'v2.0.0-rc.0'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'rc-major', BASE_BRANCH: 'releases/v2.0.x' },
  });
  assert.equal(r.newVersion,    'v2.0.0-rc.1');
  assert.equal(r.currentVersion, 'v2.0.0-rc.0');
  assert.equal(r.createBranch, false);
});

test('pre-major after rc from release branch → error (cannot go back)', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-rc.0'];
  const mergedTags = ['v1.2.3', 'v2.0.0-rc.0'];
  assert.throws(
    () => calculate({
      execSync: makeExecSync(allTags, mergedTags),
      env: { BUMP: 'pre-major', BASE_BRANCH: 'releases/v2.0.x' },
    }),
    /cannot follow an rc/,
  );
});

// ---------------------------------------------------------------------------
// Promoting to stable from release branch (tag lands on release branch HEAD)
// ---------------------------------------------------------------------------

test('major from release branch with existing pre → v2.0.0, no new branch', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-pre.2'];
  const mergedTags = ['v1.2.3', 'v2.0.0-pre.2'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'major', BASE_BRANCH: 'releases/v2.0.x' },
  });
  assert.equal(r.newVersion,    'v2.0.0');
  assert.equal(r.currentVersion, 'v2.0.0-pre.2');
  assert.equal(r.createBranch, false);
});

test('major from release branch with existing rc → v2.0.0, no new branch', () => {
  const allTags    = ['v1.2.3', 'v2.0.0-pre.0', 'v2.0.0-rc.2'];
  const mergedTags = ['v1.2.3', 'v2.0.0-pre.0', 'v2.0.0-rc.2'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'major', BASE_BRANCH: 'releases/v2.0.x' },
  });
  assert.equal(r.newVersion,    'v2.0.0');
  assert.equal(r.currentVersion, 'v2.0.0-rc.2');
  assert.equal(r.createBranch, false);
});

test('minor from release branch with existing rc → v1.3.0, no new branch', () => {
  const allTags    = ['v1.2.3', 'v1.3.0-pre.0', 'v1.3.0-rc.1'];
  const mergedTags = ['v1.2.3', 'v1.3.0-pre.0', 'v1.3.0-rc.1'];
  const r = calculate({
    execSync: makeExecSync(allTags, mergedTags),
    env: { BUMP: 'minor', BASE_BRANCH: 'releases/v1.3.x' },
  });
  assert.equal(r.newVersion,    'v1.3.0');
  assert.equal(r.currentVersion, 'v1.3.0-rc.1');
  assert.equal(r.createBranch, false);
});

// ---------------------------------------------------------------------------
// No tags → v0.0.0 baseline
// ---------------------------------------------------------------------------

test('no tags, minor → v0.1.0', () => {
  const r = calc([], { BUMP: 'minor' });
  assert.equal(r.newVersion, 'v0.1.0');
  assert.equal(r.createBranch, true);
});

test('no tags, pre-major → v1.0.0-pre.0', () => {
  const r = calc([], { BUMP: 'pre-major' });
  assert.equal(r.newVersion, 'v1.0.0-pre.0');
  assert.equal(r.createBranch, true);
});
