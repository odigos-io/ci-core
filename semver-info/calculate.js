'use strict';

// Reads git tags and origin release branches and reports Odigos semver fields.
//
// Tag formats:
//   stable  vMAJOR.MINOR.PATCH
//   pre     vMAJOR.MINOR.PATCH-preN
//   rc      vMAJOR.MINOR.PATCH-rcN
//
// Release branches: releases/vMAJOR.MINOR.PATCH  (Odigos uses releases/vX.Y.0)
//
// last_release_line is the highest series among:
//   - origin release branches (covers an unpublished line that already has a branch)
//   - the latest stable tag's vMAJOR.MINOR.0
// next_release is one minor after last_release_line (vX.(Y+1).0).
// next_pre / next_rc are computed from tags of next_release.
//
// The repo must already be checked out with full tags (fetch-depth: 0).

const { execSync: defaultExecSync } = require('child_process');
const fs = require('fs');

const STABLE_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const PRE_RE = /^v(\d+)\.(\d+)\.(\d+)-pre(\d+)$/;
const RC_RE = /^v(\d+)\.(\d+)\.(\d+)-rc(\d+)$/;
const BRANCH_RE = /(?:^|\/)releases\/v(\d+)\.(\d+)\.(\d+)$/;

function parseStable(tag) {
  const m = STABLE_RE.exec(tag);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

function parsePre(tag) {
  const m = PRE_RE.exec(tag);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    n: parseInt(m[4], 10),
  };
}

function parseRc(tag) {
  const m = RC_RE.exec(tag);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    n: parseInt(m[4], 10),
  };
}

function fmt(major, minor, patch) {
  return `v${major}.${minor}.${patch}`;
}

function cmpSeries(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  return a.minor - b.minor;
}

function cmpStable(a, b) {
  const series = cmpSeries(a, b);
  if (series !== 0) return series;
  return a.patch - b.patch;
}

function maxBy(items, cmp) {
  return items.reduce((best, cur) => (cmp(cur, best) > 0 ? cur : best));
}

function calculate({ execSync = defaultExecSync, env = process.env } = {}) {
  const GITHUB_OUTPUT = env.GITHUB_OUTPUT || '';
  const directory = env.DIRECTORY || '.';

  function git(cmd) {
    return execSync(cmd, { encoding: 'utf8', cwd: directory }).trim();
  }

  let tagRaw = '';
  try {
    tagRaw = git('git tag -l');
  } catch {
    tagRaw = '';
  }
  const tags = tagRaw ? tagRaw.split('\n').filter(Boolean) : [];

  let branchRaw = '';
  try {
    branchRaw = git("git ls-remote --heads origin 'releases/*'");
  } catch {
    branchRaw = '';
  }

  const branchVersions = [];
  for (const line of branchRaw ? branchRaw.split('\n') : []) {
    const ref = line.split(/[\s\t]+/)[1] || line;
    const m = BRANCH_RE.exec(ref.trim());
    if (!m) continue;
    branchVersions.push({
      major: parseInt(m[1], 10),
      minor: parseInt(m[2], 10),
      patch: parseInt(m[3], 10),
    });
  }

  const stables = tags.map(parseStable).filter(Boolean).sort(cmpStable);
  const latestStable = stables.length ? stables[stables.length - 1] : null;

  const seriesCandidates = [...branchVersions];
  if (latestStable) {
    seriesCandidates.push({ major: latestStable.major, minor: latestStable.minor, patch: 0 });
  }
  if (seriesCandidates.length === 0) {
    throw new Error('no stable tags or release branches found');
  }

  const lastRelease = maxBy(seriesCandidates, cmpSeries);
  const nextRelease = { major: lastRelease.major, minor: lastRelease.minor + 1, patch: 0 };
  const nextReleaseTag = fmt(nextRelease.major, nextRelease.minor, nextRelease.patch);

  const pres = tags
    .map(parsePre)
    .filter((v) => v && v.major === nextRelease.major && v.minor === nextRelease.minor && v.patch === nextRelease.patch)
    .sort((a, b) => a.n - b.n);
  const rcs = tags
    .map(parseRc)
    .filter((v) => v && v.major === nextRelease.major && v.minor === nextRelease.minor && v.patch === nextRelease.patch)
    .sort((a, b) => a.n - b.n);

  const latestPre = pres.length ? `${nextReleaseTag}-pre${pres[pres.length - 1].n}` : '';
  const nextPre = `${nextReleaseTag}-pre${pres.length ? pres[pres.length - 1].n + 1 : 0}`;
  const latestRc = rcs.length ? `${nextReleaseTag}-rc${rcs[rcs.length - 1].n}` : '';
  const nextRc = `${nextReleaseTag}-rc${rcs.length ? rcs[rcs.length - 1].n + 1 : 0}`;

  const lastReleaseTag = fmt(lastRelease.major, lastRelease.minor, 0);
  const lastBranch = branchVersions.length ? maxBy(branchVersions, cmpSeries) : null;
  const lastReleaseBranch = lastBranch ? `releases/${fmt(lastBranch.major, lastBranch.minor, 0)}` : '';

  const result = {
    latest_stable: latestStable ? fmt(latestStable.major, latestStable.minor, latestStable.patch) : '',
    last_release_line: lastReleaseTag,
    last_release_branch: lastReleaseBranch,
    next_release: nextReleaseTag,
    latest_pre: latestPre,
    next_pre: nextPre,
    has_pre: pres.length > 0 ? 'true' : 'false',
    latest_rc: latestRc,
    next_rc: nextRc,
    has_rc: rcs.length > 0 ? 'true' : 'false',
  };

  if (GITHUB_OUTPUT) {
    const lines = Object.entries(result).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.appendFileSync(GITHUB_OUTPUT, lines + '\n');
  }

  return result;
}

if (require.main === module) {
  try {
    const r = calculate();
    console.log(`latest_stable=${r.latest_stable}`);
    console.log(`last_release_line=${r.last_release_line}  last_release_branch=${r.last_release_branch || '(none)'}`);
    console.log(`next_release=${r.next_release}`);
    console.log(`next_pre=${r.next_pre}  (latest_pre=${r.latest_pre || '(none)'})`);
    console.log(`next_rc=${r.next_rc}  (latest_rc=${r.latest_rc || '(none)'})`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}

module.exports = { calculate };
