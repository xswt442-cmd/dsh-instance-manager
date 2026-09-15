# 更新日志

Release Notes 由对应版本段生成；最新版本在前。
英文版见 [CHANGELOG.en.md](CHANGELOG.en.md)。

## 0.9.7 - 2026-09-16

### 变更

- CI 去掉跨仓的 `guard-parity` job。共享片段改由本仓 `npm test` 的 `loopback:check` / `guard:check` 对照所 pin 的 dock 版本校验——dock 版本发布后不可变、消费仓 pin 的又是精确版本，「三仓 pin 同一版本」已经蕴含「三仓的块逐字节相同」，跨仓比对属重复校验。
- `scripts/guard-parity.mjs` 转为人工诊断工具（不再是 CI 门禁）：现在直接断言三仓 pin 一致，并断言三仓在每一道判定上结论相同。`AGENTS.md` 记明它只在三个检出处于同一分支时成立——peer 检出会解析到默认分支，因此它会误报，不适合当门禁。
- LICENSE 的版权署名统一为 `xswt442-cmd`。

## 0.9.6 - 2026-09-14

### 安全

- 同源请求守卫改由 `dsh-mini-utility-dock` 的共享片段提供。此前三仓各自维护一份 `createGuard`，已漂移三次：三家都拒绝 IPv6 回环 `::1`；三家对 Host 拼写各执一词；未加方括号的 IPv6 Host（如 `::1:3080`，RFC 7230 禁止）曾静默跳过 Host 白名单。现由单一实现判定；本插件保留全部既有错误码与文案，`createGuard` 的调用方式与 fleet 模式语义均未改变。
- 本插件此前在 loopback 白名单中列出 `::ffff:127.0.0.1`，但该字符串在 Origin 路径上无法命中：WHATWG URL 解析器会把 `[::ffff:127.0.0.1]` 规范化为 `[::ffff:7f00:1]`。该条目已由共享判定取代，两种拼写在 Host 与 Origin 两条路径上均视为回环。
- Host 头存在但解析不出主机名时按非回环处理。此前该情形会跳过白名单校验。

### 变更

- 新增 `loopback:sync` / `loopback:check` 与 `guard:sync` / `guard:check` 脚本，用于同步并校验 `lib/shared.js` 中的两个生成片段；`npm test` 会校验其未漂移。
- 依赖 `dsh-mini-utility-dock` 0.1.3，即首个包含上述片段的已发布版本。

## 0.9.5 - 2026-09-04

### 变更

- 适配 DSH 0.1.2-rc.1 的 Connection 鉴权：浏览器 API 与 SSE 使用签名 cookie，内部实例探测保留严格 loopback 通道；Connection 拒绝或卸载时不再降级放行。
- 网页面板启动的新实例会打开 DSH 的一次性 token URL 完成 cookie 交接；Agent 工具启动仍使用 `--no-open`，并统一采用显式 `--profile web` 参数。
- 面板语言跟随 DSH 全局 locale，移除独立的 `dshim-lang` localStorage 偏好与语言按钮；旧 DSH 仍按浏览器语言降级。
- 兼容检查显式覆盖 `0.1.2-rc.1` 与 latest。

### 修复

- 请求守卫改用 TCP 对端地址判定本地性。对于旧版或自定义的远程监听，此前远端来源伪造 `Host: 127.0.0.1` 即可通过守卫并绕过 fleet bearer，执行 start / stop / stop-all / stop-self。
- 对端地址缺失或为空白时按未知来源拒绝，不再视为本地请求。
- 服务运行在 HTTP 默认端口 80 时，省略端口的同源 Origin（如 `http://127.0.0.1`）不再被误判为跨源。

## 0.9.4 - 2026-09-02

### 变更

- Mini Utility Dock 改由 `dsh-mini-utility-dock` 在构建时同步，插件发布物仍可独立运行。
- Dock 统一过滤外部 SVG 图标，并为无效图标显示文本回退。

## 0.9.3 - 2026-09-01

### 新增

- 配置迁移至 settings，区分即时生效与重启生效的选项，并保留 env 作为默认层。
- Fleet token 作为 secret 存储；无效配置自动回退到 schema 默认值。

### 修复

- 修复缺少 token 时远程请求返回 500；现在按预期返回 403。

## 0.9.2 - 2026-08-31

### 变更

- `DSH Instance` 与 TreeKeeper 接入带版本的 Mini Utility Dock 协议。
- Dock 注册支持 HMR 所有权保护；打开一个面板会关闭同级面板。

### 修复

- 中英文面板标题统一为 `DSH Instance`。

## 0.9.1 - 2026-08-31

### 修复

