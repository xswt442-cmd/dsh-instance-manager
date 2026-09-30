# 更新日志

Release Notes 由对应版本段生成；最新版本在前。
英文版见 [CHANGELOG.en.md](CHANGELOG.en.md)。

## Unreleased

### 修复

- 桌面宿主不会被任何停止操作结束：单实例停止、全部结束与 agent 工具的停止都跳过它，全部结束同时回报被跳过的条数；桌面窗口依赖该宿主提供后端。
- 桌面端的面板打开实例页时使用宿主接口返回的绝对 token 地址；桌面应用拒绝相对跳转。

### 变更

- 桌面宿主行的停止按钮保留但禁用并给出原因，该行新增「桌面端 / Desktop」徽标；打开该实例页仍然可用。
- 桌面端启动新实例时启动参数带 `--no-open`，不向浏览器交接；启动结果与面板都报告本次使用的 dsh 启动器路径与版本。
- 桌面宿主启动子进程时显式传入桌面运行时环境标记。
- 实例行新增 `runtime`（`desktop` / `node`）与 `launcher`、`parentPid`；`runtime` 随实例列表与 agent 工具行一同返回，`launcher` 与 `parentPid` 只写在心跳文件里。不回报 `runtime` 的宿主按 `node` 处理，取不到 `launcher` 与 `parentPid` 时为 `null`。
- `name` 字段是列表进程自己的可执行文件名，同一份列表的每行相同，不是被列实例的身份；该字段不进入 agent 工具行。

### 维护

- 实例注册表的 home 优先采用启动层提供的 `dshHomePath` 访问器，宿主未提供时回落到原有解析。

## 0.10.7 - 2026-09-29

### 修复

- 版本差异提示说明当前状态：面板与实例的版本一致之前 fleet 仍是混版。

### 变更

- 端口设置改为逗号分隔的范围与单端口清单，默认值在 `3080-3129` 之外加入桌面端宿主的 `19387`，未安装本插件的桌面端也会出现在实例列表中；首段仍为新实例的启动范围。

## 0.10.6 - 2026-09-29

### 维护

- 兼容性验证覆盖 `0.2.0-rc.1`：Windows 与 Linux 各执行一次真实 boot。

## 0.10.5 - 2026-09-29

### 变更

- `CHANGELOG.md`、`CHANGELOG.en.md`、`RELEASING.md` 移入 `docs/`，仓库根目录保留两份 README、`LICENSE`、`AGENTS.md` 与 `CLAUDE.md`；npm 包内的两份 CHANGELOG 按新路径发布。

### 维护

- `dsh-mini-utility-dock` 依赖升至 0.7.0；`docs:check` 改为读取本仓声明的 `docs.config.mjs`。

## 0.10.4 - 2026-09-28

### 新增

- 嵌入 `dsh-mini-utility-dock` 的第四个片段 `dsh-host-http`，JSON 应答、POST 方法门槛与浏览器准入由其提供；新增 `http:sync` / `http:check`。
- README 安全章列出两条应答规则：事件流与 JSON 应答均带 `cache-control: no-store`，意外失败只返回固定 `code`。

### 修复

- 事件流与 JSON 应答增加 `cache-control: no-store`；这些响应体包含实例端口、PID 与会话摘要，不可由中间缓存保存。
- `action` 中的未预期异常不再返回原始 message：500 只返回固定 `code`，异常文本写入宿主日志。
- 跨实例转发对两类失败各记一行日志：应答不是 JSON、无应答。返回值不变；端口段扫描产生的失败不记日志。

### 变更

- `sendJson` / `requirePost` / `authorizeBrowser` 由片段提供，不再是 `lib/index.js` 的局部闭包。对外行为不变：405 仍返回 `need_post` 并回显被拒的 `action`；方法名按大小写不敏感匹配。
- README 配置章补齐取值信息：`live` / `startup` 两节、两个命名空间 id、各字段的默认值与范围、环境变量所在的层级，以及 `DSHIM_FLEET_TOKEN_REF` 存放的是变量名而非 token。

### 维护

- CI 增加 pull request 触发，`node --check` 覆盖 `lib/` 全部文件，并在 node 20 与 24 各运行一次；失败日志过滤 launch token。`publish.yml` 拆为 checks / npm / release 三个 job，仅 release 持有写权限，tag 必须是 `main` 已包含的提交。
- `dsh-mini-utility-dock` pin 升至 0.6.0，四个嵌入块重新 sync；`http:check` 覆盖第四个块。

