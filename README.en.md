# dsh-instance-manager

[中文](./README.md) | [English](./README.en.md)

[![ci](https://img.shields.io/github/actions/workflow/status/xswt442-cmd/dsh-instance-manager/compat.yml?branch=main&label=ci)](https://github.com/xswt442-cmd/dsh-instance-manager/actions/workflows/compat.yml)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=plugin&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-instance-manager?label=npm&color=4d6bfe)](https://www.npmjs.com/package/dsh-instance-manager)
[![release](https://img.shields.io/github/v/release/xswt442-cmd/dsh-instance-manager?label=release&color=16a3a3)](https://github.com/xswt442-cmd/dsh-instance-manager/releases)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=%3E%3D0.1.5-rc.3&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![node](https://img.shields.io/static/v1?label=node&message=%3E%3D20&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![downloads](https://img.shields.io/npm/d18m/dsh-instance-manager?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-instance-manager)
[![license](https://img.shields.io/badge/license-MIT-22c55e.svg)](./LICENSE)

Instance manager for DSH Web. It shows one status row per local dsh web instance the machine can see, and starts, opens, and stops those instances. With a peer configured, the same panel also queries instances on other machines.

The entry point is the menu icon at the bottom-left of the work area, right of the sidebar.

## Features

- One row per instance: port, PID, uptime, session count, resident memory and version; the current instance sorts first and the rest follow by ascending port.
- Start a new instance: an empty port takes the first free port of the start range, and a named port already in use is reported instead of moving to another port.
- Open an instance: a row's `:port` navigates to that instance's UI, and the launch token is read by the host at that moment, so it enters neither the panel state nor the link.
- Stop one, the current, or all local instances; remote rows are read-only and never part of stop-all.
- Read-only views per instance: stdout/stderr logs, session summaries, and what the instance is serving.
- Remote instances: with a peer configured, view remote instances, their logs, and their sessions.
- Agent tools: `instance_list`, `instance_start`, `instance_stop`, `instance_logs`, `instance_sessions`.
- A web-panel start opens the one-time token URL so the new instance can issue its browser cookie, and an agent-tool start remains headless.

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
- The default adds `19387`, the port the desktop host takes by default; a desktop host is identified by the injected boot manifest, is listed even without this plugin, and is not managed by this plugin.

The UI language follows the global DSH Settings → General language. The plugin stores no separate language preference.

### Environment variables and override precedence

Every field has an environment variable of the same name: a deployment without a settings service is configured through them, and when a preference is left unset the matching variable is that field's default.

```powershell
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'                # live.refreshIntervalMs, decimal digits only
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'        # live.fleetToken
$env:DSHIM_PEERS = 'office@http://192.168.1.20:3080'   # live.peers, same format as the table
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

The heartbeat file `<home>/run/instances/<port>.json`, the `action=self` reply and the agent tool rows share one set of identity fields:

- `runtime`: `desktop` marks the desktop app's own host process, which every stop operation skips, and `node` marks an ordinary web instance. The criterion is the entry script the host was asked to run, so the environment flag (`ELECTRON_RUN_AS_NODE`) is a diagnostic field only: a web instance started from the desktop carries it too.
- `launcher`: the host kind that started this instance, `desktop` or `web`, and `parentPid`: the pid of the host that spawned it. A patched host injects both, and they are `null` when unavailable.
- A host started before this version writes none of these fields and its row is read as `node`, identifying itself only after one restart.
- `name` is the listing process's own executable name, identical on every row of one listing and never the listed instance's identity; tell instances apart by `runtime`, `pid` and `version`.

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
- On DSH 0.1.0-rc.7 and later, browser APIs and event streams reuse the Connection signed cookie, admission is decided by Connection's Host/Origin check and that cookie, and this plugin's own guard does not take part.
- Instance confirmation and forwarding use strict loopback probe actions only, and SSE is local-only.
- Every accepted mutation writes one line to `<home>/launcher/logs/dshim-requests.log`, recording the peer address, the admission path, the request's `Host`/`Origin`/`Referer`/`User-Agent`, the target port, and the result.
- `dshim-selfexit.log` records only the trigger; cookies and Authorization are never read and never written.

## Development

Run before committing:

```sh
npm test
npm run docs:check
npm pack --dry-run
```

## License

[MIT](./LICENSE)
