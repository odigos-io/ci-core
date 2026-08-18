# Image signing at Odigos

## How a signature is made

Publish jobs call [sign-oci](./sign-oci/README.md) right after pushing an image, and
sign **by digest** — never by tag, since tags are mutable. Keyless, per signature:

1. cosign generates a **one-shot keypair in memory** — nothing is stored or rotated
2. the job's GitHub **OIDC token** is exchanged at **Fulcio** (Sigstore's CA) for a
   **~10-minute certificate** binding that public key to the workflow's identity
   (`repo/workflow@ref`)
3. the digest is signed with the ephemeral key
4. signature + certificate are appended to **Rekor**, the public transparency log,
   which returns a signed timestamp proving *when* the signing happened
5. the private key is discarded

The Rekor timestamp is what makes a 10-minute certificate verify forever: it proves
the signature was created while the certificate was valid. Every signing event is
public — auditable at search.sigstore.dev — so nobody can mint signatures with our
identity unnoticed.

## Where it lives

The signature and a CycloneDX SBOM are uploaded **to the same registry as the image**,
linked to its digest (via the OCI referrers API, or a `sha256-<digest>` tag on
registries without it).

## How to verify

```bash
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '<identity from the table below>' \
  <registry>/<image>@<digest>
```

Never verify with a broad pattern like `.*odigos-io.*` — that would accept a signature
minted by any workflow in the org, including PR CI.

| Artifact | Signing identity (regexp) | Signed since |
|---|---|---|
| odigos components (`odigos-{autoscaler,scheduler,instrumentor,collector,odiglet,ui,operator,agents}`) | `^https://github\.com/odigos-io/odigos/\.github/workflows/publish-modules\.yml@refs/tags/v.*$` | v1.30.0 |
| `odigos-cli` (image) | `^https://github\.com/odigos-io/odigos/\.github/workflows/release\.yml@refs/heads/main$` | v1.30.0 |
| `odigos-victoria-metrics` (re-hosted upstream) | `^https://github\.com/odigos-io/odigos/\.github/workflows/release\.yml@refs/heads/main$` | v1.30.0 |
| enterprise components (`odigos-enterprise-*`) | `^https://github\.com/odigos-io/odigos-enterprise/\.github/workflows/release-images\.yml@refs/(tags/.*\|heads/.*)$` | releases after 2026-08-17 |
| `wasp-init` | `^https://github\.com/odigos-io/ebpf-core/\.github/workflows/build-sender\.yml@refs/(heads/main\|heads/releases/.*\|tags/.*)$` | v0.0.6 |
| `odigos-cli-offsets` | `^https://github\.com/odigos-io/enterprise-go-instrumentation/\.github/workflows/offsets-push\.yml@refs/heads/.*$` | v1.34.3 (only `:latest` and `:<version>-<sha>` tags exist, by design) |
| `odigos-vmagent-instrumentations` | `^https://github\.com/odigos-io/vm-agent/\.github/workflows/publish-agents\.yml@refs/(heads/.*\|tags/agents/.*)$` | publishes after 2026-08-12 |

Reading the table:

- **"Signed since" applies to the canonical registry** —
  `us-central1-docker.pkg.dev/odigos-cloud/components` — where history was
  retroactively backfilled. Mirrors (`docker.io/keyval`, `ghcr.io/odigos-io`)
  only carry signatures from when release-time signing went live
  (2026-08-17, the v1.36.0-pre trains); verify older versions against GAR.
- **Backfilled history verifies under a different identity**: swap the regexp for
  `^https://github\.com/odigos-io/ci-core/\.github/workflows/backfill-sign\.yml@refs/heads/main$`.
  The distinct identity is deliberate — audit can always tell a backfill from a
  release-time signature.
- **Stable `x.y.0` component tags are retags of the RC digest** and verify against
  the RC's tag identity. `odigos-victoria-metrics` is a re-hosted upstream image:
  the signature attests that odigos published that exact digest, not that odigos
  built it.
- Identities are per repo AND per workflow. Dispatch-triggered workflows sign under
  `refs/heads/<branch>` (the CLI's `release.yml` signs as `refs/heads/main`, never a
  tag); tag-triggered ones under `refs/tags/<tag>`.

## Operations

- [backfill-sign](./.github/workflows/backfill-sign.yml) — signing is fail-closed, so a
  Sigstore outage means shipping unsigned on purpose; this signs the already-published
  digest after the fact

### Retroactive signing

Signing an old image is the same operation as signing a new one: a signature is a
separate small artifact whose subject is the **digest**, uploaded next to the image —
the image itself is never touched, and a referrer can be attached to an existing
manifest at any time. The only difference is the certificate identity, which truthfully
records `backfill-sign.yml` and *today's* Rekor timestamp — so a backfill always
verifies, but audit can always tell it apart from a release-time signature. No
backdating is possible.
