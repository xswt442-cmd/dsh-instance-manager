# Agent guide

`dsh-instance-manager` is a DSH host + web plugin for managing local and paired DSH Web instances.

## Workflow

- Do not commit directly to `main`. Use a development branch such as `dev`.
- Use lowercase Conventional Commit prefixes.
- Never bypass repository hooks with `--no-verify`.
- Keep disposable scripts and generated artifacts out of tracked source.
- Do not link this working tree into a running DSH profile; use `scripts/deploy-profile.ps1`.
- Read `RELEASING.md` only when publishing.

## Engineering

- Prefer root-cause fixes to patches and workarounds.
- Refactor when it simplifies the requested change or prevents technical debt.
- Keep changes focused; avoid unrelated or speculative refactors.
- Keep `package.json#version` and `lib/shared.js#VERSION` equal.
- The two marked blocks in `lib/shared.js` are generated from
  `dsh-mini-utility-dock`: `dsh-loopback-helpers` from `dist/loopback.js` and
  `dsh-host-guard` from `dist/guard.js`. Edit the dock fragment and run
  `npm run loopback:sync` / `npm run guard:sync` (either maintains both blocks),
  never the blocks themselves. The guard block depends on the loopback block, so
  keep that order.
- `npm test` verifies both blocks against the dock version this repo pins
  (`loopback:check` / `guard:check`). That is what makes the three plugins hold
  identical blocks, so keep the pin exact and in step with the sibling repos.
- `scripts/guard-parity.mjs` is a local diagnostic, not a CI gate. Run it with
  `DSH_PLUGINS_ROOT` when all three checkouts share a branch; the property it
  asserts cannot hold while a peer sits on a different branch.
- Access optional DSH services only inside `ctx.inject(...)` callbacks.
- Preserve the request guards in `lib/shared.js`. Local routes and fleet routes have different trust boundaries.
- Keep `README.md` / `README.en.md` and `CHANGELOG.md` / `CHANGELOG.en.md` in sync.
- CHANGELOG entries are one or two lines: what changed, and why it matters. No implementation narrative, incident timeline, or root-cause essay.

## Verify

```sh
npm test
npm run docs:check
node --check lib/index.js
node --check lib/client.js
npm pack --dry-run
```
