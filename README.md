# dsh-instance-manager

[中文](./README.md) | [English](./README.en.md)

[![DSH](https://img.shields.io/static/v1?label=DSH&message=plugin&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-instance-manager?label=npm&color=4d6bfe)](https://www.npmjs.com/package/dsh-instance-manager)
[![release](https://img.shields.io/github/v/release/xswt442-cmd/dsh-instance-manager?label=release&color=16a3a3)](https://github.com/xswt442-cmd/dsh-instance-manager/releases)
[![DSH](https://img.shields.io/static/v1?label=DSH&message=%3E%3D0.1.2-rc.1&color=4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![node](https://img.shields.io/static/v1?label=node&message=%3E%3D20&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![downloads](https://img.shields.io/npm/d18m/dsh-instance-manager?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-instance-manager)
[![license](https://img.shields.io/badge/license-MIT-22c55e.svg)](./LICENSE)

DSH Web 的实例管理器。它在本机可见的每个 dsh web 实例上给出一行状态，并负责启动、打开和停止这些实例；配置了 peer 时，同一面板也能查询其他机器上的实例。入口是页面左下角的 Mini Utility Dock。

偏好（dock 位置、刷新间隔、Fleet token、peer 列表、托管端口段）有两个来源：DSH 0.1.7-rc.1 起由 **profile 条目自己的 config** 提供（`live` / `startup` 两个分节），更早的版本走设置服务注册的两个命名空间。两者同时存在时以**条目 config** 为准；都缺失时回落到环境变量与内置默认值，面板照常工作。

## 功能

- 每个实例一行：端口、PID、运行时长、会话数、常驻内存、版本，以及它当前是否为该面板所在实例。当前实例恒排第一行，其余按端口升序。
- 启动新实例：端口留空时在托管端口段（默认 3080–3129）内挑第一个空闲端口，填入端口则在指定端口启动。指定端口已被占用时明确报错，不会改到别的端口。
- 打开实例：点击某行的 `:端口` 跳转到该实例界面。DSH 要求实例根 URL 携带每进程的启动 token，因此该链接指向一个重定向端点，由宿主读出该实例当前 token 后 303 跳转；token 不进入面板状态或链接本身。实例不由本机 launcher 启动（读不到 token）时返回 `launch_token_unavailable`，提示改用 `dsh web` 打印的 URL。
- 停止实例：单个、当前或全部本地实例，都通过目标实例自身的优雅退出完成；远程行只读，不参与 stop-all。
- 每个实例的只读视图：stdout/stderr 日志、会话概要，以及该实例正在跑什么。
- 远程实例：配置 peer 后，可查看远程实例及其日志与会话；端口链接由该 peer 自身的面板完成同样的 token 换取。
- Agent 工具：`instance_list`、`instance_start`、`instance_stop`、`instance_logs`、`instance_sessions`。
- 网页启动会打开一次性 token URL 让新实例换取浏览器 cookie；Agent 工具启动保持后台无窗口。

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

界面语言跟随 DSH Settings → General 的全局语言，不再维护插件自己的语言偏好。

```powershell
$env:DSHIM_DOCK_PLACEMENT = 'main-bottom-left'
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'
$env:DSHIM_PORT_RANGE = '3080-3129'
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'
$env:DSHIM_PEERS = 'office@http://192.168.1.20:3080'
```

Peer 配置是单向的；需要双向可见时，两端分别配置对方。远程行只读，不参与本地 stop-all。

## 安全

- 本插件自带的本地守卫拒绝跨站 Origin、非 loopback Host 和不安全的 Fetch Metadata；宿主挂载了 Connection 时由它承担这一层。
- 写操作仅接受 POST；端口必须是 1–65535 的十进制整数。
- 是否需要 Fleet Bearer 由**真实 TCP 对端地址（socket）**判定，而非仅看 Host 头：对端非回环**或** Host 非回环，二者满足其一即要求 bearer。伪造 `Host: 127.0.0.1` 无法隐藏非回环对端；对端地址缺失时直接拒绝。缺少或无法解析 token 时拒绝。
- Fleet token 没有操作级权限划分。持有者可启动或停止本机实例并读取会话信息，应仅授予可信设备。
- 浏览器 API 与事件流在 DSH 0.1.0-rc.7+ 中复用 Connection 的签名 cookie，准入由 Connection 的 Host/Origin 校验与 cookie 判定，插件自带守卫此时不参与；内部实例确认与转发只走严格 loopback 探测动作。
- SSE 仅向本机开放。

## 开发

工作树用 `scripts/deploy-profile.ps1` 快照部署进运行中的 DSH profile，直接挂符号链接会出问题。提交前运行：

```sh
npm test
npm run docs:check
npm pack --dry-run
```

## License

[MIT](./LICENSE)
