# Trivy Vulnerability Scanner

A GitHub Actions composite action that scans container images or filesystem paths for vulnerabilities using [Trivy](https://github.com/aquasecurity/trivy) and displays results in the workflow summary.

## Features

- 🔍 Scans container images or filesystem paths for security vulnerabilities
- 📊 Displays all vulnerabilities in GitHub Actions summary with severity breakdown
- ✅ Only reports vulnerabilities with available fixes (unfixed are ignored)
- 🚨 Configurable severity cutoff to control when the workflow fails
- 📋 Groups findings by severity (Critical, High, Medium, Low)

## Usage

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `image` | Container image to scan (e.g., `nginx:latest`, `myregistry.com/myimage:tag`) | No* | - |
| `path` | Filesystem path to scan (e.g., `.` or `src/`) | No* | - |
| `severity-cutoff` | Comma-separated list of severity levels that will cause the workflow to fail (e.g., `HIGH,CRITICAL`). Leave empty to never fail. | No | `HIGH,CRITICAL` |

\* You must provide either `image` or `path`, but not both.


### Scan a container image
```yaml
steps:
  - name: Scan image for vulnerabilities
    uses: odigos-io/ci-core/vulnerabilities-scanner@main
    with:
      image: nginx:latest
```

### Scan a filesystem path
```yaml
steps:
  - name: Checkout code
    uses: actions/checkout@v4
    
  - name: Scan code for vulnerabilities
    uses: odigos-io/ci-core/vulnerabilities-scanner@main
    with:
      path: .
```

### Fail only on critical vulnerabilities
```yaml
steps:
  - name: Scan with critical-only failure
    uses: odigos-io/ci-core/vulnerabilities-scanner@main
    with:
      image: myregistry.com/myimage:tag
      severity-cutoff: "CRITICAL"
```

### Report only (never fail)
```yaml
steps:
  - name: Scan without failing
    uses: odigos-io/ci-core/vulnerabilities-scanner@main
    with:
      image: myregistry.com/myimage:tag
      severity-cutoff: ""
```
## Behavior

- **Scanning**: Always scans for all severity levels and displays all vulnerabilities found
- **Ignore Unfixed**: `true` - Only reports vulnerabilities that have fixes available
- **Severity Cutoff**: Controls which severity levels cause the workflow to fail (defaults to `HIGH,CRITICAL`)
- **Output**: Results displayed in GitHub Actions summary page with:
  - Summary table with counts by all severity levels
  - Detailed listing of Critical and High vulnerabilities
  - Collapsible sections for Medium and Low vulnerabilities

## Example Output

The action generates a summary that looks like:
```
🔍 Vulnerability Scan Results

| Severity | Count |
|----------|-------|
| 🔴 Critical | 2 |
| 🟠 High | 8 |
| 🟡 Medium | 15 |
| 🔵 Low | 5 |
| **Total** | **30** |

### 🔴 Critical Vulnerabilities (2)
- **CVE-2024-0001** in `openssl@1.1.1` (Fixed: 1.1.2)
...

### 🟠 High Vulnerabilities (8)
- **CVE-2024-1234** in `package@1.2.3` (Fixed: 1.2.4)
...
```