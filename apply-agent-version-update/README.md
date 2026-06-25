# apply-agent-version-update

Consumer-side half of the instrumentation-agent version-update flow. Runs the repo's
`upgrade-agent` make target and, if anything changed, opens an auto-merging PR and notifies
Slack.

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

## Contract

Each consumer repo must expose an `agent-deps.mk` (in `make_dir`) with an `upgrade-agent` target:

```
make -f agent-deps.mk upgrade-agent INSTRUMENTATION_AGENT=<instrumentation_agent> AGENT_VERSION=<version>
```

It must update whatever that repo pins for the instrumentation (Dockerfile image tags and/or
`go.mod`/`go.sum`) and **no-op on unknown instrumentations** so releases can broadcast safely.

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
