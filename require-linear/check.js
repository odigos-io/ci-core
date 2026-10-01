'use strict';

// Ensures a pull request carries a Linear issue key that survives the merge.
//
// Every odigos repo squashes with squash_merge_commit_title=PR_TITLE, so the PR
// title becomes the commit subject on the default branch — which is where the
// Linear release scan reads it. The PR body and the branch name reach nothing,
// so a key in either of those alone is lost. Hence: the key has to be in the
// title.
//
// Env: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, ENFORCE ("false" warns instead of
//      failing).
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

/** @returns {{ok: boolean, level: 'none'|'warning'|'error', message: string}} */
function decide({ prTitle, prBody, prBranch, enforce, keys }) {
  const k = keys || loadKeys();

  if (hasKey(prTitle, k)) {
    return { ok: true, level: 'none', message: 'Linear issue reference found in the PR title.' };
  }

  // Being in the body or the branch is worth saying, because it is the usual
  // near-miss and explains why the check is complaining about an issue the
  // author clearly did link.
  const elsewhere =
    hasKey(prBody, k) ? 'the PR body' :
    hasKey(prBranch, k) ? 'the branch name' : null;

  const message = elsewhere
    ? `the Linear key is in ${elsewhere} but not in the PR title. Merging squashes the PR title into the commit subject on the default branch, and nothing else reaches it, so the release scan would never see this issue. Put the key in the title, e.g. "RUN-123 | ${prTitle || 'fix(x): thing'}".`
    : 'No Linear issue reference in the PR title. Add one, e.g. "RUN-123 | fix(x): thing".';

  if (enforce === 'false') return { ok: true, level: 'warning', message };
  return { ok: false, level: 'error', message };
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

  const result = decide({
    prTitle: pr.title,
    prBody: pr.body,
    prBranch: pr.head?.ref,
    enforce: env.ENFORCE,
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

module.exports = { decide, hasKey, loadKeys, shouldSkip };
