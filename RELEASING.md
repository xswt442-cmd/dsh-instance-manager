# Releasing

A release is a version bump that reaches `main`, plus a `vX.Y.Z` tag on a commit `main` already carries. Branch pushes publish nothing; only a tag runs `publish.yml`. The examples use `dev` — any development branch behaves the same way.

## What runs where

- `compat.yml` — syntax check of every module under `lib/`, the unit suite, package contents, manifest consistency, and a real `dsh web` boot against two host versions. Triggers on `pull_request`, on pushes to `main` and `dev`, nightly, and manually.
- `docs.yml` — `npm run docs:check`, on `pull_request` and on pushes to `main` and `dev`.
- `publish.yml` — only on a `v*` tag. It has three jobs: `checks` (the tag matches the version, the tag is on `main`, tests, pack), `npm` (Trusted Publishing over OIDC; no repository write), and the GitHub release, which is **the only job holding `contents: write`** and does nothing but create or refresh the release from `CHANGELOG.md`. Every step that executes this repository's code runs against a read-only token.

The ci badge at the head of the README badge row is `compat.yml` on `main` — that is the run whose state the README advertises. `docs.yml` is not badged.

## Checklist

1. Choose `X.Y.Z` on your development branch and update what carries it:
   - `package.json#version`
   - `lib/shared.js#VERSION`
   - the first section of both changelogs, written exactly as `## X.Y.Z - YYYY-MM-DD` — `scripts/release-notes.mjs` reads that heading out of `CHANGELOG.md`
   - the DSH floor, only when it moves: the README badge, `engines.dsh`, and `peerDependencies['@deepseek-ai/dsh']`

2. Re-check the embedded fragments against their canonical sources in `dsh-mini-utility-dock` (the loopback predicates, the host request guard and the host HTTP glue in `lib/shared.js`, the utility launcher in `lib/client.js`). A drifted block fails `npm test`; the matching script rewrites it:

   ```sh
   npm run loopback:sync
   npm run guard:sync
   npm run http:sync
   npm run launcher:sync
   ```

   A `check` only compares the marked blocks its pinned dock version knows, so a block newer than that pin passes silently. Raise the pin and re-sync every block in one commit: two pushes — old bytes under a new pin, or the reverse — leave CI reporting ok about a file it never actually verified.

3. Run the repository's checks — the same commands as the Verify block in `AGENTS.md`:

   ```sh
   npm test
   npm run docs:check
   for f in lib/*.js; do node --check "$f"; done
   npm pack --dry-run
   ```

4. Commit and push the development branch:

   ```sh
   git commit -am "chore: release X.Y.Z"
   git push origin dev
   ```

5. Wait for that branch's CI to be green, meaning the `compat` and `docs` runs for the branch or its pull request. Nothing has published yet: `publish.yml` starts at the tag. Then merge into `main` and push:

   ```sh
   git switch main
   git pull
   git merge --no-ff dev -m "merge: dev -> main"
   git push origin main
   ```

6. Tag a commit on `main` — after the merge is there — and push the tag:

   ```sh
   git tag vX.Y.Z main
   git push origin vX.Y.Z
   ```

   The `checks` job runs `git merge-base --is-ancestor <tagged commit> origin/main` and fails the release otherwise. This is a hard gate, not a formality: a tag on an unmerged commit would publish code nobody reviewed on `main`, and the release's compare link would describe a history that does not contain what shipped.

   Name `main` in the tag command instead of tagging wherever `HEAD` happens to sit. That is where a squash merge — or a rebase merge — bites: the branch's commits are replaced by one new commit on `main`, so a tag made on `dev` is no longer reachable from `main` and the ancestry check fails. If you tagged the branch commit, drop that tag locally, merge, and tag `main`; a failed ancestry check publishes nothing, because the npm and release jobs both wait on `checks`.

Published npm versions are immutable. If a release is bad, deprecate it and publish a new patch version.
