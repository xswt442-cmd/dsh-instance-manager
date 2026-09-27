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

Instance manager for DSH Web. It shows one status row per local dsh web instance the machine can see, and owns starting, opening, and stopping them; with a peer configured, the same panel also queries instances on other machines. Open it from the menu icon at the bottom-left of the work area, right of the sidebar, whose container and rows come from the `dsh-utility-launcher` fragment in `dsh-mini-utility-dock`.

Preferences (refresh interval, fleet token, peer list, managed port range) are split into a `live` and a `startup` section, and which source feeds them depends on the host version: from DSH 0.1.7-rc.1 it is the profile entry's own config, on earlier releases the two namespaces the settings service registers (the Configuration section walks through both). When neither carries a value, environment variables and the built-in defaults do, and the panel keeps working.

## Features

- One row per instance: port, PID, uptime, live session count, resident memory, version, and whether it is the instance hosting this panel. The current instance always sorts first; everything else follows by ascending port.
- Start a new instance. An empty port means the host picks the first free port in the managed range (3080-3129 by default); a named port is used exactly, and one that is already in use is reported instead of starting somewhere else.
- Open an instance: a row's `:port` navigates to that instance's UI. DSH requires the per-process launch token on an instance root, so the link targets a redirect endpoint: the host reads that instance's current token and answers 303, and the token never enters panel state or the link itself. When the instance was not started by this host's launcher there is no token to read, and the endpoint answers `launch_token_unavailable` naming the `dsh web` URL to use.
- Stop one, the current, or all local instances; each stop goes through the target instance's own graceful shutdown. Remote rows are read-only and are never part of stop-all.
- Read-only views per instance: stdout/stderr logs, session summaries, and what the instance is serving.
- Remote instances: with a peer configured, view remote instances, logs, and sessions; a remote row's port link performs the same token exchange on that peer's own panel.
- Agent tools: `instance_list`, `instance_start`, `instance_stop`, `instance_logs`, `instance_sessions`.
- A web-panel start opens the one-time token URL so the new instance can issue its browser cookie; agent-tool starts remain headless.

## Install

```powershell
# install from npm and register with the web profile (recommended)
dsh plugin --profile web add dsh-instance-manager

# install the npm package only
npm install dsh-instance-manager

# or install from GitHub
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

`npm install` installs the package only; DSH still needs the bundle in its profile. `dsh plugin add` performs both steps. Restart DSH Web after installation.

## Configuration

### Two sections: live and startup

Preferences are split by whether a change needs a restart, and the two section names are the same in both sources:

- `live` — refresh interval, fleet token, peer list. A change takes effect immediately (the host watches this section).
- `startup` — the managed port band. `applies: 'restart'`: the host reads it once at construction, and the settings UI marks a not-yet-applied edit as pending.

Which source is actually read depends on the host version:

- **From DSH 0.1.7-rc.1** the settings service no longer exposes `register`, so both sections come from the profile entry's own `config`. Editing the entry config restarts this plugin, which is why `live` still applies immediately.
- **On earlier releases** the two sections are the namespaces the settings service registers: `dsh-instance-manager` (`live`) and `dsh-instance-manager-startup` (`startup`). `live` applies through its watch; the same names written into an entry config are not read at all.
- On a transitional host that offers both, the settings-service path is the one that takes over the reads. In other words: **configure a preference in the one place your host version actually reads** — a value written to the other one goes missing silently.

### Fields and value ranges

| Section | Field | Type | Default | Accepted values |
| --- | --- | --- | --- | --- |
| live | `refreshIntervalMs` | number | `4000` | `1000`–`60000` ms; out-of-range is clamped to the bound, a fraction is rounded to the nearest integer |
| live | `fleetToken` | string (secret) | none | any non-empty string; write-only in the UI, never carried by an API response or a log |
| live | `peers` | string | `''` (no peers) | comma-separated `id@origin`, at most 16 entries; id is 1–32 characters of `[A-Za-z0-9_-]`; `http(s)://` may be omitted; a URL with userinfo is rejected |
| startup | `portRange` | string | `'3080-3129'` | `min-max`, ports within `1`–`65535`, at most `1024` ports wide |

