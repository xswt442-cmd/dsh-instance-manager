# Contributing

## Branches

Pull requests target `dev`. Maintainers fast-forward `main` before a release. Merging, tagging, and publishing are maintainer actions. CI runs on pull requests.

## Pull request descriptions

A description states the change, the work completed, and the checks actually run, in a Simplified Chinese section and a matching English section. Deferred work belongs in an issue.

## Documentation

`README.md` and `README.en.md` change together. `docs/CHANGELOG.md` and `docs/CHANGELOG.en.md` change together. `npm run docs:check` compares the pairs declared in `docs.config.mjs`. Tracked files contain no personal paths, credentials, private host details, or one-off logs.

## Generated blocks

The marked blocks in `lib/shared.js` and `lib/client.js` are generated from the declared `dsh-mini-utility-dock` dependency. A change to a fragment is re-synced with the matching `*.sync` script, and every pin rises in the same commit. `npm test` runs the `*:check` gates.

## Verification

Run these checks before opening a pull request:

```sh
npm test
npm run docs:check
for f in lib/*.js; do node --check "$f"; done
npm pack --dry-run
```

## Version history

Release notes are generated from the section for the tagged version in `docs/CHANGELOG.md`. `docs/RELEASING.md` records the maintainer release steps.

## Security reports

Security findings follow [SECURITY.md](SECURITY.md).
