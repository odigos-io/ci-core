'use strict';

const fs               = require('fs');
const childProcess     = require('child_process');

// ---------------------------------------------------------------------------
// run() — can be called directly or injected with mocks for testing
// Throws Error on any failure; caller is responsible for process.exit.
// ---------------------------------------------------------------------------
async function run({
  fetchFn       = globalThis.fetch,
  execFileSync  = childProcess.execFileSync,
  env           = process.env,
} = {}) {

  const rawPairs        = (env.PAIRS     || '').trim();
  const legacyScope     = (env.SCOPE     || '').trim();
  const legacyIdentity  = (env.IDENTITY  || '').trim();
  const outputGitConfig = env.OUTPUT_GIT_CONFIG === 'true';
  const domain          = env.DOMAIN || 'octo-sts.dev';
  const githubOutput    = env.GITHUB_OUTPUT || '';
  const gitConfigFile   = '/tmp/odigos.gitconfig';

  // ── resolve input mode ─────────────────────────────────────────────────────
  const hasPairs  = rawPairs.length > 0;
  const hasLegacy = legacyScope.length > 0 && legacyIdentity.length > 0;

  if (hasPairs && hasLegacy) {
    throw new Error('provide either "pairs" or "scope"/"identity", not both');
  }
  if (!hasPairs && !hasLegacy) {
    throw new Error('one of "pairs" or "scope"+"identity" is required');
  }

  const pairsInput = hasPairs
    ? rawPairs
    : `${legacyScope}:${legacyIdentity}`;

  // ── process pairs ──────────────────────────────────────────────────────────

  const seen      = new Set();
  let   lastToken = '';

  for (const rawLine of pairsInput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // parse "scope:identity"
    const cut      = line.indexOf(':');
    const scope    = cut !== -1 ? line.slice(0, cut).trim()  : '';
    const identity = cut !== -1 ? line.slice(cut + 1).trim() : '';

    if (!scope || !identity) {
      throw new Error(`invalid pair '${line}' — expected 'scope:identity'`);
    }

    const dedupKey = `${scope}:${identity}`;
    if (seen.has(dedupKey)) {
      process.stdout.write(`::warning::duplicate pair '${scope}:${identity}' — skipping\n`);
      continue;
    }
    seen.add(dedupKey);

    console.log(`[ + ] scope=${scope}  identity=${identity}`);

    // ── step 1: obtain a GitHub Actions OIDC token ─────────────────────────
    const oidcRes = await fetchFn(
      `${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${domain}`,
      { headers: { Authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } },
    );
    if (!oidcRes.ok) {
      throw new Error(`OIDC fetch failed for ${scope}: HTTP ${oidcRes.status}`);
    }
    const { value: oidcToken } = await oidcRes.json();
    if (!oidcToken) {
      throw new Error(`empty OIDC token for ${scope}`);
    }

    // ── step 2: exchange OIDC token → scoped GitHub token ──────────────────
    const stsRes = await fetchFn(
      `https://${domain}/sts/exchange?scope=${scope}&identity=${identity}`,
      { headers: { Authorization: `Bearer ${oidcToken}` } },
    );
    if (!stsRes.ok) {
      const msg = await stsRes.text();
      throw new Error(`STS exchange failed for ${scope}/${identity}: HTTP ${stsRes.status} — ${msg}`);
    }
    const { token: ghToken, message } = await stsRes.json();
    if (!ghToken) {
      throw new Error(`no token in STS response for ${scope}: ${message ?? '(no message)'}`);
    }

    process.stdout.write(`::add-mask::${ghToken}\n`);

    // ── step 3: verify the token can actually reach the repo ───────────────
    const repoRes = await fetchFn(`https://api.github.com/repos/${scope}`, {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'odigos-ci-core-sts',
      },
    });
    if (!repoRes.ok) {
      throw new Error(`permission check failed for ${scope}: HTTP ${repoRes.status}`);
    }

    // ── step 4: write gitconfig entry ──────────────────────────────────────
    if (outputGitConfig) {
      // Write directly — keeps the token out of process args / shell history
      fs.appendFileSync(
        gitConfigFile,
        `[url "https://x:${ghToken}@github.com/${scope}"]\n\tinsteadOf = https://github.com/${scope}\n`,
      );
    }

    lastToken = ghToken;
    console.log(`[ + ] ok: ${scope}`);
  }

  if (!lastToken) {
    throw new Error('no valid pairs were processed');
  }

  if (outputGitConfig) {
    execFileSync('git', ['config', '--global', 'include.path', gitConfigFile]);
    fs.appendFileSync(githubOutput, `GIT_CONFIG_PATH=${gitConfigFile}\n`);
    console.log('[ + ] git configured for all scopes');
  }

  fs.appendFileSync(githubOutput, `GH_TOKEN=${lastToken}\n`);
  console.log('[ + ] done');
}

// ---------------------------------------------------------------------------
// Entry point when executed directly by the action
// ---------------------------------------------------------------------------
if (require.main === module) {
  run().catch(e => {
    process.stderr.write(`::error::${e.message}\n`);
    process.exit(1);
  });
}

module.exports = { run };
