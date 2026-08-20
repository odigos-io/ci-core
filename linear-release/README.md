# linear-release

Records a release in [Linear](https://linear.app) after it has been tagged and published. Wraps [`linear/linear-release-action`](https://github.com/linear/linear-release-action), which walks the commits in `<base-ref>..HEAD`, works out which Linear issues they belong to, and attaches those issues to a release named after the tag.

The wrapper exists so the upstream pin lives in one place, and so a repo without a `LINEAR_ACCESS_KEY` skips instead of failing.

## Usage

Run it in its own job after the tagging job, with `continue-on-error` on the job:

```yaml
jobs:
  linear-release:
    needs: [calculate, tag]
    runs-on: ubuntu-latest
    continue-on-error: true
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.calculate.outputs.new_version }}
          fetch-depth: 0       # required — the scan walks commit history
          fetch-tags: true

      - uses: odigos-io/ci-core/linear-release@main
        with:
          access-key: ${{ secrets.LINEAR_ACCESS_KEY }}
          version: ${{ needs.calculate.outputs.new_version }}
          base-ref: ${{ needs.calculate.outputs.current_version }}
```

`base-ref` is optional but worth passing — it pins the commit range to exactly the previous release. Only pass a tag that exists; `tag-and-release` reports `v0.0.0` for a repo with no tags, so filter that out with `!= 'v0.0.0' && ... || ''`.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `access-key` | no | | Pipeline access key, normally `secrets.LINEAR_ACCESS_KEY`. Empty skips the sync |
| `version` | yes | | Version the Linear release is named after, e.g. `v1.4.2` |
| `base-ref` | no | | Start of the commit scan, **exclusive** — the previous release tag, if it exists |
| `include-paths` | no | | Comma-separated globs restricting which commits count. For monorepos |
| `dry-run` | no | `false` | Scan and read, but make no changes in Linear |
| `fail-on-error` | no | `false` | Fail the step instead of warning when the sync cannot run |

## Outputs

`release-id`, `release-name`, `release-version`, `release-url`. All four are empty when nothing was created or updated — a skip, a failure, a `dry-run`, and a sync that matched no issues all look the same. Guard with `!= ''`.

## Things that will bite you

**The access key picks the pipeline, nothing here does.** A key belongs to exactly one pipeline, so a repo given the wrong key files its releases in someone else's. An org-wide `LINEAR_ACCESS_KEY` therefore sends every repo to the same pipeline; repos that need their own want a repo-level secret.

**Give it its own job.** Two reasons: the third-party CLI it downloads should not run beside a release job's credentials, and the runner resolves remote actions during job *setup*, before `continue-on-error` can catch anything — in the tagging job that would fail the release outright.

**Failures are otherwise swallowed.** This runs after the release is published, so a Linear problem warns rather than turning the job red. Look for the warning annotation. `fail-on-error: "true"` opts out; an unset secret is a warning either way.

**Issue detection is broader than commit subjects.** Upstream matches branch names, magic words, `TEAM-123` keys, and the pull request a commit came from, so a squash-merge whose only link is `(#2173)` still resolves. No commit-convention change is needed.

**The CLI is not pinned by digest.** The action is pinned to a commit SHA, but that commit downloads the `linear-release` binary from a mutable release tag with no checksum.

See also [tag-and-release](../tag-and-release/README.md), which cuts the tag this action reports on.
