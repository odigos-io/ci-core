# Upload Linux Packages to GCP Artifact Registry

This composite action sets up GCP authentication and uploads deb and rpm packages to Google Cloud Artifact Registry.

## Usage

```yaml
- uses: odigos-io/ci-core/.github/actions/upload-linux-packages@main
  with:
    gcp-project-id: ${{ secrets.GCP_PROJECT_ID }}
    gcp-workload-identity-provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
    gcp-service-account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
    package-directory: 'dist'  # Optional, defaults to 'dist'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `gcp-project-id` | GCP Project ID | Yes | - |
| `gcp-workload-identity-provider` | GCP Workload Identity Provider | Yes | - |
| `gcp-service-account` | GCP Service Account | Yes | - |
| `package-directory` | Directory containing deb/rpm packages | No | `dist` |
| `repository` | Base name of the repository (appends `-apt` for deb and `-rpm` for rpm) | No | `odigos` |
| `location` | GCP location for Artifact Registry | No | `us-central1` |
| `access-token-lifetime` | Access token lifetime for GCP auth | No | `1200s` |

## Example

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      # Build your packages here...

      - uses: odigos-io/ci-core/.github/actions/upload-linux-packages@main
        with:
          gcp-project-id: ${{ secrets.GCP_PROJECT_ID }}
          gcp-workload-identity-provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          gcp-service-account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
          package-directory: 'collector/dist'
```

