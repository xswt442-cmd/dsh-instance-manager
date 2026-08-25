# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## 0.7.0 — 2026-08-25

### Added

- Agent tools: registers `instance_list` / `instance_start` / `instance_stop` / `instance_logs` with the harness `tools` service, so the in-session agent can inspect and drive the local fleet directly. `@deepseek-ai/dsh-tools` resolves from this package first, then from the running dsh checkout's own dependency tree; when neither exists the panel keeps working without tools. The stop tool refuses to kill the instance hosting the conversation.
- Cross-instance session summaries: new `action=sessions&port=` self-reports (or forwards to) any managed instance's live sessions — scalar fields only (id, created-at, cwd, subagent origin, event count), newest-first, capped at 20 rows. Surfaced in the instance drawer and through a fifth agent tool, `instance_sessions`. Pre-0.7 peers degrade to an explicit "unavailable" instead of failing.
- Fleet up/down push over SSE (`GET /dsh-instance-manager/events`): one lazy diff-ticker per process broadcasts managed-port joins and leaves to every subscriber; clients get a silent baseline frame on connect, then bottom-right toasts on change — even with the panel closed. The ticker stops itself when the last subscriber disconnects.

### Fixed

- The instance-stop argument validation now rejects non-integer ports (e.g. 1.5) at both the tool and forwarding layers.

## 0.6.2 — 2026-08-25

### Added

- The instance start time in the detail drawer now shows the viewer's IANA timezone beside the local time (e.g. `2026/8/25 17:23:45 (Asia/Shanghai)`). Rendered entirely client-side from the epoch — nothing about the timezone is reported or stored anywhere.

### Fixed

- Discovery now also lists instances whose heartbeat sits OUTSIDE the fixed 3080–3129 sweep (e.g. one hand-started with `--port 4000`) — registry-known ports join the sweep instead of being dropped.
- 「启动新实例」now holds the request until the fresh child answers `action=self` and returns its `pid`; a child that dies immediately (lost the port race) retries once on the next free port instead of failing silently, and a slow-booting child is reported as `start_unconfirmed` rather than double-spawned. Covered by a new boot-check regression on both OSes.
- Instance rows report the real process name (`path.basename(process.execPath)`) instead of a hardcoded `node.exe`, which read wrong on Linux.
- Stopping the current instance (or all instances) now swaps the panel to a farewell screen and halts polling, instead of spinning into guaranteed-failing requests that surfaced a network-error banner. The farewell tells the user they can close the tab; script-driven window closing was deliberately left out since browsers ignore it anyway.

## 0.6.1 — 2026-08-25

### Added

- Instance self-report now carries the plugin version (`version`), and the panel flags rows whose version differs from the serving instance (「版本差异」 badge) — mixed-fleet windows become visible, and a clean fleet is the objective signal for retiring the legacy alias route.
- Bilingual UI: a self-contained zh/EN dictionary with a header toggle, persisted in localStorage (first open follows `navigator.language`). Host failure payloads now carry machine-readable `code`s that the client localizes; older panels keep showing the raw text.
- Instance detail drawer: click any row for pid / start time / version, a memory sparkline built from the panel's own polling samples, and stdout/stderr log tails via `action=logs` — bounded 64KB / 200-line reads of the shared launcher logs, no peer forwarding needed.
- File-based instance registry: every managed instance heartbeats `~\.dsh\run\instances\<port>.json` (10 s cadence, entries trusted for 30 s); `action=list` verifies fresh claims with a cheap `action=self` re-check and sweeps only the ports no heartbeat covers. The 50-port blind probe becomes the fallback path instead of the norm; graceful exits remove the file via the plugin disposer.
- node:test unit suite (`npm test`) covering the request guards, loopback parsing, dsh-bin resolution, registry-entry validation, log tailing and self-probe racing; wired into the compat static job.

### Changed

- Cross-platform: the dsh-launcher profile-path fallback is built with `path.join` instead of a Windows-only backslash literal.
- Self-report discovery fans the current and pre-rename routes out concurrently instead of paying two serial timeouts per live port that answers neither.
- Stop forwarding now waits up to 8s per attempt (was 5s): a freshly launched target can still be initializing when the stop arrives. A stop whose ack timed out but whose row disappears on the next refresh is no longer surfaced as an error.
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
