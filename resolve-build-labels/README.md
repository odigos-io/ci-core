# Resolve Build Labels

Reads pull request labels and exposes Docker build options for consuming workflows.

## Labels

| Label | Effect | Default (label absent) |
|-------|--------|------------------------|
| `build: arm` | Build for `linux/amd64` and `linux/arm64` | `linux/amd64` only |
| `build: no-cache` | Build without Docker layer cache | Cache enabled |

Create these labels in each consuming repository (or via org-level label sync). Label names are exact matches, including the space after the colon.

## Outputs

| Output | Description | Example |
|--------|-------------|---------|
| `build-arm` | `true` if `build: arm` is present | `true` / `false` |
| `no-cache` | `true` if `build: no-cache` is present | `true` / `false` |
| `platforms` | Platforms string for `docker/build-push-action` | `linux/amd64` or `linux/amd64,linux/arm64` |

Outside of PR events (no PR to read labels from, e.g. `merge_group`), outputs fall back to amd64-only with cache enabled.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | no | `${{ github.token }}` | Token that reads the PR's labels; needs `pull-requests: read` |

## Permission Requirements

* `pull-requests: read` — to read the PR's labels. Without it, the action uses the labels of the event that started the run and logs a warning.

## Usage

Labels are read from the PR when the job runs, so re-running a run picks up labels added or removed since it started. To re-run CI on a label change, re-run the latest run from a `pull_request_target` workflow on `labeled`/`unlabeled` (see odigos' `pr-label-rerun.yaml`). Adding `labeled`/`unlabeled` to the `pull_request` types also works, but with `cancel-in-progress` concurrency, label events that arrive together (e.g. a bot that opens a PR and labels it) start runs that cancel each other in no fixed order. When the newest run is the one cancelled, its required checks stay "Expected" on the PR.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: read
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Resolve build options from PR labels
        id: build-opts
        uses: odigos-io/ci-core/resolve-build-labels@main

      - name: Set up QEMU
        if: steps.build-opts.outputs.build-arm == 'true'
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: ${{ steps.build-opts.outputs.platforms }}
          no-cache: ${{ steps.build-opts.outputs.no-cache }}
          # When using registry/GHA cache, also gate cache-* on the label:
          # cache-from: ${{ steps.build-opts.outputs.no-cache != 'true' && 'type=gha' || '' }}
          # cache-to: ${{ steps.build-opts.outputs.no-cache != 'true' && 'type=gha,mode=max' || '' }}
          push: false
          tags: myimage:pr
```

## Examples

- No labels → `platforms=linux/amd64`, `no-cache=false`
- `build: arm` → `platforms=linux/amd64,linux/arm64`, `no-cache=false`
- `build: no-cache` → `platforms=linux/amd64`, `no-cache=true`
- Both labels → `platforms=linux/amd64,linux/arm64`, `no-cache=true`
