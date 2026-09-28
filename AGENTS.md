# Agent guide

`dsh-instance-manager` is a DSH host + web plugin for managing local and paired DSH Web instances.

## Engineering

- Keep `package.json#version` and `lib/shared.js#VERSION` equal.
- The four marked blocks are generated from `dsh-mini-utility-dock`: `dsh-loopback-helpers`, `dsh-host-guard` and `dsh-host-http` in `lib/shared.js`, `dsh-utility-launcher` in `lib/client.js`. Edit the dock fragment and run the matching `*.sync` script (`loopback:sync` / `guard:sync` / `http:sync` / `launcher:sync`); never edit a block. The guard block depends on the loopback block, so keep that order, and the HTTP glue lands below the guard — that is the block order, and `lib/shared.js` keeps exactly one pair of markers per block.
- `npm test` checks every block against the dock version this repo pins (`launcher:check` / `loopback:check` / `guard:check` / `http:check`). The `shared.js` script names are synonymous by design, not four separate inspections: the CLI selects the blocks from the markers present in the target file that its own version carries, so one `check lib/shared.js` verifies the host-side blocks it knows in a single pass.
- A `check` only compares the marked blocks its pinned dock version knows, so a block newer than that pin passes silently — never read a green `http:check` as proof that the third block matches. `test/host-http.test.js` is what asserts each block's markers appear exactly once and in order. Raise the pin and re-sync every block in the same commit: two separate pushes leave CI reporting ok about a file it did not actually verify.
- The HTTP glue is what `lib/index.js` used to hand-write: `sendJson` now comes from the block (which is what puts `cache-control: no-store` on every reply), and `requirePost` / `authorizeBrowser` are built by the block's factories. The published vocabulary of this plugin stays: `requirePost` is `createRequirePost` with the `need_post` policy (code, wording, and the echoed `action`), and a route's unexpected failure answers a fixed `code` only — an exception message never goes into a response body, it is logged instead.
- The gate reads the method case-insensitively, so a lowercase `post` passes where this plugin's own pre-fragment closure answered 405. That widening is accepted deliberately: the request the gate exists to refuse is one a browser issues on its own, and those are always `GET`. Do not re-tighten it inside the block — the block serves three repositories, and this one's older reading is not the other two's contract. `test/routes.test.js` pins the verdict on the mounted route.
- `requestNeedsBearer` in `lib/shared.js` is not the guard and is not redundant with it: the guard answers whether a request may proceed, this answers which credential the route must demand before any guard runs, and it must not write a reply. See the comment on it before trying to fold one into the other.
- Preserve the request guards in `lib/shared.js`: local routes and fleet routes have different trust boundaries.
- Keep `README.md` / `README.en.md` and `CHANGELOG.md` / `CHANGELOG.en.md` in sync. The Configuration chapter is the operable one: it names the `live` / `startup` sections, the two namespace ids, every field with its range and default, the environment variables and where they sit in the layering, and what `DSHIM_FLEET_TOKEN_REF` actually references — a reader must be able to configure the plugin from it alone.
- `scripts/deploy-profile.ps1` and `scripts/auth-topics.ps1` are one-machine conveniences, not part of what the repository promises: they stay out of the installation and development instructions, and they must not carry an owner, account, or path in their defaults.
- Read optional DSH services only inside `ctx.inject(...)` callbacks.
- The supported DSH floor lives in three places and must agree: the README badge, `engines.dsh`, and `peerDependencies['@deepseek-ai/dsh']` (marked optional in `peerDependenciesMeta` so npm never installs the host because of it). DSH's startup preflight compares that peer against the running version with prereleases included and disables the row when it does not match, and the only override is an exact-version `dsh plugin allow-version` exemption. The range carries no upper bound on purpose: a ceiling would disable this plugin on the host's next release, and the exemption path accepts an exact version only.
- `dsh-plugin-parity` (from the dock) is a manual diagnostic, not a CI gate: what it asserts cannot hold across checkouts that sit on different branches.

## Changelog

- `CHANGELOG.md` and `CHANGELOG.en.md` stay in step: the same sections, the same number of bullets, the same order.
- One bullet per change — what changed and why it matters, in at most two short sentences — counting prose, not the inline code identifiers a bullet names (roughly 120 CJK characters or 240 letters of it, and a whole version section stays under about 900 CJK characters). A version section is published verbatim as the GitHub release notes, so its reader is someone using this plugin, not its historian.
- No implementation narrative and no root-cause essay. "It used to do X, which was wrong because Y, so now Z" is one bullet about Z; the rest belongs in the commit message or a handoff note. A bullet that needs a subordinate clause to justify itself has one clause too many.
- The same register as the README: state what ships, in the tool's own technical vocabulary. No conversational verbs ("the pin rises to", "this now compares it for real", "one call asks it all"), no quotation marks used for emphasis, and no colon-then-explanation flourish.
- `Unreleased` records what a reader other than the author would notice. Deferred work and "X was left alone because it needs a product call" are handoff notes, not changelog entries.
- Do not name another repository. The test is a reader who cloned only this one: a sentence that only parses if they also know what a sibling checkout does cannot be verified and adds nothing — state what this repository does. `dsh-mini-utility-dock` is the single exception, and only where it genuinely is the subject: it is a dependency this package declares, and these blocks are synced from it.

## Verify

```sh
npm test
npm run docs:check
for f in lib/*.js; do node --check "$f"; done
npm pack --dry-run
```
