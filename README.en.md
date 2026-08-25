# dsh-instance-manager

[中文](./README.md) | English

[![npm](https://img.shields.io/npm/v/dsh-instance-manager)](https://www.npmjs.com/package/dsh-instance-manager)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A management panel for the DSH Web sidebar: lists every dsh web instance on local ports 3080–3129, with launch, graceful stop, and per-instance details.

## Features

- **Instance list**: port (clickable) / PID / uptime / sessions / memory; auto-refresh every 4 seconds, paused while the tab is hidden
- **Version badges**: managed instances report their plugin version; a row running a different version gets a "version skew" flag
- **Instance details**: click a row to expand a drawer — start time, memory sparkline, stdout/stderr log tails (last 200 lines)
- **Start / stop**: one-click new instance; graceful stop of any instance (`appExit`, sessions persist); stopping the current instance and stop-all ask twice
- **zh / EN toggle**: header button switches languages instantly; preference persists in localStorage
- **Agent tools**: registers `instance_list / instance_start / instance_stop / instance_logs / instance_sessions` with the in-session model, so agents can inspect and drive instances (the stop tool refuses to kill the current instance)
- **Up/down toasts**: managed instances joining or leaving pop an instant toast bottom-right via SSE — even while the panel is closed
- **Session summaries**: inspect any managed instance's live sessions from the drawer (time / cwd / subagent / activity)

Apart from launching new instances, no child processes are spawned.

## Install

```powershell
dsh plugin --profile web add dsh-instance-manager
# or from the Git repository
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

Restart DSH Web afterwards. Uninstall: `dsh plugin --profile web remove dsh-instance-manager`.

## How it works

The host half registers the JSON route `/dsh-instance-manager/api` (the pre-rename `/dsh-easy-port-manager/api` path stays as an alias):

| Action | Method | Description |
|---|---|---|
| `list` | GET | Reads the heartbeat registry first (10 s cadence / 30 s freshness) and re-verifies claims, including heartbeat-known ports outside the sweep range; uncovered ports fall back to self-probing and page markers |
| `self` | GET | Reports `{ pid, port, startedAt, sessions, rss, version }` |
| `logs&port=&stream=out\|err` | GET | Tails the shared launcher log `server-<port>.*.log` (≤64KB / 200 lines) |
| `sessions&port=` | GET | Live-session summary of the target instance (scalar fields only, newest 20); omit port for self |
| `GET /dsh-instance-manager/events` | GET | SSE fleet up/down push (baseline frame + diff frames) |
| `start` | POST | Launches a new instance on the first free port (detached background) and holds the reply until it answers `self`, returning `{ ok, port, pid }`; a lost port race retries once on the next free port |
| `stop&port=` | POST | Self → `appExit`; otherwise forwards `stop-self` to the target |
| `stop-all` | POST | Forwards stops in parallel, then exits itself |
| `stop-self` | POST | Graceful self-shutdown (GET tolerated for ≤0.4.1 peer forwarding) |

## Security model

The API serves the local panel only. Loopback is exempt from mixed-content blocking and missing CORS only hides responses, so every action passes a shared guard:

- Mutating actions require POST (`stop-self` tolerates GET for legacy peer forwarding)
- Fetch Metadata: `sec-fetch-site` outside same-origin / none → 403
- Foreign `Origin` → 403; non-loopback `Host` → 403 (also defeats DNS rebinding)

A malicious process already running locally can kill processes directly and is out of scope for this threat model.

## Structure

```
package.json       npm metadata + dsh.bundle.patch + dsh.client declaration
cordis.patch.yml   inserts this plugin's loader row into the profile
lib/index.js       host: registers the /dsh-instance-manager/api JSON route
lib/agent-tools.js host: instance_* model tools (tools service)
lib/client.js      client: sidebar entry + floating panel (ModuleLoader bundle)
lib/shared.js      host pure helpers (guards / bin resolution / registry validation)
test/              node:test unit suite (npm test)
CHANGELOG.md       changelog
```

## License

[MIT](./LICENSE)
