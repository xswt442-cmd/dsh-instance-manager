# Engineering conventions

This directory holds one index. Every kind of information has a single home; do not copy it elsewhere.

## Documents

| What | Where |
| --- | --- |
| Project entry | `README.md` / `README.en.md` |
| Version changes | `docs/CHANGELOG.md` / `docs/CHANGELOG.en.md` |
| Release procedure | `docs/RELEASING.md` |
| Agent constraints | `AGENTS.md`; `CLAUDE.md` is its entry point |
| Engineering conventions | this file |

- Both changelogs keep the same sections, bullet count, and order; `npm run docs:check` compares the pairs declared in this repository.
- GitHub release notes are extracted verbatim from the matching `docs/CHANGELOG.md` section by `scripts/release-notes.mjs`. Do not maintain a second copy.
- Tracked documents describe shipped behavior only: no personal paths, machine state, implementation logs, or future plans.

## Branches and commits

- Maintainers commit straight to `dev` and fast-forward `main` before a release; outside contributions arrive as pull requests and run the same CI.
- Use English conventional commit messages.
- Keep `package.json#version`, the code version constant (where present), both changelogs, and the `vX.Y.Z` tag in step. Tag only a commit on `main`; `publish.yml` rejects any other ancestry.

## Actions

- `ci` / `compat` / `docs` run on pushes to `main` and `dev`, on `pull_request`, on `workflow_dispatch`, and (compat) on the nightly schedule. `publish` runs only on a `v*` tag.
- CI runs on `pull_request` so outside contributions are tested; there are no PR templates, paired-edit gates, or review bots.
- Every workflow sets `permissions: contents: read` at the top; only the job that creates the GitHub release declares write access. CI workflows cancel superseded runs per ref; publishes queue and are never cancelled.
- `actions/checkout` and `actions/setup-node` use the same pinned versions across the workflows.

## Checks

See the Verify section of `AGENTS.md` before a commit, and `docs/RELEASING.md` before a release.
