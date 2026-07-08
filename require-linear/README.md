# Require Linked Linear Issue

Ensures pull requests reference a Linear issue in the PR title, body, or branch name before merging. Automatically skips bot accounts.

## Permission Requirements
* `pull_requests: read` - To read pull request title, body, and branch name.

## Usage

```yaml
- uses: odigos-io/ci-core/require-linear@main
```

The check matches (case-insensitive) an allowed Linear team prefix followed by an issue number that does not start with `0`: `(CORE-|PLAT-|PRD-|RUN-|GEN-|DEVOPS-|SEC-)[1-9][0-9]*`.

Bot accounts (`dependabot[bot]`, `renovate[bot]`, `odigos-bot`, `github-actions[bot]`, `keyval-release-bot`) and any PR opened by a Bot user are skipped. The allowed prefixes and skipped accounts are hardcoded in `action.yml`.
