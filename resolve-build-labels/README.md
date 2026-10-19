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

Outside of `pull_request` events (no labels in context), outputs fall back to amd64-only with cache enabled unless overridden via inputs.

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `platforms` | If set, use this platforms string instead of label resolution | _(empty — resolve from labels)_ |
| `no-cache` | If set to `true`/`false`, use this instead of label resolution | _(empty — resolve from labels)_ |

## Permission Requirements

* `pull-requests: read` — to read PR labels from the event payload.

## Usage

Include `labeled` and `unlabeled` in the workflow's `pull_request` types so adding or removing a label re-runs CI:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]

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

### Release workflows (force options)

```yaml
- name: Resolve build options
  id: build-opts
  uses: odigos-io/ci-core/resolve-build-labels@main
  with:
    platforms: linux/amd64,linux/arm64
    no-cache: "true"
```

## Examples

- No labels → `platforms=linux/amd64`, `no-cache=false`
- `build: arm` → `platforms=linux/amd64,linux/arm64`, `no-cache=false`
- `build: no-cache` → `platforms=linux/amd64`, `no-cache=true`
- Both labels → `platforms=linux/amd64,linux/arm64`, `no-cache=true`
- Input overrides → use `platforms` / `no-cache` inputs as-is
