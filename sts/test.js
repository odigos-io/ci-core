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

test('identity-only with default scope (simulates github.repository default)', async () => {
  process.env.SCOPE    = 'odigos-io/current-repo';
  process.env.IDENTITY = 'ro';

  await run({ fetchFn: mockFetch(...happyTriple('ghp_default_scope')), execFileSync: noopExec, env: process.env });

  assert.equal(readOutput().GH_TOKEN, 'ghp_default_scope');
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

test('exact duplicate pair → second entry is skipped, first token wins', async () => {
  process.env.PAIRS = 'odigos-io/repo-a:id-a\nodigos-io/repo-a:id-a';

  // Only one set of three fetches should be made
  await run({ fetchFn: mockFetch(...happyTriple('ghp_first')), execFileSync: noopExec, env: process.env });

  assert.equal(readOutput().GH_TOKEN, 'ghp_first');
});

test('same scope different identity → both tokens are fetched, last wins', async () => {
  process.env.PAIRS = 'odigos-io/repo-a:id-a\nodigos-io/repo-a:id-b';

  await run({
    fetchFn:      mockFetch(...happyTriple('ghp_A'), ...happyTriple('ghp_B')),
    execFileSync: noopExec,
    env:          process.env,
  });

  assert.equal(readOutput().GH_TOKEN, 'ghp_B');
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

test('STS exchange HTTP 4xx error → rejects immediately (no retry)', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  await assert.rejects(
    () => run({
      fetchFn: mockFetch(
        { body: { value: 'oidc-token' } },         // OIDC ok
        { ok: false, status: 401, text: 'denied' }, // STS 4xx — no retry
      ),
      execFileSync: noopExec,
      env: process.env,
      sleepFn: async () => {},
    }),
    /STS exchange failed.*401/,
  );
});

test('STS exchange 500 → retries and succeeds on second attempt', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  const sleepCalls = [];
  await run({
    fetchFn: mockFetch(
      { body: { value: 'oidc-token' } },                  // OIDC ok
      { ok: false, status: 500, text: 'internal error' },  // STS attempt 1 fails
      { body: { token: 'ghp_retry_ok' } },                 // STS attempt 2 succeeds
      { body: { id: 1, name: 'repo' } },                   // repo check ok
    ),
    execFileSync: noopExec,
    env: process.env,
    sleepFn: async (ms) => { sleepCalls.push(ms); },
  });

  assert.equal(readOutput().GH_TOKEN, 'ghp_retry_ok');
  assert.deepStrictEqual(sleepCalls, [1000]);
});

test('STS exchange 502 → retries 3 times then rejects', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  const sleepCalls = [];
  await assert.rejects(
    () => run({
      fetchFn: mockFetch(
        { body: { value: 'oidc-token' } },                  // OIDC ok
        { ok: false, status: 502, text: 'bad gateway' },     // attempt 1
        { ok: false, status: 502, text: 'bad gateway' },     // attempt 2
        { ok: false, status: 502, text: 'bad gateway' },     // attempt 3
      ),
      execFileSync: noopExec,
      env: process.env,
      sleepFn: async (ms) => { sleepCalls.push(ms); },
    }),
    /STS exchange failed.*502/,
  );

  assert.deepStrictEqual(sleepCalls, [1000, 2000]);
});

test('STS exchange 500 → recovers on third attempt', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  const sleepCalls = [];
  await run({
    fetchFn: mockFetch(
      { body: { value: 'oidc-token' } },                  // OIDC ok
      { ok: false, status: 500, text: 'error' },           // STS attempt 1
      { ok: false, status: 503, text: 'unavailable' },     // STS attempt 2
      { body: { token: 'ghp_third' } },                    // STS attempt 3 ok
      { body: { id: 1, name: 'repo' } },                   // repo check ok
    ),
    execFileSync: noopExec,
    env: process.env,
    sleepFn: async (ms) => { sleepCalls.push(ms); },
  });

  assert.equal(readOutput().GH_TOKEN, 'ghp_third');
  assert.deepStrictEqual(sleepCalls, [1000, 2000]);
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

// ---------------------------------------------------------------------------
// OIDC edge cases
// ---------------------------------------------------------------------------

test('OIDC response missing value field → rejects with empty OIDC token', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';

  await assert.rejects(
    () => run({
      fetchFn: mockFetch({ body: {} }),   // ok:true but no `value`
      execFileSync: noopExec,
      env: process.env,
    }),
    /empty OIDC token/,
  );
});

// ---------------------------------------------------------------------------
// gitconfig output
// ---------------------------------------------------------------------------

test('OUTPUT_GIT_CONFIG=true → GIT_CONFIG_PATH written to GITHUB_OUTPUT', async () => {
  process.env.PAIRS             = 'odigos-io/my-repo:my-identity';
  process.env.OUTPUT_GIT_CONFIG = 'true';

  const execCalls = [];
  await run({
    fetchFn:      mockFetch(...happyTriple('ghp_cfg')),
    execFileSync: (...args) => execCalls.push(args),
    env:          process.env,
  });

  const out = readOutput();
  assert.equal(out.GH_TOKEN,       'ghp_cfg');
  assert.equal(out.GIT_CONFIG_PATH, '/tmp/odigos.gitconfig');
});

test('OUTPUT_GIT_CONFIG=true single pair → gitconfig contains token and scope', async () => {
  process.env.PAIRS             = 'odigos-io/my-repo:my-identity';
  process.env.OUTPUT_GIT_CONFIG = 'true';

  await run({
    fetchFn:      mockFetch(...happyTriple('ghp_single')),
    execFileSync: noopExec,
    env:          process.env,
  });

  const cfg = fs.readFileSync('/tmp/odigos.gitconfig', 'utf8');
  assert.match(cfg, /ghp_single/);
  assert.match(cfg, /odigos-io\/my-repo/);
});

test('successive run() calls accumulate gitconfig entries (multi-step scenario)', async () => {
  process.env.OUTPUT_GIT_CONFIG = 'true';

  process.env.PAIRS = 'odigos-io/repo-a:ro';
  await run({ fetchFn: mockFetch(...happyTriple('ghp_A')), execFileSync: noopExec, env: process.env });

  process.env.PAIRS = 'odigos-io/repo-b:ro';
  await run({ fetchFn: mockFetch(...happyTriple('ghp_B')), execFileSync: noopExec, env: process.env });

  const cfg = fs.readFileSync('/tmp/odigos.gitconfig', 'utf8');
  assert.match(cfg, /repo-a/);
  assert.match(cfg, /repo-b/);
});

test('OUTPUT_GIT_CONFIG=false → git exec not called, no GIT_CONFIG_PATH output', async () => {
  process.env.PAIRS             = 'odigos-io/my-repo:my-identity';
  process.env.OUTPUT_GIT_CONFIG = 'false';

  const execCalls = [];
  await run({
    fetchFn:      mockFetch(...happyTriple('ghp_noconfig')),
    execFileSync: (...args) => execCalls.push(args),
    env:          process.env,
  });

  assert.equal(execCalls.length, 0);
  assert.equal(readOutput().GIT_CONFIG_PATH, undefined);
});

// ---------------------------------------------------------------------------
// Missing OIDC environment
// ---------------------------------------------------------------------------

test('missing ACTIONS_ID_TOKEN_REQUEST_URL → rejects with actionable message', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;

  await assert.rejects(
    () => run({ fetchFn: mockFetch(), execFileSync: noopExec, env: process.env }),
    /id-token: write/,
  );
});