- 阻止 peer 之间递归查询导致的舰队请求循环。
- 启动子进程失败不再终止宿主，统一返回 `start_failed`。
- stop、logs 与 sessions 使用一致的严格端口校验。
- 拒绝未知 peer，并修复远程日志路径穿越。
- 修复本地日志、session 摘要及远程 session 端口查询。
- 修复舰队误报下线、同端口 peer 状态冲突和日志失败态。

### 变更

- 无效端口统一返回 400；GET stop 仍返回 405。
- stop 存活复查仅考虑本地实例。

## 0.9.0 - 2026-08-27

### 新增

- 增加带 Bearer 鉴权、重连和心跳的 WebSocket peer 链路。
- 实例列表可合并远程舰队；远程行保持只读。
- 支持通过 peer 链路读取远程 session 摘要与日志。
- 面板入口迁移至可定位、可持久化的 Mini Utility Dock。

### 安全

- 配置的 peer 视为可信操作方；Fleet token 是无操作级隔离的对称密钥。

### 修复

- 正确注册 WebSocket upgrade 路由并在卸载时释放 peer hub。
- 崩溃记录不再抢占 Harness 的 fatal-exit 流程。
- Agent tools 与面板入口可等待后挂载的可选服务。
- `DSH_HOME` 按 Harness 优先级解析，并支持尚未创建的目录。

### 变更

- `stop-self` 改为仅接受 POST。

### 移除

- **破坏性变更：**移除 `/dsh-easy-port-manager/api` 及 ≤0.4.1 兼容路径；0.5.0 及以上不受影响。

## 0.8.0 - 2026-08-27

### 新增

- 非 loopback 请求要求 Bearer token；无法解析 token 时 fail-closed。
- `DSHIM_PORT_RANGE="min-max"` 可覆盖默认端口段。
- 增加 `scripts/deploy-profile.ps1`，以目录快照部署开发版本。

### 变更

- 精简实例行、footer 与 stop-all 的显示条件。
- 启动子进程启用严格 rejection、退出追踪和异常报告。

### 修复

- 修正无效的 Node 异常报告参数，避免子进程立即退出。

## 0.7.1 - 2026-08-26

### 新增

- 增加 fatal error 崩溃日志，记录 pid、port 与堆栈。
- 启动确认窗口延长至 25 秒，并记录窗口内退出的 exit code。

### 修复

- SSE 断开不再终止宿主进程。
- 首个兄弟实例启动不再被首次回填误判为失败。

## 0.7.0 - 2026-08-25

### 新增

- 增加 `instance_list`、`instance_start`、`instance_stop` 与 `instance_logs` Agent 工具。
- 增加跨实例 session 摘要及 `instance_sessions`。
- 增加实例上下线 SSE 通知。

### 修复

- stop 拒绝非整数端口。

## 0.6.2 - 2026-08-25

### 新增

- 启动时间按浏览者时区显示。

### 修复

- 停止当前实例或全部实例时进入告别状态并停止轮询。

## 0.6.1 - 2026-08-25

### 新增

- 增加版本偏移提示、中英界面和机器可读错误码。
- 增加实例详情、内存趋势和 stdout/stderr 日志尾部。
- 增加文件心跳注册表与校验后清扫机制。

### 变更

- 改进跨平台启动路径、并发探测、转发超时、CI boot-check 与版本校验。

## 0.6.0 - 2026-08-24

### 新增

- 实例上报并显示内存使用。
- 使用 `window.__DSH_BOOT__` 检测未挂载的 DSH。

### 变更

- 子进程通过当前 Node 与 DSH 入口启动，不再依赖本机路径。

### 性能

- 页面隐藏时暂停自动刷新，恢复可见时立即刷新。

### 移除

- 移除内部启动 payload 的废弃 `port` 字段。

## 0.5.0 - 2026-08-24

### 变更

- 项目由 `dsh-easy-port-manager` 更名为 `dsh-instance-manager`。

### 兼容性

- 暂时保留旧 API 路由，并与 ≤0.4.x 互通。

## 0.4.2 - 2026-08-24

### 修复

- 按端口记录 busy 与确认状态，隐藏未受管实例的空 pid，并修复 manifest。

### 安全

- 写操作要求 POST；`stop-self` 暂时兼容旧 peer 的 GET。
- 拒绝跨站、外来 Origin 与非 loopback Host 请求。

## 0.4.1 - 2026-08-24

### 修复

- 优雅退出后增加强制退出兜底。

## 0.4.0 - 2026-08-24

### 新增

- 支持从面板启动新实例。
- 增加带二次确认的 stop-all、启动时间与 session 计数。

## 0.3.0 - 2026-08-23

### 新增

- 首次发布：列出并优雅停止 3080–3129 端口上的本地 DSH Web 实例。
