# dispatch-agent-version-update

Dispatch an instrumentation-agent version bump from a release workflow to the odigos
consumer repos (`odigos`, `odigos-enterprise`, `vm-agent`).

The consumer, afterwards, applies it via [`apply-agent-version-update`](../apply-agent-version-update).

## Usage

```yaml
jobs:
  trigger-odigos-update:
    needs: [calculate, publish]
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # required for the STS OIDC exchange
      contents: read
    steps:
      - uses: odigos-io/ci-core/dispatch-agent-version-update@main
        with:
          instrumentation_agent: php
          version: ${{ needs.calculate.outputs.new_version }}
          # consumers omitted -> dispatches to all defaults.
          # Set consumers to target a subset, e.g. consumers: "vm-agent"
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `instrumentation_agent` | yes | — | Language instrumentation being released (e.g. `php`, `ruby`, `python`, `golang`, …). |
| `version` | yes | — | Released version to propagate (e.g. `v0.11.0`). |
| `consumers` | no | `odigos&odigos-enterprise&vm-agent` | `&`-separated consumer repos to dispatch to (commas/spaces/newlines also accepted). Valid: `odigos`, `odigos-enterprise`, `vm-agent`. |

## Notes

- The instrumentation repo must be trusted by each targeted consumer's STS dispatch identity.
- Broadcasting to a consumer that doesn't pin this instrumentation is safe: its `upgrade-agent`
  make target no-ops on unknown values. Still, set `consumers` to the repos that actually consume
  it so an untrusted consumer isn't dispatched to.
- This action does not post to Slack — the consumer-side `apply-agent-version-update` posts the PR link.
