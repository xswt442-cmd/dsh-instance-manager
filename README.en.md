# dsh-easy-port-manager

> [中文](./README.md) | English

A persistent DSH plugin: a **dsh 管理** button at the sidebar foot opens a floating panel that lists every dsh web instance running on local ports 3080–3129, with one-click graceful stop — including a Task-Manager-style stop of the current instance. Zero external processes: discovery is peer-to-peer over HTTP, and stopping asks the target instance to exit through the harness's own graceful `appExit` shutdown (sessions are flushed properly).

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)

## Features

- **Instance overview**: port (click to open), PID, status badge (current session / running / non-DSH service), auto-refresh every 4s.
- **One-click stop**: politely asks the target instance to exit gracefully; automatically disabled for legacy instances without this bundle.
- **Stop current**: two-step confirmation ends the instance behind the current window (same as Task Manager End Task). Sessions are persisted — conversations resume after restarting DSH.
- **Theme aware**: follows light/dark theme tokens; renders entirely in-page, never spawns console windows.

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
