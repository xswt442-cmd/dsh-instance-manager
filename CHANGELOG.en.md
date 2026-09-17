# Changelog

Release notes are generated from the matching version section; newest first.
For Chinese, see [CHANGELOG.md](CHANGELOG.md).

## 0.9.11 - 2026-09-17

### Fixed

- **The panel swallowed the reason an action failed.** `refresh()` called `setError(null)` after every successful list read, and `startNew()` sets the error and then calls `refresh()`, so a "port already in use" or "start failed" message was cleared before it could be read — the click simply appeared to do nothing. Only a failed list read writes that state now; an action error persists until the next action.
- As a result 0.9.10's occupied-port check returned `port_in_use` correctly from the host but showed nothing in the panel. It is visible now.

## 0.9.10 - 2026-09-17

### Added

- Starting a new instance can name a port. The toolbar gains a port field: empty keeps the previous behaviour (the first free port in the managed range), a value starts on that port. A named port that is already in use answers `port_in_use` and names it, and the instance is **not** started elsewhere; a non-integer or out-of-range value answers 400 instead of silently falling back to auto.
- The lost-scan/bind-race retry applies only to an auto-picked port. A named port is no longer retried on another port, which would start an instance the caller did not ask for.

### Changed

- The armed stop button is now an outlined warning (`--dsw-alias-state-warn-primary`) labelled "确认？" / "Confirm?". It was a solid error-red fill: red denotes a failure that already happened, whereas the stop has not run yet and the click is still reversible. The unarmed button keeps its original red outline and "Stop" label.

## 0.9.9 - 2026-09-17

### Fixed

- The two-step stop confirmation applied only to the **current** instance (`item.current`). Stopping any other instance ran on the first click, which reads as "there is no confirmation". Every stoppable local instance now arms first, and the second click performs the stop.
- The armed button label changed from "Confirm?" to "Click again", stating the next action instead of asking a question. The window stays 4 seconds and then cancels, so a stale armed state cannot fire a stop much later.

### Changed

- The README header uses one consistent badge row: npm version, downloads, DSH compatibility range, Node version, license, and the Mini Utility Dock entry point.

## 0.9.8 - 2026-09-17

### Fixed

- Clicking a row's `:port` no longer navigates to a bare root that must answer 401. Current DSH requires the per-process launch token on an instance root; the link pointed at `http://127.0.0.1:<port>/`, so newer hosts answered `authentication required; reopen the URL printed by dsh web`.
- The link now targets a redirect endpoint, `?action=open&port=`: the host reads that instance's **current process** token from `$DSH_HOME/launcher/logs/server-<port>.out.log` and answers 303. The token is regenerated on every process start, so a port that has been restarted accumulates one line per process, and only the **last** line is current — following an earlier one yields an equally invalid token.
- The log line is parsed as a URL rather than prefix-matched, and the scheme, loopback host, requested port, root path, and token presence are all checked; any mismatch counts as no token.
- When no token can be read — the instance was not started by this host's launcher, or the log has rotated — the endpoint answers 409 `launch_token_unavailable` naming the `dsh web` URL to use, instead of silently redirecting to a bare root.
- A remote instance row's port link performs the same exchange on that peer's own panel: the token is readable only on the host running the instance.

### Security

- The token never enters panel state and never appears in the link's `href`; it exists only in the 303 response's `Location` header, which carries `cache-control: no-store` and `referrer-policy: no-referrer`. DSH then exchanges it for a cookie and redirects to a clean `/`.
- `action=open` passes the same browser authentication gate as `list` / `logs` / `sessions`; it is not a new unauthenticated endpoint.

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

- The Dock fragment is synchronized from `dsh-mini-utility-dock`; published plugins remain standalone.
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
