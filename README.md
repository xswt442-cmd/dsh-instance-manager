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

| 动作 | 说明 |
|---|---|
| `action=list` | 并发探测 3080–3129：先问 `action=self`（挂载了本面板的实例会自报 pid / 启动时间 / 活跃会话数），再回退页面标记探测 |
| `action=self` | 实例自报 `{ pid, port, startedAt, sessions }` |
| `action=start` | 在第一个空闲端口启动新的 dsh web 实例（detached + windowsHide） |
| `action=stop&port=` | 目标是自己 → 延迟 300ms 走 `appExit` 优雅退出；否则转发 `stop-self` 给目标 |
| `action=stop-all` | 结束所有托管实例（远程转发 + 自身优雅退出） |
| `action=stop-self` | 自身优雅退出 |

全程不启动 netstat/tasklist/powershell 等任何子进程，与挂载的 shell 执行器无关。

## 结构

```
package.json       npm 元数据 + dsh.bundle.patch + dsh.client（浏览器半注册）
cordis.patch.yml   向 profile 插入本插件行
lib/index.js       host（/dsh-easy-port-manager/api JSON 路由）
lib/client.js      client（ModuleLoader 经典脚本 bundle，侧边栏按钮 + 浮动面板）
```

## License

[MIT](./LICENSE)
