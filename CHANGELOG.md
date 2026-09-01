# 更新日志

Release Notes 由对应版本段生成；最新版本在前。
英文版见 [CHANGELOG.en.md](CHANGELOG.en.md)。

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

