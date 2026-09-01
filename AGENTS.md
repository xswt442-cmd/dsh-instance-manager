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
- Access optional DSH services only inside `ctx.inject(...)` callbacks.
- Preserve the request guards in `lib/shared.js`. Local routes and fleet routes have different trust boundaries.
- Keep `README.md` / `README.en.md` and `CHANGELOG.md` / `CHANGELOG.en.md` in sync.

## Verify

```sh
npm test
npm run docs:check
node --check lib/index.js
node --check lib/client.js
npm pack --dry-run
```
