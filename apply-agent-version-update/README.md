# apply-agent-version-update

Consumer-side half of the instrumentation-agent version-update flow. Logs in to public ECR, runs
the repo's `upgrade-agent` make target (with retries) and, if anything changed, opens an
auto-merging PR. Slack is notified when a PR is opened or updated, or when the update fails.

The per-repo mapping (category → image/module, Dockerfile vs go.mod) lives in that repo's
`upgrade-agent` make target — not here.

## Usage

The calling job checks out the repo with a read-only STS token, then invokes this action
(repos whose bump touches `go.mod` set up Go and any private-module read tokens beforehand):

```yaml
jobs:
  update-version-and-create-pr:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      # resolve instrumentation_agent + version from the trigger payload
      # checkout with a read-only STS token
      - uses: odigos-io/ci-core/apply-agent-version-update@main
        with:
          instrumentation_agent: ${{ steps.in.outputs.instrumentation_agent }}
          version: ${{ steps.in.outputs.version }}
          make_dir: <dir containing agent-deps.mk>
          webhook-url: ${{ secrets.RELEASE_STATUS_WEBHOOK_URL }}
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `instrumentation_agent` | yes | — | Language instrumentation to update. |
| `version` | yes | — | Version to set (e.g. `v0.11.0`). |
| `make_dir` | no | `.` | Directory containing the repo's `agent-deps.mk`. |
| `webhook-url` | yes | — | Slack webhook for the release-status notification. |
| `automerge` | no | `true` | Enable auto-merge on the created PR. |
| `ecr-login` | no | `true` | Log in to public ECR before running `make`. Set `false` to pull anonymously. |
| `ecr-role-to-assume` | no | `arn:aws:iam::061717858829:role/ecr-pull-push-role` | IAM role assumed over OIDC for the ECR login. |

## Reliability

- **Public ECR login.** Digest lookups (`docker buildx imagetools inspect public.ecr.aws/...`) from
  shared runner IPs hit public ECR's anonymous rate and data limits (`429 Too Many Requests`). The
  action assumes `ecr-role-to-assume` over OIDC, which needs `id-token: write` on the calling job and
  the role's trust policy to cover the calling repo. The AWS credentials are kept out of the job
  environment and used only for `docker login`, and the registry login is removed right after `make`.
  If the role can't be assumed or the login fails, the run continues anonymously with a warning.
- **Retries.** `upgrade-agent` gets 3 attempts (30s, then 60s apart). Tracked files are
  restored between attempts so a partial rewrite never reaches the PR, which is why the target must
  be idempotent (see the contract below).
- **Input validation.** `instrumentation_agent` and `version` must match `^[A-Za-z0-9._-]+$`,
  because make expands them into recipe shells.
- **Failure alerts.** A failed or cancelled update, or a failure while opening or auto-merging the
  PR, posts the failure message to `webhook-url`. The result is
  derived from this action's own steps, because `job.status` doesn't reflect failures inside a
  composite action. Steps the calling job runs before this action (token, checkout) aren't covered.

## Contract

Each consumer repo must expose an `agent-deps.mk` (in `make_dir`) with an `upgrade-agent` target:

```
make -f agent-deps.mk upgrade-agent INSTRUMENTATION_AGENT=<instrumentation_agent> AGENT_VERSION=<version>
```

It must update whatever that repo pins for the instrumentation (Dockerfile image tags and/or
`go.mod`/`go.sum`), **no-op on unknown instrumentations** so releases can broadcast safely, and be
**idempotent** so a retry after a partial run produces the same result.

## Canonical instrumentations

One `instrumentation_agent` value == one release stream, standardized across consuming repos so a
single dispatched value routes correctly everywhere. The set of supported values is defined by each
consumer repo's `upgrade-agent` make target; unknown values no-op.

## Onboarding a new agent — zero framework change

A new agent needs no changes to this action or the dispatch action. In short:

1. The instrumentation repo's release workflow calls `dispatch-agent-version-update` with the new
   `instrumentation_agent` value and the `consumers` that pin it.
2. Each consuming repo handles the new value in its own `upgrade-agent` make target.
3. The relevant STS trust is granted in the consumer repos.

Repo-specific wiring (make targets, module read access, trust policies) lives in the consumer
repos, not here.
