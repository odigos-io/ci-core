'use strict';

// Calculates the next semantic version based on bump type and git tag history.
//
// Required env vars:
//   BUMP        - one of: patch, minor, major, pre-minor, pre-major, rc-minor, rc-major
//   BASE_BRANCH - the branch being tagged (e.g. "main" or "releases/v1.3.x")
//
// The repo must already be checked out with full history and tags
// (fetch-depth: 0, fetch-tags: true) before this script runs.
//
// Version bump logic (based on the latest stable tag visible repo-wide):
//
//   major      v1.2.3        → v2.0.0         + creates releases/v2.0.x branch
//   major      v2.0.0-pre.N  → v2.0.0           (promotes pre to stable; branch already exists)
//   minor      v1.2.3        → v1.3.0         + creates releases/v1.3.x branch
//   minor      v1.3.0-pre.N  → v1.3.0           (promotes pre to stable; branch already exists)
//   patch      v1.2.3        → v1.2.4
//   patch      v1.3.0-pre.N  → v1.3.0           (on releases/vX.Y.x: promotes pre to stable)
//   patch      v1.3.0-rc.N   → v1.3.0           (on releases/vX.Y.x: promotes rc to stable)
//
//   (no tags)                → treated as v0.0.0 baseline for all bump types
//
//   pre-minor  v1.2.3        → v1.3.0-pre.0   + creates releases/v1.3.x branch
//   pre-minor  v1.3.0-pre.0  → v1.3.0-pre.1
//   pre-minor  v1.3.0-rc.0   → ERROR (cannot go back to pre after rc)
//
//   pre-major  v1.2.3        → v2.0.0-pre.0   + creates releases/v2.0.x branch
//   pre-major  v2.0.0-pre.N  → v2.0.0-pre.N+1
//   pre-major  v2.0.0-rc.N   → ERROR (cannot go back to pre after rc)
//
//   rc-minor   v1.2.3        → v1.3.0-rc.0    + creates releases/v1.3.x branch
//   rc-minor   v1.3.0-pre.N  → v1.3.0-rc.0      (releases/v1.3.x already exists)
//   rc-minor   v1.3.0-rc.N   → v1.3.0-rc.N+1    (releases/v1.3.x already exists)
//
//   rc-major   v1.2.3        → v2.0.0-rc.0    + creates releases/v2.0.x branch
//   rc-major   v2.0.0-pre.N  → v2.0.0-rc.0      (releases/v2.0.x already exists)
//   rc-major   v2.0.0-rc.N   → v2.0.0-rc.N+1    (releases/v2.0.x already exists)
//
// A release branch (releases/vX.Y.x) is created for major, minor, rc-minor,
// rc-major, and the first pre-minor/pre-major. Skipped if it already exists.

const { execSync: defaultExecSync } = require('child_process');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Pure helpers (no I/O)
// ---------------------------------------------------------------------------

const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-(pre|rc)\.(\d+))?$/;

function parseVersion(tag) {
  const m = VERSION_RE.exec(tag);
  if (!m) return null;
  return {
    major:   parseInt(m[1], 10),
    minor:   parseInt(m[2], 10),
    patch:   parseInt(m[3], 10),
    preType: m[4] ?? '',
    preNum:  m[5] !== undefined ? parseInt(m[5], 10) : -1,
  };
}

// Semver comparator: stable > rc > pre; within same type sort by number.
// e.g. v1.1.0 > v1.1.0-rc.1 > v1.1.0-rc.0 > v1.1.0-pre.1 > v1.1.0-pre.0 > v1.0.9
function cmpVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (!pa.preType && !pb.preType) return 0;
  if (!pa.preType) return 1;   // a is stable → a > b
  if (!pb.preType) return -1;  // b is stable → b > a
  if (pa.preType !== pb.preType) return pa.preType === 'rc' ? 1 : -1; // rc > pre
  return pa.preNum - pb.preNum;
}

function latest(tags) {
  return tags.length ? tags[tags.length - 1] : null;
}

