# generate-release-notes

Composite action that generates release notes for a given tag, uploads them as a workflow artifact, and optionally updates the GitHub release body. Uses a custom release-note regex to collect `release-note` blocks from the commit range.

Authentication can use **STS** (short-lived tokens via [octo-sts](https://octo-sts.dev); see [../sts/README.md](../sts/README.md)) or a **GitHub token** for backward compatibility. Exactly one of `sts_identity` or `github-token` must be provided.

## Usage

### Basic example (GitHub token)

```yaml
- uses: odigos-io/ci-core/generate-release-notes@main
  with:
    tag: v1.19.1
    release-branch: main
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Basic example (STS)

The calling job must have `id-token: write` for the STS OIDC exchange. An identity file must exist in the repo (e.g. `.github/chainguard/release-notes.sts.yaml`) granting `contents: read` and `contents: write` as needed.

```yaml
permissions:
  contents: write
  id-token: write

jobs:
  update-release-notes:
    runs-on: ubuntu-latest
    steps:
      - uses: odigos-io/ci-core/generate-release-notes@main
        with:
          tag: v1.19.1
          release-branch: main
          sts_identity: release-notes
```

### Full example (workflow_dispatch)

```yaml
name: Update release notes

on:
  workflow_dispatch:
    inputs:
      tag:
        description: "Tag of the release to update (e.g. v1.17.0 or v1.17.0-rc1)"
        required: true
        type: string
      release_branch:
        description: "Branch to use for release note scope (e.g. main)"
        required: false
        default: main
        type: string
      dry_run:
        description: "Preview only; do not update the GitHub release body"
        required: false
        default: false
        type: boolean

permissions:
  contents: write

jobs:
  update-release-notes:
    runs-on: ubuntu-latest
    steps:
      - name: Generate and update release notes
        uses: odigos-io/ci-core/generate-release-notes@main
        with:
          tag: ${{ inputs.tag }}
          release-branch: ${{ inputs.release_branch }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          dry-run: ${{ inputs.dry_run }}
```

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `tag` | Yes | — | Tag of the release (e.g. `v1.19.1`, `v1.17.0-rc1`). Must be an exact semver tag: `vX.Y.Z` or `vX.Y.Z-rcN`. |
| `release-branch` | Yes | — | Branch used as scope for the release-notes tool (e.g. `main`). |
| `repo` | No | `odigos` | Repo name for the generate command (org is odigos-io). |
| `github-token` | If not using STS | — | Token for checkout, API, and `gh release edit`. Use `${{ secrets.GITHUB_TOKEN }}` or a PAT with `contents: write`. |
| `sts_identity` | If not using github-token | `""` | STS identity for short-lived tokens (scope is `github.repository`). Calling job must have `id-token: write`. See [../sts/README.md](../sts/README.md). |
| `dry-run` | No | `"false"` | If `"true"`, notes are still generated and the `release-notes` artifact is uploaded, but the GitHub release body is **not** updated. Use for previews or when downstream steps consume the artifact. |
| `use-branch-head` | No | `"false"` | If `"true"`, the action checks out the release branch and uses its HEAD as the end of the commit range (for tags not published yet). The GitHub release body is not updated in this case. |

### Outputs and artifacts

**Action output**

| Output | Description |
|--------|-------------|
| `release_notes` | Full content of the generated release notes (same as `release-notes.md`). Use `steps.<id>.outputs.release_notes` in the same job. |

**Workflow artifacts and release**

- **Workflow artifact:** The action always uploads a `release-notes` artifact containing the full `release-notes.md`, so other jobs can download it.
- **Release body:** Unless `dry-run` is `true`, the action updates the GitHub release for `tag` with the generated notes.
- **Truncation:** If the notes exceed GitHub’s limit (~124k chars), the release body is truncated and a note is appended. The **full** `release-notes.md` is still in the artifact and is also attached to the release as a `release-notes.md` asset when truncated.

### How the commit range is chosen

The action picks `START_SHA` (and uses `END_SHA` = the tag commit) based on the tag format:

- **RC tags (`vX.Y.Z-rcN`):**
  - If there is a lower RC for the same minor (e.g. `v1.17.0-rc1` for `v1.17.0-rc2`), range is from that previous RC.
  - Otherwise (first RC for that minor), range is from the previous minor’s release branch point on `main`.
- **Stable `vX.Y.0`:** Range is from the previous minor’s release branch point on `main`.
- **Stable patch `vX.Y.Z` (Z ≥ 1):** Range is from the previous stable tag in the same minor (e.g. `v1.19.0` for `v1.19.1`). If none exists, fallback is merge-base of `main` and the tag.

Only exact semver tags (`vX.Y.Z` or `vX.Y.Z-rcN`) are considered; namespaced tags like `profiles/v1.17.0` are ignored.

## Local testing with act

You can run the workflow locally with [act](https://github.com/nektos/act). From the repo that uses the action (e.g. `odigos-io/odigos`):

```bash
cd /path/to/odigos
act workflow_dispatch -W .github/workflows/update-release-notes.yml \
  -i tag=v1.19.1 \
  -i release_branch=main \
  -i dry_run=true \
  -s GITHUB_TOKEN="$(gh auth token)" \
  --env-file .env.act
```

### .env.act when testing from a fork

If you run act from a fork (e.g. `damemi/odigos`), act may use your fork as `GITHUB_REPOSITORY` and checkout/fetch can fail or use the wrong repo. Override it and avoid SSH host-key prompts:

```bash
# .env.act
GITHUB_REPOSITORY=odigos-io/odigos
GIT_SSH_COMMAND=ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
```

Run act with `--env-file .env.act` so these are applied. You can also pass `-e GITHUB_REPOSITORY=odigos-io/odigos` on the command line to force the repo.
