'use strict';

// Calculates the next semantic version based on bump type and git tag history.
//
// Required env vars:
//   BUMP        - one of: patch, minor, major, pre-minor, pre-major, rc-minor, rc-major
//   BASE_BRANCH - the branch being tagged (e.g. "main" or "releases/1.3.x")
//
// The repo must already be checked out with full history and tags
// (fetch-depth: 0, fetch-tags: true) before this script runs.
//
// Version bump logic (based on the latest tag reachable from BASE_BRANCH):
//
//   major      v1.2.3        → v2.0.0         + creates releases/2.0.x branch
//   major      v2.0.0-pre.N  → v2.0.0           (promotes pre to stable; branch already exists)
//   minor      v1.2.3        → v1.3.0         + creates releases/1.3.x branch
//   minor      v1.3.0-pre.N  → v1.3.0           (promotes pre to stable; branch already exists)
//   patch      v1.2.3        → v1.2.4
//   patch      v1.3.0-pre.N  → v1.3.0           (on releases/X.Y.x: promotes pre to stable)
//   patch      v1.3.0-rc.N   → v1.3.0           (on releases/X.Y.x: promotes rc to stable)
//
//   (no tags)                → treated as v0.0.0 baseline for all bump types
//
//   pre-minor  v1.2.3        → v1.3.0-pre.0   + creates releases/1.3.x branch
//   pre-minor  v1.3.0-pre.0  → v1.3.0-pre.1
//   pre-minor  v1.3.0-rc.0   → ERROR (cannot go back to pre after rc)
//
//   pre-major  v1.2.3        → v2.0.0-pre.0   + creates releases/2.0.x branch
//   pre-major  v1.2.3-pre.N  → ERROR (already on a pre-release; use 'pre-minor')
//   pre-major  v1.2.3-rc.N   → ERROR (cannot go back to pre after rc)
//
//   rc-minor   v1.2.3        → v1.3.0-rc.0    + creates releases/1.3.x branch
//   rc-minor   v1.3.0-pre.N  → v1.3.0-rc.0      (releases/1.3.x already exists)
//   rc-minor   v1.3.0-rc.N   → v1.3.0-rc.N+1    (releases/1.3.x already exists)
//
//   rc-major   v1.2.3        → v2.0.0-rc.0    + creates releases/2.0.x branch
//   rc-major   v1.2.3-pre.N  → ERROR (already on a pre-release; use 'rc-minor')
//
// A release branch (releases/X.Y.x) is created for major, minor, rc-minor,
// rc-major, and the first pre-minor/pre-major. Skipped if it already exists.

const { execSync } = require('child_process');
const fs = require('fs');

const BUMP = process.env.BUMP;
const BASE_BRANCH = process.env.BASE_BRANCH;
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

if (!BUMP) fail('BUMP environment variable is required');
if (!BASE_BRANCH) fail('BASE_BRANCH environment variable is required');

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

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

const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-(pre|rc)\.(\d+))?$/;

