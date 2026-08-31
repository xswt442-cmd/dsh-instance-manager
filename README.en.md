# dsh-instance-manager

[中文](./README.md) | English

[![npm](https://img.shields.io/npm/v/dsh-instance-manager)](https://www.npmjs.com/package/dsh-instance-manager)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

DSH Web instance manager, opened from `DSH Instance` in the shared utility dock. It lists DSH Web instances in the local port range, shows details, stops instances, and launches new ones; configured peers add remote instances. DIM and TreeKeeper reuse one page-local dock through a versioned private protocol, with no prerequisite plugin.

## Features

- **Instance list**: port / PID / uptime / sessions / memory; 4 s auto-refresh (paused on hidden tabs); plugin-version mismatch gets a "version skew" badge
- **Instance details**: drawer with start time, memory trend, stdout/stderr log tails (200 lines), live session summary
- **Start / stop**: launch a new instance (waits for its self-report, returns the pid); graceful stop of any instance (`appExit`, sessions persist); stopping the current instance and stop-all ask twice; instance and peer status changes toast via SSE
- **Agent tools**: `instance_list` / `instance_start` / `instance_stop` / `instance_logs` / `instance_sessions`
- **zh / EN toggle**: preference persisted in localStorage

## Install

```powershell
dsh plugin --profile web add dsh-instance-manager
# or from the Git repository
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

Restart DSH Web afterwards.

## How it works

The host half registers `/dsh-instance-manager/api` (the pre-rename alias `/dsh-easy-port-manager/api` was removed in 0.9):

| Action | Method | Description |
|---|---|---|
| `list` | GET | Heartbeat registry first (10 s write / 30 s freshness) with re-verification, then probing; merges remote fleets when peers are configured |
| `self` | GET | `{ pid, port, startedAt, sessions, rss, version, fleetId }` |
| `logs&port=&stream=` | GET | Tails the shared launcher log (≤64KB / 200 lines); with `peer=` reads through the fleet link |
| `sessions&port=` | GET | Live-session summary (scalar fields, newest 20); with `peer=` reads through the fleet link |
| `start` | POST | Launches on the first free port (detached), holds until the instance answers `self`, returns `{ ok, port, pid }`; retries once on a lost port race |
| `stop&port=` | POST | Self → `appExit`; otherwise forwards `stop-self` |
| `stop-all` | POST | Forwards stops in parallel (local rows only), then exits itself |
| `stop-self` | POST | Graceful self-shutdown (GET gets 405) |
| `GET /events` | GET | SSE: instance up/down and peer status pushes |
| `WS /link` | WS | Fleet link: bearer-authenticated (fail-closed); query kinds `ping` / `fleet` / `sessions` / `logs` |

## Port band

- Sweep/start default to 3080–3129; `DSHIM_PORT_RANGE="4000-4010"` overrides
- Discovery is heartbeat-driven (ports validated 1–65535) and does not depend on the band; out-of-band instances are still listed and operable
- Every `port=` parameter (`logs` / `sessions` / `stop`) goes through the same `normalizePort` gate: decimal integers in 1–65535 only. `1e3`, `0x10`, `+80`, `80.5` and `-1` are all 400 `no_port` — the port is interpolated into a launcher log filename, so it refuses rather than guesses

## Fleet pairing (>= 0.9)

```powershell
setx DSHIM_FLEET_TOKEN "a-long-random-string"      # must match on both sides
setx DSHIM_PEERS "office@http://192.168.1.20:3080"
```

- Rows are badged `@id`; `instance_sessions` / `instance_logs` accept `peer=`
- `action=list` reports each peer's status in `peers`: `online` / `unreachable` / `timeout`
- Peering is per-direction, so two machines that should see each other list each other in `DSHIM_PEERS` — that is the supported shape (a `fleet` query is answered from local rows only and never re-queries a peer)
- Without a token the link always answers 403 (fail-closed)

## Security model

The API serves the local panel only; every action passes a shared guard:

- Mutating actions require POST, `stop-self` included
- Fetch Metadata: `sec-fetch-site` outside same-origin / none → 403
- Foreign `Origin` → 403; non-loopback `Host` → 403 (also defeats DNS rebinding)
- Non-loopback requests require `Authorization: Bearer <token>` (constant-time comparison; refused when unconfigured)
- **The token has no action-level scoping**: a peer holding it can call every action on this machine (`start` spawns processes, `stop` / `stop-all` shut down local instances, `sessions` reads session working directories). Treat each peer as a trusted operator, not a read-only observer; for read-only access, open the other machine's panel instead of peering
- SSE `/events` is not exposed remotely (EventSource cannot send custom headers)
- A malicious process already running locally can kill processes directly; that is outside this threat model

## Development and deployment

- Running instances must NOT mount this repository through a symlink: file changes trigger HMR reloads, and intermediate states of multi-file edits can take an instance down
- Snapshot deploy (symlink → real directory copy): `powershell -File scripts\deploy-profile.ps1`, then restart instances

## Structure

```
package.json       npm metadata + dsh.bundle.patch + dsh.client declaration
cordis.patch.yml   inserts the loader row into the profile
lib/index.js       host: API / SSE / fleet-link registration
lib/fleet.js       host: peer links (dial / reconnect / query frames)
lib/agent-tools.js host: instance_* model tools
lib/client.js      client: dock entry + panel
lib/shared.js      host pure helpers (guards / registry / session summary)
scripts/           dev tooling
test/              node:test unit suite (npm test)
```

## License

[MIT](./LICENSE)
