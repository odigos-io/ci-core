'use strict';

// Run with: node --test sts/test.js

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { run } = require('./fetch');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a mock fetch function that replays the given responses in order. */
function mockFetch(...responses) {
  let i = 0;
  return async (url) => {
    const r = responses[i++];
    if (!r) throw new Error(`unexpected fetch call #${i} to ${url}`);
    return {
      ok:     r.ok   ?? true,
      status: r.status ?? 200,
      json:   async () => r.body,
      text:   async () => r.text ?? JSON.stringify(r.body ?? {}),
    };
  };
}

/** Three successful fetch responses for one scope: OIDC → STS → repo check. */
function happyTriple(ghToken = 'ghp_test_token') {
  return [
    { body: { value: 'oidc-token' } },                 // OIDC
    { body: { token: ghToken } },                       // STS exchange
    { body: { id: 1, name: 'repo' } },                  // repo check
  ];
}

const noopExec = () => {};  // stub for execFileSync (git config --global ...)

// ---------------------------------------------------------------------------
// Per-test env + GITHUB_OUTPUT setup
// ---------------------------------------------------------------------------

let tmpOutput;
let savedEnv;

beforeEach(() => {
  savedEnv   = { ...process.env };
  tmpOutput  = path.join(os.tmpdir(), `gh-output-${process.pid}-${Date.now()}`);

  process.env.GITHUB_OUTPUT                  = tmpOutput;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL   = 'https://token.example.com/token?';
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'runner-token';
  process.env.DOMAIN                         = 'octo-sts.dev';
  process.env.OUTPUT_GIT_CONFIG              = 'false';   // avoid real git calls by default
  process.env.PAIRS                          = '';
  process.env.SCOPE                          = '';
  process.env.IDENTITY                       = '';
});

afterEach(() => {
  process.env = savedEnv;
  if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
});