## 0.10.3 - 2026-09-25

### 新增

- 新增 `dshim-requests.log`：每个被接受的写操作记下对端地址、准入路径、请求自带的 Host / Origin / Referer / User-Agent、目标端口与结果；Cookie 与 Authorization 不读、不落盘。

### 变更

- 最低支持 DSH 版本提高到 `0.1.5-rc.3`；兼容矩阵固定检查该基线与 0.1.7 线。
- 面板入口改用 `dsh-mini-utility-dock` 的共享 launcher 片段：左下角一个图标点开菜单。页面级 dock 协议与 `dockPlacement`（含 `DSHIM_DOCK_PLACEMENT`）一并退役。
- 声明宿主兼容性：`peerDependencies` 与 `engines.dsh` 都要求 `>=0.1.5-rc.3`，peer 标 optional 以免 npm 去装宿主；没有声明时，宿主预检无从判断该不该禁用本插件。
- 修复热重载后共享 launcher 图标消失：同步到 `dsh-mini-utility-dock` 0.5.1，图标归属随 owner 一起释放，其余副本不必刷新整页即可重新注册。

## 0.10.1 - 2026-09-24

### 修复

- 支持 DSH 0.1.7-rc.1：该版本移除 `settingsScope` 服务，并把插件设置移到 profile 条目自己的 config（`live` / `startup` 两节）。此前 0.1.7 上偏好静默回落到 localStorage 与环境变量，配置值读不到。

### 变更

- 两个来源并存，新的优先：条目 config 有值时以它为准，否则沿用设置服务的命名空间，两者都缺时仍是环境变量与内置默认值。两条路径都是运行时注入，旧版本不受影响。
- compat 矩阵加上 `0.1.7-rc.1`，每条线各自在自己的宿主上验证。

## 0.10.0 - 2026-09-23

### 修复

- fleet 出站握手加 10 秒超时。对端收下 TCP 却不返回 101 时，连接会一直停在 CONNECTING，该 peer 从此静默失联。
- 事件流订阅上限 8 个，并在 `write()` 报背压时剔除最慢的订阅者；此前每个订阅都会触发一次全量实例列举。
- `dshim-crash.log` 与 `dshim-selfexit.log` 封顶 1MB，超出后保留较新的后半段。launcher 持有的 `server-<port>.out.log` 不在内：子进程握着句柄，改名会把文件分叉。
- `stopForAgent` 的端口校验改用统一的 `normalizePort`。
- 解析 `ws` 模块失败时留下一行日志；此前被静默吞掉，整条 fleet 链路失联且无诊断信息。

### 变更

- 声明的最低 DSH 版本改为 `>=0.1.2-rc.1`；此前声明的 `0.1.0-rc.5` 在 npm 上并不存在。

## 0.9.13 - 2026-09-20

### 变更

- 实例列表面板所在实例恒排第一行。此前整个列表按端口升序、远程行追加在后，当前实例落在自己端口的数字位置上，与它是否为最需要看的那一行无关。

## 0.9.12 - 2026-09-17

### 修复

- 自动选端口改为先实际尝试监听再返回，且重试会跳过上一次失败的那个端口。此前端口在扫描时看起来空闲、子进程监听时却报 EADDRINUSE，换口重试又挑中同一个端口，形成子进程反复启动即死、面板一直停在「启动中…」的循环。
- 面板的「启动中…」状态改为在请求结束后无条件复位，后续刷新失败不再把按钮永久留在禁用态。

## 0.9.11 - 2026-09-17

### 修复

- 面板不再吞掉操作失败的原因：`refresh()` 此前在每次列表读取成功后清空错误，`startNew()` 的错误提示在被读到之前就被清掉。现在只有列表读取本身失败才清空。

## 0.9.10 - 2026-09-17

### 新增

- 启动新实例可指定端口：留空沿用自动选择；指定端口被占用时返回 `port_in_use` 且不换口启动；非整数或超出 1–65535 返回 400，不静默回退。
- 丢失扫描/绑定竞态的重试只对自动选择生效，指定端口失败不再换口重试。

### 变更

- 停止确认态改为橙色描边 + 「确认？」。红色表示已发生的错误，而停止尚未执行、仍可撤销。未确认时仍是红色描边「停止」。

