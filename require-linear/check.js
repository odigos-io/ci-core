'use strict';

// Ensures a pull request carries a Linear issue key that survives the merge.
//
// 118 of 129 org repos squash with COMMIT_OR_PR_TITLE, which takes the commit
// title on a single-commit PR. A key living only in the PR title is dropped, so
// it never reaches the default branch where the release scan reads it.
//
// Which text reaches main depends on the merge method, and the merger picks that
// at merge time — we cannot know it, and cannot read the repo's merge settings
// either (GitHub omits those fields for a token without push rights).
//
//   squash  the PR title, or the commit subject on a single-commit PR
//   rebase  every commit subject, replayed; the PR title never lands
//   merge   the branch name, plus every commit subject
//
// So the key has to be in the PR title AND in at least one commit subject. That
// is the only rule correct under all three, and it is the convention anyway.
//
// Env: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_TOKEN,
//      ENFORCE ("false" warns instead of failing).
//
// Everything except main() is pure, so test.js can drive it.

const fs   = require('node:fs');
const path = require('node:path');

const KEYS_FILE = path.join(__dirname, '..', 'linear-team-keys');

/**
 * One team key per line; blank lines and #comments ignored. Shared with
 * linear-release. Not an input and no fallback: which teams exist belongs to the
 * workspace, not to the repo being checked, and a stale second copy is the drift
 * this file exists to end.
 *
 * @returns {string[]}
 */
function loadKeys() {
  let raw;
  try {
    raw = fs.readFileSync(KEYS_FILE, 'utf8');
  } catch (e) {
    throw new Error(`cannot read team keys from ${KEYS_FILE}: ${e.message}`);
  }
  const keys = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (keys.length === 0) throw new Error(`${KEYS_FILE} lists no team keys`);
  // A key that is not a bare uppercase token would either break the composed
  // regex or, if it introduced an empty alternative, make it match almost
  // anything — passing every PR instead of failing it.
  const bad = keys.filter((k) => !/^[A-Z][A-Z0-9]*$/.test(k));
  if (bad.length) throw new Error(`${KEYS_FILE}: not uppercase team keys: ${bad.join(', ')}`);
  return keys;
}

const BOT_ACCOUNTS = [
  'dependabot[bot]',
  'renovate[bot]',
  'odigos-bot',
  'github-actions[bot]',
  'keyval-release-bot',
];

/** @returns {string|null} why we are skipping, or null to proceed. */
function shouldSkip({ eventName, userLogin, userType }) {
  // merge_group carries no pull request payload, so every field reads empty and the
  // check would fail every queue entry. It is enforced on the pull_request events
  // that run before the queue.
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
    return `event ${eventName} carries no pull request`;
  }
  if (userType === 'Bot') return `opened by bot user ${userLogin}`;
  if (BOT_ACCOUNTS.includes(userLogin)) return `opened by ${userLogin}`;
  return null;
}

// \b so FOORUN-12 is not RUN-12; [1-9] so RUN-0 and RUN-007 do not match.
function keyRegex(keys) {
  const alternation = (Array.isArray(keys) ? keys : [keys]).join('|');
  return new RegExp(String.raw`\b(${alternation})-[1-9][0-9]*`, 'i');
}

function hasKey(text, keys) {
  return keyRegex(keys).test(text || '');
}

/**
 * Which carriers are missing the key.
 * @returns {string[]} empty when the key survives every merge method.
 */
function missingCarriers({ prTitle, commitSubjects }, keys) {
  const missing = [];
  if (!hasKey(prTitle, keys)) missing.push('the PR title (used by squash)');
  if (!commitSubjects.some((c) => hasKey(c, keys))) {
    missing.push('every commit subject (used by rebase, and by squash on a single-commit PR)');
  }
  return missing;
}

/** @returns {{ok: boolean, level: 'none'|'notice'|'warning'|'error', message: string}} */
function decide(facts) {
  const { prTitle, prBody, prBranch, commitSubjects, enforce } = facts;
  const keys = facts.keys || loadKeys();   // facts.keys is a test seam, not an input

  // The long-standing gate: a key has to be somewhere.
  const found =
    hasKey(prTitle, keys) ? 'PR title' :
    hasKey(prBody, keys) ? 'PR body' :
    hasKey(prBranch, keys) ? 'branch name' : null;

  if (!found) {
    return {
      ok: false,
      level: 'error',
      message:
        'No Linear issue reference found in the PR title, body, or branch name. ' +
        "Add one, e.g. title 'RUN-123 | fix(x): thing' or branch 'run-123-thing'.",
    };
  }

  // Without the commit list there is nothing to check; never fail on an API hiccup.
  if (!commitSubjects || commitSubjects.length === 0) {
    return { ok: true, level: 'notice', message: `Found in the ${found}. Could not read the PR's commits; skipping the merge-survival check.` };
  }

  const missing = missingCarriers(facts, keys);
  if (missing.length === 0) {
    return { ok: true, level: 'none', message: `Found in the ${found}, and it survives squash, rebase and merge.` };
  }

  const problem =
    `the Linear key is missing from ${missing.join(' and from ')}. ` +
    'Which text reaches the default branch depends on how this PR is merged, and the release scan reads it there, ' +
    'so put the key in both the PR title and the commit subject.';

  if (enforce === 'false') {
    return { ok: true, level: 'warning', message: problem };
  }
  return { ok: false, level: 'error', message: problem };
}

async function api(pathname, token) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'odigos-ci-core-require-linear',
    },
  });
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status}`);
  return res.json();
}

/** A failed lookup leaves the value undefined, and decide() degrades to a notice
 *  rather than blocking a PR on an API hiccup. */
async function gather({ repo, prNumber, token }) {
  const facts = {};
  try {
    const commits = await api(`/repos/${repo}/pulls/${prNumber}/commits?per_page=100`, token);
    facts.commitSubjects = commits.map((c) => (c.commit?.message || '').split('\n')[0]);
  } catch (e) {
    console.log(`Could not read the PR's commits: ${e.message}`);
  }
  return facts;
}

async function main() {
  const env = process.env;
  const event = env.GITHUB_EVENT_PATH && fs.existsSync(env.GITHUB_EVENT_PATH)
    ? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    : {};
  const pr = event.pull_request || {};

  const skip = shouldSkip({
    eventName: env.GITHUB_EVENT_NAME,
    userLogin: pr.user?.login,
    userType: pr.user?.type,
  });
  if (skip) {
    console.log(`Linear check skipped: ${skip}.`);
    return;
  }

  const gathered = await gather({
    repo: env.GITHUB_REPOSITORY,
    prNumber: pr.number,
    token: env.GITHUB_TOKEN,
  });

  const result = decide({
    prTitle: pr.title,
    prBody: pr.body,
    prBranch: pr.head?.ref,
    enforce: env.ENFORCE,
    ...gathered,
  });

  console.log(result.level === 'none' ? result.message : `::${result.level}::${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exitCode = 1;
  });
}

module.exports = { decide, missingCarriers, hasKey, loadKeys, shouldSkip };
