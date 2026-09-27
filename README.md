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

DSH Web 的实例管理器。它在本机可见的每个 dsh web 实例上给出一行状态，并负责启动、打开和停止这些实例；配置了 peer 时，同一面板也能查询其他机器上的实例。入口是页面左下、侧边栏右侧的一个菜单图标，菜单容器与三行都由 `dsh-mini-utility-dock` 的 `dsh-utility-launcher` 片段提供。

偏好（刷新间隔、Fleet token、peer 列表、托管端口段）按需不需要重启分成 `live` / `startup` 两节，而这两节由哪一路来源提供取决于宿主版本：DSH 0.1.7-rc.1 起走 profile 条目自己的 config，更早的版本走设置服务注册的两个命名空间（配置章逐条说明）。两路都没有值时回落到环境变量与内置默认值，面板照常工作。

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

### 两个分节：live 与 startup

偏好按**是否需要重启**分成两节，两节的名字在两种来源里是一致的：

- `live` —— 刷新间隔、Fleet token、peer 列表。改了立刻生效（宿主会 watch 这一节）。
- `startup` —— 托管端口段。`applies: 'restart'`：宿主只在构造时读一次，设置界面会把待生效的改动标成「待生效」。

哪一路来源在实际读取，取决于宿主版本：

- **DSH 0.1.7-rc.1 起**：设置服务已经没有 `register`，两节都来自 profile 条目自己的 `config`。改条目 config 会重启本插件，所以 `live` 一节照样即时生效。
- **更早的版本**：两节来自设置服务注册的两个命名空间——`dsh-instance-manager`（`live`）与 `dsh-instance-manager-startup`（`startup`），`live` 一节的改动由 watch 热生效，写在条目 config 里的同名值不会被读到。
- 两条来源同时可用的过渡版本上，接管读取的仍是设置服务那一路。也就是说：**一份偏好只配在你所在版本实际读取的那一处**，配错地方的值是静默失效的。

### 字段与取值范围

| 分节 | 字段 | 类型 | 默认 | 取值范围 |
| --- | --- | --- | --- | --- |
| live | `refreshIntervalMs` | number | `4000` | `1000`–`60000` 毫秒；超出会被夹到边界，小数取整到最近整数 |
| live | `fleetToken` | string（secret） | 无 | 任意非空字符串；UI 与响应里只写不读，任何 API 应答与日志都不带它 |
| live | `peers` | string | `''`（无 peer） | `id@origin` 逗号分隔，最多 16 条；id 为 1–32 位 `[A-Za-z0-9_-]`；origin 可省 `http(s)://`；带 userinfo 的 URL 被拒绝 |
| startup | `portRange` | string | `'3080-3129'` | `min-max`，端口在 `1`–`65535`，跨度最多 `1024` 个端口 |

`portRange` 只限定 **启动新实例可以落在哪些端口**；发现是心跳驱动的，`--port 4000` 手工启动的实例照样会出现在列表里。`peers` 是单向的：需要双向可见时两端各配一份，远程行始终只读、不参与本地 stop-all。

界面语言跟随 DSH Settings → General 的全局语言，不再维护插件自己的语言偏好。

### 环境变量与覆盖优先级

每个字段都有一个同名环境变量，写给没有设置服务的部署，或作为设置未填时的默认值：

```powershell
$env:DSHIM_REFRESH_INTERVAL_MS = '4000'            # live.refreshIntervalMs，仅接受十进制整数
$env:DSHIM_FLEET_TOKEN = '<long-random-secret>'    # live.fleetToken
$env:DSHIM_PEERS = 'office@http://192.168.1.20:3080'  # live.peers，格式同上表
$env:DSHIM_PORT_RANGE = '3080-3129'                # startup.portRange
$env:DSHIM_FLEET_TOKEN_REF = 'DSHIM_FLEET_TOKEN'   # 见下：token 的「引用名」，不是 token 本身
```

同一个字段的取值顺序是：**已生效的那个来源（见上）→ 上表的同名环境变量 → 内置默认值**。环境变量走的是 composition 的 `base` 层，它在用户存的值之下、在 schema 默认值之上；而且只有**格式正确**的 env 值才会进入这一层——一个写错的 `DSHIM_PORT_RANGE` 不会让注册失败，会被直接忽略并按默认段启动。

### Fleet token 怎么被读到

`DSHIM_FLEET_TOKEN_REF` 里放的**不是 token，而是「装着 token 的那个环境变量的名字」**；未设置时这个名字就是 `DSHIM_FLEET_TOKEN`。每次远程请求按下面三条依次尝试，取到第一个非空值为止：

1. `live` 分节里的 `fleetToken`（条目 config 或已存设置；`DSHIM_FLEET_TOKEN` 已经是它的 base 层）；
2. 宿主挂了凭据服务时，按上面那个名字去凭据服务解析——这才让「环境变量里只留变量名、真值由 provider 供给」成立；
3. 直接读那个名字的进程环境变量。

逐请求解析意味着换 token 不需要重启实例。三条都拿不到值时远程面整体关闭（fail closed），本地面板照常工作。

## 安全

- 本插件自带的本地守卫拒绝跨站 Origin、非 loopback Host 和不安全的 Fetch Metadata；宿主挂载了 Connection 时由它承担这一层。
- 写操作仅接受 POST（方法名按大小写不敏感匹配）；端口必须是 1–65535 的十进制整数。
- 事件流与每个 JSON 应答都带 `cache-control: no-store`：这些响应体写着实例端口、PID 与会话摘要，被中间缓存留住就是一份过期的本机拓扑。意外失败的 500 只回一个固定 `code`，异常原文只进宿主日志。
- 是否需要 Fleet Bearer 由**真实 TCP 对端地址（socket）**判定，而非仅看 Host 头：对端非回环**或** Host 非回环，二者满足其一即要求 bearer。伪造 `Host: 127.0.0.1` 无法隐藏非回环对端；对端地址缺失时直接拒绝。缺少或无法解析 token 时拒绝。
- Fleet token 没有操作级权限划分。持有者可启动或停止本机实例并读取会话信息，应仅授予可信设备。
- 浏览器 API 与事件流在 DSH 0.1.0-rc.7+ 中复用 Connection 的签名 cookie，准入由 Connection 的 Host/Origin 校验与 cookie 判定，插件自带守卫此时不参与；内部实例确认与转发只走严格 loopback 探测动作。
- SSE 仅向本机开放。
- 每个被接受的写操作都在 `<home>/launcher/logs/dshim-requests.log` 留下一行来源记录：对端地址、准入路径、请求自带的 `Host`/`Origin`/`Referer`/`User-Agent`、目标端口与结果。它与只记触发者的 `dshim-selfexit.log` 配对——「这个进程被要求走了」和「谁要求的」是两件事。Cookie 与 Authorization 不读取、不落盘。

## 开发

开发验证就是下面三条命令（`npm test` 会先把四个嵌入块的一致性检查跑完）。把工作树快照部署进某台机器上正在运行的 DSH profile 属于本机的一次性做法，仓库不对那个脚本的行为作承诺，它也不是安装步骤的一部分。提交前运行：

```sh
npm test
npm run docs:check
npm pack --dry-run
```

## License

[MIT](./LICENSE)
