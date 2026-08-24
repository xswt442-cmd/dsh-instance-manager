# dsh-instance-manager

> [中文](./README.md) | English

A DSH plugin that adds a **dsh 管理** entry to the sidebar foot. It opens a floating panel listing every dsh web instance on local ports 3080–3129 (port / PID / status) and can stop a selected instance. (Formerly `dsh-easy-port-manager`; renamed in 0.5.0 — it manages instance lifecycles, ports are just the discovery mechanism.)

Instance discovery happens over HTTP between local instances; stopping sends a request to the target, which exits through the harness's `appExit` shutdown while sessions are written to disk as usual. No child processes are spawned.

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)

## Features

- **Instance list**: port (clickable link), PID, uptime, active session count, status (current session / running / non-DSH service); refreshes every 4 seconds, manual refresh available.
- **Start new instance**: launches a fresh dsh web instance on the first free port (hidden background process, logs under `~\.dsh\launcher\logs\`).
- **Stop instance**: sends an exit request to the target; disabled for legacy instances without this bundle, with the reason shown.
- **Stop all**: ends every managed instance (including the one this panel lives in) behind a two-step confirmation.
- **Stop current instance**: requires two-step confirmation; the current window disconnects afterwards, sessions stay persisted and resume after restarting DSH.
- **Styling**: colors follow theme tokens for light/dark; apart from launching new instances, no child processes are spawned.

## Install

```powershell
dsh plugin --profile web add "github:xswt442-cmd/dsh-instance-manager"
```

> Restart DSH Web afterwards.
>
> Upgrading from `dsh-easy-port-manager` ≤0.4.x: run `dsh plugin --profile web remove dsh-easy-port-manager` first, then install as above. Mixed fleets are fine — new panels discover and stop old instances, and old panels discover and stop new ones (the pre-rename route is kept as an alias).

## How it works

The host half registers a JSON route `/dsh-instance-manager/api` on the webserver (the pre-rename `/dsh-easy-port-manager/api` path is kept as an identical-behavior alias):

| Action | Method | Description |
|---|---|---|
| `action=list` | GET | Probes 3080–3129 concurrently: first asks `action=self` (instances mounting this bundle self-report pid / start time / session count), falling back to page-marker probing |
| `action=self` | GET | Instance reports `{ pid, port, startedAt, sessions }` |
| `action=start` | POST | Starts a new dsh web instance on the first free port (detached + windowsHide) |
| `action=stop&port=` | POST | If the target is self → delayed `appExit` graceful shutdown; otherwise forwards `stop-self` to the target |
| `action=stop-all` | POST | Ends all managed instances (remote forwarding + own graceful shutdown) |
| `action=stop-self` | POST | Graceful self shutdown; GET is also tolerated for forwarding peers running ≤0.4.1 |

No netstat/tasklist/powershell child processes are ever spawned; behavior is independent of the mounted shell executor.

## Security model

The API is meant for the local panel only. Loopback binding alone is not enough: browsers happily let any https page fire requests at `http://127.0.0.1:<port>` (loopback counts as a potentially trustworthy origin, so mixed-content blocking does not apply), and missing CORS only hides responses — it does not stop the request. Since 0.4.2:

- **Mutating actions require POST** (`start` / `stop` / `stop-all`); `stop-self` additionally tolerates GET for legacy peer forwarding.
- **Fetch Metadata check**: any request with `sec-fetch-site: cross-site` gets a 403 — modern browsers attach the header to every request, which covers img/form/fetch drive-bys from malicious pages.
- **Origin check**: when an `Origin` header is present it must be this instance's loopback origin.
- **Host check**: the `Host` header must name a loopback address, which also defeats DNS rebinding.

A malicious process already running locally can kill processes directly and is out of scope for this threat model.

## Structure

```
package.json       npm metadata + dsh.bundle.patch + dsh.client (browser half registration)
cordis.patch.yml   inserts this plugin's loader row into the profile
lib/index.js       host (/dsh-instance-manager/api JSON route, legacy path kept as alias)
lib/client.js      client (ModuleLoader classic-script bundle: sidebar action + floating panel)
```

## License

[MIT](./LICENSE)
