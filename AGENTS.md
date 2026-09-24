# Agent guide

`dsh-instance-manager` is a DSH host + web plugin for managing local and paired DSH Web instances.

## Engineering

- Keep `package.json#version` and `lib/shared.js#VERSION` equal.
- The three marked blocks are generated from `dsh-mini-utility-dock`: `dsh-loopback-helpers` and `dsh-host-guard` in `lib/shared.js`, `dsh-utility-launcher` in `lib/client.js`. Edit the dock fragment and run the matching `*.sync` script (`loopback:sync` / `guard:sync` / `launcher:sync`); never edit a block. The guard block depends on the loopback block, so keep that order.
- `npm test` checks all three blocks against the dock version this repo pins (`launcher:check` / `loopback:check` / `guard:check`).
- `dsh-plugin-parity` (from the dock) is a manual diagnostic, not a CI gate: what it asserts cannot hold across checkouts that sit on different branches.
- Read optional DSH services only inside `ctx.inject(...)` callbacks.
- Preserve the request guards in `lib/shared.js`: local routes and fleet routes have different trust boundaries.
- Keep `README.md` / `README.en.md` and `CHANGELOG.md` / `CHANGELOG.en.md` in sync.
- The supported DSH floor lives in three places and must agree: the README badge, `engines.dsh`, and `peerDependencies['@deepseek-ai/dsh']` (marked optional in `peerDependenciesMeta` so npm never installs the host because of it). DSH's startup preflight compares that peer against the running version with prereleases included and disables the row when it does not match, and the only override is an exact-version `dsh plugin allow-version` exemption. The range carries no upper bound on purpose: a ceiling would disable this plugin on the host's next release, and the exemption path accepts an exact version only.

## Verify

```sh
npm test
npm run docs:check
node --check lib/index.js
node --check lib/client.js
npm pack --dry-run
```
