# Agent instructions

## Pull requests and releases

Before opening a pull request, confirm its release impact with the contributor.
Do not infer an ambiguous release type or open the PR until the contributor has
selected one of:

| Release impact | PR label | PR title |
| --- | --- | --- |
| No release | `release:none` | `docs:`, `test:`, `ci:`, `refactor:`, `style:`, `build:`, or `chore:` |
| Bug fix | `release:patch` | `fix:` or `perf:` |
| New feature | `release:minor` | `feat:` |
| Breaking change | `release:major` | Add `!` before the colon, such as `feat!:` or `fix!:` |

Apply exactly one release-impact label to every contributor-authored PR. The PR
title must follow Conventional Commits and agree with that label; CI rejects
missing, conflicting, or mismatched labels.

Do not manually bump `manifest.json`, `version.txt`, or
`.release-please-manifest.json` in feature PRs. Release Please collects merged
PRs and opens a release PR containing the appropriate version bump and
changelog. Merging the generated release PR creates the tag and GitHub Release
and attaches the packaged extension ZIP.

All PRs are squash-merged so the validated PR title becomes the commit Release
Please uses to determine the version.
