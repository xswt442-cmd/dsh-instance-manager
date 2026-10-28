# dsh-instance-manager

[中文](./README.md) | [English](./README.en.md)

[![ci](https://img.shields.io/github/actions/workflow/status/xswt442-cmd/dsh-instance-manager/compat.yml?branch=main&label=ci)](https://github.com/xswt442-cmd/dsh-instance-manager/actions/workflows/compat.yml)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=plugin&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-instance-manager?label=npm&color=4d6bfe)](https://www.npmjs.com/package/dsh-instance-manager)
[![release](https://img.shields.io/github/v/release/xswt442-cmd/dsh-instance-manager?label=release&color=16a3a3)](https://github.com/xswt442-cmd/dsh-instance-manager/releases)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=%3E%3D0.2.0-rc.1&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![node](https://img.shields.io/static/v1?label=node&message=%3E%3D20&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![downloads](https://img.shields.io/npm/d18m/dsh-instance-manager?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-instance-manager)
[![license](https://img.shields.io/badge/license-MIT-22c55e.svg)](./LICENSE)

Instance manager for DSH Web. It shows one status row per local dsh web instance the machine can see, and starts, opens, and stops those instances. With a peer configured, the same panel also queries instances on other machines.

The entry point is the menu icon at the bottom-left of the work area, right of the sidebar.

## Features

- One row per instance: port, PID, uptime, session count, resident memory and version; the current instance sorts first and the rest follow by ascending port.
- Start a new instance: an empty port takes the first free port of the start range, and a named port already in use is reported instead of moving to another port. When tmux or screen is detected, the start runs `dsh web` inside a persistent session, so the instance does not leave with the panel host.
- Open an instance: a row's `:port` navigates to that instance's UI, and the launch token is read by the host at that moment, so it enters neither the panel state nor the link.
- Stop one, the current, or all local instances; remote rows are read-only and never part of stop-all.
- Restart in place: restart another local instance **on the same port** without a manual stop + start.
- Restart the current instance: when tmux or screen is detected, a replacement starts on a new port, the browser is sent to its token URL once it is ready, and the old instance exits afterwards.
- Read-only views per instance: stdout/stderr logs, session summaries (time, folded title or short id, working directory, subagent flag, preset, delegation depth, event count), what the instance is serving, and its diagnostic records (crash black box, self-exit log, mutation trace).
- Remote instances: with a peer configured, view remote instances, their logs, and their sessions.
- Agent tools: `instance_list`, `instance_start`, `instance_stop`, `instance_restart`, `instance_logs`, `instance_sessions`.
- A start from the web panel hands the one-time token URL off to a browser so the new instance can issue its browser cookie; an agent-tool start and a start from the desktop stay headless (`--no-open` is passed on).

## Install

```powershell
# install from npm and register with the web profile (recommended)
dsh plugin --profile web add dsh-instance-manager

# install the npm package only
npm install dsh-instance-manager

# or install from GitHub
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

- `npm install` installs the package only; DSH enables the plugin once the bundle is in a DSH profile, and `dsh plugin add` performs both steps.
- Restart DSH Web after installation.

## Configuration

### The live and startup sections

- `live`: refresh interval, fleet token, peer list; the host watches this section and a change there takes effect immediately.
- `startup`: the managed port range; that section is `applies: 'restart'`, the host reads it once at construction, and the settings UI marks a not-yet-applied edit as pending.

Which source is read depends on the host version:

- DSH 0.1.7-rc.1 and later: both sections come from the profile entry's own `config`, and that version's settings service no longer exposes `register`; editing the entry config restarts this plugin, while `live` changes still apply immediately.
- Earlier releases: the two sections are the namespaces the settings service registers, `dsh-instance-manager` (`live`) and `dsh-instance-manager-startup` (`startup`); `live` applies through its watch, and the same names written into an entry config are not read.
- On a host that offers both, the settings service carries the reads, and a value written to the other source has no effect and reports no error.

### Fields and value ranges

| Section | Field | Type | Default | Accepted values |
| --- | --- | --- | --- | --- |
| live | `refreshIntervalMs` | number | `4000` | `1000`–`60000` ms |
| live | `fleetToken` | string (secret) | none | any non-empty string |
| live | `peers` | string | `''` (no peers) | comma-separated `id@origin`, at most 16 entries |
| startup | `portRange` | string | `'3080-3129,19387'` | comma-separated ranges and single ports within `1`–`65535`, at most `1024` ports across all ranges |

- An out-of-range `refreshIntervalMs` is clamped to the bound, and a fractional one is rounded to the nearest integer.
- `fleetToken` is write-only in the UI and appears in no API response and no log.
- A `peers` id is 1–32 characters of `[A-Za-z0-9_-]`, its origin may omit `http://` and `https://`, and a URL with userinfo is rejected.
- `peers` is directional; configure both ends when two machines should see each other.
- The first `portRange` range bounds where a new instance may start, and every remaining range bounds what discovery sweeps.
- Discovery also sweeps the heartbeat-known ports, so an instance launched by hand with `--port 4000` still appears in the list.
- One unusable `portRange` part sends the whole list back to the built-in default.
- The default adds `19387`, the port the desktop host takes by default; a desktop host that does not run this plugin reaches the list through a probe of that port, its row carries no `runtime`, and this plugin does not manage it.

The UI language follows the global DSH Settings → General language. The plugin stores no separate language preference.

### Environment variables and override precedence

Every field has an environment variable of the same name: a deployment without a settings service is configured through them, and when a preference is left unset the matching variable is that field's default.

```powershell
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'                # live.refreshIntervalMs, decimal digits only
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'        # live.fleetToken
$env:DSHIM_PEERS = 'office@http://192.0.2.10:3080'     # live.peers, same format as the table
$env:DSHIM_PORT_RANGE = '3080-3129,19387'              # startup.portRange
$env:DSHIM_FLEET_TOKEN_REF = 'DSHIM_FLEET_TOKEN'       # the name of the variable holding the token, see below
```

A single field resolves in this order:

1. the source the running host version reads (see above).
2. the matching environment variable.
3. the built-in default.

- The environment is the composition `base` layer, below a value the user stored and above the schema default.
- Only a well-formed environment value enters that layer; a mistyped `DSHIM_PORT_RANGE` does not fail the registration, and that field falls back to the built-in default.

### Fleet token resolution order

The value of `DSHIM_FLEET_TOKEN_REF` is the name of the environment variable holding the token. When that variable is unset, the name is `DSHIM_FLEET_TOKEN`. Each remote request takes the first non-empty result of:

1. the `fleetToken` of the `live` section (entry config or stored settings), where `DSHIM_FLEET_TOKEN` already participates as that field's `base` layer.
2. the credentials service, looked up under that name, when the host provides one.
3. the process environment under that name.

- The token is resolved per request, so rotating it needs no restart.
- When all three are empty the remote surface is closed entirely, and the local panel is unaffected.

## Instance fields

The heartbeat file `<home>/run/instances/<port>.json` records this plugin's instance identity; the `action=self` reply and the agent tool rows carry its `pid`, `port`, `runtime` and other fields.

- `runtime`: `desktop` marks the desktop app's own host process, which every stop operation skips, and `node` marks an ordinary web instance. The criterion is the entry script the host was asked to run, so the environment flag (`ELECTRON_RUN_AS_NODE`) is a diagnostic field only: a web instance started from the desktop carries it too.
- `launcher`: the host kind that started this instance, `desktop` or `web`, and `parentPid`: the pid of the host that spawned it. A patched host injects both, and they are `null` when unavailable; they are written into the heartbeat file only and appear in no `action=self` reply, agent tool row or panel row.
- A row this plugin reports without a `runtime` is read as `node`; a row found only by a port probe carries no such field.
- `name` is the listing process's own executable name, identical on every row of one listing and never the listed instance's identity; the instance identity is read from `runtime`, `pid` and `version`.

## Security

- This plugin's own guard rejects cross-site origins, non-loopback hosts, and unsafe Fetch Metadata; a host that mounts Connection carries that layer instead.
- Whether a fleet bearer is required is decided by the real TCP peer address together with the `Host` header, and either one off-loopback triggers the bearer.
- A remote route is decided by the bearer before the guard runs, and a local request needs no token.
- A missing peer address is rejected, and a request is refused when the token is missing or cannot be resolved.
- Mutating actions are POST-only, and the method name is matched case-insensitively.
- A port parameter must be a decimal integer from 1 to 65535.
- The event stream and every JSON reply carry `cache-control: no-store`.
- An unexpected failure answers a fixed `code` only, and the exception text goes to the host log rather than the response.
- The fleet token has no action-level scopes: a holder can start or stop local instances and read session information, so grant it only to trusted devices.
- On a host that mounts Connection, browser APIs and event streams reuse its signed cookie; admission is decided by Connection's Host/Origin check and that cookie, and this plugin's own guard does not take part.
- Instance confirmation and forwarding use strict loopback probe actions only, and SSE is local-only.
- Every accepted mutation writes one line to `<home>/launcher/logs/dshim-requests.log`, recording the peer address, the admission path, the request's `Host`/`Origin`/`Referer`/`User-Agent`, the target port, and the result.
- `dshim-selfexit.log` records only the trigger; cookies and Authorization are never read and never written.

## Diagnostic records

When an instance disappears silently, the drawer's Diagnostics tab lists that instance's three records, the last 200 lines of each:

- Crash black box `dshim-crash.log`: one header line plus the stack, written on a process crash or an unhandled promise rejection.
- Self-exit log `dshim-selfexit.log`: one line per route that ends this process, saying whether it crashed or was asked to leave.
- Mutation trace `dshim-requests.log`: one line per accepted mutation, with the peer address, the admission path, `Host`/`Origin`/`Referer`/`User-Agent`, the target port, and the result.

- All three files are shared by every local instance, so crash and self-exit records are scoped by that instance's pid and the mutation trace by its port.
- The diagnostics surface accepts local loopback requests only and is never forwarded over fleet: neither a peer holding a valid fleet bearer nor a trusted LAN browser can read it. Remote rows therefore carry no such tab.
- Filtering a crash record keeps the whole record — header and stack — so a stack never lands under another instance's name.
- These files are never pruned by anything, and the diagnostics surface only reads them: nothing deletes or rewrites them.

## Session fields

Every session summary row is a pure scalar projection; the host's live session objects are never serialized wholesale.

- `title`: the latest folded session title, from the host's optional `sessionTitle` service. The field is absent when the host has no such service, or when the session has no eligible input yet, and the panel then falls back to the 8-character short id.
- `agentPreset`, `parentSession`, `delegationDepth`: lineage from the session header, each omitted when absent. Delegation depth appears only on a genuinely delegated child; a top-level session carries none.
- `cwd`, `subagent`, `events`: working directory, subagent flag and event count.
- All of these are optional. On a mixed-version fleet an older instance's reply carries none of them, and this plugin's output schema is closed, so the projection adopts each by type and omits what is missing rather than writing `null`.

## Restart and handoff

An instance row's Restart button and the `instance_restart` agent tool restart a local instance. When the target is not the current instance, the steps are fixed: forward the stop (the target exits gracefully through its own `appExit`, so sessions persist) → poll until the port is genuinely released → launch on that port → wait for it to answer `action=self`.

- **The current instance is handed off.** When tmux or screen is detected, a replacement starts on a free port of the start range inside that session; once it answers `action=self`, the panel returns its absolute token URL and the browser navigates there, after which the old process exits. The token is the one that replacement wrote after starting, and a loopback request confirms it exchanges for a cookie before it is handed over; the host name is the one the browser used for the panel. The old instance serves the panel until the replacement is ready, so there is no empty-port window.
- Panel starts and restarts run `dsh web` inside tmux (then screen) when available, so an instance no longer leaves with the panel host; without either tool the launch falls back to a direct spawn.
- The launcher comes from `dsh` on `PATH` first, then the dsh entry in the profile; only when neither exists does the host answer `no_dsh_bin`.
- In-place restarts of other instances stay on their original port: the port is empty between the stop and the start, a process that grabs it fails the restart with `port_in_use`, and a port still taken after 15 seconds answers `port_still_in_use`. Neither case moves elsewhere.
- Without tmux or screen the current instance is still refused; the desktop host and remote rows are never restartable.
- A panel-triggered restart hands the launch token off to the browser, so the fresh instance opens directly; an agent-tool restart stays headless (`--no-open` is passed on).

## Development

Engineering boundaries and pre-commit checks live in [AGENTS.md](https://github.com/xswt442-cmd/dsh-instance-manager/blob/main/AGENTS.md); the release runbook is [docs/RELEASING.md](https://github.com/xswt442-cmd/dsh-instance-manager/blob/main/docs/RELEASING.md).

## License

[MIT](./LICENSE)
