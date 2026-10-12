# Require Linked Linear Issue

Ensures pull requests reference a Linear issue in the PR title before merging. Automatically skips bot accounts.

Only the title counts. Merging squashes the PR title into the commit subject on the default branch, which is what the Linear release scan reads, so a key that sits only in the PR body or the branch name is lost. The check still looks at both, but only to say so in the failure message.

## Permission Requirements
* `pull_requests: read` - To read pull request title, body, and branch name.

## Usage

```yaml
- uses: odigos-io/ci-core/require-linear@main
```

The check matches (case-insensitive) an allowed Linear team key followed by an issue number that does not start with `0`. The allowed keys are not listed here: they come from the repo-root [`linear-team-keys`](../linear-team-keys) file, one key per line, shared with `linear-release`. They are composed on read into `\b(KEY1|KEY2|...)-[1-9][0-9]*`, so adding a team to that file is all it takes for this check to accept its keys.

Bot accounts (`dependabot[bot]`, `renovate[bot]`, `odigos-bot`, `github-actions[bot]`, `keyval-release-bot`) and any PR opened by a Bot user are skipped. The skipped accounts are hardcoded in `check.js`.

## Merge queues

Events other than `pull_request` and `pull_request_target` are skipped, since they carry no pull request to inspect.

This matters when the check is required and the repository uses a merge queue. A queue entry fires `merge_group` against a `gh-readonly-queue/*` ref, so the workflow has to be triggered on it or the required check never reports and the queue stalls:

```yaml
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
  merge_group:
    types: [checks_requested]
```

Any job level condition reading `github.event.pull_request` also has to move to the step, since that context is null under `merge_group`.
