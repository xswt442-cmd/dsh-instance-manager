# dsh-instance-manager

[中文](./README.md) | [English](./README.en.md)

[![DSH](https://img.shields.io/static/v1?label=DSH&message=plugin&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-instance-manager?label=npm&color=4d6bfe)](https://www.npmjs.com/package/dsh-instance-manager)
[![release](https://img.shields.io/github/v/release/xswt442-cmd/dsh-instance-manager?label=release&color=16a3a3)](https://github.com/xswt442-cmd/dsh-instance-manager/releases)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=%3E%3D0.1.2-rc.1&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![node](https://img.shields.io/static/v1?label=node&message=%3E%3D20&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![downloads](https://img.shields.io/npm/d18m/dsh-instance-manager?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-instance-manager)
[![license](https://img.shields.io/badge/license-MIT-22c55e.svg)](./LICENSE)

Instance manager for DSH Web. It shows one status row per local dsh web instance the machine can see, and owns starting, opening, and stopping them; with a peer configured, the same panel also queries instances on other machines. Open it from the Mini Utility Dock at the bottom-left of the page.

Preferences (dock placement, refresh interval, fleet token, peer list, managed port range) have two sources: from DSH 0.1.7-rc.1 they come from **the profile entry's own config** (`live` and `startup` sections); on earlier releases they come from the two namespaces the settings service registers. When both are present the **entry config** wins; when neither is, values fall back to environment variables and built-in defaults, and the panel keeps working.

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

DSH settings control Dock placement, refresh interval, fleet token, peers, and the launch port band. Environment variables provide defaults:

The UI language follows the global DSH Settings → General language; the plugin no longer stores a separate language preference.

```powershell
$env:DSHIM_DOCK_PLACEMENT = 'main-bottom-left'
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'
$env:DSHIM_PORT_RANGE = '3080-3129'
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'
$env:DSHIM_PEERS = 'office@http://192.168.1.20:3080'
```

Peer configuration is directional; configure each side when both machines should see each other. Remote rows are read-only and excluded from local stop-all.

## Security

- This plugin's own local guard rejects cross-site origins, non-loopback hosts, and unsafe Fetch Metadata; a host that mounts Connection carries that layer instead.
- Mutating actions are POST-only; ports must be decimal integers from 1 to 65535.
- Whether a fleet bearer is required is decided by the **real TCP peer address (socket), not just the Host header**: an off-loopback peer OR an off-loopback Host triggers the bearer. A forged `Host: 127.0.0.1` cannot hide an off-loopback peer, and a missing peer address is rejected outright. Requests fail closed when the token is missing or unresolved.
- The fleet token has no action-level scopes. A holder can start or stop local instances and read session information, so grant it only to trusted devices.
- On DSH 0.1.0-rc.7+, browser APIs and event streams reuse the Connection signed cookie, so admission is decided by Connection's Host/Origin fence and cookie and this plugin's own guard no longer takes part; instance confirmation and forwarding use private strict-loopback probes.
- SSE remains local-only.

## Development

The working tree is deployed into a running DSH profile as a snapshot by `scripts/deploy-profile.ps1`; symlinking it does not work. Before committing:

```sh
npm test
npm run docs:check
npm pack --dry-run
```

## License

[MIT](./LICENSE)
