# Grype Vulnerability Scanner

A GitHub Actions composite action that scans container images for vulnerabilities using [Grype](https://github.com/anchore/grype) and displays results in the workflow summary.

## Features

- 🔍 Scans container images for security vulnerabilities
- 📊 Displays results in GitHub Actions summary with severity breakdown
- ✅ Only reports vulnerabilities with available fixes
- 🚨 Fails build on high+ severity vulnerabilities
- 📋 Groups findings by severity (Critical, High, Medium)

## Usage
```yaml
steps:
  - name: Scan image for vulnerabilities
    uses: odigos-io/ci-core/vulnerabilities-scanner@main
    with:
      image: odiglet:e2e-test
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `image` | Container image to scan (e.g., `nginx:latest`, `myregistry.com/myimage:tag`) | Yes | - |

## Behavior

- **Severity Cutoff**: `high` - Fails on medium, high, or critical vulnerabilities
- **Only Fixed**: `true` - Only reports vulnerabilities that have fixes available
- **Output**: Results displayed in GitHub Actions summary page with:
  - Summary table with counts by severity
  - Detailed listing of Critical and High vulnerabilities
  - Collapsible section for Medium vulnerabilities

## Example Output

The action generates a summary that looks like:
```
🔍 Vulnerability Scan Results

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 8 |
| 🟡 Medium | 11 |
| Total | 25 |

### 🟠 High Vulnerabilities (8)
- **CVE-2024-1234** in `package@1.2.3` (Fixed: 1.2.4)
...
```