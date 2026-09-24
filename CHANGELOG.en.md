# Changelog

Release notes are generated from the matching version section; newest first.
For Chinese, see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

### Added

- New `dshim-requests.log`: every accepted mutation (`start` / `stop` / `stop-all` / `stop-self`) records the socket peer, the admission path, the request's own `Host` / `Origin` / `Referer` / `User-Agent`, the target port and the result. The self-exit breadcrumb says a process was asked to leave, never who asked. Cookies and Authorization are never read or written.

### Changed

- Raise the minimum supported DSH version to `0.1.5-rc.3`; the compatibility matrix now pins this baseline and the 0.1.7 line.
- The panel entry becomes `dsh-mini-utility-dock`'s shared launcher fragment: one icon at the bottom-left opens a menu of the three panels. The page-local dock protocol (its own container, persisted placement, icon sanitizing) is retired, taking `dockPlacement` (and `DSHIM_DOCK_PLACEMENT`) and `dock:sync` / `dock:check` with it.
- Declare host compatibility: `peerDependencies` and `engines.dsh` both require `>=0.1.5-rc.3`, with the peer marked optional so npm never installs the host. The host's startup preflight disables a plugin whose peer does not match; declaring none left it with nothing to judge.

## 0.10.1 - 2026-09-24

### Fixed

- Support DSH 0.1.7-rc.1. That release removes the client service `settingsScope` (replaced by `configForms`) and moves a plugin's settings out of the settings service namespaces and into **the profile entry's own config** (`live` and `startup` sections). On 0.1.7 preferences silently fell back to localStorage and the environment: the panel still rendered, but dock placement, refresh interval, fleet token, peer list, and port range never picked up the configured values.

### Changed

- Both sources are supported, newest first: the entry config wins when it carries values, otherwise the older settings-service namespaces still serve, and environment plus built-in defaults remain the last resort. Older releases are unaffected — both paths are runtime injects, so a missing service never blocks the plugin from mounting.
- The compat matrix gained `0.1.7-rc.1`, so each line is verified against its own host.

## 0.10.0 - 2026-09-23

### Fixed

- Bound the outbound fleet handshake at 10s. A peer that accepts TCP but never returns 101 left the socket in CONNECTING forever: close never fires, the backoff loop never restarts, and the peer reads as permanently unreachable with no trace.
- Cap the events stream at 8 subscribers and drop the slowest writer when `write()` reports backpressure. Every subscriber used to trigger a full instance listing on connect, and one page could open unlimited streams.
- Size-cap `dshim-crash.log` and `dshim-selfexit.log` at 1MB, keeping the newest half. The launcher-owned `server-<port>.out.log` is deliberately excluded: the child holds that fd, so a rename would fork the file behind the writer's back.
- `stopForAgent` validates ports through the shared `normalizePort` instead of a private reimplementation of the same rule.
- A failing `ws` resolution logs a line; it used to be swallowed, leaving the fleet link permanently offline with no diagnostics.

### Changed

- The declared minimum DSH version is now `>=0.1.2-rc.1`: the previously declared `0.1.0-rc.5` does not exist on npm, and CI never covered it.

## 0.9.13 - 2026-09-20

### Changed

- The instance list pins the instance serving the panel to the first row. The list previously ordered purely by ascending port with remote rows appended, so the current instance sat at whatever position its port number gave it rather than where it was most worth reading.

## 0.9.12 - 2026-09-17

### Fixed

- Auto port selection now confirms a candidate by actually listening on it, and the retry skips the port the previous attempt died on. A port that read free during the scan could still refuse the child's listen with EADDRINUSE, and the retry re-picked the same port — children died on boot while the panel sat on "Starting…".
- The panel's "Starting…" state now resets unconditionally after the request settles, so a failed follow-up refresh can no longer leave the button disabled.

## 0.9.11 - 2026-09-17

### Fixed

