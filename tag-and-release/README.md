# 🏷️ tag-and-release

Semantic version tagging and GitHub release creation, with a human approval gate.

---

## What it does

Runs three jobs when triggered:

1. **calculate** — computes the next version from git tag history and writes a preview to the job summary.
2. **confirm** — pauses at the `release-gate` environment for human approval.
3. **tag** — creates an annotated git tag, pushes it, creates a GitHub release, and (when required) creates the release branch.

Rejecting or dismissing the gate cancels the run. No tag is created.

### Trigger

Go to **Actions → Tag and Release → Run workflow** and fill in:

| Input | Description | Example |
|---|---|---|
| `bump` | Version bump type | `minor` |
| `base_branch` | Branch to tag | `main` or `releases/1.3.x` |

### Version bump logic

| Bump | Current | → New | Branch created? |
|---|---|---|---|
| `major` | `v1.2.3` | `v2.0.0` | ✅ `releases/v2.0.x` |
| `major` | `v2.0.0-pre.N` | `v2.0.0` | — *(promotes pre to stable; branch already exists)* |
| `minor` | `v1.2.3` | `v1.3.0` | ✅ `releases/v1.3.x` |
| `minor` | `v1.3.0-pre.N` | `v1.3.0` | — *(promotes pre to stable; branch already exists)* |
| `patch` | `v1.2.3` | `v1.2.4` | — |
| `patch` | `v1.3.0-pre.N` | `v1.3.0` | — *(on `releases/vX.Y.x`: promotes to stable)* |
| `patch` | `v1.3.0-rc.N` | `v1.3.0` | — *(on `releases/vX.Y.x`: promotes to stable)* |
| `pre-minor` | `v1.2.3` | `v1.3.0-pre.0` | ✅ `releases/v1.3.x` |
| `pre-minor` | `v1.3.0-pre.N` | `v1.3.0-pre.N+1` | — |
| `pre-major` | `v1.2.3` | `v2.0.0-pre.0` | ✅ `releases/v2.0.x` |
| `pre-major` | `v2.0.0-pre.N` | `v2.0.0-pre.N+1` | — |
| `rc-minor` | `v1.2.3` | `v1.3.0-rc.0` | ✅ `releases/v1.3.x` |
| `rc-minor` | `v1.3.0-pre.N` | `v1.3.0-rc.0` | — *(branch already exists)* |
| `rc-minor` | `v1.3.0-rc.N` | `v1.3.0-rc.N+1` | — |
| `rc-major` | `v1.2.3` | `v2.0.0-rc.0` | ✅ `releases/v2.0.x` |
| `rc-major` | `v2.0.0-pre.N` | `v2.0.0-rc.0` | — *(branch already exists)* |
| `rc-major` | `v2.0.0-rc.N` | `v2.0.0-rc.N+1` | — |

No tags → treated as `v0.0.0` baseline for all bump types.

**Error cases:** `pre-minor` / `pre-major` cannot follow an `rc`.

---

## What you need

### 1. `release-gate` environment

Create a GitHub Environment named **`release-gate`** with required reviewers. The workflow pauses there before creating any tag.

### 2. STS identity

The `tag` job authenticates via [octo-sts](../sts/README.md). An identity file must exist in the **target repo** granting `contents: write`:

```yaml
# filename -> .github/chainguard/<identity-name>.sts.yaml
# Make sure to update the subject_pattern to match your repo and workflow structure!
issuer: https://token.actions.githubusercontent.com
subject_pattern: '^repo:odigos-io/ci-core:(tag:.*|ref:refs/heads/.*)$'

permissions:
  contents: write
```

### 3. Job permissions

The job calling `operation: tag` must declare:

```yaml
permissions:
  id-token: write  # required for STS OIDC exchange
  contents: read   # required for checkout
```

And the checkout step must set `persist-credentials: false` so that the STS token is used for pushes.

---

## Using as an action

The `tag-and-release` action can be called directly from other workflows. Copy-paste the example below and adjust `sts_scope` / `sts_identity` for your repo.

```yaml
name: Tag and Release
run-name: "Tag and Release · ${{ inputs.bump }} on ${{ inputs.base_branch }}"

concurrency:
  group: tag-and-release
  cancel-in-progress: false

permissions: read-all

on:
  workflow_dispatch:
    inputs:
      bump:
        description: "Version bump type"
        required: true
        type: choice
        options: [patch, minor, major, pre-minor, pre-major, rc-minor, rc-major]
      base_branch:
        description: "Base branch to tag (e.g. main, releases/v1.9.x)"
        required: true
        default: main
        type: string

jobs:
  calculate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      new_version:    ${{ steps.calc.outputs.new_version }}
      create_branch:  ${{ steps.calc.outputs.create_branch }}
      release_branch: ${{ steps.calc.outputs.release_branch }}
    steps:
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

  # This job runs inside the "release-gate" environment.
  # Configure that environment with required reviewers so GitHub pauses
  # here and asks for manual approval before the tag job proceeds.
  # Rejecting or dismissing cancels the workflow without creating any tag.
  confirm:
    needs: calculate
    runs-on: ubuntu-latest
    environment: release-gate
    steps:
      - name: Release approved
        run: echo "Releasing ${{ needs.calculate.outputs.new_version }} from ${{ inputs.base_branch }}"

  tag:
    needs: [calculate, confirm]
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # required for STS OIDC token exchange
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.base_branch }}
          fetch-depth: 0
          fetch-tags: true
          persist-credentials: false  # STS handles auth

      - uses: odigos-io/ci-core/tag-and-release@main
        with:
          operation: tag
          bump: ${{ inputs.bump }}
          base_branch: ${{ inputs.base_branch }}
          sts_scope:    your-org/your-repo
          sts_identity: your-identity
          new_version:    ${{ needs.calculate.outputs.new_version }}
          create_branch:  ${{ needs.calculate.outputs.create_branch }}
          release_branch: ${{ needs.calculate.outputs.release_branch }}
          actor:   ${{ github.actor }}
          run_url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

### Inputs & Options

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
| `release_branch` | — | `""` | Release branch name (e.g. `releases/v1.3.x`) |
| `actor` | — | — | GitHub actor recorded in the tag message |
| `run_url` | — | — | Actions run URL recorded in the tag message |
| `sts_scope` | — | `odigos-io/ci-core` | Repo scope for the STS token |
| `sts_identity` | — | `tag-releaser` | STS identity to request |

### Outputs (calculate phase only)

| Output | Description |
|---|---|
| `current_version` | Latest version tag reachable from HEAD |
| `new_version` | Calculated next version |
| `create_branch` | `"true"` if a release branch should be created |
| `release_branch` | Release branch name (e.g. `releases/v1.3.x`) |
