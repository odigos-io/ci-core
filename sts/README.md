# sts

Fetches short-lived GitHub credentials via the [octo-sts](https://octo-sts.dev) service and writes a gitconfig file covering all requested scopes.

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `pairs` | — | `""` | Newline-separated `scope:identity` entries *(preferred)* |
| `scope` | — | `""` | Single repo scope — backward-compatible alternative to `pairs` |
| `identity` | — | `""` | Identity name — used together with `scope` |
| `output-git-config` | — | `true` | Write a gitconfig file and include it globally |
| `domain` | — | `octo-sts.dev` | octo-sts service domain |

Exactly one of `pairs` **or** `scope`+`identity` must be provided. Passing both is an error.

## Outputs

| Output | Description |
|---|---|
| `GIT_CONFIG_PATH` | Path to the gitconfig file covering all scopes |
| `GH_TOKEN` | The token for the last (or only) scope — for single-pair use |

---

## Setup

### 1. Create an identity file in the target repo

```yaml
# .github/chainguard/NAME_OF_YOUR_IDENTITY.sts.yaml
issuer: https://token.actions.githubusercontent.com
subject_pattern: '^repo:odigos-io/[-a-zA-Z0-9_]+:(pull_request|ref:.*)$'

permissions:
  contents: read
```

### 2. Grant `id-token: write` in the consuming job

```yaml
jobs:
  example-job:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
```

---

## Usage

### Single repo

```yaml
- uses: odigos-io/ci-core/sts@main
  with:
    pairs: "odigos-io/my-private-repo:my-identity"
```

Or using the legacy inputs (backward-compatible):

```yaml
- uses: odigos-io/ci-core/sts@main
  with:
    scope: "odigos-io/my-private-repo"
    identity: "my-identity"
```

### Multiple repos

```yaml
- uses: odigos-io/ci-core/sts@main
  with:
    pairs: |
      odigos-io/repo-a:identity-a
      odigos-io/repo-b:identity-b
```

A single gitconfig is written covering all scopes. If the same scope appears more than once, the duplicate is skipped with a warning. If any token exchange fails, the step fails immediately.

---

## Usage with Docker

Pass the gitconfig as a build secret so private Go/npm modules are accessible without baking tokens into the image.

```yaml
- id: sts
  uses: odigos-io/ci-core/sts@main
  with:
    pairs: "odigos-io/my-private-repo:my-identity"

- name: Build Docker image
  run: |
    docker build \
      --secret id=gitconfig,src=${{ steps.sts.outputs.GIT_CONFIG_PATH }} \
      .
```

```Dockerfile
RUN --mount=type=secret,id=gitconfig,required=false \
    git config --global include.path /run/secrets/gitconfig && \
    go mod download
```