- The panel no longer swallows why an action failed: `refresh()` cleared the error after every successful list read, so `startNew()`'s message was wiped before it could be read. Only a failed list read clears it now.

## 0.9.10 - 2026-09-17

### Added

- Starting an instance can name a port: empty keeps the auto pick; a named port that is in use answers `port_in_use` and is not started elsewhere; a non-integer or out-of-range value answers 400 instead of silently falling back.
- The lost-scan/bind-race retry applies only to an auto-picked port.

### Changed

- The armed stop button is an outlined warning labelled "Confirm?"; red denotes a failure that already happened, while the stop has not run yet and is still reversible. Unarmed it stays a red outline.

## 0.9.9 - 2026-09-17

### Fixed

- The two-step stop confirmation applied only to the current instance; every stoppable local instance now arms first.
- The armed label changed from "Confirm?" to "Click again", and the armed window cancels itself after 4 seconds.

### Changed

- The README header uses one consistent badge row.

## 0.9.8 - 2026-09-17

### Fixed

- A row's `:port` link now targets `?action=open&port=`: the host reads that instance's current-process token from `server-<port>.out.log` and answers 303. DSH requires the per-process token on an instance root, so the bare root always answered 401.
- The token is regenerated per process, so a restarted port accumulates one line per process and only the last one is current.
- The log line is parsed as a URL and its scheme, loopback host, port, root path and token are all checked.
- With no readable token (not started by this host's launcher, or a rotated log) the endpoint answers 409 `launch_token_unavailable` instead of a bare root.
- A remote row's port link performs the same exchange on that peer's own panel.

### Security

- The token exists only in the 303 `Location` header, with `cache-control: no-store` and `referrer-policy: no-referrer`; it never enters panel state or a link `href`.
- `action=open` passes the same browser authentication gate as `list` / `logs` / `sessions`.

## 0.9.7 - 2026-09-16

### Maintenance

- The shared-fragment CI check now runs in this repository (`loopback:check` / `guard:check`) instead of comparing across repositories.
- The LICENSE copyright holder is now `xswt442-cmd`.

## 0.9.6 - 2026-09-14

### Security

- Fix a way to bypass the same-origin check: when a `Host` header is present but yields no hostname (for example an unbracketed IPv6 host such as `::1:3080`, which RFC 7230 does not allow), the allowlist was skipped entirely. Such requests are now rejected as non-loopback.
- The IPv4-mapped IPv6 loopback `[::ffff:127.0.0.1]` is now recognised on the Origin path too. It was only listed for the Host allowlist, while the URL parser normalises that spelling to `[::ffff:7f00:1]`, so the Origin check could never match.

### Fixed

- Reaching the plugin over the IPv6 loopback address `::1` no longer gets rejected.

## 0.9.5 - 2026-09-04

### Changed

- Adapted browser API and SSE authentication to the DSH 0.1.2-rc.1 Connection signed cookie. Private instance probes retain a strict loopback path, and Connection rejection or disposal never falls back open.
- Instances started from the web panel now open DSH's one-time token URL to complete the cookie handoff. Agent-tool starts retain `--no-open`, and both paths use explicit `--profile web` arguments.
- The panel now follows the global DSH locale. The private `dshim-lang` localStorage preference and language button are removed; older DSH builds fall back to the browser language.
- Compatibility checks cover `0.1.2-rc.1` and latest.

### Fixed

- The request guard now decides locality from the TCP peer address. On older or custom remote-listening deployments, a remote source forging `Host: 127.0.0.1` previously passed the guard and skipped the fleet bearer, reaching start / stop / stop-all / stop-self.
- A missing or blank peer address is rejected as unidentified instead of being treated as local.
- With the service on the default HTTP port 80, a same-origin Origin that omits the port (such as `http://127.0.0.1`) is no longer rejected as cross-origin.

## 0.9.4 - 2026-09-02

### Changed

- The Dock fragment is now embedded from an external fragment package at build time; published plugins remain standalone.
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
