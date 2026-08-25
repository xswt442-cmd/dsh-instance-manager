# dsh-instance-manager

[中文](./README.md) | [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-instance-manager)](https://www.npmjs.com/package/dsh-instance-manager)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

在 DSH Web 侧边栏添加管理面板,列出本机 3080–3129 端口上的全部 dsh web 实例(端口 / PID / 运行时长 / 会话数 / 内存),支持启动新实例与停止任意实例。

## 功能

- **实例列表**:端口(可点击直达)、PID、运行时长、活跃会话数、内存占用;状态标注(当前会话 / 运行中 / 非 dsh 服务);4 秒自动刷新,标签页隐藏时暂停
- **版本标注**:每个托管实例自报插件版本;与当前实例不同的行标「版本差异」——混跑窗口期一眼可见,全舰队一致即可移除旧版兼容路由
- **启动新实例**:在第一个空闲端口以 detached 后台进程拉起新的 dsh web 实例,日志写入 `~\.dsh\launcher\logs\`
- **停止实例**:向目标发送退出请求,由其调用 harness `appExit` 正常退出,会话照常落盘;未挂载本面板的旧实例禁用该项并提示原因
- **停止当前实例 / 全部结束**:均需两步确认;结束后界面断开,重启 DSH 后会话自动恢复

除「启动新实例」外全程不产生子进程,与挂载的 shell 执行器无关。

## 安装

```powershell
# npm 包(推荐)
dsh plugin --profile web add dsh-instance-manager

# Git 仓库直装
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

安装后重启 DSH Web 生效。

### 从 ≤0.4.x(dsh-easy-port-manager)迁移

```powershell
dsh plugin --profile web remove dsh-easy-port-manager
dsh plugin --profile web add dsh-instance-manager
```

新旧版本实例可以混跑:新面板能发现并停止旧实例,旧面板亦然(旧 API 路由以别名保留)。

## 卸载

```powershell
dsh plugin --profile web remove dsh-instance-manager
```

## 工作原理

主机端在 webserver 上注册 JSON 路由 `/dsh-instance-manager/api`(旧路径 `/dsh-easy-port-manager/api` 以别名保留):

| 动作 | 方法 | 说明 |
|---|---|---|
| `action=list` | GET | 优先读取心跳注册表(`~\.dsh\run\instances\<port>.json`,10s 心跳 / 30s 有效)并对自报复核;未覆盖端口再走 self 探测与页面标记 |
| `action=self` | GET | 实例自报 `{ pid, port, startedAt, sessions, rss, version }` |
| `action=start` | POST | 在第一个空闲端口启动新的 dsh web 实例(detached + windowsHide) |
| `action=stop&port=` | POST | 目标是自己 → 延迟后走 `appExit` 优雅退出;否则向目标转发 `stop-self` |
| `action=stop-all` | POST | 并行转发停止所有托管实例,最后自身优雅退出 |
| `action=stop-self` | POST | 自身优雅退出;容忍 GET 以兼容 ≤0.4.1 的实例间转发 |

未挂载本面板的 dsh 实例通过注入的 `window.__DSH_BOOT__` 清单标记识别。

## 安全模型

API 仅面向本机面板。浏览器允许任意页面请求 `http://127.0.0.1:<port>`(回环地址不受混合内容拦截,CORS 缺失仅阻止读取响应、不阻止请求发出),因此所有动作经过统一守卫:

- 变更类动作(`start` / `stop` / `stop-all`)仅接受 POST;`stop-self` 额外容忍 GET,兼容 ≤0.4.1 实例间的转发
- Fetch Metadata:`sec-fetch-site` 非 `same-origin` / `none` → 403
- `Origin`:存在时必须与本实例回环同源 → 否则 403
- `Host`:必须为回环地址名 → 否则 403,同时阻断 DNS rebinding

已在本地运行的恶意进程可直接结束任意进程,不在威胁模型内。

## 结构

```
package.json       npm 元数据 + dsh.bundle.patch + dsh.client 声明
cordis.patch.yml   向 profile 插入本插件 loader 行
lib/index.js       host:注册 /dsh-instance-manager/api JSON 路由
lib/client.js      client:侧边栏入口 + 浮动面板(ModuleLoader bundle)
lib/shared.js      host 纯函数(请求守卫 / bin 解析 / 注册表校验)
test/              node:test 单元测试(npm test)
CHANGELOG.md       变更记录
```

## License

[MIT](./LICENSE)
