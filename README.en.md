# dsh-instance-manager

[中文](./README.md) | [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-instance-manager)](https://www.npmjs.com/package/dsh-instance-manager)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

View, start, and stop local DSH Web instances, with optional access to trusted remote instances. Open it from the Mini Utility Dock at the bottom-left of the page.

## Features

- List instance ports, PIDs, uptime, sessions, memory, and version status.
- Inspect stdout/stderr logs, memory trends, and active-session summaries.
- Start new instances and gracefully stop one, the current instance, or all local instances.
- View remote instances, logs, and sessions through authenticated peer links.
- Expose the `instance_list`, `instance_start`, `instance_stop`, `instance_logs`, and `instance_sessions` agent tools.

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

```powershell
$env:DSHIM_DOCK_PLACEMENT = 'main-bottom-left'
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'
$env:DSHIM_PORT_RANGE = '3080-3129'
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'
$env:DSHIM_PEERS = 'office@http://192.168.1.20:3080'
```

Peer configuration is directional; configure each side when both machines should see each other. Remote rows are read-only and excluded from local stop-all.

## Security

- The local API rejects cross-site origins, non-loopback hosts, and unsafe Fetch Metadata.
- Mutating actions are POST-only; ports must be decimal integers from 1 to 65535.
- Whether a fleet bearer is required is decided by the **real TCP peer address (socket), not just the Host header**: an off-loopback peer OR an off-loopback Host triggers the bearer. A forged `Host: 127.0.0.1` cannot hide an off-loopback peer, and a missing peer address is rejected outright. Requests fail closed when the token is missing or unresolved.
- The fleet token has no action-level scopes. A holder can start or stop local instances and read session information, so grant it only to trusted devices.
- SSE remains local-only.

## Development

Do not symlink the working tree into a running DSH profile. Deploy a snapshot instead:

```powershell
powershell -File scripts\deploy-profile.ps1
```

Before committing:

```sh
npm test
npm run docs:check
npm pack --dry-run
```

## License

[MIT](./LICENSE)
