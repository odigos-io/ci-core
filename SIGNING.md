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

Use the identity for the artifact from [verification-policy.yaml](./verification-policy.yaml):

```bash
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '<identity from verification-policy.yaml>' \
  <registry>/<image>@<digest>
```

Never verify with a broad pattern like `.*odigos-io.*` — that would accept a signature
minted by any workflow in the org, including PR CI.

## Operations

- [signature-drift-check](./.github/workflows/signature-drift-check.yml) — daily cron;
  alerts on Slack if any recent tag above its signing floor lacks a signature
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
