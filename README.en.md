# dsh-instance-manager

[中文](./README.md) | English

[![npm](https://img.shields.io/npm/v/dsh-instance-manager)](https://www.npmjs.com/package/dsh-instance-manager)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A management panel launched from the shared createhelper utility dock in DSH Web: lists every dsh web instance on local ports 3080–3129, with launch, graceful stop, and per-instance details.

The dock is one small page-level tray shared with other createhelper utilities such as dsh-treekeeper — whichever plugin loads first creates it, the rest register a button into it. Placement (bottom-left following the sidebar edge / bottom-right / hidden) is switchable and remembered in localStorage.

## Features

- **Instance list**: port (clickable) / PID / uptime / sessions / memory; auto-refresh every 4 seconds, paused while the tab is hidden
- **Version badges**: managed instances report their plugin version; a row running a different version gets a "version skew" flag
- **Instance details**: click a row to expand a drawer — start time, memory sparkline, stdout/stderr log tails (last 200 lines)
- **Start / stop**: one-click new instance; graceful stop of any instance (`appExit`, sessions persist); stopping the current instance and stop-all ask twice
- **zh / EN toggle**: header button switches languages instantly; preference persists in localStorage
- **Agent tools**: registers `instance_list / instance_start / instance_stop / instance_logs / instance_sessions` with the in-session model, so agents can inspect and drive instances (the stop tool refuses to kill the current instance)
- **Up/down toasts**: managed instances joining or leaving pop an instant toast bottom-right via SSE — even while the panel is closed
- **Session summaries**: inspect any managed instance's live sessions from the drawer (time / cwd / subagent / activity)
- **Shared utility dock**: the entry point is one button in a page-level tray shared with other createhelper utilities (dsh-treekeeper); placement (bottom-left / bottom-right / hidden) is switchable and remembered

Apart from launching new instances, no child processes are spawned.

## Install

```powershell
dsh plugin --profile web add dsh-instance-manager
# or from the Git repository
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

Restart DSH Web afterwards. Uninstall: `dsh plugin --profile web remove dsh-instance-manager`.

## How it works

The host half registers the JSON route `/dsh-instance-manager/api`:

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
| `stop-self` | POST | Graceful self-shutdown (POST only, like every other mutating action) |

## Port band and adaptability

Sweep/start default to **3080–3129** (matching dsh's documented convention). Research note: the band is a convention, not a runtime contract — the dsh webserver takes its port from composition config and even supports `0` (OS-assigned); nothing in the runtime hard-codes it. Therefore:

- `DSHIM_PORT_RANGE="4000-4010"` overrides the sweep/start band wholesale
- **Discovery never depended on the band**: heartbeat entries validate 1–65535, so instances hand-started outside the range are still listed, stopped, and inspectable
- Panel-launched children spawn with `--no-open`; the start-confirm window is up to 25 s, so slow first boots (session-log backfills) are no longer mis-reported as failures, and a child that dies in-window leaves an exit-code breadcrumb in its launcher log

## Security model

The API serves the local panel only. Loopback is exempt from mixed-content blocking and missing CORS only hides responses, so every action passes a shared guard:

- Mutating actions require POST, `stop-self` included (a GET gets 405)
- Fetch Metadata: `sec-fetch-site` outside same-origin / none → 403
- Foreign `Origin` → 403; non-loopback `Host` → 403 (also defeats DNS rebinding)

A malicious process already running locally can kill processes directly and is out of scope for this threat model.

### Remote fleet: configuring a peer grants it control of this machine

Requests from outside loopback (a non-loopback `Host`) additionally need the fleet bearer —
`Authorization: Bearer`, resolved per request from `DSHIM_FLEET_TOKEN` or from whatever
`DSHIM_FLEET_TOKEN_REF` points at, failing closed when unconfigured. **The token carries no
action-level scoping**: it is a symmetric pre-shared key, and a peer holding it can call every
action on this machine, including

- `start` — spawning new processes here
- `stop` / `stop-all` — shutting down local dsh instances, this one included
- `sessions` — reading session working directories and the other scalar fields

Treat every machine in `DSHIM_PEERS` as a trusted operator of this host, not a read-only observer.
There is no "let them only see the list" setting — for read-only access, open the other machine's
panel in a browser instead of peering. SSE `/events` is not exposed remotely (EventSource cannot
send custom headers), so remote peers get no live up/down push.

## Structure

```
package.json       npm metadata + dsh.bundle.patch + dsh.client declaration
cordis.patch.yml   inserts this plugin's loader row into the profile
lib/index.js       host: registers the /dsh-instance-manager/api JSON route
lib/agent-tools.js host: instance_* model tools (tools service)
lib/client.js      client: dock entry + floating panel (ModuleLoader bundle)
lib/shared.js      host pure helpers (guards / bin resolution / registry validation)
test/              node:test unit suite (npm test)
CHANGELOG.md       changelog
```

## License

[MIT](./LICENSE)