function parseVersion(tag) {
  const m = VERSION_RE.exec(tag);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    preType: m[4] ?? '',
    preNum: m[5] !== undefined ? parseInt(m[5], 10) : -1,
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

function getMergedTags({ stableOnly = false } = {}) {
  const raw = git("git tag --merged HEAD --list 'v[0-9]*'");
  if (!raw) return [];
  let tags = raw.split('\n').filter((t) => parseVersion(t) !== null);
  if (stableOnly) tags = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  return tags.sort(cmpVersions);
}

function latest(tags) {
  return tags.length ? tags[tags.length - 1] : null;
}

// Parses the major.minor series from a release branch name, e.g. "releases/1.3.x" → {major:1, minor:3}
function parseBranchSeries(branch) {
  const m = /^releases\/(\d+)\.(\d+)\.x$/.exec(branch);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

// ── Determine the "current" version used for display and parsing ──────────────

const allMerged = getMergedTags();
const stableMerged = getMergedTags({ stableOnly: true });

// Always use the latest stable tag as the calculation base.
// Pre-release lookups for each bump type use allMerged filtered by the target series,
// which avoids cross-series contamination when multiple pre-release series are visible
// from HEAD (common in CI-infra repos where all tags share the same commit).
const currentTag = latest(stableMerged) ?? 'v0.0.0';
const cv = parseVersion(currentTag);
if (!cv) fail(`Failed to parse current version tag: ${currentTag}`);

const { major, minor, patch, preType, preNum } = cv;

// ── Calculate new version ─────────────────────────────────────────────────────

let displayCurrent = currentTag;
let newVersion;
let createBranch = false;
let releaseBranch = '';

switch (BUMP) {
  case 'major': {
    newVersion = `v${major + 1}.0.0`;
    releaseBranch = `releases/${major + 1}.0.x`;
    const existingMajorPre = latest(allMerged.filter((t) => {
      const v = parseVersion(t);
      return v && v.major === major + 1 && v.minor === 0 && v.patch === 0 && v.preType;
    }));
    if (existingMajorPre) {
      displayCurrent = existingMajorPre;
      createBranch = false;
    } else {
      createBranch = true;
    }
    break;
  }

  case 'minor': {
    newVersion = `v${major}.${minor + 1}.0`;
    releaseBranch = `releases/${major}.${minor + 1}.x`;
    const existingMinorPre = latest(allMerged.filter((t) => {
      const v = parseVersion(t);
      return v && v.major === major && v.minor === minor + 1 && v.patch === 0 && v.preType;
    }));
    if (existingMinorPre) {
      displayCurrent = existingMinorPre;
      createBranch = false;
    } else {
      createBranch = true;
    }
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
          // Stable base already exists globally (maybe tagged on a sibling
          // branch line) — show it as current and increment from it
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
    const [tMaj, tMin] = [major, minor + 1];
    releaseBranch = `releases/${tMaj}.${tMin}.x`;
    const rcForMinor = latest(allMerged.filter((t) => {
      const v = parseVersion(t);
      return v && v.major === tMaj && v.minor === tMin && v.patch === 0 && v.preType === 'rc';
    }));
    if (rcForMinor) fail(`'pre-minor' cannot follow an rc (${rcForMinor}).`);
    const preForMinor = latest(allMerged.filter((t) => {
      const v = parseVersion(t);
      return v && v.major === tMaj && v.minor === tMin && v.patch === 0 && v.preType === 'pre';
    }));
    if (preForMinor) {
      const lv = parseVersion(preForMinor);
      newVersion = `v${tMaj}.${tMin}.0-pre.${lv.preNum + 1}`;
      displayCurrent = preForMinor;
    } else {
      newVersion = `v${tMaj}.${tMin}.0-pre.0`;
      createBranch = true;
    }
    break;
  }

  case 'rc-minor': {
    const [tMaj, tMin] = [major, minor + 1];
    releaseBranch = `releases/${tMaj}.${tMin}.x`;
    const rcForMinor = latest(allMerged.filter((t) => {
      const v = parseVersion(t);
      return v && v.major === tMaj && v.minor === tMin && v.patch === 0 && v.preType === 'rc';
    }));
    if (rcForMinor) {
      const lv = parseVersion(rcForMinor);
      newVersion = `v${tMaj}.${tMin}.0-rc.${lv.preNum + 1}`;
      displayCurrent = rcForMinor;
    } else {
      const preForMinor = latest(allMerged.filter((t) => {
        const v = parseVersion(t);
        return v && v.major === tMaj && v.minor === tMin && v.patch === 0 && v.preType === 'pre';
      }));
      if (preForMinor) {
        newVersion = `v${tMaj}.${tMin}.0-rc.0`;
        displayCurrent = preForMinor;
      } else {
        newVersion = `v${tMaj}.${tMin}.0-rc.0`;
        createBranch = true;
      }
    }
    break;
  }

  case 'pre-major': {
    const tMaj = major + 1;
    releaseBranch = `releases/${tMaj}.0.x`;
    const rcForMajor = latest(allMerged.filter((t) => {
      const v = parseVersion(t);
      return v && v.major === tMaj && v.minor === 0 && v.patch === 0 && v.preType === 'rc';
    }));
    if (rcForMajor) fail(`'pre-major' cannot follow an rc (${rcForMajor}).`);
    const preForMajor = latest(allMerged.filter((t) => {
      const v = parseVersion(t);
      return v && v.major === tMaj && v.minor === 0 && v.patch === 0 && v.preType === 'pre';
    }));
    if (preForMajor) fail(`'pre-major' cannot be used when pre-releases already exist (${preForMajor}). Use 'pre-minor' to continue the series.`);
    newVersion = `v${tMaj}.0.0-pre.0`;
    createBranch = true;
    break;
  }

  case 'rc-major': {
    const tMaj = major + 1;
    releaseBranch = `releases/${tMaj}.0.x`;
    const anyForMajor = latest(allMerged.filter((t) => {
      const v = parseVersion(t);
      return v && v.major === tMaj && v.minor === 0 && v.patch === 0 && v.preType;
    }));
    if (anyForMajor) fail(`'rc-major' cannot be used when pre-releases already exist (${anyForMajor}). Use 'rc-minor' to continue the series.`);
    newVersion = `v${tMaj}.0.0-rc.0`;
    createBranch = true;
    break;
  }

  default:
    fail(`Unknown bump type: ${BUMP}`);
}

// ── Emit outputs ──────────────────────────────────────────────────────────────

const outputs = [
  `current_version=${displayCurrent}`,
  `new_version=${newVersion}`,
  `create_branch=${createBranch}`,
  `release_branch=${releaseBranch}`,
].join('\n');

if (GITHUB_OUTPUT) {
  fs.appendFileSync(GITHUB_OUTPUT, outputs + '\n');
}

console.log(`current: ${displayCurrent}  →  new: ${newVersion}`);
if (createBranch) console.log(`branch:  ${releaseBranch} (will be created)`);
