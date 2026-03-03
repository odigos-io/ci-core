# 🏷️ tag-and-release

Semantic version tagging and GitHub release creation, with a human approval gate.

Two parts:
- **`tag-and-release.yml`** — a `workflow_dispatch` workflow you trigger manually to cut a release.
- **`tag-and-release/action.yml`** — a reusable composite action (used internally by the workflow, and available for other repos).

---

## Workflow: Triggering a release

Go to **Actions → Tag and Release → Run workflow** and fill in:

| Input | Description | Example |
|---|---|---|
| `bump` | Version bump type (see table below) | `minor` |
| `base_branch` | Branch to tag | `main` or `releases/1.3.x` |

The workflow runs three jobs:

1. **calculate** — computes the next version and shows a preview summary.
2. **confirm** — pauses at the `release-gate` environment for manual approval.
3. **tag** — creates the annotated git tag, GitHub release, and release branch (when required).

> Rejecting or dismissing the gate cancels the run. No tag is created.

### Version bump logic

| Bump | Current | → New | Branch created? |
|---|---|---|---|
| `major` | `v1.2.3` | `v2.0.0` | ✅ `releases/2.0.x` |
| `minor` | `v1.2.3` | `v1.3.0` | ✅ `releases/1.3.x` |
| `patch` | `v1.2.3` | `v1.2.4` | — |
| `patch` | `v1.3.0-pre.N` | `v1.3.0` | — *(promotes to stable)* |
| `patch` | `v1.3.0-rc.N` | `v1.3.0` | — *(promotes to stable)* |
| `pre-minor` | `v1.2.3` | `v1.3.0-pre.0` | ✅ `releases/1.3.x` |
| `pre-minor` | `v1.3.0-pre.N` | `v1.3.0-pre.N+1` | — |
| `pre-major` | `v1.2.3` | `v2.0.0-pre.0` | ✅ `releases/2.0.x` |
| `rc-minor` | `v1.2.3` | `v1.3.0-rc.0` | ✅ `releases/1.3.x` |
| `rc-minor` | `v1.3.0-pre.N` | `v1.3.0-rc.0` | — *(branch already exists)* |
| `rc-minor` | `v1.3.0-rc.N` | `v1.3.0-rc.N+1` | — |
| `rc-major` | `v1.2.3` | `v2.0.0-rc.0` | ✅ `releases/2.0.x` |

No tags → treated as `v0.0.0` baseline for all bump types.

**Error cases:** `pre-minor` / `pre-major` cannot follow an `rc`. `pre-major` / `rc-major` cannot be used when already on a pre-release.

---

## Prerequisites

### `release-gate` environment

Create a GitHub Environment named **`release-gate`** with required reviewers. The workflow pauses there waiting for approval before creating any tag.

### STS identity

The `tag` job authenticates via [octo-sts](../sts/README.md). An identity file must exist in this repo granting `contents: write`:

```yaml
# .github/chainguard/<identity-name>.sts.yaml
issuer: https://token.actions.githubusercontent.com
subject_pattern: '^repo:odigos-io/ci-core:(tag:.*|ref:refs/heads/.*)$'

permissions:
  contents: write
```

---

## Composite action

The `tag-and-release` action can be used directly in other workflows.

```yaml
- uses: actions/checkout@v4
  with:
    ref: ${{ inputs.base_branch }}
    fetch-depth: 0
    fetch-tags: true

- id: calc
  uses: odigos-io/ci-core/tag-and-release@main
  with:
    operation: calculate
    bump: ${{ inputs.bump }}
    base_branch: ${{ inputs.base_branch }}

# ... approval gate job ...

- uses: actions/checkout@v4
  with:
    ref: ${{ inputs.base_branch }}
    fetch-depth: 0
    fetch-tags: true
    persist-credentials: false

- uses: odigos-io/ci-core/tag-and-release@main
  with:
    operation: tag
    bump: ${{ inputs.bump }}
    base_branch: ${{ inputs.base_branch }}
    new_version: ${{ needs.calculate.outputs.new_version }}
    create_branch: ${{ needs.calculate.outputs.create_branch }}
    release_branch: ${{ needs.calculate.outputs.release_branch }}
    actor: ${{ github.actor }}
    run_url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
    sts_scope: your-org/your-repo
    sts_identity: your-identity
```

### Inputs

**`operation: calculate`**

| Input | Required | Description |
|---|---|---|
| `bump` | ✅ | Bump type |
| `base_branch` | ✅ | Branch being tagged |

**`operation: tag`**

| Input | Required | Default | Description |
|---|---|---|---|
| `new_version` | ✅ | — | Version to tag (from `calculate` outputs) |
| `bump` | ✅ | — | Original bump type (recorded in tag message) |
| `base_branch` | ✅ | — | Branch being tagged (recorded in tag message) |
| `create_branch` | — | `false` | Whether to create a release branch |
| `release_branch` | — | `""` | Release branch name (e.g. `releases/1.3.x`) |
| `actor` | — | — | GitHub actor recorded in the tag message |
| `run_url` | — | — | Actions run URL recorded in the tag message |
| `sts_scope` | — | `odigos-io/ci-core` | Repo scope for the STS token |
| `sts_identity` | — | `tag-releaser` | STS identity to request |

The calling job must have `id-token: write` permission for the STS OIDC exchange, and the repo must be checked out with `persist-credentials: false`.

### Outputs (calculate phase only)

| Output | Description |
|---|---|
| `current_version` | Latest version tag reachable from HEAD |
| `new_version` | Calculated next version |
| `create_branch` | `"true"` if a release branch should be created |
| `release_branch` | Release branch name (e.g. `releases/1.3.x`) |
