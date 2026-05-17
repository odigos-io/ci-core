# cherry-pick

Backport merged pull requests to release branches when the PR description includes a `cherry-pick:` line.

Runs in two phases (like [tag-and-release](../tag-and-release/README.md)):

1. **extract** — on push to the default branch, find the merged PR for the commit and parse target versions from its body.
2. **backport** — for each version, cherry-pick onto `releases/vX.Y.0` (configurable) and open a labeled pull request.

---

## PR format

Add a line to the merged PR description (case-insensitive):

```text
cherry-pick: v1.3, v1.4
```

Short forms are accepted and normalized to `v1.X`:

```text
cherry-pick: 1.3, 1.4
```

Invalid entries are skipped with a warning. If the line is missing or no valid versions remain, the workflow exits without creating PRs.

---

## Release branches

By default, version `v1.3` maps to branch `releases/v1.3.0` (`release-branch-prefix` + version + `release-branch-suffix`).

Override with inputs when your naming differs.

---

## Setup

### 1. STS identities

Create two identity files in the consuming repo (see [sts](../sts/README.md)):

**`cherry-pick-decision`** — read merged PR metadata on push to main:

```yaml
# .github/chainguard/cherry-pick-decision.sts.yaml
issuer: https://token.actions.githubusercontent.com
subject_pattern: repo:YOUR_ORG/YOUR_REPO:ref:refs/heads/main

permissions:
  contents: read
  pull_requests: read
```

**`create-pr`** — cherry-pick and open backport PRs:

```yaml
# .github/chainguard/create-pr.sts.yaml
issuer: https://token.actions.githubusercontent.com
subject_pattern: repo:YOUR_ORG/YOUR_REPO:ref:.*

permissions:
  contents: write
  pull_requests: write
```

### 2. Label

Ensure a `cherry-pick` label exists in the repository (used on created PRs).

### 3. Workflow

The action does not define jobs or a version matrix. The consuming repo workflow triggers on push, runs **extract** once, then **backport** in a matrix over `versions`.

---

## Usage

### Full workflow example

```yaml
name: Cherry Pick to Release Branches

on:
  push:
    branches:
      - main

permissions: read-all

jobs:
  extract-versions:
    runs-on: depot-ubuntu-latest
    permissions:
      id-token: write
    outputs:
      run_cherry_pick: ${{ steps.extract.outputs.run_cherry_pick }}
      versions: ${{ steps.extract.outputs.versions }}
      pr_number: ${{ steps.extract.outputs.pr_number }}
      merge_commit_sha: ${{ steps.extract.outputs.merge_commit_sha }}
      pr_title: ${{ steps.extract.outputs.pr_title }}
      pr_user_login: ${{ steps.extract.outputs.pr_user_login }}
      original_pr_body: ${{ steps.extract.outputs.original_pr_body }}
    steps:
      - uses: odigos-io/ci-core/cherry-pick@main
        id: extract
        with:
          operation: extract

  cherry-pick:
    needs: extract-versions
    if: needs.extract-versions.outputs.run_cherry_pick == 'true'
    runs-on: depot-ubuntu-latest
    permissions:
      id-token: write
    strategy:
      fail-fast: false
      matrix:
        version: ${{ fromJson(needs.extract-versions.outputs.versions) }}
    steps:
      - uses: odigos-io/ci-core/cherry-pick@main
        with:
          operation: backport
          version: ${{ matrix.version }}
          merge-commit-sha: ${{ needs.extract-versions.outputs.merge_commit_sha }}
          pr-number: ${{ needs.extract-versions.outputs.pr_number }}
          pr-title: ${{ needs.extract-versions.outputs.pr_title }}
          pr-user-login: ${{ needs.extract-versions.outputs.pr_user_login }}
          original-pr-body: ${{ needs.extract-versions.outputs.original_pr_body }}
          slack-webhook-url: ${{ secrets.YOUR_SLACK_WEBHOOK_SECRET }}
```

Reference implementation: [odigos `.github/workflows/cherry-pick.yml`](https://github.com/odigos-io/odigos/blob/main/.github/workflows/cherry-pick.yml).

### Extract only

```yaml
- uses: odigos-io/ci-core/cherry-pick@main
  id: extract
  with:
    operation: extract
```

### Backport one version

```yaml
- uses: odigos-io/ci-core/cherry-pick@main
  with:
    operation: backport
    version: v1.3
    merge-commit-sha: abc1234
    pr-number: "42"
    pr-title: "Fix the thing"
    pr-user-login: octocat
    original-pr-body: "Full PR description…"
```

---

## Permission requirements

| Phase | Job `permissions` | STS identity |
|-------|-------------------|--------------|
| extract | `id-token: write` | `cherry-pick-decision` (default) |
| backport | `id-token: write` | `create-pr` (default) |

Workflow-level `permissions: read-all` is sufficient when jobs grant `id-token: write` where needed.

---

## Inputs

| Input | Required | Default | Used by |
|-------|----------|---------|---------|
| `operation` | Yes | — | `extract` or `backport` |
| `sts-scope` | No | `${{ github.repository }}` | both |
| `base-branch` | No | `main` | both |
| `release-branch-prefix` | No | `releases/` | backport |
| `release-branch-suffix` | No | `.0` | backport |
| `cherry-pick-decision-identity` | No | `cherry-pick-decision` | extract |
| `commit-sha` | No | `${{ github.sha }}` | extract |
| `create-pr-identity` | No | `create-pr` | backport |
| `version` | backport | — | backport |
| `merge-commit-sha` | backport | — | backport |
| `pr-number` | backport | — | backport |
| `pr-title` | backport | — | backport |
| `pr-user-login` | backport | — | backport |
| `original-pr-body` | backport | — | backport |
| `slack-webhook-url` | No | — | backport (optional) |

---

## Outputs

### `extract`

| Output | Description |
|--------|-------------|
| `run_cherry_pick` | `true` when at least one valid version was found |
| `versions` | JSON array, e.g. `["v1.3","v1.4"]` |
| `pr_number` | Original merged PR number |
| `merge_commit_sha` | Merge commit to cherry-pick |
| `pr_title` | Original PR title |
| `pr_user_login` | Original PR author |
| `original_pr_body` | Original PR body |

### `backport`

| Output | Description |
|--------|-------------|
| `pull-request-url` | URL of the created cherry-pick PR |

---

## Behavior notes

- **Direct pushes** to the base branch without an associated merged PR are ignored (`run_cherry_pick=false`).
- **Merge vs squash merges**: merge commits use `git cherry-pick -m 1`; single-parent commits (e.g. squash) are cherry-picked without `-m`.
- **Conflicts**: the backport job fails; fix conflicts manually on a branch from the release branch.
- **Slack**: when `slack-webhook-url` is set, success and failure notifications are sent via [slack-release-notification](../.github/actions/slack-release-notification/README.md).
- **Parallel versions**: use a job matrix on `versions` with `fail-fast: false` so one failed backport does not cancel the others.
