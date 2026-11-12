# Resolve Kubernetes Test Versions

Reads pull request labels and exposes the Kubernetes versions to run tests against, for consuming workflows to use as a job matrix.

## Labels

| Label | Effect |
|-------|--------|
| `test-k8s/<version>` (e.g. `test-k8s/1.29`) | Also test against `<version>` |

A PR can have several of these labels. A label for the default version adds nothing, and duplicates are dropped. The version is passed through as written; validating it, e.g. against the kind node images the workflow supports, is up to the workflow.

Create these labels in each consuming repository for the versions it supports. The `label-prefix` input changes the `test-k8s/` prefix.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `default-version` | yes | | Version that is always tested, e.g. `1.32` |
| `label-prefix` | no | `test-k8s/` | Prefix of the labels that add a version |

## Outputs

| Output | Description | Example |
|--------|-------------|---------|
| `versions` | JSON array of the default version followed by the additional ones | `["1.32","1.29"]` |
| `additional-versions` | JSON array of the versions the labels add, without the default one | `["1.29"]` |
| `has-additional-versions` | `true` if the labels add at least one version | `true` / `false` |

Outside of `pull_request` events (no labels in context, e.g. `merge_group`), `versions` is only the default version and `additional-versions` is `[]`.

## Permission Requirements

* `pull-requests: read` — to read PR labels from the event payload.

## Usage

Include `labeled` and `unlabeled` in the workflow's `pull_request` types so adding or removing a label re-runs CI.

All versions in one matrix:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]

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
