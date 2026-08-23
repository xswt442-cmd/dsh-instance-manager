# dsh-easy-port-manager

> 中文 | [English](./README.en.md)

DSH 常驻插件：侧边栏底部 **「dsh 管理」** 按钮，弹出浮动面板，统一查看并停止本机
3080–3129 端口上运行的所有 dsh web 实例。零外部进程：实例发现是实例间互查（HTTP），
停止 = 通知目标实例通过 harness 的 `appExit` **优雅退出**（会话正常落盘）。

![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)

## 功能

- **实例总览**：端口（点击直达）、PID、状态徽章（当前会话 / 运行中 / 非 dsh 服务）、每 4 秒自动刷新。
- **一键停止**：通知目标实例优雅退出；对旧版未挂载本面板的实例自动禁用并说明。
- **停止当前**：两步确认后结束当前 GUI 所在实例（等同任务管理器结束任务）；会话已持久化，重启 dsh 后对话原样恢复。
- **自适应 UI**：深浅色跟随主题 token；纯浏览器内渲染，不弹任何控制台窗口。

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
| `action=list` | 并发探测 3080–3129：先问 `action=self`（挂载了本面板的实例会自报 pid），再回退页面标记探测 |
| `action=self` | 实例自报 `{ pid, port }` |
| `action=stop&port=` | 目标是自己 → 延迟 300ms 走 `appExit` 优雅退出；否则转发 `stop-self` 给目标 |
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
