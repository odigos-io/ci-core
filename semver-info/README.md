# Semver Info

Reads git tags and origin `releases/*` branches and reports Odigos semantic version fields.

Supported tag formats:

| Kind | Example | Meaning |
|------|---------|---------|
| stable | `v1.21.4` | Published release (patch is kept) |
| pre | `v1.22.0-pre3` | Pre-release of a not-yet-branched line |
| rc | `v1.22.0-rc1` | Release candidate of a started line |

Release branches are `releases/vX.Y.0`. Creating that branch (typically when an RC starts) marks the line as started even if no stable tag exists yet.

## Field differences

These are easy to confuse. They answer different questions. “Latest” / “last” / “highest” always means **highest by semver** (`v1.21.4` > `v1.21.0` > `v1.20.9`), never tag or commit time.

| Output | Question it answers | Shape | Empty when |
|--------|---------------------|-------|------------|
| `latest_stable` | Highest **published** tag by semver | `vX.Y.Z` (patch kept) | No stable tags |
| `last_release_line` | Highest **started** line by semver, published or not | `vX.Y.0` (always `.0`) | Never (errors if nothing exists) |
| `last_release_branch` | Highest origin `releases/vX.Y.0` branch by semver | `releases/vX.Y.0` | Line is inferred from a tag only |
| `next_release` | Next **unstarted** line (one minor after `last_release_line`). Used when cutting a new pre/rc from main — not for patches on an already-frozen line. | `vX.(Y+1).0` | Never |
| `latest_pre` | Highest **existing** pre tag on `next_release`? | `vX.Y.0-preN` | No pres on that line |
| `next_pre` | What pre tag should we **create** for `next_release`? | always set | Never |
| `has_pre` | Does `latest_pre` exist? | `true` / `false` | n/a |
| `latest_rc` / `next_rc` / `has_rc` | Same trio as pre, for `-rcN` on `next_release` | | |

`next_pre` and `next_rc` are always computed against **`next_release`**, not `last_release_line`. Once `releases/v1.22.0` exists, pre/rc outputs move to `v1.23.0`.

How `last_release_line` is chosen:

1. Take `latest_stable`'s series (`v1.21.4` → `v1.21.0`).
2. Take the highest origin `releases/vX.Y.0` branch.
3. `last_release_line` is the max of those two. `next_release` is one minor after that.

## Examples

Repo state is on the left. Full outputs are on the right so the deltas are visible.

### A. Only a published stable, no next line yet

Tags: `v1.21.4`. Branches: none. No `v1.22.0-pre*` / `-rc*`.

| Output | Value | Why |
|--------|-------|-----|
| `latest_stable` | `v1.21.4` | Highest published tag; patch kept |
| `last_release_line` | `v1.21.0` | Same line, normalized to `.0` |
| `last_release_branch` | *(empty)* | No `releases/*` branch on origin |
| `next_release` | `v1.22.0` | One minor after `last_release_line` |
| `latest_pre` | *(empty)* | No pres on 1.22 yet |
| `next_pre` | `v1.22.0-pre0` | First pre of `next_release` |
| `has_pre` | `false` | |
| `latest_rc` | *(empty)* | |
| `next_rc` | `v1.22.0-rc0` | |
| `has_rc` | `false` | |

`latest_stable` ≠ `last_release_line`: one is the tag (`v1.21.4`), the other is the line (`v1.21.0`).

### B. Pres already exist for the next line (no release branch yet)

Tags: `v1.21.4`, `v1.22.0-pre0`, `v1.22.0-pre2`. Branches: none.

| Output | Value | Why |
|--------|-------|-----|
| `latest_stable` | `v1.21.4` | Unchanged — pres are not stable |
| `last_release_line` | `v1.21.0` | 1.22 has no release branch, so it is not “started” |
| `last_release_branch` | *(empty)* | |
| `next_release` | `v1.22.0` | Still the line after 1.21 |
| `latest_pre` | `v1.22.0-pre2` | Highest existing pre (not `pre0`) |
| `next_pre` | `v1.22.0-pre3` | `pre(N+1)` of `latest_pre` |
| `has_pre` | `true` | |
| `next_rc` | `v1.22.0-rc0` | No rcs yet on 1.22 |

`latest_pre` vs `next_pre`: what exists vs what to create. `last_release_line` stays on 1.21 because a pre tag does not open a release branch.

### C. Release branch exists, stable not published yet (RC in progress)

Tags: `v1.21.4`. Branches: `releases/v1.21.0`, `releases/v1.22.0`.

| Output | Value | Why |
|--------|-------|-----|
| `latest_stable` | `v1.21.4` | 1.22 is not tagged stable |
| `last_release_line` | `v1.22.0` | Unpublished branch is ahead of the stable tag |
| `last_release_branch` | `releases/v1.22.0` | Highest origin release branch |
| `next_release` | `v1.23.0` | One minor after the started 1.22 line |
| `next_pre` | `v1.23.0-pre0` | Pres now target 1.23, not 1.22 |

This is the gap between `latest_stable` and `last_release_line`: published vs started. Once the branch exists, `next_pre` skips that line.

### D. RCs exist on the next line (no branch yet — unusual)

Tags: `v1.21.4`, `v1.22.0-rc0`, `v1.22.0-rc1`. Branches: none.

| Output | Value |
|--------|-------|
| `last_release_line` | `v1.21.0` |
| `next_release` | `v1.22.0` |
| `latest_rc` | `v1.22.0-rc1` |
| `next_rc` | `v1.22.0-rc2` |
| `has_rc` | `true` |
| `next_pre` | `v1.22.0-pre0` |

`has_rc` / `latest_rc` describe `next_release` only. Callers that must not emit a pre after an RC should check `has_rc` themselves; this action still reports `next_pre`.

## Requirements

The calling workflow must check out the repo with full tags (`fetch-depth: 0`). Origin must be reachable so `git ls-remote --heads origin 'releases/*'` can list release branches.

When checkout uses `path:` (repo is not at the workspace root), pass that path as `directory`.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `directory` | no | `.` | Git working tree. Match `actions/checkout` `path:` when the repo is not at the workspace root. |

## Usage

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0

- name: Resolve semver
  id: version
  uses: odigos-io/ci-core/semver-info@main

- run: echo "next pre is ${{ steps.version.outputs.next_pre }}"
```

Checkout into a subdirectory:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
    path: odigos

- name: Resolve semver
  id: version
  uses: odigos-io/ci-core/semver-info@main
  with:
    directory: odigos
```
