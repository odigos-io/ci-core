# apply-agent-version-update

Consumer-side half of the instrumentation-agent version-update flow. Runs the repo's
`upgrade-agent` make target and, if anything changed, opens an auto-merging PR and notifies
Slack.

The per-repo mapping (category → image/module, Dockerfile vs go.mod) lives in that repo's
`upgrade-agent` make target — not here.

## Usage

The calling job checks out the repo (with an `ro` STS token) and, when the bump touches
`go.mod`, sets up Go + private-module read tokens, then invokes this action:

```yaml
jobs:
  update-version-and-create-pr:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Resolve inputs
        id: in
        run: |  # map workflow_dispatch inputs / repository_dispatch payload -> instrumentation_agent + version
          ...
      - uses: odigos-io/ci-core/sts@main
        id: sts
        with: { scope: "${{ github.repository }}", identity: ro }
      - uses: actions/checkout@v6
        with: { token: "${{ steps.sts.outputs.GH_TOKEN }}" }
      # (go-module repos only) setup-go + GOPRIVATE + private-deps read tokens here
      - uses: odigos-io/ci-core/apply-agent-version-update@main
        with:
          instrumentation_agent: ${{ steps.in.outputs.instrumentation_agent }}
          version: ${{ steps.in.outputs.version }}
          make_dir: odiglet         # or "." for repo-root makefiles (vm-agent)
          webhook-url: ${{ secrets.ODIGOS_RELEASE_STATUS_WEBHOOK_URL }}
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

One value == one release stream. Standardized across all repos so a single dispatched
`instrumentation_agent` routes correctly everywhere:

`python`, `php`, `ruby`, `nodejs-community`, `nodejs-enterprise`, `python-ebpf`, `java-ebpf`,
`golang` — and `cpp` once onboarded.

## Onboarding a new agent (e.g. cpp) — zero framework change

The slot is designed so a new agent needs no changes to this action or the wrappers:

1. **Instrumentation repo** — in its release workflow, call
   `odigos-io/ci-core/dispatch-agent-version-update@main` with `instrumentation_agent: cpp`,
   `version: <tag>`, and `consumers` listing the repos that pin it (e.g.
   `consumers: "odigos-enterprise vm-agent"`).
2. **Each consuming repo** — add a `cpp)` branch to that repo's `upgrade-agent` make-target
   dispatcher that updates whatever it pins (image tag via `upgrade-agent-image` /
   `upgrade-odiglet-agent-version`, and/or a `go get <module>@$(AGENT_VERSION)` + `go mod tidy`,
   or a `go mod edit -replace` for a forked module).
3. **octo-sts** — ensure the instrumentation repo is trusted by each target consumer's
   `trigger-agent-version-updater` identity, and (for go.mod bumps) that the consumer can read
   the new module repo (`ro` octo-sts identity or `RELEASE_BOT_TOKEN`).

No change to `ci-core/apply-agent-version-update`, `ci-core/dispatch-agent-version-update`, or any
consumer wrapper workflow is required.
