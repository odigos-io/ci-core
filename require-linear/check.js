'use strict';

// Ensures a pull request carries a Linear issue key that survives the merge.
//
// 118 of 129 org repos squash with COMMIT_OR_PR_TITLE, which takes the commit
// title on a single-commit PR. A key living only in the PR title is dropped, so
// it never reaches the default branch where the release scan reads it.
//
// We cannot read a repo's merge settings — GitHub omits those fields for a token
// without push rights, and no workflow permission grants it — and the merger picks
// squash vs merge at merge time anyway. So the rule is deliberately conservative
// and depends only on the commit count: on a single-commit PR the commit subject
// is what can ship, so the key has to be there.
//
// Env: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_TOKEN,
//      ENFORCE ("false" warns instead of failing).
//
// Everything except main() is pure, so test.js can drive it.

const fs   = require('node:fs');
const path = require('node:path');

const KEYS_FILE = path.join(__dirname, '..', 'linear-team-keys');

/**
 * Shared with linear-release's issue-pattern. Not an input and no fallback: which
 * teams exist belongs to the workspace, not to the repo being checked, and a stale
 * second copy is the drift this file exists to end.
 */
function loadKeys() {
  let raw;
  try {
    raw = fs.readFileSync(KEYS_FILE, 'utf8');
  } catch (e) {
    throw new Error(`cannot read team keys from ${KEYS_FILE}: ${e.message}`);
  }
  const keys = raw.replace(/\s/g, '');
  if (!keys) throw new Error(`${KEYS_FILE} is empty`);
  // An empty alternative — a stray "||" or a trailing "|" — makes the key regex
  // match almost anything, which would pass every PR instead of failing it.
  if (!/^[A-Z][A-Z0-9]*(\|[A-Z][A-Z0-9]*)*$/.test(keys)) {
    throw new Error(`${KEYS_FILE} must be uppercase keys separated by "|", got: ${keys}`);
  }
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
  return new RegExp(String.raw`\b(${keys})-[1-9][0-9]*`, 'i');
}

function hasKey(text, keys) {
  return keyRegex(keys).test(text || '');
}

/** What has to carry the key, given only the commit count. */
function requiredCarrier({ prTitle, firstSubject, nCommits }) {
  return String(nCommits) === '1'
    ? { subject: firstSubject, why: 'a single-commit PR squashes to the commit subject' }
    : { subject: prTitle, why: 'a multi-commit PR squashes to the PR title' };
}

/** @returns {{ok: boolean, level: 'none'|'notice'|'warning'|'error', message: string}} */
function decide(facts) {
  const { prTitle, prBody, prBranch, nCommits, enforce } = facts;
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
  if (!nCommits) {
    return { ok: true, level: 'notice', message: `Found in the ${found}. Could not read the PR's commits; skipping the merge-subject check.` };
  }

  const { subject, why } = requiredCarrier(facts);
  if (hasKey(subject, keys)) {
    return { ok: true, level: 'none', message: `Found in the ${found}, and it survives the merge — ${why}.` };
  }

  const problem =
    `the Linear key would not reach the merge commit subject (${why}: "${subject}"). ` +
    'The release scan reads commits on the default branch, so this association would be lost.';

  if (enforce === 'false') {
    return {
      ok: true,
      level: 'warning',
      message: `${problem} Put the key in the commit subject too.`,
    };
  }
  return { ok: false, level: 'error', message: `${problem} Put the key in the commit subject too.` };
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
    facts.nCommits = String(commits.length);
    facts.firstSubject = (commits[0]?.commit?.message || '').split('\n')[0];
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

module.exports = { decide, requiredCarrier, hasKey, loadKeys, shouldSkip };
