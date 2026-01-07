# Upload to S3 Action

This GitHub Action uploads Linux packages (deb and rpm) to AWS S3 using OIDC authentication.

## Features

- OIDC-based authentication with AWS (no long-lived credentials needed)
- Organized upload structure: `odigos-{agent-type}/{version}/{apt|rpm}/`
- Supports both vmagent and otelcol agent types
- Handles multiple architectures (amd64/x86_64 and arm64/aarch64)

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `aws-role-arn` | AWS IAM Role ARN for OIDC authentication | Yes | - |
| `aws-region` | AWS Region | No | `us-east-1` |
| `bucket-name` | S3 Bucket Name | Yes | - |
| `agent-type` | Agent type: `vmagent` or `otelcol` | Yes | - |
| `version` | Version of the release (e.g., `0.1.56`) | Yes | - |
| `package-directory` | Directory containing the deb and rpm packages | Yes | - |

## Usage

```yaml
- name: Upload packages to S3
  uses: ./.github/actions/upload-to-s3
  with:
    aws-role-arn: arn:aws:iam::061717858829:role/vmagent-s3-bucket-role
    bucket-name: your-bucket-name
    agent-type: vmagent
    version: 0.1.56
    package-directory: dist
```

## S3 Structure

The action organizes uploaded files in the following structure:

```
s3://bucket-name/
  └── odigos-{agent-type}/
      └── {version}/
          ├── apt/
          │   ├── {package}_amd64.deb
          │   └── {package}_arm64.deb
          └── rpm/
              ├── {package}-{version}-1.x86_64.rpm
              └── {package}-{version}-1.aarch64.rpm
```

## Prerequisites

1. Configure OIDC provider in AWS IAM for GitHub Actions
2. Create an IAM role with the necessary S3 permissions
3. Ensure the role trust policy allows the GitHub repository to assume the role

