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
| `base_branch` | Branch to tag | `main`, `releases/v1.3.x`, or shorthand `1.3.x` |

**Branch rules** (enforced at runtime):

| Base branch | Allowed bump types |
|---|---|
| Default branch (e.g. `main`) | `minor`, `major`, `pre-minor`, `pre-major`, `rc-minor`, `rc-major` |
| Release branch (`releases/vX.Y.x`) | all except `patch`-from-main restriction |
| Any other branch | ❌ rejected |

> `patch` is the only bump type blocked on the default branch.
> All bump types are valid on a release branch — including `minor`/`major`
> for final promotion so the stable tag lands on the same commit as the last RC.

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

## Pre-release playbook

### Starting a pre-release

The **first** run of a pre-release series must come from **`main`** — this is what creates the `releases/vX.Y.x` branch.

| Goal | Bump | Base branch |
|---|---|---|
| Start a pre-major | `pre-major` | `main` |
| Start a pre-minor | `pre-minor` | `main` |
| Start an rc-major (skipping pre) | `rc-major` | `main` |
| Start an rc-minor (skipping pre) | `rc-minor` | `main` |

A `releases/vX.Y.x` branch is created automatically.

---

### Incrementing a pre (pre on pre)

All subsequent pre iterations run from the **release branch**, so the tag lands on a release-branch commit (not on main).

| Goal | Bump | Base branch |
|---|---|---|
| `v2.0.0-pre.0` → `v2.0.0-pre.1` | `pre-major` | `releases/v2.0.x` |
| `v1.3.0-pre.0` → `v1.3.0-pre.1` | `pre-minor` | `releases/v1.3.x` |

---

### Promoting pre → rc (rc on pre)

Ready to move from pre to release candidate? Run from the **release branch**.

| Goal | Bump | Base branch |
|---|---|---|
| `v2.0.0-pre.N` → `v2.0.0-rc.0` | `rc-major` | `releases/v2.0.x` |
| `v1.3.0-pre.N` → `v1.3.0-rc.0` | `rc-minor` | `releases/v1.3.x` |

> **Note:** `pre-major` / `pre-minor` cannot follow an `rc` — that would be going backwards.

---

### Incrementing an rc (rc on rc)

Run from the **release branch**.

| Goal | Bump | Base branch |
|---|---|---|
| `v2.0.0-rc.0` → `v2.0.0-rc.1` | `rc-major` | `releases/v2.0.x` |
| `v1.3.0-rc.0` → `v1.3.0-rc.1` | `rc-minor` | `releases/v1.3.x` |

---

### Promoting pre/rc → stable

Run from the **release branch** with `major` or `minor`. The stable tag
lands on the same commit as the last RC — not on main.

| Goal | Bump | Base branch |
|---|---|---|
| `v2.0.0-pre.N` or `v2.0.0-rc.N` → `v2.0.0` | `major` | `releases/v2.0.x` |
| `v1.3.0-pre.N` or `v1.3.0-rc.N` → `v1.3.0` | `minor` | `releases/v1.3.x` |

Patch releases from the release branch continue as normal after promotion.

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

The `tag-and-release` action can be called directly from other workflows. Copy-paste the example below and set `sts_identity` to the STS identity configured in your repo.

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
        description: >
          Base branch to tag. Use 'main' for the default branch.
          For release branches, shorthand is accepted:
          '1.3.x', 'v1.3.x', and 'releases/v1.3.x' are all equivalent.
        required: true
        default: main
        type: string

jobs:
  calculate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      current_version: ${{ steps.calc.outputs.current_version }}
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
          sts_identity: your-identity
          new_version:      ${{ needs.calculate.outputs.new_version }}
          previous_version: ${{ needs.calculate.outputs.current_version }}
          create_branch:    ${{ needs.calculate.outputs.create_branch }}
          release_branch:   ${{ needs.calculate.outputs.release_branch }}
          actor:   ${{ github.actor }}
          run_url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

### Inputs & Options

**`operation: calculate`**

| Input | Required | Description |
|---|---|---|
| `bump` | ✅ | Bump type (see branch rules above) |
| `base_branch` | ✅ | Branch being tagged (default branch or `releases/vX.Y.x`) |

**`operation: tag`**

| Input | Required | Default | Description |
|---|---|---|---|
| `new_version` | ✅ | — | Version to tag (from `calculate` outputs) |
| `previous_version` | — | `""` | Previous version for release notes (from `calculate` outputs `current_version`) |
| `bump` | ✅ | — | Original bump type (recorded in tag message) |
| `base_branch` | ✅ | — | Branch being tagged (recorded in tag message) |
| `create_branch` | — | `false` | Whether to create a release branch |
| `release_branch` | — | `""` | Release branch name (e.g. `releases/v1.3.x`) |
| `actor` | — | — | GitHub actor recorded in the tag message |
| `run_url` | — | — | Actions run URL recorded in the tag message |
| `sts_identity` | — | `tag-releaser` | STS identity to request (scope is always `github.repository`) |

### Outputs (calculate phase only)

| Output | Description |
|---|---|
| `current_version` | Latest version tag reachable from HEAD |
| `new_version` | Calculated next version |
| `create_branch` | `"true"` if a release branch should be created |
| `release_branch` | Release branch name (e.g. `releases/v1.3.x`) |
