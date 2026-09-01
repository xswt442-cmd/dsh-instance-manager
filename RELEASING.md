# Releasing

Releases are tag-driven. Branch pushes do not publish anything. The examples below use `dev`; any development branch works the same way.

## Checklist

1. On your development branch, choose `X.Y.Z` and update:
   - `package.json#version`
   - `lib/shared.js#VERSION`
   - the first section of both changelogs: `## X.Y.Z - YYYY-MM-DD`
2. Run:

   ```sh
   npm test
   npm run docs:check
   npm pack --dry-run
   ```

3. Commit and push the development branch:

   ```sh
   git commit -am "chore: release X.Y.Z"
   git push origin dev
   ```

4. After its CI passes, merge the development branch into `main` and push:

   ```sh
   git switch main
   git merge dev -m "merge: dev -> main"
   git push origin main
   ```

5. Tag the release commit:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

`publish.yml` validates the tag, tests the package, publishes to npm with provenance, and creates the GitHub release from `CHANGELOG.md`.

Published npm versions are immutable. If a release is bad, deprecate it and publish a new patch version. Never move a tag after npm publication.
