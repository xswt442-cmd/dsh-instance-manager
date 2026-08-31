# dsh-instance-manager

[中文](./README.md) | [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-instance-manager)](https://www.npmjs.com/package/dsh-instance-manager)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

DSH Web 实例管理插件，以共享工具坞中的 `DSH Instance` 为入口。列出本机端口段内的全部 dsh web 实例，支持详情查看、停止、启动新实例；配置配对后可查看远程实例。DIM 与 TreeKeeper 通过页面内版本化协议复用同一个 Dock，不需要额外前置插件。

## 功能

- **实例列表**：端口 / PID / 运行时长 / 会话数 / 内存；4s 自动刷新（后台标签页暂停）；插件版本不一致标「版本差异」
- **实例详情**：抽屉查看启动时间、内存走势、stdout/stderr 日志（200 行）、活跃会话概要
- **启停控制**：启动新实例（等待自报就绪，返回 pid）；优雅停止任意实例（`appExit`，会话落盘）；停止当前实例与全部结束需二次确认
- **跨机舰队（≥0.9）**：配置 peer 后，面板合并远程实例列表，抽屉可查远程会话与日志
- **Agent 工具**：`instance_list` / `instance_start` / `instance_stop` / `instance_logs` / `instance_sessions`
- **上下线提醒**：实例与 peer 状态变化经 SSE 即时 toast
- **中英切换**：偏好存 localStorage

## 安装

```powershell
dsh plugin --profile web add dsh-instance-manager
# 或 Git 直装
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

安装后重启 DSH Web 生效。

## 工作原理

主机端注册 `/dsh-instance-manager/api`（0.9 起移除 pre-rename 别名 `/dsh-easy-port-manager/api`）：

| 动作 | 方法 | 说明 |
|---|---|---|
| `list` | GET | 心跳注册表优先（10s 写 / 30s 有效）并复核，未覆盖端口走探测；配置 peer 时合并远程舰队 |
| `self` | GET | `{ pid, port, startedAt, sessions, rss, version, fleetId }` |
| `logs&port=&stream=` | GET | 尾读共享 launcher 日志（≤64KB / 200 行）；`peer=` 经舰队链路读取 |
| `sessions&port=` | GET | 目标实例活跃会话概要（标量字段，最近 20 条）；`peer=` 经舰队链路读取 |
| `start` | POST | 空闲端口拉起新实例（detached），等自报就绪返回 `{ ok, port, pid }`；端口竞态换口重试一次 |
| `stop&port=` | POST | 本机 → `appExit`；其他 → 转发 `stop-self` |
| `stop-all` | POST | 并行转发停止全部托管实例（不含远程行），最后自身退出 |
| `stop-self` | POST | 自身优雅退出（GET 一律 405） |
| `GET /events` | GET | SSE：实例上/下线与 peer 状态推送 |
| `WS /link` | WS | 舰队链路：Bearer 认证（fail-closed），query：`ping` / `fleet` / `sessions` / `logs` |

## 端口段

- 默认扫描/启动 3080–3129，`DSHIM_PORT_RANGE="4000-4010"` 可覆盖
- 发现基于心跳注册表（端口校验 1–65535），不依赖端口段；段外实例同样可列出与操作
- 所有 `port=` 参数（`logs` / `sessions` / `stop`）走同一条 `normalizePort` 校验：只接受 1–65535 的十进制整数。`1e3`、`0x10`、`+80`、`80.5`、`-1` 一律 400 `no_port` —— 端口会被拼进 launcher 日志文件名，宁可拒也不猜

## 舰队配对（≥0.9）

```powershell
setx DSHIM_FLEET_TOKEN "足够长的随机串"        # 双方一致
setx DSHIM_PEERS "office@http://192.168.1.20:3080"
```

- 重启后面板合并 peer 实例（`@id` 徽章），抽屉可查远程会话与日志；`instance_sessions` / `instance_logs` 支持 `peer=`
- `action=list` 的 `peers` 字段报告 `online` / `unreachable` / `timeout`
- 配对是单向配置的，两台机器互相可见就是各自把对方写进 `DSHIM_PEERS` —— 这是受支持的形态（`fleet` 查询只用本地行作答，不会再回头问 peer）
- 无 token 时链路一律 403（fail-closed）

## 安全模型

API 仅面向本机面板，所有动作经统一守卫：

- 变更类动作仅接受 POST（含 `stop-self`）
- Fetch Metadata：`sec-fetch-site` 非 same-origin / none → 403
- `Origin` 非本实例回环同源 → 403；`Host` 非回环名 → 403（同时封 DNS rebinding）
- 非回环请求需 `Authorization: Bearer <token>`（constant-time 比较；未配置即拒绝）
- **token 无动作分级**：持 token 的 peer 可调用本机全部动作（`start` 拉起进程、`stop` / `stop-all` 结束本机实例、`sessions` 读会话工作目录），应视为本机的可信操作方，而非只读观察者。想只读就配置 peer，直接打开对方面板页面
- SSE `/events` 不向远程开放（EventSource 无法携带自定义请求头）
- 已在本地运行的恶意进程可直接结束任意进程，不在威胁模型内

## 开发与部署

- 运行中的实例**不要**以符号链接挂载本仓库：文件变动触发 HMR 热重载，多文件编辑的中间态可能拖垮实例
- 部署快照（软链 → 真实目录副本）：`powershell -File scripts\deploy-profile.ps1`，然后重启实例

## 结构

```
package.json       npm 元数据 + dsh.bundle.patch + dsh.client 声明
cordis.patch.yml   向 profile 插入 loader 行
lib/index.js       host：API / SSE / 舰队链路注册
lib/fleet.js       host：peer 链路（拨号 / 重连 / query 帧）
lib/agent-tools.js host：instance_* 模型工具
lib/client.js      client：工具坞入口 + 面板
lib/shared.js      host 纯函数（守卫 / 注册表 / 会话概要）
scripts/           部署等开发脚本
test/              node:test 单元测试（npm test）
```

## License

[MIT](./LICENSE)