// Parses the major.minor series from a release branch name, e.g. "releases/v1.3.x" → {major:1, minor:3}
function parseBranchSeries(branch) {
  const m = /^releases\/v(\d+)\.(\d+)\.x$/.exec(branch);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

// ---------------------------------------------------------------------------
// calculate() — injectable for testing
// ---------------------------------------------------------------------------

function calculate({ execSync = defaultExecSync, env = process.env } = {}) {
  const BUMP         = env.BUMP;
  const BASE_BRANCH  = env.BASE_BRANCH;
  const GITHUB_OUTPUT = env.GITHUB_OUTPUT || '';

  if (!BUMP)        throw new Error('BUMP environment variable is required');
  if (!BASE_BRANCH) throw new Error('BASE_BRANCH environment variable is required');

  function git(cmd) {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  }

  function tagExists(tag) {
    try {
      execSync(`git rev-parse ${JSON.stringify(tag)}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  function getMergedTags() {
    const raw = git("git tag --merged HEAD --list 'v[0-9]*'");
    if (!raw) return [];
    return raw.split('\n').filter((t) => parseVersion(t) !== null).sort(cmpVersions);
  }

  // Repo-wide stable tags — not scoped to HEAD lineage. Used to determine the
  // current stable version base so that initial version tags on release-branch
  // "begin" commits (unreachable from main) are still visible during major/minor
  // bump calculations on main.
  function getAllStableTags() {
    const raw = git("git tag --list 'v[0-9]*'");
    if (!raw) return [];
    return raw.split('\n')
      .filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && parseVersion(t) !== null)
      .sort(cmpVersions);
  }

  // Returns the latest pre-release tag for the given major.minor.0 coordinate.
  // type: 'pre' | 'rc' | null (null matches any pre-release)
  // Uses repo-wide tag lookup (not --merged HEAD) so that pre-release tags on
  // release-branch "begin" commits (unreachable from main) are still visible
  // when bumping pre-major/pre-minor/rc-* a second time from the default branch.
  function latestPreFor(maj, min, type = null) {
    const raw = git(`git tag --list 'v${maj}.${min}.0-*'`);
    if (!raw) return null;
    const tags = raw.split('\n')
      .filter((t) => {
        const v = parseVersion(t);
        return v && v.major === maj && v.minor === min && v.patch === 0
          && (type ? v.preType === type : v.preType);
      })
      .sort(cmpVersions);
    return latest(tags);
  }

  // allMerged: tags reachable from HEAD — used for branch-scoped patch logic.
  const allMerged    = getMergedTags();
  // stableMerged: ALL stable tags repo-wide — used as the version base.
  const stableMerged = getAllStableTags();

  const currentTag = latest(stableMerged) ?? 'v0.0.0';
  const cv = parseVersion(currentTag);
  if (!cv) throw new Error(`Failed to parse current version tag: ${currentTag}`);

  const { major, minor, patch } = cv;

  let displayCurrent = currentTag;
  let newVersion;
  let createBranch = false;
  let releaseBranch = '';

  switch (BUMP) {
    case 'major': {
      const tMaj = major + 1;
      newVersion = `v${tMaj}.0.0`;
      releaseBranch = `releases/v${tMaj}.0.x`;
      const existingPre = latestPreFor(tMaj, 0);
      if (existingPre) { displayCurrent = existingPre; }
      else { createBranch = true; }
      break;
    }

    case 'minor': {
      const tMin = minor + 1;
      newVersion = `v${major}.${tMin}.0`;
      releaseBranch = `releases/v${major}.${tMin}.x`;
      const existingPre = latestPreFor(major, tMin);
      if (existingPre) { displayCurrent = existingPre; }
      else { createBranch = true; }
      break;
    }

    case 'patch': {
      if (BASE_BRANCH.startsWith('releases/')) {
        // On a release branch: scope tags to this branch's major.minor series to
        // avoid picking up pre-releases from unrelated series visible from HEAD.
        const series = parseBranchSeries(BASE_BRANCH);
        const scopedTags = series
          ? allMerged.filter((t) => {
              const v = parseVersion(t);
              return v && v.major === series.major && v.minor === series.minor;
            })
          : allMerged;
        const latestAny = latest(scopedTags) ?? 'v0.0.0';
        const lav = parseVersion(latestAny);
        if (!lav.preType) {
          // Latest is already stable — normal patch increment
          newVersion = `v${major}.${minor}.${patch + 1}`;
        } else {
          const baseVer = `v${lav.major}.${lav.minor}.${lav.patch}`;
          if (tagExists(baseVer)) {
            // Stable base already exists globally — increment from it
            displayCurrent = baseVer;
            newVersion = `v${lav.major}.${lav.minor}.${lav.patch + 1}`;
          } else {
            displayCurrent = latestAny;
            // Stable base not yet released — promote pre/rc to stable
            newVersion = baseVer;
          }
        }
      } else {
        // Not a release branch (e.g. main): always use stable tags only
        newVersion = `v${major}.${minor}.${patch + 1}`;
      }
      break;
    }

    case 'pre-minor': {
      // On a release branch, target that branch's series (e.g. releases/2.0.x → v2.0).
      // On main, target the next minor from the latest stable.
      const bs = parseBranchSeries(BASE_BRANCH);
      const [tMaj, tMin] = bs ? [bs.major, bs.minor] : [major, minor + 1];
      releaseBranch = `releases/v${tMaj}.${tMin}.x`;
      const rc  = latestPreFor(tMaj, tMin, 'rc');
      if (rc) throw new Error(`'pre-minor' cannot follow an rc (${rc}).`);
      const pre = latestPreFor(tMaj, tMin, 'pre');
      if (pre) {
        newVersion = `v${tMaj}.${tMin}.0-pre.${parseVersion(pre).preNum + 1}`;
        displayCurrent = pre;
      } else {
        newVersion = `v${tMaj}.${tMin}.0-pre.0`;
        createBranch = true;
      }
      break;
    }

    case 'rc-minor': {
      const bs = parseBranchSeries(BASE_BRANCH);
      const [tMaj, tMin] = bs ? [bs.major, bs.minor] : [major, minor + 1];
      releaseBranch = `releases/v${tMaj}.${tMin}.x`;
      const rc  = latestPreFor(tMaj, tMin, 'rc');
      const pre = latestPreFor(tMaj, tMin, 'pre');
      if (rc) {
        newVersion = `v${tMaj}.${tMin}.0-rc.${parseVersion(rc).preNum + 1}`;
        displayCurrent = rc;
      } else {
        newVersion = `v${tMaj}.${tMin}.0-rc.0`;
        if (pre) { displayCurrent = pre; }
        else { createBranch = true; }
      }
      break;
    }

    case 'pre-major': {
      // On a release branch (e.g. releases/v2.0.x), target that branch's series.
      // On main, target the next major from the latest stable.
      const bs = parseBranchSeries(BASE_BRANCH);
      const tMaj = bs ? bs.major : major + 1;
      releaseBranch = `releases/v${tMaj}.0.x`;
      const rc  = latestPreFor(tMaj, 0, 'rc');
      if (rc) throw new Error(`'pre-major' cannot follow an rc (${rc}).`);
      const pre = latestPreFor(tMaj, 0, 'pre');
      if (pre) {
        newVersion = `v${tMaj}.0.0-pre.${parseVersion(pre).preNum + 1}`;
        displayCurrent = pre;
      } else {
        newVersion = `v${tMaj}.0.0-pre.0`;
        createBranch = true;
      }
      break;
    }

    case 'rc-major': {
      // On a release branch (e.g. releases/v2.0.x), target that branch's series.
      // On main, target the next major from the latest stable.
      const bs = parseBranchSeries(BASE_BRANCH);
      const tMaj = bs ? bs.major : major + 1;
      releaseBranch = `releases/v${tMaj}.0.x`;
      const rc  = latestPreFor(tMaj, 0, 'rc');
      const pre = latestPreFor(tMaj, 0, 'pre');
      if (rc) {
        newVersion = `v${tMaj}.0.0-rc.${parseVersion(rc).preNum + 1}`;
        displayCurrent = rc;
      } else {
        newVersion = `v${tMaj}.0.0-rc.0`;
        if (pre) { displayCurrent = pre; }
        else { createBranch = true; }
      }
      break;
    }

    default:
      throw new Error(`Unknown bump type: ${BUMP}`);
  }

  const result = { currentVersion: displayCurrent, newVersion, createBranch, releaseBranch };

  if (GITHUB_OUTPUT) {
    const outputs = [
      `current_version=${displayCurrent}`,
      `new_version=${newVersion}`,
      `create_branch=${createBranch}`,
      `release_branch=${releaseBranch}`,
    ].join('\n');
    fs.appendFileSync(GITHUB_OUTPUT, outputs + '\n');
  }

  return result;
}

// ---------------------------------------------------------------------------
// Entry point when executed directly by the action
// ---------------------------------------------------------------------------
if (require.main === module) {
  try {
    const { currentVersion, newVersion, createBranch, releaseBranch } = calculate();
    console.log(`current: ${currentVersion}  →  new: ${newVersion}`);
    if (createBranch) console.log(`branch:  ${releaseBranch} (will be created)`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}

module.exports = { calculate };