test('missing ACTIONS_ID_TOKEN_REQUEST_TOKEN → rejects with actionable message', async () => {
  process.env.PAIRS = 'odigos-io/my-repo:my-identity';
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

  await assert.rejects(
    () => run({ fetchFn: mockFetch(), execFileSync: noopExec, env: process.env }),
    /id-token: write/,
  );
});

// ---------------------------------------------------------------------------
// Custom domain
// ---------------------------------------------------------------------------

test('custom DOMAIN → used in OIDC audience and STS exchange URL', async () => {
  process.env.PAIRS   = 'odigos-io/my-repo:my-identity';
  process.env.DOMAIN  = 'custom-sts.example.com';

  const capturedUrls = [];
  const capturingFetch = async (url, opts) => {
    capturedUrls.push(url);
    const defaults = happyTriple('ghp_custom');
    const r = defaults[capturedUrls.length - 1];
    return {
      ok:   r.ok   ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => r.text ?? JSON.stringify(r.body ?? {}),
    };
  };

  await run({ fetchFn: capturingFetch, execFileSync: noopExec, env: process.env });

  // OIDC audience should include custom domain
  assert.match(capturedUrls[0], /custom-sts\.example\.com/);
  // STS exchange URL should use custom domain
  assert.match(capturedUrls[1], /custom-sts\.example\.com/);
});
