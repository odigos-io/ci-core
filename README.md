<p align="center">
  <img src="./logo.png" alt="Odigos Logo" width="100%"/>
</p>



## Odigos GitHub Actions and Workflows

### Authentication and Token Management
1. [Github STS (GitHub Secure Token Service)](./sts/README.md)

### Ticket and Issue Management
1. [require-linear](./require-linear/README.md)
1. [require-release-note](./require-release-note/README.md)

### Build Configuration
1. [resolve-build-labels](./resolve-build-labels/README.md)

### Security and Supply Chain
1. [vulnerabilities-scanner](./vulnerabilities-scanner/README.md)
2. [sign-oci](./sign-oci/README.md) — keyless cosign signing and SBOM attestation for published images
3. [verification-policy.yaml](./verification-policy.yaml) — per-artifact OIDC identities, signature locations, and signing floors
4. [backfill-sign](./.github/workflows/backfill-sign.yml) — break-glass: sign an already-published digest after an outage forced an unsigned release
5. [signature-drift-check](./.github/workflows/signature-drift-check.yml) — daily assertion that recent tags carry signatures

### How image signing works

Publish jobs call [sign-oci](./sign-oci/README.md) right after pushing an image. It signs
**by digest** (never by tag) using keyless cosign: the job's GitHub OIDC token is traded
for a short-lived certificate tied to the workflow's identity — no keys stored anywhere.

The signature and a CycloneDX SBOM are uploaded **to the same registry, next to the
image**, linked to its digest (they do not travel with `crane copy` — mirrors use
`oras copy -r`). Each signing event is also recorded in the public Rekor transparency
log, which is what lets the short-lived certificate verify forever.

Consumers verify with the identity listed in [verification-policy.yaml](./verification-policy.yaml):

```bash
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '<identity from verification-policy.yaml>' \
  <registry>/<image>@<digest>
```

Assurance is continuous: [signature-drift-check](./.github/workflows/signature-drift-check.yml)
walks recent tags daily and alerts if anything above its signing floor is unsigned, and
[backfill-sign](./.github/workflows/backfill-sign.yml) signs an already-published digest
after an outage forced an unsigned release.

### Release Management
1. [tag-and-release](./tag-and-release/README.md)
2. [semver-info](./semver-info/README.md)
3. [cherry-pick](./cherry-pick/README.md)
4. [dispatch-agent-version-update](./dispatch-agent-version-update/README.md)
5. [apply-agent-version-update](./apply-agent-version-update/README.md)

### Release and Deployment Notifications
1. [slack-release-notification](./.github/actions/slack-release-notification/README.md)

### Package Management
1. [upload-linux-packages](./upload-linux-packages/README.md)
