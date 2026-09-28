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

DSH Web 的实例管理器。它为本机可见的每个 dsh web 实例显示一行状态，并负责这些实例的启动、打开与停止；配置 peer 后，同一面板也可查询其他机器上的实例。入口是工作区左下、侧边栏右侧的菜单图标，菜单容器与菜单行由 `dsh-mini-utility-dock` 的 `dsh-utility-launcher` 片段提供。

偏好项（刷新间隔、Fleet token、peer 列表、托管端口段）按是否需要重启分为 `live` 与 `startup` 两节。实际读取的来源取决于宿主版本：DSH 0.1.7-rc.1 及之后读取 profile 条目自身的 `config`，更早版本读取设置服务注册的两个命名空间（见配置章）。两路来源都未提供值时使用环境变量与内置默认值，面板功能不受影响。

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

### live 与 startup 两节

两节按是否需要重启划分，名称在两种来源中一致：

- `live` —— 刷新间隔、Fleet token、peer 列表。宿主 watch 该节，修改即时生效。
- `startup` —— 托管端口段。`applies: 'restart'`，宿主仅在构造时读取一次；设置界面把尚未生效的修改标记为「待生效」。

实际读取的来源取决于宿主版本：

- **DSH 0.1.7-rc.1 及之后**：设置服务不再提供 `register`，两节均来自 profile 条目自身的 `config`。修改条目 config 会重启本插件，`live` 一节的改动因此同样立即生效。
- **更早的版本**：两节来自设置服务注册的两个命名空间 `dsh-instance-manager`（`live`）与 `dsh-instance-manager-startup`（`startup`）。`live` 一节通过 watch 生效；写入条目 config 的同名字段不会被读取。
- 两种来源同时存在的过渡版本由设置服务接管读取。偏好项应配置在当前宿主版本实际读取的位置；配置在另一处的值不生效，也不报错。

### 字段与取值范围

| 分节 | 字段 | 类型 | 默认 | 取值范围 |
| --- | --- | --- | --- | --- |
| live | `refreshIntervalMs` | number | `4000` | `1000`–`60000` 毫秒；超出会被夹到边界，小数取整到最近整数 |
| live | `fleetToken` | string（secret） | 无 | 任意非空字符串；UI 与响应里只写不读，任何 API 应答与日志都不带它 |
| live | `peers` | string | `''`（无 peer） | `id@origin` 逗号分隔，最多 16 条；id 为 1–32 位 `[A-Za-z0-9_-]`；origin 可省 `http(s)://`；带 userinfo 的 URL 被拒绝 |
| startup | `portRange` | string | `'3080-3129'` | `min-max`，端口在 `1`–`65535`，跨度最多 `1024` 个端口 |

`portRange` 仅约束新实例可使用的端口范围；实例发现由心跳驱动，以 `--port 4000` 手工启动的实例仍会出现在列表中。`peers` 为单向配置：需要双向可见时在两端各配置一份。远程行只读，不参与本地 stop-all。

界面语言跟随 DSH Settings → General 的全局语言设置，本插件不单独存储语言偏好。

### 环境变量与覆盖优先级

每个字段都有同名环境变量，用于没有设置服务的部署，或作为偏好项未填写时的默认值：

```powershell
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'            # live.refreshIntervalMs，仅接受十进制整数
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'    # live.fleetToken
$env:DSHIM_PEERS = 'office@http://192.168.1.20:3080'  # live.peers，格式同上表
$env:DSHIM_PORT_RANGE = '3080-3129'                # startup.portRange
$env:DSHIM_FLEET_TOKEN_REF = 'DSHIM_FLEET_TOKEN'   # 见下：token 的「引用名」，不是 token 本身
```

单个字段的取值顺序为：当前生效的来源（见上）→ 同名环境变量 → 内置默认值。环境变量属于 composition 的 `base` 层，位于用户已存的值之下、schema 默认值之上。仅格式正确的环境变量值参与该层：格式错误的 `DSHIM_PORT_RANGE` 不会导致注册失败，该值被忽略并使用默认端口段。

### Fleet token 的解析顺序

`DSHIM_FLEET_TOKEN_REF` 的值是存放 token 的环境变量名，而不是 token 本身；未设置时该名称为 `DSHIM_FLEET_TOKEN`。每个远程请求按以下顺序取第一个非空值：

1. `live` 节的 `fleetToken`（条目 config 或已存设置；`DSHIM_FLEET_TOKEN` 已作为其 base 层参与）；
2. 宿主提供凭据服务时，按上述名称向凭据服务解析；环境中只保留变量名、实际值由 provider 提供即依赖这一路径；
3. 以该名称直接读取进程环境变量。

按请求解析，因此更换 token 无需重启实例。三项均为空时远程功能整体关闭（fail closed），本地面板不受影响。

## 安全

- 本插件自带的本地守卫拒绝跨站 Origin、非 loopback Host 和不安全的 Fetch Metadata；宿主挂载了 Connection 时由它承担这一层。
- 写操作仅接受 POST（方法名按大小写不敏感匹配）；端口必须是 1–65535 的十进制整数。
- 事件流与所有 JSON 应答携带 `cache-control: no-store`：响应体包含实例端口、PID 与会话摘要，不应由中间缓存保存。意外失败的 500 仅返回固定 `code`，异常原文只写入宿主日志。
- 是否需要 Fleet Bearer 由真实 TCP 对端地址（socket）与 `Host` 头共同判定：对端非回环**或** Host 非回环，任一成立即要求 bearer。伪造 `Host: 127.0.0.1` 不能隐藏非回环对端；对端地址缺失时直接拒绝。token 缺失或无法解析时拒绝。
- Fleet token 没有操作级权限划分。持有者可启动或停止本机实例并读取会话信息，应仅授予可信设备。
- 浏览器 API 与事件流在 DSH 0.1.0-rc.7+ 中复用 Connection 的签名 cookie，准入由 Connection 的 Host/Origin 校验与 cookie 判定，插件自带守卫此时不参与；内部实例确认与转发只走严格 loopback 探测动作。
- SSE 仅向本机开放。
- 每个被接受的写操作在 `<home>/launcher/logs/dshim-requests.log` 记录一行来源信息：对端地址、准入路径、请求携带的 `Host`/`Origin`/`Referer`/`User-Agent`、目标端口与结果。`dshim-selfexit.log` 只记录触发者，两个文件分别对应请求的执行与来源。Cookie 与 Authorization 不读取、不写入。

## 开发

开发验证为下列三条命令（`npm test` 会先执行四个嵌入块的一致性检查）。`scripts/` 下的部署脚本面向单机的本地快照部署，不属于安装步骤，仓库不对其行为作出承诺。提交前运行：

```sh
npm test
npm run docs:check
npm pack --dry-run
```

## License

[MIT](./LICENSE)