/** Read the GITHUB_OUTPUT file written by run(). */
function readOutput() {
  if (!fs.existsSync(tmpOutput)) return {};
  return Object.fromEntries(
    fs.readFileSync(tmpOutput, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => line.split('=', 2)),
  );
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test('errors when both pairs and scope/identity are provided', async () => {
  process.env.PAIRS    = 'odigos-io/repo-a:identity-a';
  process.env.SCOPE    = 'odigos-io/repo-b';
  process.env.IDENTITY = 'identity-b';

  await assert.rejects(
    () => run({ fetchFn: mockFetch(), execFileSync: noopExec, env: process.env }),
    /not both/,
  );
});

test('errors when neither pairs nor scope/identity are provided', async () => {
  await assert.rejects(
    () => run({ fetchFn: mockFetch(), execFileSync: noopExec, env: process.env }),
    /is required/,
  );
});

test('errors on invalid pair format (no colon)', async () => {
  process.env.PAIRS = 'odigos-io/repo-without-identity';

  await assert.rejects(
    () => run({ fetchFn: mockFetch(), execFileSync: noopExec, env: process.env }),
    /invalid pair/,
  );
});

test('errors on pair with empty scope', async () => {
  process.env.PAIRS = ':some-identity';

  await assert.rejects(
    () => run({ fetchFn: mockFetch(), execFileSync: noopExec, env: process.env }),
    /invalid pair/,
  );
});

test('errors on pair with empty identity', async () => {
  process.env.PAIRS = 'odigos-io/repo:';

  await assert.rejects(
    () => run({ fetchFn: mockFetch(), execFileSync: noopExec, env: process.env }),
    /invalid pair/,
  );
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('single pair via pairs → sets GH_TOKEN output', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  await run({ fetchFn: mockFetch(...happyTriple('ghp_abc')), execFileSync: noopExec, env: process.env });

  assert.equal(readOutput().GH_TOKEN, 'ghp_abc');
});

test('legacy scope+identity → sets GH_TOKEN output', async () => {
  process.env.SCOPE    = 'odigos-io/my-repo';
  process.env.IDENTITY = 'my-identity';

  await run({ fetchFn: mockFetch(...happyTriple('ghp_legacy')), execFileSync: noopExec, env: process.env });

  assert.equal(readOutput().GH_TOKEN, 'ghp_legacy');
});

test('blank lines and comments in pairs are ignored', async () => {
  process.env.PAIRS = `
    # this is a comment
    odigos-io/my-repo:my-identity
  `;

  await run({ fetchFn: mockFetch(...happyTriple('ghp_clean')), execFileSync: noopExec, env: process.env });

  assert.equal(readOutput().GH_TOKEN, 'ghp_clean');
});

test('multi-pair → GH_TOKEN is the last token, gitconfig has both entries', async () => {
  process.env.PAIRS             = 'odigos-io/repo-a:id-a\nodigos-io/repo-b:id-b';
  process.env.OUTPUT_GIT_CONFIG = 'true';

  const execCalls = [];
  const captureExec = (...args) => execCalls.push(args);

  await run({
    fetchFn:      mockFetch(...happyTriple('ghp_A'), ...happyTriple('ghp_B')),
    execFileSync: captureExec,
    env:          process.env,
  });

  assert.equal(readOutput().GH_TOKEN, 'ghp_B');

  const gitConfig = fs.readFileSync('/tmp/odigos.gitconfig', 'utf8');
  assert.match(gitConfig, /repo-a/);
  assert.match(gitConfig, /repo-b/);

  // git config --global include.path should have been called once
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0][0], 'git');
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

test('duplicate scope → second entry is skipped, first token wins', async () => {
  process.env.PAIRS = 'odigos-io/repo-a:id-a\nodigos-io/repo-a:id-duplicate';

  // Only one set of three fetches should be made
  await run({ fetchFn: mockFetch(...happyTriple('ghp_first')), execFileSync: noopExec, env: process.env });

  assert.equal(readOutput().GH_TOKEN, 'ghp_first');
});

// ---------------------------------------------------------------------------
// Fail-fast
// ---------------------------------------------------------------------------

test('OIDC fetch HTTP error → rejects', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  await assert.rejects(
    () => run({
      fetchFn: mockFetch({ ok: false, status: 403 }),
      execFileSync: noopExec,
      env: process.env,
    }),
    /OIDC fetch failed.*403/,
  );
});

test('STS exchange returns no token → rejects', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  await assert.rejects(
    () => run({
      fetchFn: mockFetch(
        { body: { value: 'oidc-token' } },       // OIDC ok
        { body: { message: 'not authorized' } },  // STS returns no token
      ),
      execFileSync: noopExec,
      env: process.env,
    }),
    /no token in STS response/,
  );
});

test('STS exchange HTTP error → rejects', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  await assert.rejects(
    () => run({
      fetchFn: mockFetch(
        { body: { value: 'oidc-token' } },         // OIDC ok
        { ok: false, status: 401, text: 'denied' }, // STS HTTP error
      ),
      execFileSync: noopExec,
      env: process.env,
    }),
    /STS exchange failed.*401/,
  );
});

test('repo permission check fails → rejects', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  await assert.rejects(
    () => run({
      fetchFn: mockFetch(
        { body: { value: 'oidc-token' } },   // OIDC ok
        { body: { token: 'ghp_x' } },         // STS ok
        { ok: false, status: 404 },            // repo check fails
      ),
      execFileSync: noopExec,
      env: process.env,
    }),
    /permission check failed.*404/,
  );
});

test('second pair fails → rejects (fail-fast)', async () => {
  process.env.PAIRS = 'odigos-io/repo-a:id-a\nodigos-io/repo-b:id-b';

  await assert.rejects(
    () => run({
      fetchFn: mockFetch(
        ...happyTriple('ghp_A'),              // repo-a succeeds
        { ok: false, status: 500 },           // OIDC fails for repo-b
      ),
      execFileSync: noopExec,
      env: process.env,
    }),
    /OIDC fetch failed/,
  );
});
