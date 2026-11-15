# Resolve Kubernetes Test Versions

Reads pull request labels and exposes the Kubernetes versions to run tests against, for consuming workflows to use as a job matrix. A release also tests a fixed set of versions, e.g. the minimum, a middle and the latest supported version.

## Labels

| Label | Effect |
|-------|--------|
| `test-k8s/<version>` (e.g. `test-k8s/1.29`) | Also test against `<version>` |

A PR can have several of these labels. A label for the default version adds nothing, and duplicates are dropped. The version is passed through as written; validating it, e.g. against the kind node images the workflow supports, is up to the workflow.

Create these labels in each consuming repository for the versions it supports. The `label-prefix` input changes the `test-k8s/` prefix.

## Releases

With `release: "true"`, the `release-versions` are tested too, e.g. the minimum, a middle and the latest supported version. Pass `release` from whatever marks a release in the workflow, e.g. a PR to a release branch. Labels still add versions on top of the release versions.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `default-version` | yes | | Version that is always tested, e.g. `1.32` |
| `release` | no | `false` | `true` for a release: also test the `release-versions` |
| `release-versions` | when `release` is `true` | | Comma-separated versions a release also tests, e.g. `1.21.12,1.29,1.37` |
| `label-prefix` | no | `test-k8s/` | Prefix of the labels that add a version |
| `github-token` | no | `${{ github.token }}` | Token that reads the PR's labels; needs `pull-requests: read` |

## Outputs

| Output | Description | Example |
|--------|-------------|---------|
| `versions` | JSON array of the default version followed by the additional ones | `["1.32","1.29"]` |
| `additional-versions` | JSON array of the versions the release and labels add, without the default one | `["1.29"]` |
| `has-additional-versions` | `true` if the release or labels add at least one version | `true` / `false` |

Versions are ordered the default first, then the release versions in their given order, then the labelled ones sorted. Each version appears once; the step summary lists where it came from.

Outside of PR events (no PR to read labels from, e.g. `merge_group`), `versions` is only the default version, plus the release versions for a release.

## Permission Requirements

* `pull-requests: read` — to read the PR's labels. Without it, the action uses the labels of the event that started the run and logs a warning.

## Usage

Labels are read from the PR when the job runs, so re-running a run picks up labels added or removed since it started. To re-run CI on a label change, re-run the latest run from a `pull_request_target` workflow on `labeled`/`unlabeled` (see odigos' `pr-label-rerun.yaml`). Adding `labeled`/`unlabeled` to the `pull_request` types also works, but with `cancel-in-progress` concurrency, label events that arrive together (e.g. a bot that opens a PR and labels it) start runs that cancel each other in no fixed order. When the newest run is the one cancelled, its required checks stay "Expected" on the PR.

All versions in one matrix:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: read
  contents: read

jobs:
  resolve-versions:
    runs-on: ubuntu-latest
    outputs:
      versions: ${{ steps.k8s.outputs.versions }}
    steps:
      - name: Resolve Kubernetes versions from PR labels
        id: k8s
        uses: odigos-io/ci-core/resolve-kubernetes-test-versions@main
        with:
          default-version: "1.32"
          # PRs and merge queue entries targeting a release branch.
          release: ${{ startsWith(github.base_ref, 'releases/') || startsWith(github.event.merge_group.base_ref, 'refs/heads/releases/') }}
          release-versions: "1.21.12,1.29,1.37"

  e2e:
    needs: resolve-versions
    runs-on: ubuntu-latest
    strategy:
      matrix:
        kube-version: ${{ fromJSON(needs.resolve-versions.outputs.versions) }}
    steps:
      - run: echo "Testing against Kubernetes ${{ matrix.kube-version }}"
```

Or a separate job for the additional versions, which only runs when there are any:

```yaml
  additional-versions-e2e:
    needs: resolve-versions
    if: needs.resolve-versions.outputs.has-additional-versions == 'true'
    strategy:
      matrix:
        kube-version: ${{ fromJSON(needs.resolve-versions.outputs.additional-versions) }}
```

(with `additional-versions` and `has-additional-versions` exposed as job outputs of `resolve-versions`).

## Examples

With `default-version: "1.32"`:

- No labels → `versions=["1.32"]`, `additional-versions=[]`, `has-additional-versions=false`
- `test-k8s/1.29` → `versions=["1.32","1.29"]`, `additional-versions=["1.29"]`, `has-additional-versions=true`
- `test-k8s/1.34` and `test-k8s/1.29` → `versions=["1.32","1.29","1.34"]`, `additional-versions=["1.29","1.34"]`
- `test-k8s/1.32` → `versions=["1.32"]`, `additional-versions=[]`

With `release: "true"` and `release-versions: "1.21.12,1.29,1.37"` as well:

- No labels → `versions=["1.32","1.21.12","1.29","1.37"]`, `additional-versions=["1.21.12","1.29","1.37"]`
- `test-k8s/1.34` and `test-k8s/1.29` → `versions=["1.32","1.21.12","1.29","1.37","1.34"]`
