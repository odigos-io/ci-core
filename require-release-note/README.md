# Require Release note

Ensures pull requests have a changelog/release note before merging. Automatically skips bot accounts.

Based on the Kubernetes format for PR release notes and the generator tool used here: https://github.com/kubernetes/release/blob/aa840f34f4fc5a4bc2b4c2ed5151b3eed89de807/cmd/release-notes/README.md

## Permission Requirements
* `pull_requests: read` - To read pull request details and linked issues.
* `statuses: write` - To set the status check on the pull request.

## Usage

```yaml
- uses: odigos-io/ci-core/require-release-note@main
```

### Custom Configuration

```yaml
- uses: odigos-io/ci-core/require-release-note@main
  with:
    bot-accounts-json: '["dependabot[bot]","custom-bot"]'
```

## Inputs

| Input | Required | Default |
|-------|----------|---------|
| `bot-accounts-json` | No | `["dependabot[bot]","renovate[bot]","odigos-bot","github-actions[bot]","keyval-release-bot"]` |
