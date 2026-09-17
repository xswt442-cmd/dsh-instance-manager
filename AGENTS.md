# Agent guide

`dsh-instance-manager` is a DSH host + web plugin for managing local and paired DSH Web instances.

## Engineering

- Keep `package.json#version` and `lib/shared.js#VERSION` equal.
- The two marked blocks in `lib/shared.js` are generated from `dsh-mini-utility-dock`. Edit the dock fragment and run `npm run loopback:sync` / `npm run guard:sync` (either maintains both blocks); never edit a block. The guard block depends on the loopback block, so keep that order.
- `npm test` checks both blocks against the dock version this repo pins (`loopback:check` / `guard:check`), which is what keeps the three consumers byte-identical.
- `scripts/guard-parity.mjs` is a manual diagnostic, not a CI gate: what it asserts cannot hold while a sibling checkout sits on another branch.
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
