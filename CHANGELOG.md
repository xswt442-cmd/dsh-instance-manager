# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## Unreleased

### Added

- Instance self-report now carries the plugin version (`version`), and the panel flags rows whose version differs from the serving instance (「版本差异」 badge) — mixed-fleet windows become visible, and a clean fleet is the objective signal for retiring the legacy alias route.
- File-based instance registry: every managed instance heartbeats `~\.dsh\run\instances\<port>.json` (10 s cadence, entries trusted for 30 s); `action=list` verifies fresh claims with a cheap `action=self` re-check and sweeps only the ports no heartbeat covers. The 50-port blind probe becomes the fallback path instead of the norm; graceful exits remove the file via the plugin disposer.
- node:test unit suite (`npm test`) covering the request guards, loopback parsing, dsh-bin resolution, registry-entry validation and self-probe racing; wired into the compat static job.

### Changed

- Cross-platform: the dsh-launcher profile-path fallback is built with `path.join` instead of a Windows-only backslash literal.
- Self-report discovery fans the current and pre-rename routes out concurrently instead of paying two serial timeouts per live port that answers neither.
- CI: boot-check now runs on windows-latest AND ubuntu-latest (symlink + bash variant) and no longer tolerates failures (`continue-on-error` removed); publish sanity-check asserts `lib/shared.js VERSION` matches the release tag.

## 0.6.0 — 2026-08-24

### Added

- `action=self` now reports resident memory (`rss`); the panel shows a memory figure per instance. Zero-cost self-report — no child processes.

### Changed

- CI boot-check now asserts the request guards regressively (GET mutations → 405, foreign Origin / cross-site metadata / non-loopback Host → 403).
- Child-instance launch resolves node via `process.execPath` and dsh bin via the current process's own entry script — no more machine-specific install paths (also fixes cold CI-like environments).
- Unbundled dsh instances are detected by the injected `window.__DSH_BOOT__` manifest marker first; the brand string remains as a legacy fallback.

### Performance

- The 4s auto-refresh pauses while the browser tab is hidden and issues an immediate refresh on return — an open panel previously swept up to 50 local ports even in a background tab.

### Removed

- Dead `port` field from the internal start payload; the free-port scan in「启动新实例」now reuses the shared scanner instead of duplicating it.

## 0.5.0 — 2026-08-24

### Changed

- **Package renamed** `dsh-easy-port-manager` → `dsh-instance-manager`: it manages instance lifecycles; ports are only the discovery mechanism. The old name collided with `dsh-port-manager` (a different plugin that hot-switches the web port).
- CSS class prefix `easy-dshm-*` → `dshim-*`; slot ids and cordis loader row updated accordingly.

### Compatibility

- The pre-rename API route `/dsh-easy-port-manager/api` stays registered as an identical-behavior alias.
- Discovery and stop forwarding fall back to that path, so ≤0.4.x and ≥0.5.0 instances interoperate in both directions inside a mixed fleet.

## 0.4.2 — 2026-08-24

### Fixed

- Client busy map was written keyed by port but read by pid — the「停止中…」label and button disable never fired.
- Two-step confirm stored a port into a pid-named state and compared against pid — the「确认结束？」highlight never rendered. State renamed to `confirmPort`, compared by port everywhere.
- Unmanaged rows rendered "pid null"; pid is now shown only when present.
- `package.json` description was double-encoded mojibake; rewritten as clean bilingual text. Manifest formatting repaired (was PowerShell `ConvertTo-Json` output); added `engines` and a minimal `dshhub` metadata block.

### Security

- Mutating actions (`start` / `stop` / `stop-all`) require POST; `stop-self` additionally tolerates GET for ≤0.4.1 peer forwarding.
- Every action runs behind request guards rejecting browser-initiated cross-site traffic: Fetch Metadata (`sec-fetch-site` outside `same-origin|none`), foreign `Origin`, non-loopback `Host` (also defeats DNS rebinding).
- `stop-all` forwards stops in parallel instead of a serial 5s-per-target wait.

## 0.4.1 — 2026-08-24

### Fixed

- Force-exit backstop after graceful shutdown: the harness shutdown relies on the event loop draining, and a lingering handle could hold the process alive forever.

## 0.4.0 — 2026-08-24

### Added

- Launch a new dsh web instance from the panel (first free port, detached + hidden background, logs under `~\.dsh\launcher\logs\`).
- Stop-all flow with two-step confirmation.
- Instance self-report extended with start time and active session count (uptime + session columns in the panel).

## 0.3.x and earlier — 2026-08-23

- Initial public release: persistent sidebar panel listing local dsh web instances on ports 3080–3129 with graceful one-click stop of any instance carrying the bundle.
