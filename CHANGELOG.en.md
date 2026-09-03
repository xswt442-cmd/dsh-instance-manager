# Changelog

Release notes are generated from the matching version section; newest first.
For Chinese, see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

### Fixed

- The request guard now decides locality from the TCP peer address. DSH supports listening on `0.0.0.0`, so a remote source forging `Host: 127.0.0.1` previously passed the guard and skipped the fleet bearer, reaching start / stop / stop-all / stop-self.
- A missing or blank peer address is rejected as unidentified instead of being treated as local.
- With the service on the default HTTP port 80, a same-origin Origin that omits the port (such as `http://127.0.0.1`) is no longer rejected as cross-origin.

## 0.9.4 - 2026-09-02

### Changed

- The Mini Utility Dock is now synchronized at build time from `dsh-mini-utility-dock`; published plugins remain standalone.
- The Dock now filters external SVG icons and renders a text fallback for rejected markup.

## 0.9.3 - 2026-09-01

### Added

- Moved configuration into settings with separate live and restart options, retaining env values as defaults.
- Stored the fleet token as a secret; invalid settings now fall back to schema defaults.

### Fixed

- Missing-token remote requests now return 403 instead of 500.

## 0.9.2 - 2026-08-31

### Changed

- `DSH Instance` and TreeKeeper now use a versioned Mini Utility Dock protocol.
- Dock registration is ownership-safe across HMR; opening one panel closes its active sibling.

### Fixed

- The panel title is `DSH Instance` in both languages.

## 0.9.1 - 2026-08-31

### Fixed

- Prevented recursive peer queries from creating fleet request loops.
- Child launch failures no longer terminate the host and return `start_failed`.
- Stop, logs, and sessions now share strict port validation.
- Unknown peers are rejected, and remote log path traversal is blocked.
- Repaired local logs, session summaries, and remote session port queries.
- Fixed false fleet-down notices, same-port peer state collisions, and log error states.

### Changed

- Invalid ports consistently return 400; GET stop remains 405.
- Stop liveness checks now consider local instances only.

## 0.9.0 - 2026-08-27

### Added

- Added bearer-authenticated WebSocket peer links with reconnect and heartbeat.
- Instance lists can merge remote fleets; remote rows remain read-only.
- Remote session summaries and logs are available through peer links.
- Moved the panel entry to the positionable, persistent Mini Utility Dock.

### Security

- Configured peers are trusted operators; the fleet token is a symmetric key without action-level isolation.

### Fixed

- Registered the WebSocket upgrade route and added peer-hub disposal.
- Crash recording no longer pre-empts the Harness fatal-exit path.
- Agent tools and the panel entry now wait for late-mounted optional services.
- `DSH_HOME` follows Harness precedence and accepts directories that do not yet exist.

### Changed

- `stop-self` is now POST-only.

### Removed

- **Breaking:** removed `/dsh-easy-port-manager/api` and ≤0.4.1 compatibility paths; 0.5.0 and later are unaffected.

## 0.8.0 - 2026-08-27

### Added

- Non-loopback requests require a bearer token and fail closed when it cannot be resolved.
- `DSHIM_PORT_RANGE="min-max"` overrides the default port band.
- Added `scripts/deploy-profile.ps1` for snapshot-based development deployment.

### Changed

- Simplified instance rows, the footer, and stop-all visibility.
- Spawned children use strict rejections, exit tracing, and exception reports.

### Fixed

- Corrected an invalid Node exception-report flag that caused immediate child exits.

## 0.7.1 - 2026-08-26

### Added

- Added fatal-error logs with pid, port, and stack.
- Extended launch confirmation to 25 seconds and added exit-code recording within the window.

### Fixed

- SSE disconnects no longer terminate the host.
- First sibling launches are no longer misclassified during initial backfill.

## 0.7.0 - 2026-08-25

### Added

- Added the `instance_list`, `instance_start`, `instance_stop`, and `instance_logs` agent tools.
- Added cross-instance session summaries and `instance_sessions`.
- Added SSE notifications for instance joins and leaves.

### Fixed

- Stop rejects non-integer ports.

## 0.6.2 - 2026-08-25

### Added

- Start times use the viewer's timezone.

### Fixed

- Stopping the current instance or all instances enters a farewell state and stops polling.

## 0.6.1 - 2026-08-25

### Added

- Added version-skew hints, a bilingual UI, and machine-readable error codes.
- Added instance details, memory trends, and stdout/stderr log tails.
- Added a file heartbeat registry with verify-before-sweep cleanup.

### Changed

- Improved cross-platform launch paths, concurrent probing, forwarding timeouts, CI boot checks, and version validation.

## 0.6.0 - 2026-08-24

### Added

- Added per-instance memory reporting.
- Added unmounted-instance detection through `window.__DSH_BOOT__`.

### Changed

- Children launch through the current Node and DSH entry point without machine-specific paths.

### Performance

- Auto-refresh pauses while the page is hidden and runs immediately on return.

### Removed

- Removed the obsolete `port` field from the internal start payload.

## 0.5.0 - 2026-08-24

### Changed

- Renamed `dsh-easy-port-manager` to `dsh-instance-manager`.

### Compatibility

- Temporarily retained the old API route and interoperability with ≤0.4.x.

## 0.4.2 - 2026-08-24

### Fixed

- Keyed busy and confirmation state by port, hid empty pids on unmanaged rows, and repaired the manifest.

### Security

- Mutating actions require POST; `stop-self` temporarily accepts GET for legacy peers.
- Guards reject cross-site, foreign-Origin, and non-loopback Host requests.

## 0.4.1 - 2026-08-24

### Fixed

- Added a forced-exit fallback after graceful shutdown.

## 0.4.0 - 2026-08-24

### Added

- Launch new instances from the panel.
- Added confirmed stop-all, start times, and session counts.

## 0.3.0 - 2026-08-23

### Added

- Initial release: list and gracefully stop local DSH Web instances on ports 3080–3129.
