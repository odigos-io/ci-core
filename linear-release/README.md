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

`base-ref` is optional but worth passing — it pins the commit range to exactly the previous release. Pass it unconditionally: it is dropped with a warning if it is unresolvable or not on this branch's history, which covers both `tag-and-release`'s `v0.0.0` placeholder and the common case below.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `access-key` | no | | Pipeline access key, normally `secrets.LINEAR_ACCESS_KEY`. Empty skips the sync |
| `version` | yes | | The released tag, e.g. `v1.4.2`. Becomes the release title |
| `name` | no | the tag | Overrides the title. Rarely needed |
| `base-ref` | no | | Start of the commit scan, **exclusive** — the previous release tag, if it exists |
| `include-paths` | no | | Comma-separated globs restricting which commits count. For monorepos |
| `links` | no | | Links to attach, one per line: absolute URL or `Label=URL` |
| `issue-pattern` | no | all odigos team keys | Regex whose first capture group is an issue key, matched against commit subjects |
| `release-notes` | no | | Path to a markdown file to use as the release notes |
| `dry-run` | no | `false` | Scan and read, but make no changes in Linear |
| `fail-on-error` | no | `false` | Fail the step instead of warning when the sync cannot run |

## Outputs

`release-id`, `release-name`, `release-version`, `release-url`. All four are empty when nothing was created or updated — a skip, a failure, a `dry-run`, and a sync that matched no issues all look the same. Guard with `!= ''`.

## Things that will bite you

**The tag is the title; the commit SHA is the pill.** `version` is also what a sync targets, so two tags on one commit resolve to a single release.

**The access key picks the pipeline, nothing here does.** A key belongs to exactly one pipeline, so a repo given the wrong key files its releases in someone else's. An org-wide `LINEAR_ACCESS_KEY` therefore sends every repo to the same pipeline; repos that need their own want a repo-level secret.

**Give it its own job.** Two reasons: the third-party CLI it downloads should not run beside a release job's credentials, and the runner resolves remote actions during job *setup*, before `continue-on-error` can catch anything — in the tagging job that would fail the release outright.

**`base-ref` is resolved to the fork point when it is not an ancestor.** The highest tag by semver usually lives on a release branch, so a minor cut from the default branch is handed a ref it cannot reach; scanning `<merge-base>..HEAD` gives exactly what this release ships that the last one did not.

**`base-ref` is often not on your branch.** `tag-and-release` reports the highest tag by semver, which usually lives on a release branch — so a minor cut from the default branch gets a ref it cannot reach, and an unguarded scan fails outright. The action drops such a ref with a warning and lets Linear pick the baseline. It also needs `fetch-depth: 0` to resolve one at all.

**Failures are otherwise swallowed.** This runs after the release is published, so a Linear problem warns rather than turning the job red. Look for the warning annotation. `fail-on-error: "true"` opts out; an unset secret is a warning either way.

**A bare issue key in a commit subject is NOT detected by default.** Upstream only matches a key preceded by a magic word (`fixes RUN-1`, `part of RUN-1`) or a `(#123)` pull request reference. `feat(x): thing (RUN-1)` matches nothing on its own — which is why `issue-pattern` defaults to the odigos team keys here. If you override it, keep the key in **capture group 1**; the pattern is applied to the subject only, never the body.

**Zero issues means zero auto-generated notes.** Linear generates notes from the issues attached to a release, so a release that matched none shows nothing. Pass `release-notes` with a file — e.g. the body GitHub already generated for the tag — to have something either way.

**The CLI is not pinned by digest.** The action is pinned to a commit SHA, but that commit downloads the `linear-release` binary from a mutable release tag with no checksum.

See also [tag-and-release](../tag-and-release/README.md), which cuts the tag this action reports on.