## 0.9.9 - 2026-09-17

### 修复

- 停止的两步确认此前只对当前实例生效，其他实例一次点击即执行。现在所有可停止的本地实例都先进入确认态。
- 确认态文案由「确认结束？」改为「再次点击结束」，确认窗口 4 秒后自动取消。

### 变更

- README 抬头统一为一致徽章行。

## 0.9.8 - 2026-09-17

### 修复

- 行的 `:端口` 链接改指 `?action=open&port=`：宿主从 `server-<port>.out.log` 读出该实例当前进程的 token 并返回 303。DSH 要求实例根 URL 携带每进程 token，原先的裸根地址必然 401。
- token 每次进程启动重新生成，同一端口重启后日志中会累积多行，因此只取最后一条。
- 日志行按 URL 解析并校验协议、回环主机、端口、根路径与 token；任一项不符即视为无 token。
- 无 token 可读（实例不由本机 launcher 启动或日志已轮转）时返回 409 `launch_token_unavailable`，不再跳到裸根地址。
- 远程实例行的端口链接由该 peer 自身的面板执行同一换取流程。

### 安全

- token 只出现在 303 响应的 `Location` 头，带 `cache-control: no-store` 与 `referrer-policy: no-referrer`，不进面板状态也不进链接 `href`。
- `action=open` 与 `list` / `logs` / `sessions` 走同一浏览器认证门。

## 0.9.7 - 2026-09-16

### 维护

- 共享片段的 CI 校验改为在本仓执行（`loopback:check` / `guard:check`）。
- LICENSE 版权署名统一为 `xswt442-cmd`。

## 0.9.6 - 2026-09-14

### 安全

- 修复同源校验的一处绕过：`Host` 头存在但解析不出主机名时（例如写成未加方括号的 IPv6 主机 `::1:3080`，RFC 7230 不允许这种写法），此前会**整段跳过白名单校验**。现在这类请求一律按非回环拒绝。
- IPv4-mapped IPv6 回环 `[::ffff:127.0.0.1]` 现在在 Origin 路径上也能被识别为回环。此前它只出现在 Host 白名单里，而 URL 解析器会把这种写法规范化成 `[::ffff:7f00:1]`，导致 Origin 校验永远匹配不上。

### 修复

- 通过 IPv6 回环地址（`::1`）访问时不再被拒绝。

## 0.9.5 - 2026-09-04

### 变更

- 适配 DSH 0.1.2-rc.1 的 Connection 鉴权：浏览器 API 与 SSE 使用签名 cookie，内部实例探测保留严格 loopback 通道；Connection 拒绝或卸载时不再降级放行。
- 网页面板启动的新实例会打开 DSH 的一次性 token URL 完成 cookie 交接；Agent 工具启动仍使用 `--no-open`，并统一采用显式 `--profile web` 参数。
- 面板语言跟随 DSH 全局 locale，移除独立的 `dshim-lang` localStorage 偏好与语言按钮；旧 DSH 仍按浏览器语言降级。
- 兼容检查覆盖 `0.1.2-rc.1` 与 latest。

### 修复

- 请求守卫改用 TCP 对端地址判定本地性。对于旧版或自定义的远程监听，此前远端来源伪造 `Host: 127.0.0.1` 即可通过守卫并绕过 fleet bearer，执行 start / stop / stop-all / stop-self。
- 对端地址缺失或为空白时按未知来源拒绝，不再视为本地请求。
- 服务运行在 HTTP 默认端口 80 时，省略端口的同源 Origin（如 `http://127.0.0.1`）不再被误判为跨源。

## 0.9.4 - 2026-09-02

### 变更

- Dock 片段改为构建期从外部片段包嵌入；插件发布物仍可独立运行。
- Dock 统一过滤外部 SVG 图标，并为无效图标显示文本回退。

## 0.9.3 - 2026-09-01

### 新增

- 配置迁移至 settings，区分即时生效与重启生效的选项，并保留 env 作为默认层。
- Fleet token 作为 secret 存储；无效配置自动回退到 schema 默认值。

### 修复

- 修复缺少 token 时远程请求返回 500；现在按预期返回 403。

## 0.9.2 - 2026-08-31

### 变更

- 面板接入带版本的 Mini Utility Dock 协议。
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
