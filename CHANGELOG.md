# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## Unreleased

### Added

- Remote-fleet F2 (peer links): `/dsh-instance-manager/link` WebSocket upgrade (always bearer-authenticated, fail-closed without a token) answers `ping` / `fleet` queries; `DSHIM_PEERS="id@origin,..."` dials peers with exponential-backoff reconnects and 30 s ping/pong liveness. `action=list` merges peer fleets (2 s cache, 3.5 s per-peer budget) with rows tagged by peer id and rewritten to peer-origin URLs. Remote rows are read-only in the panel (source badge, stop disabled, drawer hint) and excluded from stop-all and the local up/down differ; `instance_list` gains an optional `source` field.

## 0.8.0 - 2026-08-27

### Added

- Fleet trust boundary (remote-fleet F1): dual-mode guard — loopback unchanged; non-loopback requests require `Authorization: Bearer` verified in constant time against a token resolved per request via the credentials service (`DSHIM_FLEET_TOKEN_REF`, default `DSHIM_FLEET_TOKEN`, plain-env fallback). Fail-closed when unresolvable; SSE `/events` stays loopback-only; `self` reports a stable `fleetId`.
- `DSHIM_PORT_RANGE="min-max"` override for the sweep/start band (default 3080-3129).
- `scripts/deploy-profile.ps1`: deploys a real-directory snapshot into the profile, replacing dev symlink mounts safely (edit the repo without touching running instances).

### Changed

- Panel de-crowded: stop-all shows only with 2+ managed instances; instance rows drop the process name; shorter footer.
- Panel-spawned children run with `--trace-exit`, `--unhandled-rejections=strict`, `--report-uncaught-exception`.
- `npm test` scoped to this package's suite.

### Fixed

- Panel-spawned children used the invalid flag `--report-on-uncaught-exception` (Node >= 20 rejects it; the child died instantly with code 9).

## 0.7.1 - 2026-08-26

### Added

- Crash black-box: fatal `uncaughtException` / `unhandledRejection` stacks (pid+port) append to `~/.dsh/launcher/logs/dshim-crash.log` before exit(1).
- Launch confirm window 25 s (was 10 s); children spawn with `--no-open`; in-window child exits leave an exit-code breadcrumb in the launcher log.

### Fixed

- SSE subscriptions attach `error` listeners on both streams; broadcasts skip dead sockets (abrupt client disconnects were fatal to the process).
- First sibling-instance launches no longer mis-report as failures while one-time first-boot backfills run.

## 0.7.0 - 2026-08-25

### Added

- Agent tools `instance_list` / `instance_start` / `instance_stop` / `instance_logs` on the harness `tools` service; stop refuses the hosting instance; environments without `@deepseek-ai/dsh-tools` degrade to panel-only.
- Cross-instance session summaries: `action=sessions&port=` (scalar fields, newest 20), shown in the drawer and via `instance_sessions`; pre-0.7 peers report unavailable.
- SSE fleet up/down push at `/dsh-instance-manager/events` with a silent baseline frame; toasts on instance joins/leaves.

### Fixed

- Stop argument validation rejects non-integer ports.

## 0.6.2 - 2026-08-25

### Added

- Drawer start time shows the viewer's IANA timezone.

### Fixed

- Stopping the current instance (or all) shows a farewell screen and halts polling instead of issuing doomed requests.

## 0.6.1 - 2026-08-25

### Added

- Version badge with skew flag; bilingual zh/EN UI with persisted toggle; machine-readable error codes.
- Instance drawer: pid / start time / version, memory sparkline, stdout/stderr log tails.
- File heartbeat registry (`run/instances/<port>.json`, 10 s cadence / 30 s freshness) with verify-then-sweep discovery.
- node:test unit suite wired into CI.

### Changed

- Cross-platform dsh-bin fallback via `path.join`; concurrent self-probe racing; stop forwarding timeout 8 s; CI boot-check on Windows + Linux; publish asserts VERSION lockstep.

## 0.6.0 - 2026-08-24

### Added

- `self` reports rss; panel shows memory per instance.
- Unmounted dsh detection via the `window.__DSH_BOOT__` marker (brand string fallback).

### Changed

- Children spawn with `process.execPath` + the current entry script (no machine-specific paths); CI boot-check asserts guard regressions.

### Performance

- 4 s auto-refresh pauses on hidden tabs and refreshes on return.

### Removed

- Dead `port` field in the internal start payload; start reuses the shared free-port scanner.

## 0.5.0 - 2026-08-24

### Changed

- Renamed `dsh-easy-port-manager` -> `dsh-instance-manager`; CSS prefix `easy-dshm-*` -> `dshim-*`.

### Compatibility

- Pre-rename API route stays as an alias; discovery and stop forwarding interoperate with <= 0.4.x.

## 0.4.2 - 2026-08-24

### Fixed

- Busy map and two-step confirm keyed by port (were pid); unmanaged rows no longer render "pid null"; repaired package.json manifest.

### Security

- Mutating actions require POST (`stop-self` tolerates GET for legacy peers).
- Guards reject cross-site traffic: Fetch Metadata, foreign Origin, non-loopback Host (DNS rebinding).
- stop-all forwards stops in parallel.

## 0.4.1 - 2026-08-24

### Fixed

- Force-exit backstop after graceful shutdown so a lingering handle cannot hold the process.

## 0.4.0 - 2026-08-24

### Added

- Launch a new instance from the panel (first free port, detached, logs under launcher logs).
- Stop-all with two-step confirmation; self-report start time and session count.

## 0.3.0 - 2026-08-23

### Added

- Initial release: sidebar panel listing local dsh web instances on 3080-3129 with graceful stop.
