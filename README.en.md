# dsh-instance-manager

[中文](./README.md) | English

[![npm](https://img.shields.io/npm/v/dsh-instance-manager)](https://www.npmjs.com/package/dsh-instance-manager)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A management panel for the DSH Web sidebar that lists every dsh web instance on local ports 3080–3129 (port / PID / uptime / sessions / memory) and starts or stops any of them.

## Features

- **Instance list**: port (clickable), PID, uptime, active session count, memory usage; status badge (current session / running / non-DSH service); auto-refresh every 4 seconds, paused while the tab is hidden
- **Version badges**: every managed instance reports its plugin version; rows running a different version than this panel get a "version skew" flag — mixed-fleet windows become visible, and a clean fleet is the signal to retire the legacy alias route
- **zh / EN toggle**: the header button switches languages instantly; the preference persists in localStorage, and first open follows the browser language
- **Instance details**: click any row to expand a drawer — PID, start time, version, a memory sparkline built from the panel's own polling samples (last 60), and stdout/stderr log tails (last 200 lines)
- **Start new instance**: launches a dsh web instance on the first free port as a detached background process; logs under `~\.dsh\launcher\logs\`
- **Stop instance**: sends an exit request to the target, which shuts down through the harness `appExit` path while sessions persist as usual; disabled for instances without this bundle, with the reason shown
- **Stop current instance / stop all**: both require a two-step confirmation; the UI disconnects afterwards and sessions resume on the next DSH start

Apart from launching new instances, no child processes are spawned.

## Install

```powershell
# npm package (recommended)
dsh plugin --profile web add dsh-instance-manager

# or install from the Git repository
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

Restart DSH Web afterwards.

### Migrating from ≤0.4.x (dsh-easy-port-manager)

```powershell
dsh plugin --profile web remove dsh-easy-port-manager
dsh plugin --profile web add dsh-instance-manager
```

Mixed fleets are supported: new panels discover and stop old instances, and old panels discover and stop new ones (the pre-rename API route is kept as an alias).

## Uninstall

```powershell
dsh plugin --profile web remove dsh-instance-manager
```

## How it works

The host half registers a JSON route `/dsh-instance-manager/api` on the webserver (the pre-rename `/dsh-easy-port-manager/api` path is kept as an identical alias):

| Action | Method | Description |
|---|---|---|
| `action=list` | GET | Reads the heartbeat registry first (`~\.dsh\run\instances\<port>.json`, 10 s cadence / 30 s freshness) and re-verifies each claim via `action=self`; only uncovered ports fall back to self-probing and page-marker detection |
| `action=self` | GET | Instance reports `{ pid, port, startedAt, sessions, rss, version }` |
| `action=logs&port=&stream=out\|err` | GET | Tails that port's launcher logs (`~\.dsh\launcher\logs\server-<port>.*.log`, bounded to 64KB / 200 lines); the logs dir is shared by all local instances, so no peer forwarding is needed |
| `action=start` | POST | Starts a new dsh web instance on the first free port (detached + windowsHide) |
| `action=stop&port=` | POST | Self target → delayed `appExit` shutdown; otherwise forwards `stop-self` to the target |
| `action=stop-all` | POST | Forwards stops to all managed instances in parallel, then exits itself |
| `action=stop-self` | POST | Graceful self-shutdown; GET tolerated for ≤0.4.1 peer forwarding |

Instances without this bundle are identified by the injected `window.__DSH_BOOT__` manifest marker.

## Security model

The API serves the local panel only. Browsers allow any page to send requests to `http://127.0.0.1:<port>` (loopback is exempt from mixed-content blocking, and missing CORS only hides responses — it does not prevent requests), so every action passes a shared guard:

- Mutating actions (`start` / `stop` / `stop-all`) require POST; `stop-self` additionally tolerates GET for ≤0.4.1 peer forwarding
- Fetch Metadata: `sec-fetch-site` outside `same-origin` / `none` → 403
- `Origin`, when present, must match this instance's loopback origin → else 403
- `Host` must name a loopback address → else 403; also defeats DNS rebinding

A malicious process already running locally can kill processes directly and is out of scope for this threat model.

## Structure

```
package.json       npm metadata + dsh.bundle.patch + dsh.client declaration
cordis.patch.yml   inserts this plugin's loader row into the profile
lib/index.js       host: registers the /dsh-instance-manager/api JSON route
lib/client.js      client: sidebar entry + floating panel (ModuleLoader bundle)
lib/shared.js      host pure helpers (request guards / bin resolution / registry validation)
test/              node:test unit suite (npm test)
CHANGELOG.md       changelog
```

## License

[MIT](./LICENSE)
