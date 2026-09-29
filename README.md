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

DSH Web 的实例管理器。它为本机可见的每个 dsh web 实例显示一行状态，并负责这些实例的启动、打开与停止。配置 peer 后，同一面板也可查询其他机器上的实例。

入口是工作区左下、侧边栏右侧的菜单图标。

## 功能

- 每个实例一行：端口、PID、运行时长、会话数、常驻内存与版本；当前实例排第一行，其余按端口升序。
- 启动新实例：端口留空时取起始端口段内第一个空闲端口；指定端口已被占用时报错，不改用其他端口。
- 打开实例：点击某行的 `:端口` 进入该实例界面；启动 token 由宿主即时换取，不进入面板状态与链接。
- 停止实例：单个、当前或全部本地实例；远程行只读，也不参与 stop-all。
- 每个实例的只读视图：stdout/stderr 日志、会话概要，以及该实例正在运行的内容。
- 远程实例：配置 peer 后可查看远程实例及其日志与会话。
- Agent 工具：`instance_list`、`instance_start`、`instance_stop`、`instance_logs`、`instance_sessions`。
- 面板启动会打开一次性 token URL 以换取浏览器 cookie，Agent 工具启动保持后台无窗口。

## 安装

```powershell
# 从 npm 安装并注册到 web profile（推荐）
dsh plugin --profile web add dsh-instance-manager

# 仅安装 npm package
npm install dsh-instance-manager

# 或从 GitHub 安装
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

- `npm install` 只安装 package；bundle 进入 profile 后 DSH 才启用本插件，`dsh plugin add` 一次完成这两步。
- 安装后重启 DSH Web 生效。

## 配置

### live 与 startup 两节

- `live`：刷新间隔、Fleet token、peer 列表；宿主 watch 该节，修改即时生效。
- `startup`：端口清单；该节 `applies: 'restart'`，宿主仅在构造时读取一次，未生效的修改在设置界面标为待生效。

读取的来源由宿主版本决定：

- DSH 0.1.7-rc.1 及之后：两节来自 profile 条目自身的 `config`，该版本的设置服务不再提供 `register`；改条目 config 会重启本插件，`live` 一节的改动仍立即生效。
- 更早的版本：两节来自设置服务注册的两个命名空间 `dsh-instance-manager`（`live`）与 `dsh-instance-manager-startup`（`startup`）；`live` 通过 watch 生效，写入条目 config 的同名字段不会被读取。
- 两个来源同时存在时由设置服务承担读取，配在另一处的值不生效，也不报错。

### 字段与取值范围

| 分节 | 字段 | 类型 | 默认 | 取值范围 |
| --- | --- | --- | --- | --- |
| live | `refreshIntervalMs` | number | `4000` | `1000`–`60000` 毫秒 |
| live | `fleetToken` | string（secret） | 无 | 任意非空字符串 |
| live | `peers` | string | `''`（无 peer） | `id@origin` 逗号分隔，最多 16 条 |
| startup | `portRange` | string | `'3080-3129,19387'` | 逗号分隔的范围与单端口，端口在 `1`–`65535`，各段合计最多 `1024` 个 |

- `refreshIntervalMs` 超出范围时取边界值，小数取整到最近整数。
- `fleetToken` 只写不读，不出现在任何 API 应答与日志中。
- `peers` 的 id 为 1–32 位 `[A-Za-z0-9_-]`，origin 可省略 `http://` 与 `https://`，带 userinfo 的 URL 被拒绝。
- `peers` 是单向配置，需要双向可见时在两端各配一份。
- `portRange` 的第一段限定新实例可启动的端口范围，其余各段只参与实例发现。
- 发现同时扫描心跳登记过的端口，`--port 4000` 手工启动的实例仍会出现在列表里。
- `portRange` 任一段不可用时，整份清单回落到内置默认值。
- 默认值包含桌面端宿主的默认端口 `19387`；桌面端宿主按注入的 boot manifest 识别，未安装本插件也在列表里，且不由本插件托管。

界面语言跟随 DSH Settings → General 的全局语言设置。本插件不单独存储语言偏好。

### 环境变量与覆盖优先级

每个字段都有同名环境变量：没有设置服务的部署用它们配置，偏好项未填写时它们充当该字段的默认值。

```powershell
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'                # live.refreshIntervalMs，仅接受十进制整数
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'        # live.fleetToken
$env:DSHIM_PEERS = 'office@http://192.168.1.20:3080'   # live.peers，格式同上表
$env:DSHIM_PORT_RANGE = '3080-3129,19387'              # startup.portRange
$env:DSHIM_FLEET_TOKEN_REF = 'DSHIM_FLEET_TOKEN'       # 存放 token 的环境变量名，见下节
```

单个字段的取值顺序：

1. 当前宿主版本实际读取的来源（见上）。
2. 同名字段的环境变量。
3. 内置默认值。

- 环境变量属于 composition 的 `base` 层，位于用户已存的值之下、schema 默认值之上。
- 只有格式正确的值进入该层；格式错误的 `DSHIM_PORT_RANGE` 不会导致注册失败，该字段用内置默认值。

### Fleet token 的解析顺序

`DSHIM_FLEET_TOKEN_REF` 的值是存放 token 的环境变量名。未设置该变量时，名称取 `DSHIM_FLEET_TOKEN`。每个远程请求按以下顺序取第一个非空值：

1. `live` 节的 `fleetToken`（条目 config 或已存设置），`DSHIM_FLEET_TOKEN` 作为 `base` 层参与该字段。
2. 宿主提供凭据服务时，按上述名称向凭据服务解析。
3. 以该名称直接读取进程环境变量。

- token 按请求解析，更换后无需重启实例。
- 三项均为空时远程功能整体关闭，本地面板不受影响。

## 安全

- 插件自带的本地守卫拒绝跨站 Origin、非回环 Host 与不安全的 Fetch Metadata；宿主挂载了 Connection 时，这一层由它承担。
- 是否需要 Fleet Bearer 由真实 TCP 对端地址与 `Host` 头共同判定，两者任一非回环即要求 bearer。
- 远程路由在守卫之前先按 bearer 判定，本地请求不需要 token。
- 对端地址缺失时直接拒绝；token 缺失或无法解析时拒绝远程请求。
- 写操作仅接受 POST，方法名按大小写不敏感匹配。
- 端口参数必须是 1–65535 的十进制整数。
- 事件流与所有 JSON 应答携带 `cache-control: no-store`。
- 意外失败的 500 仅返回固定 `code`，异常原文只写入宿主日志。
- Fleet token 没有操作级权限划分，持有者可启动或停止本机实例并读取会话信息，应仅授予可信设备。
- DSH 0.1.0-rc.7 及之后，浏览器 API 与事件流复用 Connection 的签名 cookie，准入由 Connection 的 Host/Origin 校验与 cookie 判定，插件自带守卫不参与。
- 内部实例确认与转发只走严格 loopback 探测，SSE 仅向本机开放。
- 每个被接受的写操作在 `<home>/launcher/logs/dshim-requests.log` 记录一行：对端地址、准入路径、请求携带的 `Host`/`Origin`/`Referer`/`User-Agent`、目标端口与结果。
- `dshim-selfexit.log` 只记录触发者；Cookie 与 Authorization 既不读取也不写入。

## 开发

提交前运行：

```sh
npm test
npm run docs:check
npm pack --dry-run
```

## License

[MIT](./LICENSE)
