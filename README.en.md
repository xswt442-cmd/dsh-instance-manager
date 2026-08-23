# dsh-easy-port-manager

> [中文](./README.md) | English

A DSH plugin that adds a **dsh 管理** entry to the sidebar foot. It opens a floating panel listing every dsh web instance on local ports 3080–3129 (port / PID / status) and can stop a selected instance.

Instance discovery happens over HTTP between local instances; stopping sends a request to the target, which exits through the harness's `appExit` shutdown while sessions are written to disk as usual. No child processes are spawned.

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)

## Features

- **Instance list**: port (clickable link), PID, status (current session / running / non-DSH service); refreshes every 4 seconds, manual refresh available.
- **Stop instance**: sends an exit request to the target; disabled for legacy instances without this bundle, with the reason shown.
- **Stop current instance**: requires two-step confirmation; the current window disconnects afterwards, sessions stay persisted and resume after restarting DSH.
- **Styling**: colors follow theme tokens for light/dark; all logic runs in-page without spawning child processes.

## Install

```powershell
dsh plugin --profile web add "github:xswt442-cmd/dsh-easy-port-manager"
```

> Restart DSH Web afterwards.

## How it works

The host half registers a JSON route `/dsh-easy-port-manager/api` on the webserver:

| Action | Description |
|---|---|
| `action=list` | Probes 3080–3129 concurrently: first asks `action=self` (instances mounting this bundle self-report their pid), falling back to page-marker probing |
| `action=self` | Instance reports `{ pid, port }` |
| `action=stop&port=` | If the target is self → delayed `appExit` graceful shutdown; otherwise forwards `stop-self` to the target |
| `action=stop-self` | Graceful self shutdown |

No netstat/tasklist/powershell child processes are ever spawned; behavior is independent of the mounted shell executor.

## Structure

```
package.json       npm metadata + dsh.bundle.patch + dsh.client (browser half registration)
cordis.patch.yml   inserts this plugin's loader row into the profile
lib/index.js       host (/dsh-easy-port-manager/api JSON route)
lib/client.js      client (ModuleLoader classic-script bundle: sidebar action + floating panel)
```

## License

[MIT](./LICENSE)
