# dsh-instance-manager

[中文](./README.md) | [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-instance-manager)](https://www.npmjs.com/package/dsh-instance-manager)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

从 DSH Web 中查看、启动和停止本机实例，也可连接受信任的远程实例。入口位于页面左下角的 Mini Utility Dock。

## 功能

- 列出实例的端口、PID、运行时长、会话数、内存和版本状态。
- 查看 stdout/stderr 日志、内存趋势和活跃会话概要。
- 启动新实例；优雅停止单个、当前或全部本地实例。
- 通过受认证的 peer 链路查看远程实例、日志和会话。
- 提供 `instance_list`、`instance_start`、`instance_stop`、`instance_logs` 和 `instance_sessions` Agent 工具。

## 安装

```powershell
# 从 npm 安装并注册到 web profile（推荐）
dsh plugin --profile web add dsh-instance-manager

# 仅安装 npm package
npm install dsh-instance-manager

# 或从 GitHub 安装
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

`npm install` 只安装 package；在 DSH 中启用仍需将 bundle 加入 profile。使用 `dsh plugin add` 可一次完成。重启 DSH Web 后生效。

## 配置

可在 DSH settings 中配置 Dock 位置、刷新间隔、Fleet token、peers 和启动端口段。对应的环境变量可作为默认值：

```powershell
$env:DSHIM_DOCK_PLACEMENT = 'main-bottom-left'
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'
$env:DSHIM_PORT_RANGE = '3080-3129'
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'
$env:DSHIM_PEERS = 'office@http://192.168.1.20:3080'
```

Peer 配置是单向的；需要双向可见时，两端分别配置对方。远程行只读，不参与本地 stop-all。

## 安全

- 本地 API 拒绝跨站 Origin、非 loopback Host 和不安全的 Fetch Metadata。
- 写操作仅接受 POST；端口必须是 1–65535 的十进制整数。
- 非 loopback 请求必须携带 Fleet Bearer token；缺少或无法解析时拒绝。
- Fleet token 没有操作级权限划分。持有者可启动或停止本机实例并读取会话信息，应仅授予可信设备。
- SSE 仅向本机开放。

## 开发

不要把工作树以符号链接挂入运行中的 DSH profile。使用快照部署：

```powershell
powershell -File scripts\deploy-profile.ps1
```

提交前运行：

```sh
npm test
npm run docs:check
npm pack --dry-run
```

## License

[MIT](./LICENSE)
