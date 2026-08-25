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
- **Agent 工具**:向会话内模型注册 `instance_list / instance_start / instance_stop / instance_logs / instance_sessions`,agent 可直接查看与启停实例(工具拒绝停止当前实例)
- **上下线提醒**:托管实例上/下线时右下角即时 toast(SSE 推送,面板关着也生效)
- **会话概要**:抽屉内查看任意托管实例的活跃会话(时间 / 目录 / 子代理 / 活动量)

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
| `list` | GET | 先读心跳注册表(10s 心跳 / 30s 有效)并复核(含超出扫描范围的心跳端口),未覆盖端口再走 self 探测与页面标记 |
| `self` | GET | 自报 `{ pid, port, startedAt, sessions, rss, version }` |
| `logs&port=&stream=out\|err` | GET | 尾读共享日志 `server-<port>.*.log`(≤64KB / 200 行) |
| `sessions&port=` | GET | 目标实例的活跃会话概要(仅标量字段,最近 20 条);缺省 port 即自报 |
| `GET /dsh-instance-manager/events` | GET | SSE 舰队上/下线推送(baseline 首帧 + 差分帧) |
| `start` | POST | 第一个空闲端口拉起新实例(detached 后台),等待其自报就绪后返回 `{ ok, port, pid }`;端口竞态失败自动换口重试一次 |
| `stop&port=` | POST | 自己 → `appExit` 优雅退出;否则向目标转发 `stop-self` |
| `stop-all` | POST | 并行转发停止全部托管实例,最后自身退出 |
| `stop-self` | POST | 自身优雅退出(GET 容忍,兼容 ≤0.4.1 转发) |

## 端口段与自适应

扫描/启动默认 **3080–3129**(与 dsh 文档约定一致)。调研结论:该区间只是约定,不是运行时契约——dsh 的 webserver 端口来自组合期配置,甚至支持 `0`(OS 随机分配),源码中并无硬编码。因此:

- 环境变量 `DSHIM_PORT_RANGE="4000-4010"` 可整体覆盖扫描与启动区间
- **发现不依赖区间**:心跳注册表校验 1–65535,范围外手动启动的实例同样会被列出、停止、查日志与会话
- 面板启动的子进程带 `--no-open`,不会自动弹浏览器;启动确认窗最长 25 秒,慢首启(如会话日志回填)不会被误报为失败;确认窗内进程退出会在其 launcher 日志留下退出码面包屑

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
lib/agent-tools.js host:instance_* 模型工具(tools 服务)
lib/client.js      client:侧边栏入口 + 浮动面板(ModuleLoader bundle)
lib/shared.js      host 纯函数(请求守卫 / bin 解析 / 注册表校验)
test/              node:test 单元测试(npm test)
CHANGELOG.md       变更记录
```

## License

[MIT](./LICENSE)
