# sign-oci

Keyless-signs a pushed container image with [cosign](https://github.com/sigstore/cosign) and attaches a [syft](https://github.com/anchore/syft) SBOM attestation. The job's OIDC token is exchanged for a short-lived Fulcio certificate and the signature is recorded in the public Rekor log — there is no key to store or rotate.

## Usage

```yaml
jobs:
  publish:
    permissions:
      contents: read
      id-token: write        # required — cosign mints its cert from this
    steps:
      # ... registry login ...

      - name: Build and push
        id: build            # required — sign-oci needs the digest
        uses: docker/build-push-action@263435318d21b8e681c14492fe198d362a7d2c83 # v6.18.0
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          tags: us-central1-docker.pkg.dev/odigos-cloud/components/my-image:v1.2.3

      - name: Sign
        uses: odigos-io/ci-core/sign-oci@main
        with:
          refs: us-central1-docker.pkg.dev/odigos-cloud/components/my-image
          digest: ${{ steps.build.outputs.digest }}
```

Pass **every** registry the digest was pushed to — a signature is stored beside the image in one registry and does not travel with a copy:

```yaml
    refs: |
      us-central1-docker.pkg.dev/odigos-cloud/components/odigos-odiglet
      ghcr.io/odigos-io/odigos-odiglet
      keyval/odigos-odiglet
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `refs` | yes | | Newline-separated registry paths **without** a tag or digest |
| `digest` | yes | | `sha256:...`, from `steps.<build>.outputs.digest` |
| `recursive` | no | `true` | Sign child manifests as well as the index |
| `sbom` | no | `true` | Generate and attach an SBOM attestation |
| `sbom-type` | no | `cyclonedx` | `cyclonedx` or `spdxjson` |
| `cosign-version` | no | `3.1.2` | Pinned cosign version |
| `syft-version` | no | `1.50.0` | Pinned syft version |
| `dry-run` | no | `false` | Sign without uploading |

No outputs. The SBOM is left at `sbom.json` in the workspace.

## Things that will bite you

**Run it in the same job as the push.** It uses the docker keychain the caller already established; a separate job gets a fresh runner with no credentials. The calling job also needs `id-token: write` — composite actions cannot declare their own permissions — plus `packages: write` for `ghcr.io` refs.

**It refuses tags, by design.** Tags here are mutable (`:latest` moves on most publishes, RC digests get retagged to stable), so signing one is a TOCTOU hole. Both `refs` and `digest` are validated.

**Signatures do not survive `crane copy`.** Copying moves the manifest and nothing else. Sign at the destination too. Note `cosign copy` is deprecated in cosign 3.x in favour of `oras copy -r`.

**The SBOM covers the index, and one platform.** `cosign attest` has no `--recursive`, so the attestation attaches to the index digest only — a consumer resolving a child directly (`COPY --from`, `crane pull --platform`) can verify the signature but not the SBOM. And syft resolves a single child of a multi-arch index, so the SBOM describes whichever arch it picked.

**Storage layout varies by registry.** cosign 3.x prefers the OCI referrers API and falls back to the referrers *tag* schema — a tag named `sha256-<digest>`, no `.sig`/`.att` suffix — where the registry lacks it (GHCR does). Don't assume a shape in tooling that enumerates signatures.

**Nothing shows in the GitHub UI.** The Attestations tab and `gh attestation verify` only cover GitHub's own store, which cosign never writes to. Use `cosign tree <ref>@<digest>`.

## Verifying

```bash
ISS=https://token.actions.githubusercontent.com
ID='^https://github\.com/odigos-io/<repo>/\.github/workflows/<workflow>\.yml@refs/(heads|tags)/.*$'

cosign tree "<ref>@<digest>"
cosign verify --certificate-oidc-issuer "$ISS" --certificate-identity-regexp "$ID" "<ref>@<digest>"

cosign verify-attestation --type cyclonedx \
  --certificate-oidc-issuer "$ISS" --certificate-identity-regexp "$ID" "<ref>@<digest>" \
  | jq -r .payload | base64 -d | jq -r '.predicate.components[] | "\(.name) \(.version)"'
```

Never use a blanket `.*odigos-io.*` identity pattern — that lets any workflow in any org repo, including PR CI, mint a signature that passes.

Airgapped verification changed in cosign 3.x: `--offline` is deprecated in favour of `--bundle` plus a `--trusted-root` file.

## Dependencies

Two, both SHA-pinned: `sigstore/cosign-installer` (verifies the cosign release it installs, and picks the right `runner.arch`) and `anchore/sbom-action` (generates the SBOM from the registry digest). Anything added here joins the supply chain of every image we ship, so additions need a security argument.

Two footguns if you touch them: `cosign-installer` has its own `v3.1.2` tag that is *not* "the installer for cosign 3.1.2" — always pin the SHA; and its `cosign-release` input requires a leading `v`. `anchore/sbom-action` defaults `upload-artifact` and `upload-release-assets` to `true`; both are disabled here so signing doesn't silently attach SBOMs to releases.
