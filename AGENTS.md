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

## Verify

```sh
npm test
npm run docs:check
node --check lib/index.js
node --check lib/client.js
npm pack --dry-run
```
