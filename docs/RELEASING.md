# Releasing

A release is a version bump on `main` plus a `vX.Y.Z` tag. Branch pushes publish nothing; only a tag runs `publish.yml`.

## Checklist

1. On `dev`, set `X.Y.Z` in `package.json#version` and the code version constant, where this repository has one.
2. Write `## X.Y.Z - YYYY-MM-DD` as the first section of both changelogs, with the same sections, bullets, and order. `scripts/release-notes.mjs` reads that heading from `docs/CHANGELOG.md`, and the GitHub release uses the section verbatim.
3. Run the checks in the Verify section of `AGENTS.md`.
4. Commit on `dev`, push, and wait for the branch's CI to be green.
5. Fast-forward `main` to `dev` and push:

   ```sh
   git switch main
   git merge --ff-only dev
   git push origin main
   ```

6. Tag that commit on `main` and push the tag:

   ```sh
   git tag vX.Y.Z main
   git push origin vX.Y.Z
   ```

   `publish.yml` checks that the tagged commit is an ancestor of `origin/main` before anything publishes.

## After the release

- `publish.yml` verifies the version, runs the checks, publishes to npm, and creates the GitHub release from `docs/CHANGELOG.md`.
- Verify the npm package and the release notes. Published versions are immutable: deprecate a bad release and publish a patch version. Never overwrite a published tag or release asset.