`portRange` bounds only **where a new instance may be started**; discovery is heartbeat-driven, so an instance launched by hand with `--port 4000` still shows up in the list. `peers` is directional: configure both sides when two machines should see each other, and remote rows stay read-only and out of a local stop-all.

The UI language follows the global DSH Settings → General language; the plugin no longer stores a separate language preference.

### Environment variables and override precedence

Every field has an environment variable of the same name, for a deployment without a settings service or as the default when the section leaves it out:

```powershell
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'            # live.refreshIntervalMs, decimal digits only
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'    # live.fleetToken
$env:DSHIM_PEERS = 'office@http://192.168.1.20:3080'  # live.peers, same format as the table
$env:DSHIM_PORT_RANGE = '3080-3129'                # startup.portRange
$env:DSHIM_FLEET_TOKEN_REF = 'DSHIM_FLEET_TOKEN'   # see below: the token's REFERENCE name, not the token
```

One field resolves in this order: **the source that is live on this host (see above) → the matching variable above → the built-in default**. The environment is the composition `base` layer: below a value the user stored, above the schema default. Only a **well-formed** environment value ever enters that layer — a mistyped `DSHIM_PORT_RANGE` does not fail the registration, it is dropped and the default band is used.

### How the fleet token is read

`DSHIM_FLEET_TOKEN_REF` does **not hold a token: it holds the name of the environment variable that holds the token**; unset, that name is `DSHIM_FLEET_TOKEN`. Each remote request tries these three in order and takes the first non-empty result:

1. the `fleetToken` of the `live` section (entry config or stored settings — `DSHIM_FLEET_TOKEN` is already its base layer);
2. the credentials service, for that name, when the host mounts one — which is what makes "keep only the variable name in the environment, let a provider own the value" work;
3. the plain process environment under that name.

Resolving per request means rotating the token needs no restart. When all three come up empty the whole remote surface fails closed and the local panel keeps working.

## Security

- This plugin's own local guard rejects cross-site origins, non-loopback hosts, and unsafe Fetch Metadata; a host that mounts Connection carries that layer instead.
- Mutating actions are POST-only (the method name is matched case-insensitively); ports must be decimal integers from 1 to 65535.
- The event stream and every JSON reply carry `cache-control: no-store`: those bodies name instance ports, pids and session summaries, and an intermediary that keeps one is a stale map of this machine. An unexpected failure answers a fixed `code` only — the exception text goes to the host log, never to the response.
- Whether a fleet bearer is required is decided by the **real TCP peer address (socket), not just the Host header**: an off-loopback peer OR an off-loopback Host triggers the bearer. A forged `Host: 127.0.0.1` cannot hide an off-loopback peer, and a missing peer address is rejected outright. Requests fail closed when the token is missing or unresolved.
- The fleet token has no action-level scopes. A holder can start or stop local instances and read session information, so grant it only to trusted devices.
- On DSH 0.1.0-rc.7+, browser APIs and event streams reuse the Connection signed cookie, so admission is decided by Connection's Host/Origin fence and cookie and this plugin's own guard no longer takes part; instance confirmation and forwarding use private strict-loopback probes.
- SSE remains local-only.
- Every accepted mutation leaves one provenance line in `<home>/launcher/logs/dshim-requests.log`: socket peer, admission path, the request's `Host`/`Origin`/`Referer`/`User-Agent`, target port and result. It pairs with `dshim-selfexit.log`, which records only the trigger — "this process was asked to leave" without "who asked". Cookies and Authorization are never read and never written.

## Development

Development is the three commands below (`npm test` runs the four embedded-block checks first). Deploying this working tree as a snapshot into a DSH profile running on one particular machine is a local convenience: the repository makes no promise about that script, and it is not part of installing the plugin. Before committing:

```sh
npm test
npm run docs:check
npm pack --dry-run
```

## License

[MIT](./LICENSE)
