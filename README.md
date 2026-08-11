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
