# dsh-instance-manager

[中文](./README.md) | [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-instance-manager)](https://www.npmjs.com/package/dsh-instance-manager)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

在 DSH Web 侧边栏添加管理面板:列出本机 3080–3129 端口上的全部 dsh web 实例,支持启动、优雅停止与详情查看。

## 功能

- **实例列表**:端口(可点击)/ PID / 运行时长 / 会话数 / 内存;4 秒自动刷新,后台标签页暂停
- **版本标注**:托管实例自报插件版本,与当前实例不同则标「版本差异」
- **实例详情**:点击行展开抽屉——启动时间、内存走势、stdout/stderr 日志尾随(最近 200 行)
- **启停控制**:一键拉起新实例;优雅停止任意实例(`appExit`,会话落盘);停止当前实例与全部结束需二次确认
- **中英切换**:面板头部「EN / 中」,偏好存 localStorage

除「启动新实例」外全程不产生子进程。

## 安装

```powershell
dsh plugin --profile web add dsh-instance-manager
# 或 Git 直装
dsh plugin --profile web add github:xswt442-cmd/dsh-instance-manager
```

安装后重启 DSH Web 生效。卸载:`dsh plugin --profile web remove dsh-instance-manager`。

## 工作原理

主机端注册 JSON 路由 `/dsh-instance-manager/api`(旧路径 `/dsh-easy-port-manager/api` 以别名保留):

| 动作 | 方法 | 说明 |
|---|---|---|
| `list` | GET | 先读心跳注册表(10s 心跳 / 30s 有效)并复核,未覆盖端口再走 self 探测与页面标记 |
| `self` | GET | 自报 `{ pid, port, startedAt, sessions, rss, version }` |
| `logs&port=&stream=out\|err` | GET | 尾读共享日志 `server-<port>.*.log`(≤64KB / 200 行) |
| `start` | POST | 第一个空闲端口拉起新实例(detached 后台) |
| `stop&port=` | POST | 自己 → `appExit` 优雅退出;否则向目标转发 `stop-self` |
| `stop-all` | POST | 并行转发停止全部托管实例,最后自身退出 |
| `stop-self` | POST | 自身优雅退出(GET 容忍,兼容 ≤0.4.1 转发) |

## 安全模型

API 仅面向本机面板。回环地址不受混合内容拦截、缺 CORS 也只是不给读响应,因此所有动作经过统一守卫:

- 变更类动作仅接受 POST(`stop-self` 容忍 GET,兼容旧实例间转发)
- Fetch Metadata:`sec-fetch-site` 非 same-origin / none → 403
- `Origin` 非本实例回环同源 → 403;`Host` 非回环名 → 403(顺带封 DNS rebinding)

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
