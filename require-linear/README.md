# Require Linked Linear Issue

Ensures pull requests have a linked Linear issue before merging. Automatically skips bot accounts.

## Permission Requirements
* `pull_requests: read` - To read pull request details and linked issues.
* `statuses: write` - To set the status check on the pull request.

## Usage

```yaml
- uses: odigos-io/ci-core/require-linear@main
```

### Custom Configuration

```yaml
- uses: odigos-io/ci-core/require-linear@main
  with:
    linear-prefix-regex: "(TEAM-|PROJ-)"
    bot-accounts-json: '["dependabot[bot]","custom-bot"]'
```

## Inputs

| Input | Required | Default |
|-------|----------|---------|
| `linear-prefix-regex` | No | `"(CORE-\|PLAT-\|PRD-\|RUN-\|GEN-\|DEVOPS-\|SEC-)"` |
| `bot-accounts-json` | No | `["dependabot[bot]","renovate[bot]","odigos-bot","github-actions[bot]","keyval-release-bot"]` |
