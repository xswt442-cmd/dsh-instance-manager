# dsh-easy-port-manager

> 中文 | [English](./README.en.md)

在 DSH Web 的侧边栏底部添加「dsh 管理」入口。点击后打开浮动面板，列出本机
3080–3129 端口上的全部 dsh web 实例（端口 / PID / 状态），并可停止选定实例。

实例发现通过 HTTP 在本机实例之间完成；停止操作向目标实例发送请求，由其调用
harness 的 `appExit` 正常退出，会话照常写入磁盘。整个流程不启动任何子进程。

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)

## 功能

- **实例列表**：端口（链接直达）、PID、运行时长、活跃会话数、状态（当前会话 / 运行中 / 非 dsh 服务）；每 4 秒刷新一次，也可手动刷新。
- **启动新实例**：在第一个空闲端口拉起一个新的 dsh web 实例（隐藏后台进程，日志写入 `~\.dsh\launcher\logs\`）。
- **停止实例**：向目标实例发送退出请求；未挂载本面板的旧实例会禁用该项并说明原因。
- **全部结束**：两步确认后结束所有托管实例（含当前窗口所在实例）。
- **停止当前实例**：需两步确认；结束后当前界面断开，会话保持持久化，重启 DSH 后可继续原会话。
- **样式**：颜色使用主题 token，随深浅色切换；除启动新实例外全程不启动子进程。

## 安装

```powershell
# 方式一：Git 依赖直装（推荐，无需本地 clone，重启 DSH 生效）
dsh plugin --profile web add "github:xswt442-cmd/dsh-easy-port-manager"

# 方式二：本地 link（开发调试）
dsh plugin --profile web add "E:\path\to\dsh-easy-port-manager"
```

> 装完**重启 DSH Web** 后生效。

## 卸载

```powershell
dsh plugin --profile web remove dsh-easy-port-manager
```

## 工作原理

主机端在 webserver 上注册一个 JSON 路由 `/dsh-easy-port-manager/api`：

| 动作 | 方法 | 说明 |
|---|---|---|
| `action=list` | GET | 并发探测 3080–3129：先问 `action=self`（挂载了本面板的实例会自报 pid / 启动时间 / 活跃会话数），再回退页面标记探测 |
| `action=self` | GET | 实例自报 `{ pid, port, startedAt, sessions }` |
| `action=start` | POST | 在第一个空闲端口启动新的 dsh web 实例（detached + windowsHide） |
| `action=stop&port=` | POST | 目标是自己 → 延迟 300ms 走 `appExit` 优雅退出；否则转发 `stop-self` 给目标 |
| `action=stop-all` | POST | 结束所有托管实例（远程转发 + 自身优雅退出） |
| `action=stop-self` | POST | 自身优雅退出；额外容忍 GET，兼容 ≤0.4.1 旧实例的转发 |

全程不启动 netstat/tasklist/powershell 等任何子进程，与挂载的 shell 执行器无关。

## 安全模型

API 只面向本机面板，默认部署绑定回环地址。但浏览器允许任意 https 页面向
`http://127.0.0.1:<端口>` 发请求（回环地址被视为潜在可信来源，不受混合内容
拦截），缺失 CORS 也只能阻止对方读取响应、拦不住请求发出。因此 0.4.2 起：

- **变更类动作只接受 POST**（`start` / `stop` / `stop-all`）；`stop-self`
  额外容忍 GET 以兼容旧实例间的转发。
- **Fetch Metadata 校验**：请求携带 `sec-fetch-site: cross-site` 一律 403
  （现代浏览器对每个请求都会附加该头，恶意页面的 img/form/fetch 全部命中）。
- **Origin 同源校验**：携带 `Origin` 时必须是本实例的回环同源。
- **Host 回环校验**：`Host` 必须是回环地址名，同时封死 DNS rebinding。

不校验来源的本地恶意进程本来就能直接杀进程，不在威胁模型内。

## 结构

```
package.json       npm 元数据 + dsh.bundle.patch + dsh.client（浏览器半注册）
cordis.patch.yml   向 profile 插入本插件行
lib/index.js       host（/dsh-easy-port-manager/api JSON 路由）
lib/client.js      client（ModuleLoader 经典脚本 bundle，侧边栏按钮 + 浮动面板）
```

## License

[MIT](./LICENSE)
