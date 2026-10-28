// dsh-instance-manager 宿主侧。
//
// webserver 上的 JSON 端点（所有操作同源）：
//
//   GET  /dsh-instance-manager/api?action=list
//   GET  /dsh-instance-manager/api?action=self
//   GET  /dsh-instance-manager/api?action=logs&port=<port>&stream=out|err
//   POST /dsh-instance-manager/api?action=start
//   POST /dsh-instance-manager/api?action=stop&port=<port>
//   POST /dsh-instance-manager/api?action=stop-all
//   POST /dsh-instance-manager/api?action=stop-self
//
// 安全模型（README「安全模型」）：每个操作都经过守卫，拒绝浏览器发起的跨站请求——
// Fetch Metadata（sec-fetch-site 不是 same-origin/none）、异源 Origin，以及非回环
// 的 Host 头（同时关闭 DNS 重绑定）。写操作还要求 POST。对端实例走普通 node:http，
// 不携带浏览器头，因此宿主之间的转发仍然可用。
//
// 远端 fleet 请求（非回环 Host）还需要 fleet bearer。它是没有操作分级的对称预共享
// 密钥：持有它的对端可以在本机启动进程、停止所有本地实例、读取会话工作目录。配置的
// 对端是受信操作者，不是只读观察者——见 README 关于 fleet 信任的说明。
//
// 实例发现以登记文件为先：每个已挂载实例向 $DSH_HOME/run/instances/<port>.json 写
// 心跳，`action=list` 在一次轻量的 action=self 复核后信任新鲜条目，只扫描没有心跳
// 覆盖的端口（未托管面板的 dsh 实例、非 dsh 监听者）。停止远端实例时转发 `stop-self`，
// 让目标通过 harness 的优雅 `appExit` 退出（会话落盘）。启动新实例派生一个脱离的、
// 隐藏窗口的 node 子进程（windowsHide），日志写在 $DSH_HOME/launcher/logs。无论挂载
// 的 shell 执行器如何，这里都不会闪出控制台窗口。
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  VERSION,
  sendJson,
  createRequirePost,
  createBrowserAuthorizer,
  createGuard,
  resolveDshBin,
  hostDshHome,
  registryDir,
  isValidRegistryEntry,
  normalizePort,
  tailFile,
  selectCrashRecords,
selectSelfExitLines,
selectRequestLines,
unionPorts,
  summarizeSessions,
  orderInstances,
  awaitChild,
  awaitPortFree,
  managedLocalPorts,
  diffManagedPorts,
  parsePortSpec,
  pickStartPort,
  startOnceOrRetry,
  registerLiveSettings,
  registerStartupSettings,
  resolveLiveSection,
  resolveStartupSection,
  FLEET_TOKEN_FIELD,
  PEERS_FIELD,
  PORT_RANGE_FIELD,
  ENV_FLEET_TOKEN_REF,
  ENV_FLEET_TOKEN,
  safeTokenEqual,
  requestNeedsBearer,
  buildDshLaunchArgs,
  buildDshWebArgs,
  findExecutable,
  detectSessionTools,
  sessionNameFor,
  buildSessionLaunch,
  buildSessionProbe,
  parseSessionPid,
  awaitSession,
  detectRuntime,
  isElectronNode,
  launcherOf,
  parentPidOf,
  buildSpawnEnv,
  dshBinVersion,
  isLoopbackName
} from './shared.js'
import { parsePeers, FleetLinks, LINK_PATH, createQueryResponder } from './fleet.js'
import { buildAgentTools } from './agent-tools.js'

export default {
  // 硬依赖：loader 条目并发挂载，apply 运行时 webserver 服务可能尚未提供。Cordis
  // 会等待它。
  inject: ['webServer'],
  // `config` 是 profile 条目的配置（cordis 作为第二个参数交给 apply）。从
  // 0.1.7-rc.1 起，插件设置就放在这里；更早的版本通常没有它，由下面的 settings
  // 服务承担。
  apply(ctx, config) {
    const ws = ctx.webServer
    if (ws === undefined) return

    const startedAt = Date.now()

    // 本宿主的运行时身份，由其被要求运行的入口识别（shared.detectRuntime）。桌面
    // 宿主与其他行的处理相反：停止它会拆掉桌面窗口唯一的后端（应用把任何宿主退出都
    // 视为失败），而且它没有自己的浏览器可以把新实例交给它。
    const HOST_RUNTIME = detectRuntime()
    const isDesktopHost = HOST_RUNTIME === 'desktop'

    const currentPort = () => {
      const server = ctx.get('webServer')
      return server ? server.port : undefined
    }

    // 宿主有自己的取值函数时优先使用，本插件写登记文件的 home 因此就是 harness
    // 实际使用的那一个（见 shared.hostDshHome）。
    const dshHome = () => hostDshHome(ctx)

    const dshBin = () => resolveDshBin({
      argv1: process.argv[1] || '',
      home: dshHome(),
      exists: (file) => fs.existsSync(file)
    })

    // ---- 会话持久化启动 ---------------------------------------------------
    // tmux / screen 里执行的实例活过面板宿主：终端关闭、SSH 断开、插件重装都不会
    // 带走它。`dsh` 不在 PATH 时退回已解析的 bin.js（旧路径），两者都没有才报
    // no_dsh_bin。
    const sessionTools = () => detectSessionTools({
      env: process.env,
      exists: (file) => fs.existsSync(file)
    })
    const sessionToolName = () => {
      const tools = sessionTools()
      return tools.length ? tools[0].tool : null
    }
    // Windows 上 PATH 里的 `dsh` 是 npm 生成的无扩展名 sh shim：文件确实存在，
    // 但 CreateProcess 起不来（spawn 直接 ENOENT）。那台机器的启动必须走
    // dshBin() + node，所以这里不给 cli，让调用方回退。
    const dshCli = () => process.platform === 'win32' ? '' : findExecutable('dsh', {
      env: process.env,
      exists: (file) => fs.existsSync(file)
    })
    const cliVersion = (file) => {
      try {
        return dshBinVersion(fs.realpathSync(file), (f) => fs.readFileSync(f, 'utf8'))
      } catch (e) {
        return null
      }
    }

    // 会话里的命令以 /bin/sh 执行；只继承启动所需的最小环境。DSH_HOME 显式传给
    // 子进程：tmux/screen 的服务端可能比面板更早启动，环境里的 home 不一定是面板
    // 正在管理的那个。
    const sessionBaseEnv = () => {
      const base = { DSH_HOME: dshHome() }
      if (typeof process.env.PATH === 'string') base.PATH = process.env.PATH
      if (typeof process.env.HOME === 'string') base.HOME = process.env.HOME
      return buildSpawnEnv(base, { runtime: HOST_RUNTIME, parentPid: process.pid })
    }

    // screen 默认把 socket 放在 /run/screen；容器里该目录常常不存在，而 /run 对非
    // root 不可写，screen 会静默退出。把本插件管理的会话收进 DSH home 下的私有目录，
    // 启动、存活探测与清理便看到同一批 socket。
    const screenDir = () => {
      const dir = path.join(dshHome(), 'launcher', 'screen')
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      } catch (e) { }
      return dir
    }
    const sessionCmdEnv = (tool) => tool === 'screen'
      ? { ...process.env, SCREENDIR: screenDir() }
      : process.env

    const runSessionCommand = (spec, tool) => {
      try {
        const result = spawnSync(spec.file, spec.args, {
          stdio: 'ignore',
          env: sessionCmdEnv(tool),
          windowsHide: true,
          timeout: 10000
        })
        return !result.error && result.status === 0
      } catch (e) {
        return false
      }
    }

    const sessionAlive = (spec, tool) => {
      try {
        const result = spawnSync(spec.file, spec.args, {
          stdio: 'ignore',
          env: sessionCmdEnv(tool),
          windowsHide: true,
          timeout: 2000
        })
        return !result.error && result.status === 0
      } catch (e) {
        return false
      }
    }

    // tmux 能读出 pane 的首进程 pid；screen 没有稳定的等价查询，返回 null。pid 只
    // 用于诊断与列表展示，不参与就绪判定。
    const sessionPidOf = (tool, bin, name) => {
      if (tool !== 'tmux') return null
      try {
        const result = spawnSync(bin, ['list-panes', '-t', name, '-F', '#{pane_pid}'], {
          encoding: 'utf8',
          timeout: 2000,
          windowsHide: true
        })
        if (result.error || result.status !== 0) return null
        return parseSessionPid(tool, result.stdout)
      } catch (e) {
        return null
      }
    }

    // 在一个持久化会话里启动实例。返回 `sessionFailed: true` 表示会话本身没建成
    // （工具不可用、守护进程拒绝），调用方还可以试下一个工具或退回直接派生；其余
    // 结果与 launchOnce 的返回形状一致。
    const launchInSession = async ({ tool, port, browserHandoff }) => {
      const cli = dshCli()
      const bin = dshBin()
      let argv
      let used
      if (cli) {
        argv = [cli, ...buildDshWebArgs(port, { browserHandoff: browserHandoff && !isDesktopHost })]
        used = { bin: cli, binVersion: cliVersion(cli) }
      } else if (bin) {
        argv = [process.execPath, ...buildDshLaunchArgs(bin, port, { browserHandoff: browserHandoff && !isDesktopHost })]
        used = { bin, binVersion: dshBinVersion(bin, (f) => fs.readFileSync(f, 'utf8')) }
      } else {
        const detail = path.join(dshHome(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        return { ok: false, code: 'no_dsh_bin', detail, error: '未找到 dsh 启动器：PATH 中没有 dsh，也没有 ' + detail }
      }
      const logDir = path.join(dshHome(), 'launcher', 'logs')
      let logs
      try {
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
        logs = {
          out: path.join(logDir, 'server-' + port + '.out.log'),
          err: path.join(logDir, 'server-' + port + '.err.log')
        }
      } catch (e) {
        return { ok: false, code: 'start_failed', port, error: '无法准备实例日志：' + (e && e.message ? e.message : String(e)) }
      }
      const name = sessionNameFor(port, tool.tool)
      // 与直接派生那条路径同理：追加日志里这次启动之前的字节属于上一代进程。
      used = Object.assign({}, used, { logSince: logSize(logs.out) })
      let spec
      try {
        spec = buildSessionLaunch({
          tool: tool.tool,
          bin: tool.bin,
          name,
          cwd: dshHome(),
          argv,
          env: sessionBaseEnv(),
          out: logs.out,
          err: logs.err
        })
      } catch (e) {
        return { sessionFailed: true, error: e && e.message ? e.message : String(e) }
      }
      if (!runSessionCommand(spec, tool.tool)) {
        return { sessionFailed: true, error: '无法创建 ' + tool.tool + ' 会话' }
      }
      const verdict = await awaitSession({
        confirmMs: START_CONFIRM_MS,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        probe: async () => {
          const self = await fetchJson(port, 'action=self', 1500)
          return !!(self && typeof self.pid === 'number')
        },
        alive: () => sessionAlive(buildSessionProbe({ tool: tool.tool, bin: tool.bin, name }), tool.tool)
      })
      if (verdict && verdict.ready) {
        return {
          ok: true,
          port,
          pid: sessionPidOf(tool.tool, tool.bin, name),
          ...used,
          session: { tool: tool.tool, name }
        }
      }
      if (verdict && verdict.died) {
        try {
          fs.appendFileSync(logs.out,
            '[dsh-instance-manager] session exited during confirm window (' + tool.tool + ' ' + name + ')\n')
        } catch (e) { }
        return { ok: false, code: 'start_failed', port, error: '新实例所在会话已退出（端口可能被抢占或启动失败）' }
      }
      // 不清理未应答的会话：它可能只是启动得慢，清掉会把“稍后刷新”变成“永远没有”。
      return {
        ok: false,
        code: 'start_unconfirmed',
        port,
        ...used,
        session: { tool: tool.tool, name },
        error: '实例仍在启动中、未能在窗口内应答，请稍后刷新列表确认'
      }
    }

    const activeSessionCount = () => {
      try {
        const sessions = ctx.get('sessions')
        return sessions ? sessions.list().length : null
      } catch (e) {
        return null
      }
    }

    // fleet 协议跨重启稳定的身份（链路按它寻址对端）。每个 DSH_HOME 生成一次，
    // 保存在 run/ 旁边。
    let fleetIdCache
    const fleetId = () => {
      if (fleetIdCache) return fleetIdCache
      const file = path.join(dshHome(), 'fleet-id')
      try {
        const existing = fs.readFileSync(file, 'utf8').trim()
        if (existing) { fleetIdCache = existing; return fleetIdCache }
      } catch (e) { }
      try {
        fleetIdCache = crypto.randomUUID()
        fs.mkdirSync(dshHome(), { recursive: true })
        fs.writeFileSync(file, fleetIdCache + '\n')
      } catch (e) {
        // 只读的 home：降级为进程内身份，而不是失败。
        fleetIdCache = 'dim-' + process.pid.toString(36) + '-' + Date.now().toString(36)
      }
      return fleetIdCache
    }

    // ---- fleet 信任边界 ---------------------------------------------------
    // token 通过环境变量的名字定位（DSHIM_FLEET_TOKEN_REF，默认 DSHIM_FLEET_TOKEN），
    // 挂载了凭证服务时由它解析：设置保存引用，提供方持有值，解析按请求进行，轮换的
    // token 无需重启即可生效（dsh-credentials 的约定要求使用方不得跨操作缓存）。任何
    // 来源都拿不到 token 时，整个远端面失败关闭。
    let credentialRefFn
    const resolveFleetToken = async () => {
      // 1) 设置中的 secret 字段（界面可写，所有响应只写不回显）。liveGet 已经通过
      // `base` 层合并了环境变量 DSHIM_FLEET_TOKEN，默认引用名在此也已覆盖。
      const fromSettings = liveGet()[FLEET_TOKEN_FIELD]
      if (fromSettings) return fromSettings
      // 2) 凭证服务引用（DSHIM_FLEET_TOKEN_REF），按请求解析，轮换的 token 无需重启。
      const refName = process.env[ENV_FLEET_TOKEN_REF] || ENV_FLEET_TOKEN
      try {
        const creds = ctx.get('credentials')
        if (creds && typeof creds.resolve === 'function') {
          if (!credentialRefFn) {
            try { credentialRefFn = (await import('@deepseek-ai/dsh-credentials')).credentialRef } catch (e) { }
          }
          if (credentialRefFn) {
            const r = await creds.resolve(credentialRefFn(refName))
            if (r && typeof r.value === 'string' && r.value.length > 0) return r.value
          }
        }
      } catch (e) { /* 退回直接读取环境变量 */ }
      // 3) 以配置的引用名直接读取环境变量。
      const direct = process.env[refName]
      return direct && direct.length > 0 ? direct : undefined
    }
    // 非回环请求的逐请求 bearer 校验。回环流量不会到达这里，也不需要 token。
    const authorizeRemote = async (req) => {
      const expected = await resolveFleetToken()
      if (!expected) return false
      return safeTokenEqual(String(req.headers.authorization || ''), 'Bearer ' + expected)
    }

    // ---- 用户偏好 ----------------------------------------------------------
    // 浏览器侧持有可实时生效的值；宿主注册两个命名空间，让 harness 的设置文档持久化
    // 它们、渲染由 schema 驱动的表单，并让环境变量覆盖继续作为 composition `base`
    // 层生效。宿主自己只读取 fleet token（按请求）与 peers 列表（由监听驱动）；端口
    // 范围由下面的 startup 取值函数读取。
    //
    // settings 服务是可选依赖，和其他服务一样通过 ctx.inject 获取——只探测一次
    // `ctx.get('settings')` 会在激活竞争中落败，并静默丢掉命名空间。
    //
    // schemastery 优先从 harness 的目录树解析：开发时本检出以 junction 形式接入
    // profile，而 node 从模块的真实路径解析裸导入——该检出自身不携带依赖（`ws` 与
    // dsh-tools 也因此在 dsh bin 上用 createRequire 加载）。
    const loadSchemastery = () => {
      for (const from of [dshBin(), import.meta.url]) {
        if (!from) continue
        try {
          const mod = createRequire(from)('@deepseek-ai/schemastery')
          const z = mod && (mod.default || mod)
          if (z && typeof z.object === 'function') return z
        } catch (e) { /* 尝试下一个根 */ }
      }
      return null
    }
    // 已配置的对端，随设置命名空间实时更新（环境变量字符串是 `base` 层）。提升到
    // inject 块之前，下面的监听回调才能重新赋值；三个使用方——collectPeerFleets、
    // resolvePeerParam 与 FleetLinks 中枢——每次使用都读取它，因此一次提交只需重建
    // 中枢（见 mountFleet）。
    let peers = parsePeers(process.env.DSHIM_PEERS)
    // 生效 peers 字符串的原始指纹，设置监听据此忽略不改变列表的提交。
    let currentPeersRaw = process.env.DSHIM_PEERS || ''
    // 分节取值函数。两个来源，新的在前：
    //
    // 1. 插件自己的 config——从 0.1.7-rc.1 起，profile 条目持有插件配置（cordis 作为
    //    第二个参数交给 `apply`，编辑它会重启本 fiber，因此这条线上 peers 列表无需
    //    监听：apply 时会重新读取）。
    // 2. `settings.register(namespace, schema, …)`——0.1.7 之前的写法，0.1.7-rc.1 起
    //    该服务变成 SettingsForms（describe/update/replace/mutate），不再有 register。
    //
    // `startupGet` 是 applies:'restart' 的使用方：每次使用都读取，但所有者不监听，
    // 因此值只在重启之间变化。
    const entryConfig = config && typeof config === 'object' ? config : {}
    const configServes = [entryConfig.live, entryConfig.startup]
      .some((section) => section && typeof section === 'object' && Object.keys(section).length > 0)
    let liveGet = () => resolveLiveSection(entryConfig.live, process.env)
    let startupGet = () => resolveStartupSection(entryConfig.startup, process.env)
    // peers 从实际生效的分节开始，无论分节来自哪个来源：0.1.7 上是条目配置，更早的
    // 线路上是环境变量 base，直到下面的设置监听替换它。
    peers = parsePeers(liveGet()[PEERS_FIELD])
    currentPeersRaw = liveGet()[PEERS_FIELD] || ''
    if (typeof ctx.inject === 'function') {
      ctx.inject(['settings'], (settingsCtx) => {
        // 注册被拒时，register 辅助函数内部已降级到内存默认值；在这里警告一次，
        // 原因才不会消失。
        const warn = (message) => console.warn(message)
        const settings = settingsCtx && settingsCtx.settings
        // 没有 `register` 时上面的条目配置已经生效，强行注册只会记录一次虚假的失败。
        if (!settings || typeof settings.register !== 'function') return
        if (configServes) {
          warn('dsh-instance-manager: 该版本同时提供了插件配置与旧的设置服务，已以插件配置为准')
        }
        const live = registerLiveSettings({
          ctx: settingsCtx,
          z: loadSchemastery(),
          env: process.env,
          warn
        })
        liveGet = live.get
        // peers 可热更新：collectPeerFleets 与 resolvePeerParam 按请求读取变量，列表
        // 变化时重建 FleetLinks 中枢（下面的 mountFleet）。`watch` 异步调用回调
        // （按提交顺序逐个执行），因此本回调运行时下面的 peerCache/fleet/mountFleet
        // 一定已经初始化。
        if (live.registered && live.scope && typeof live.scope.watch === 'function') {
          live.scope.watch((next) => {
            const raw = next && typeof next === 'object' ? String(next[PEERS_FIELD] || '') : ''
            if (raw === currentPeersRaw) return
            currentPeersRaw = raw
            peers = parsePeers(raw)
            if (peerCache) peerCache.ts = 0
            mountFleet()
          })
        }
        const startup = registerStartupSettings({
          ctx: settingsCtx,
          z: loadSchemastery(),
          env: process.env,
          warn
        })
        startupGet = startup.get
      })
    }

    // ---- 崩溃黑匣子 --------------------------------------------------------
    // 本机服务器无声无息地死掉无法接受。stderr 落进没人查看的轮转文件（或进程由对端
    // 派生）时，node 默认的致命路径会静默消失。先把每条致命路径追加到同一个共享的
    // 追踪日志。实例共用该文件，用 pid+port 区分。绝不吞掉：即使问题不是本插件引起，
    // 证据也能说明是谁。
    //
    // 然后把退出权交回。harness 在任何插件挂载前安装了 unhandledRejection 处理器
    // （installFailLoud），该处理器会等待一次释放——释放插件树、刷写会话、恢复终端——
    // 最多 2 秒后退出。node 按注册顺序调用监听器，因此这里无条件调用 process.exit()
    // 会截断那次释放。仅在没有其他监听器时接管退出：裸启动仍快速失败，同时让 harness
    // 用自己熟悉的方式结束进程。
    // 这些日志只在罕见失败路径写入，没有其他轮转机制，因此设上限：超过上限保留较新的
    // 一半并继续。（launcher 持有的 server-<port>.out.log 刻意不在此处封顶——子进程
    // 握着该 fd，改名会让文件在写入方不知情时分叉。）
    const appendCapped = (file, line, maxBytes = 1024 * 1024) => {
      try {
        let size = 0
        try { size = fs.statSync(file).size } catch (e) { }
        if (size > maxBytes) {
          try {
            const prev = fs.readFileSync(file, 'utf8')
            fs.writeFileSync(file, prev.slice(Math.floor(prev.length / 2)))
          } catch (e) { return }
        }
        fs.appendFileSync(file, line)
      } catch (e) { /* 诊断绝不能让它所描述的事情失败 */ }
    }
    const crashLog = (kind, detail) => {
      try {
        const dir = path.join(dshHome(), 'launcher', 'logs')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        appendCapped(path.join(dir, 'dshim-crash.log'),
          '[' + new Date().toISOString() + '] ' + kind + ' pid=' + process.pid +
          ' port=' + currentPort() + '\n' + String(detail || '') + '\n')
      } catch (e) { /* 黑匣子自身不能再次抛出 */ }
    }
    const ownsFatalExit = (event) => process.listenerCount(event) <= 1
    const onUncaught = (err) => {
      crashLog('uncaughtException', err && err.stack ? err.stack : String(err))
      if (ownsFatalExit('uncaughtException')) process.exit(1)
    }
    const onRejection = (reason) => {
      crashLog('unhandledRejection', reason && reason.stack ? reason.stack : String(reason))
      if (ownsFatalExit('unhandledRejection')) process.exit(1)
    }
    process.on('uncaughtException', onUncaught)
    process.on('unhandledRejection', onRejection)

    // ---- 请求守卫（见 README「安全模型」）---------------------------------
    // 严格实例：仅供 SSE/events——EventSource 无法发送自定义头，因此即使在远端模式下，
    // 这个面也只允许回环访问。
    const guard = createGuard({ currentPort, respond: sendJson })
    // fleet 实例：容忍非回环 Host，由 API 处理器自己执行 bearer 检查（见
    // createGuard 的说明）。
    const fleetGuard = createGuard({ currentPort, respond: sendJson, allowRemoteHost: () => true })
    let connection = null
    let connectionSeen = false
    let connectionGeneration = 0

    // RC1 的 Connection 负责浏览器认证。旧的严格回环守卫只保留给更老的主机与私有的
    // 宿主间探测。
    if (typeof ctx.inject === 'function') {
      ctx.inject(['connection'], (connectionCtx) => {
        if (!connectionCtx.connection) return
        const mine = ++connectionGeneration
        connectionSeen = true
        connection = connectionCtx.connection
        if (typeof connectionCtx.on === 'function') {
          connectionCtx.on('dispose', () => {
            if (mine !== connectionGeneration) return
            connectionGeneration += 1
            connection = null
          })
        }
      })
    }
    // 判定顺序（Connection 抛错即 503，Connection 给出的 code 是最终结论，重载空档
    // 不退回守卫）本身就是安全属性，位于嵌入的 `dsh-host-http` 块中。两个取值函数都
    // 按请求读取，因为服务重载会重新赋值上面的两个闭包变量。
    const authorizeBrowser = createBrowserAuthorizer({
      getConnection: () => connection,
      getConnectionSeen: () => connectionSeen,
      guard
    })
    // 写操作只接受 POST，stop-self 也不例外：所有转发写操作的路径——stop、stop-all、
    // agent 工具——都通过 node:http 发 POST，GET 写操作没有受支持的发送方。
    //
    // 检查本身来自共享片段；只有措辞属于本插件，并保持已发布的形式：`code:
    // 'need_post'`、中文提示，以及回显被拒绝的 `action`——`lib/client.js` 正是用该
    // 字段渲染 `need_post`，去掉回显会让每个 405 变成一条不指明操作的提示。
    //
    // 片段按大小写不敏感地匹配方法，因此小写 `post` 也能通过。这是刻意保留的宽松
    // 读法：这个入口拒绝的是浏览器能自行发出的请求，而那类请求总是 `GET`。
    // `test/routes.test.js` 在真实路由上固定了最终判定。
    const requirePost = createRequirePost({
      respond: sendJson,
      policy: {
        method_not_allowed: { code: 'need_post', error: '{action} 需要 POST 请求', includeAction: true }
      }
    })

    // 本包的标准路由，也是它注册的唯一 API 路径：所有宿主间调用都访问这一条。
    const API_PATH = '/dsh-instance-manager/api'

    // 访问另一个本地实例的 JSON 请求。任何失败都解析为 null——这是所有调用点已经
    // 处理的形状，保持不变。
    //
    // 两类失败分别记录，因为“API 路径被其他服务占据”和“这里没有监听者”（过期的
    // 登记项，或已经离开的对端）是不同的发现，而被吞掉的失败不会留下痕迹。每类都
    // 用自己的细节说明自己：
    //
    //   body    — 有进程应答，但应答不是 JSON；细节带上字节数与 content-type，
    //             据此判断是谁在应答。
    //   request — 被拒绝、超时，或传输中途断开，用 socket 错误码标识。
    //
    // 发现扫描按设计会不断遇到关闭的端口，因此保持安静：只有已经预期得到应答的
    // 调用方才传 `expect: 'answered'`。
    //
    // `method` 让转发路径可以发 POST，也就是所有写操作要求的请求方法。
    const fetchJson = (port, query, timeoutMs, method, expect) => new Promise((resolve) => {
      let settled = false
      const done = (v) => { if (!settled) { settled = true; resolve(v) } }
      const fail = (kind, detail) => {
        if (expect === 'answered') {
          console.warn('dsh-instance-manager: ' + API_PATH + '?' + query + ' on :' +
            port + ' failed [' + kind + ']: ' + detail)
        }
        done(null)
      }
      const reason = (e) => String((e && e.code) || (e && e.message) || e)
      const req = http.get({ host: '127.0.0.1', port, path: API_PATH + '?' + query, timeout: timeoutMs, method: method || 'GET' }, (res) => {
        let body = ''
        res.on('data', (d) => {
          body += d
          if (body.length > 65536) req.destroy()
        })
        res.on('end', () => {
          try {
            done(JSON.parse(body))
          } catch (e) {
            // 响应正文本身不写日志——这里是别人写的任意内容。只记录长度与应答方的
            // content-type，而该头也由别人写入：去掉换行，保证一个事件一行，并限制
            // 长度。
            const ctype = String((res.headers && res.headers['content-type']) || 'none')
              .replace(/[\r\n]+/g, ' ').slice(0, 80)
            fail('body', reason(e) + ' — ' + body.length + ' bytes, content-type=' + ctype)
          }
        })
        res.on('error', (e) => fail('request', 'stream ' + reason(e)))
      })
      req.on('timeout', () => { req.destroy(); fail('request', 'no answer within ' + timeoutMs + 'ms') })
      req.on('error', (e) => fail('request', 'socket ' + reason(e)))
    })

    // 对不应答管理 API 的端口（旧版或非 dsh 监听者）做原始正文探测。无人应答时
    // 解析为 ''。
    const probeBody = (port) => new Promise((resolve) => {
      let settled = false
      const done = (v) => { if (!settled) { settled = true; resolve(v) } }
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
        let body = ''
        res.on('data', (d) => {
          body += d
          if (body.length > 16384) req.destroy()
        })
        res.on('end', () => done(body))
        res.on('error', () => done(''))
      })
      req.on('timeout', () => { req.destroy(); done('') })
      req.on('error', () => done(''))
    })

    // ---- 文件式实例登记 ---------------------------------------------------
    // 按设计尽力而为：心跳缺失、过期或不可读时，读取方退回端口扫描。
    const HEARTBEAT_MS = 10000
    const registryFile = () => {
      const port = currentPort()
      return port ? path.join(registryDir(dshHome()), port + '.json') : null
    }
    const writeHeartbeat = () => {
      const file = registryFile()
      if (!file) return
      try {
        const dir = registryDir(dshHome())
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(file, JSON.stringify({
          pid: process.pid,
          port: currentPort(),
          startedAt,
          version: VERSION,
          runtime: HOST_RUNTIME,
          launcher: launcherOf(),
          parentPid: parentPidOf(),
          // 只作分诊依据，不作为信任依据：从桌面面板启动的普通 web 实例同样带有
          // 它（继承了应用的 ELECTRON_RUN_AS_NODE），因此它从不决定某个实例能否
          // 被停止。
          electronNode: isElectronNode(),
          sessions: activeSessionCount(),
          rss: process.memoryUsage().rss,
          ts: Date.now()
        }))
      } catch (e) { /* 扫描仍能覆盖发现 */ }
    }
    const removeHeartbeat = () => {
      const file = registryFile()
      if (!file) return
      try { fs.rmSync(file, { force: true }) } catch (e) { }
    }
    writeHeartbeat()
    const heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_MS)
    if (heartbeatTimer.unref) heartbeatTimer.unref()

    // 每条以本进程退出收尾的路由都经过这里，因此这里是记录该事实的唯一位置。一次
    // 既没有崩溃日志也没有诊断报告的退出，与外部杀死无法区分，而“我刚启动另一个
    // 实例，面板实例就死了”这类报告需要一行答案，而不是一场进程取证。`trigger`
    // 说明调用方，绝不写它当时试图操作的端口。
    const noteSelfExit = (trigger) => {
      try {
        const dir = path.join(dshHome(), 'launcher', 'logs')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        appendCapped(path.join(dir, 'dshim-selfexit.log'),
          '[' + new Date().toISOString() + '] self-exit trigger=' + trigger +
          ' pid=' + process.pid + ' port=' + String(currentPort()) + '\n')
      } catch (e) { /* 诊断绝不能让它所描述的退出失败 */ }
    }

    // 自退出追踪记录的是触发者，它回答“这是崩溃还是请求”，但不回答“谁要求的”。
    // 写操作罕见、有意为之，对当前端口的 `stop` 更是进程离开前发生的最后一件事，
    // 因此在接受请求的时刻记录来源：socket 对端、放行它的准入路径，以及页面无法避免
    // 发送的浏览器/宿主元数据。
    //
    // 这个区分正是重点：面板点击是同源 POST，带有 Origin、Referer 与浏览器
    // User-Agent；脚本或其他进程则一个都不带。本文件是追踪记录，不是凭证库：
    // 从不读取 cookie 与 Authorization。
    const noteRequest = (action, req, detail) => {
      try {
        const headers = req.headers || {}
        const field = (name) => String(headers[name] == null ? '' : headers[name]).replace(/[\r\n]+/g, ' ').slice(0, 200)
        const dir = path.join(dshHome(), 'launcher', 'logs')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        appendCapped(path.join(dir, 'dshim-requests.log'),
          '[' + new Date().toISOString() + '] action=' + action +
          ' instance=' + String(currentPort()) +
          ' target=' + (detail.port === undefined || detail.port === null || detail.port === '' ? '-' : String(detail.port)) +
          ' via=' + String(detail.via || 'unknown') +
          ' peer=' + String((req.socket && req.socket.remoteAddress) || '-') +
          ' host=' + field('host') +
          ' origin=' + field('origin') +
          ' referer=' + field('referer') +
          ' ua=' + field('user-agent') +
          ' result=' + String(detail.result || 'accepted') + '\n')
      } catch (e) { /* 诊断绝不能让它所描述的操作失败 */ }
    }

    const scheduleSelfExit = (trigger) => {
      noteSelfExit(trigger === undefined ? 'unknown' : trigger)
      const fire = () => {
        const exit = ctx.get('appExit')
        if (exit) {
          // 走优雅路径：释放整个插件树（会话落盘，本插件的 disposer 删除登记
          // 文件）。harness 的关闭流程之后只设置 process.exitCode，依赖事件循环
          // 自然排空——残留的句柄可能让进程永远存活，因此强制退出作为兜底。
          exit(0)
          const t2 = ctx.get('timer')
          const hard = () => process.exit(0)
          if (t2) t2.timeout(hard, 3000)
          else setTimeout(hard, 3000)
        } else {
          removeHeartbeat()
          process.exit(0)
        }
      }
      const t = ctx.get('timer')
      if (t) t.timeout(fire, 300)
      else fire()
    }

    const tryConnect = (port, timeoutMs) => new Promise((resolve) => {
      const socket = new net.Socket()
      let settled = false
      const done = (v) => { if (!settled) { settled = true; socket.destroy(); resolve(v) } }
      socket.setTimeout(timeoutMs)
      socket.once('connect', () => done(true))
      socket.once('timeout', () => done(false))
      socket.once('error', () => done(false))
      socket.connect(port, '127.0.0.1')
    })

    // START 可以派生的位置。配置的第一个区间沿用 dsh 文档约定的 3080-3129，但运行时
    // 没有硬编码它（webserver 的端口来自 composition 配置，甚至接受 0 表示系统分配）
    // ——启动区间与扫描区间都可以通过 startup 设置命名空间调整（环境变量
    // DSHIM_PORT_RANGE 仍是 `base` 层）。发现还会扫描配置中的其余区间与每个心跳已知
    // 端口，因此远离启动区间的实例也能出现。applies:'restart'：每次使用都读取，但
    // 所有者不监听，值实际上在构造时固定。
    const portRange = () => parsePortSpec(startupGet()[PORT_RANGE_FIELD])

    // 只有真正能创建监听器的端口才算空闲。连接探测回答的是“现在有东西占用”，这是
    // 另一个问题：扫描报告空闲的端口仍可能拒绝子进程绑定（上一次尝试的监听器可能
    // 尚未结算），子进程随后在确认窗口内以 EADDRINUSE 退出。
    //
    // 探测绑定后立即释放，并等待 socket 关闭而不只是绑定回调——否则端口可能在本探测
    // 仍持有监听器时被交给子进程。
    const canBindPort = (port) => new Promise((resolve) => {
      const srv = net.createServer()
      let settled = false
      let timer = null
      // 每条路径都释放探测自己的监听器，交给子进程的端口不会是本探测仍持有的那个。
      const finish = (value) => {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        try { srv.close() } catch (e) { /* 未在监听：没有需要释放的资源 */ }
        resolve(value)
      }
      srv.once('error', () => finish(false))
      srv.listen(port, '127.0.0.1', () => finish(true))
      // 未设超时的监听器会让选取器挂起，这里的定时器提供上限；unref 保证它不会拖住
      // 宿主进程。
      timer = setTimeout(() => finish(false), 1500)
      if (timer.unref) timer.unref()
    })

    const findFreePort = async (exclude) => {
      // START 只从第一个区间取端口：其余区间只用于扫描，把桌面宿主自己的端口交给
      // 子进程会让两者在下次桌面启动时冲突。
      const spec = portRange()
      return pickStartPort({
        range: { min: spec.min, max: spec.max },
        exclude,
        available: async (p) => !(await tryConnect(p, 600)) && (await canBindPort(p))
      })
    }

    // 两个文件句柄要么都打开，要么都不打开：第二个打开失败时关闭第一个；这里的所有
    // 失败都发生在派生之前。
    const openLaunchLogs = (logDir, port) => {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
      const file = (stream) => path.join(logDir, 'server-' + port + '.' + stream + '.log')
      const out = fs.openSync(file('out'), 'a')
      try {
        return { out, err: fs.openSync(file('err'), 'a') }
      } catch (e) {
        try { fs.closeSync(out) } catch (closeErr) { }
        throw e
      }
    }

    // ---- 共用的操作面（HTTP 面板 + agent 工具）---------------------------
    // 派生一个脱离的、隐藏窗口的服务子进程，并等到它应答 action=self：调用方因此
    // 拿到真实 pid，也能看到失败，而不是一次静默的空操作。子进程提前退出（在扫描与
    // 绑定之间输掉竞争）只会代价一次在下一个空闲端口上的重试；只是启动慢则报告
    // start_unconfirmed 并保持原样，绝不重复派生。
    //
    // 确认窗口刻意宽松：同机实例第一次启动要做一次性重活（profile 插件回填会话日志
    // 很容易超过十秒），把它报告为失败正是“启动崩溃了，重试又好了”的错误结论。在
    // RC1 上，面板触发的启动会打开一次性 token URL，新标签页据此取得签名的 Connection
    // cookie。agent 触发的启动加 --no-open，保持无头。桌面宿主完全不交接：没有浏览器
    // 标签页可以接收新实例，应用自己的窗口也不是那个标签页。
    const START_CONFIRM_MS = 25000
    const launchOnce = async ({ browserHandoff = false, port: requestedPort, excludePort } = {}) => {
      // 未指定端口时保留原行为：启动区间内第一个空闲端口。指定端口则严格照办——那是
      // 调用方明确表达的意图，因此要校验并探测，而不是悄悄换成其他空闲端口。
      let port
      if (requestedPort === undefined) {
        // `exclude` 是上一次尝试失败的端口：第二次启动只在别处才有意义，因此选取器
        // 在探测之上显式跳过它。
        port = await findFreePort(excludePort)
        if (!port) {
          const range = portRange()
          return { ok: false, code: 'no_free_port', error: range.min + '–' + range.max + ' 端口全部被占用' }
        }
      } else {
        port = requestedPort
        if (await tryConnect(port, 600)) {
          return { ok: false, code: 'port_in_use', port, error: '端口 ' + port + ' 已被占用，请换一个端口或留空自动选择' }
        }
      }
      // 检测到 tmux / screen 时，启动交给持久化会话：实例不再挂在面板宿主或发起
      // 点击的终端下。某个工具建会话失败时试下一个；全部失败才退回直接派生（旧的
      // 行为），因此安装了会话工具但没有可用守护进程的机器仍然能启动。
      for (const tool of sessionTools()) {
        const attempt = await launchInSession({ tool, port, browserHandoff })
        if (attempt && attempt.sessionFailed) continue
        return attempt
      }
      // 直接派生同样优先用 PATH 上的 `dsh web`：profile 里没有 dsh 副本、argv1 也不是
      // bin.js 的全局安装只需要这一条就能启动。
      const cli = dshCli()
      const bin = cli || dshBin()
      if (!bin) {
        const detail = path.join(dshHome(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        return { ok: false, code: 'no_dsh_bin', detail, error: '未找到 dsh 启动器：PATH 中没有 dsh，也没有 ' + detail }
      }
      // 实际运行的是哪个启动器从外部看不出来，桌面宿主上 resolveDshBin 还可能解析到
      // 与应用自带检出不同的检出，因此在这里读取版本并随结果一起上报。
      const binVersion = cli ? cliVersion(cli) : dshBinVersion(bin, (f) => fs.readFileSync(f, 'utf8'))
      const logDir = path.join(dshHome(), 'launcher', 'logs')
      // 日志是追加写入的：这次启动之前已有的字节属于该端口上的上一代进程，交接时
      // 不能把那里的 token 交给浏览器。
      const logSince = logSize(path.join(logDir, 'server-' + port + '.out.log'))
      const used = { bin, binVersion, logSince }
      // 只读的 $DSH_HOME 只应让这次启动失败，绝不应让面板失败：登记文件写不进去时
      // 本插件已经降级为进程级 fleet id，日志目录不可用属于同一类失败，因此用其他
      // 启动失败相同的词汇回答。
      let logs
      try {
        logs = openLaunchLogs(logDir, port)
      } catch (e) {
        return { ok: false, code: 'start_failed', port, error: '无法准备实例日志：' + (e && e.message ? e.message : String(e)) }
      }
      const out = logs.out
      const errF = logs.err
      // 每个由面板派生的子进程都带诊断用 node 参数：--trace-exit 为任何
      // process.exit() 打印调用栈，--report-uncaught-exception 在崩溃黑匣子旁写下完整
      // 诊断报告，严格拒绝让默认行为显式化。
      // 注意参数名是 --report-uncaught-exception（没有 "on"）；旧的
      // --report-on-uncaught-exception 在 Node 20 及以上是 "bad option"，会让子进程
      // 立刻以退出码 9 结束。
      // 桌面宿主用自己的（Electron）可执行文件派生子进程，因此显式设置
      // ELECTRON_RUN_AS_NODE，并告知子进程是哪个宿主启动了它。
      const spawnEnv = buildSpawnEnv(process.env, { runtime: HOST_RUNTIME, parentPid: process.pid })
      let child
      try {
        child = spawn(cli || process.execPath,
          cli
            ? buildDshWebArgs(port, { browserHandoff: browserHandoff && !isDesktopHost })
            : buildDshLaunchArgs(bin, port, { browserHandoff: browserHandoff && !isDesktopHost }), {
          cwd: dshHome(),
          detached: true,
          env: spawnEnv,
          stdio: ['ignore', out, errF],
          windowsHide: true
        })
      } catch (e) {
        // spawn() 本身抛出（坏的 fd、错误的参数）：什么都没启动，因此关闭刚打开的
        // 日志句柄，按其他启动失败上报，而不是让它变成 500。
        fs.closeSync(out)
        fs.closeSync(errF)
        return { ok: false, code: 'start_failed', port, error: '无法启动新实例：' + (e && e.message ? e.message : String(e)) }
      }
      child.unref()
      fs.closeSync(out)
      fs.closeSync(errF)
      const pid = child.pid
      // awaitChild 接管子进程的 'error' 事件：未能启动的 ChildProcess 只发 'error'
      // 不发 'exit'，而没有监听器的 'error' 会让进程退出（见 shared.awaitChild）。
      const verdict = await awaitChild({
        child,
        confirmMs: START_CONFIRM_MS,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        probe: async () => {
          const self = await fetchJson(port, 'action=self', 1500)
          return !!(self && typeof self.pid === 'number')
        }
      })
      if (verdict && verdict.ready) return { ok: true, port, pid, ...used }
      if (verdict && verdict.died) {
        // 事后追查用的追踪记录：子进程自己的 stderr 是空的，因此记录是谁发现它退出、
        // 退出码是多少。
        try {
          fs.appendFileSync(path.join(logDir, 'server-' + port + '.out.log'),
            '[dsh-instance-manager] child exited during confirm window (code ' + verdict.code + ')\n')
        } catch (e) { }
        return { ok: false, code: 'start_failed', port, error: '新实例进程已退出（端口可能被抢占或启动失败）' }
      }
      return { ok: false, code: 'start_unconfirmed', port, pid, ...used, error: '实例仍在启动中、未能在窗口内应答，请稍后刷新列表确认' }
    }
    const startWithRetry = (options) => startOnceOrRetry(launchOnce, options)

    // `stop` 的远端半边：转发 stop-self，让目标通过自己的优雅路径关闭。停止自己仍由
    // 各调用方分别处理（HTTP 操作安排 appExit；agent 工具拒绝）。转发目标是面板列为
    // 存活的实例，因此失败的跳转是一个发现：expect 'answered'。
    const forwardStopRemote = async (port) => fetchJson(port, 'action=stop-self', 8000, 'POST', 'answered')

    // 桌面宿主永远不是停止目标，即使从它自己的面板操作：它是桌面窗口唯一的后端，应用
    // 把任何宿主退出都视为失败，停止它会让窗口进入无法恢复的错误状态。哪个进程是桌面
    // 宿主只能从目标自己的应答得知（端口号说明不了），当前实例则无需探测。不应答的
    // 目标不会被假定为桌面宿主：它继续走转发，并报告 stop_unconfirmed。
    const DESKTOP_STOP_REFUSED = '桌面宿主不会被停止：停止它会让桌面窗口失去后端'
    const isDesktopTarget = async (port) => {
      if (port === currentPort()) return isDesktopHost
      const self = await fetchJson(port, 'action=self', 1500)
      return !!(self && self.runtime === 'desktop')
    }
    const desktopRefusal = (via, req, port, action) => {
      noteRequest(action, req, { via, port, result: 'desktop-refused' })
      return { ok: false, code: 'stop_desktop_refused', error: DESKTOP_STOP_REFUSED }
    }

    // ---- 原地重启 ---------------------------------------------------------
    // 版本差异徽标已经在提示混版，但用户唯一的动作是手动 stop + start 两步。这里把它
    // 合成一步，并且在**同一个端口**上重启：换端口等于换了一个实例，用户打开的标签页、
    // 收藏的地址与 `dsh instance list` 里的行都会指向别的进程。
    //
    // 顺序与三处既有确认逻辑都复用：转发 stop（forwardStopRemote，让目标经自己的
    // appExit 优雅退出、会话落盘）→ 轮询等端口真正空出来 → 同端口启动（startWithRetry
    // 的 launchOnce，它已经派生子进程并等到 action=self 应答）。
    //
    // stop 与 start 之间端口是空的，这是本次操作的真实性质而不是缺陷：窗口期内被别的
    // 进程抢占就在 `launchOnce` 里返回 port_in_use，如实上报，绝不静默换口。
    const PORT_RELEASE_MS = 15000
    const restartPort = async (port, { browserHandoff }) => {
      const stopped = await forwardStopRemote(port)
      if (!(stopped && stopped.ok)) {
        return { ok: false, code: 'stop_unconfirmed', port, error: '目标实例没有确认停止，未能开始重启（未挂载本管理面板或不可达）' }
      }
      const free = await awaitPortFree({
        port,
        available: canBindPort,
        timeoutMs: PORT_RELEASE_MS,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms))
      })
      if (!free) {
        return {
          ok: false,
          code: 'port_still_in_use',
          port,
          error: '停止后端口 ' + port + ' 在 ' + (PORT_RELEASE_MS / 1000) + ' 秒内仍未释放，未启动新实例'
        }
      }
      // 显式给出端口：`launchOnce` 因此不会挑选其他端口，也不会自动换口重试。
      return Object.assign({ restarted: true }, await startWithRetry({ browserHandoff, port }))
    }

    // 某个端口共享启动器日志的有界尾部（面板与 agent 工具共用）。即使每个调用方都
    // 已归一化，这里仍重新校验：`port` 会进入文件名，这是用受攻击者影响的输入构造
    // 路径前的最后一道关卡。
    const readLogsFor = (port, stream) => {
      const p = normalizePort(port)
      if (p === null) return { exists: false, truncated: false, lines: [] }
      try {
        return tailFile(path.join(dshHome(), 'launcher', 'logs', 'server-' + p + '.' + stream + '.log'))
      } catch (e) {
        return { exists: false, truncated: false, lines: [] }
      }
    }

    // 同一端口的启动日志是追加的：每个进程各留一行 token 公告，重启用同一个端口后
    // 上一代进程的那一行还在文件里。所有读取都要能说出“从哪个字节起算”，因此先记下
    // 本次启动之前的文件长度。
    const LAUNCH_LOG_TAIL_BYTES = 262144

    const logSize = (file) => {
      try { return fs.statSync(file).size } catch (e) { return 0 }
    }

    // `since` 之后写入的行。仍有界：尾部最多 LAST_LAUNCH_LOG_BYTES，起步位置不会退到
    // `since` 之前。
    const readLogLinesSince = (port, since) => {
      const p = normalizePort(port)
      if (p === null) return []
      const file = path.join(dshHome(), 'launcher', 'logs', 'server-' + p + '.out.log')
      try {
        const size = fs.statSync(file).size
        const floor = Number.isFinite(since) && since > 0 ? Math.min(since, size) : 0
        const length = Math.min(size - floor, LAUNCH_LOG_TAIL_BYTES)
        if (length <= 0) return []
        const buf = Buffer.alloc(length)
        const fd = fs.openSync(file, 'r')
        try { fs.readSync(fd, buf, 0, length, size - length) } finally { fs.closeSync(fd) }
        const lines = buf.toString('utf8').split('\n')
        // 起点落在行中间时第一段是半行，丢掉它，而不是解析半个 URL。
        if (size - length > floor) lines.shift()
        return lines
      } catch (e) {
        return []
      }
    }

    // 目标实例根 URL 要求的启动 token。DSH 按进程持有它，每次重启都会轮换，因此只有
    // 这一个进程写下的一行能用：更早的 token 在格式上完全合法，交给浏览器后却是 401。
    //
    // `since` 是本次启动之前该日志的字节数；交接时只接受此后写入的行；不传它则退回
    // “最后一条公告”，那是同一个进程刚刚启动后的情形，也是替不由本面板启动的实例
    // 打开界面时唯一可用的依据。
    //
    // 这里解析该行而不是做字符串匹配，格式变化会退化成“没有 token”，而不是跳转到
    // 非预期位置；主机名、端口与路径还会跟请求中的端口重新核对。
    const launchTokenFor = (port, since = 0) => {
      const lines = readLogLinesSince(port, since)
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = /^dsh web:\s+(\S+)/.exec(String(lines[i]).trim())
        if (!m) continue
        let url
        try { url = new URL(m[1]) } catch (e) { continue }
        const token = url.searchParams.get('token')
        if (url.protocol !== 'http:' || !isLoopbackName(url.hostname)) continue
        if (url.port !== String(port) || url.pathname !== '/' || !token) continue
        return token
      }
      return null
    }

    const sendLaunchTokenUnavailable = (res) => sendJson(res, 409, {
      ok: false,
      code: 'launch_token_unavailable',
      error: '该实例的启动 token 不可得：它不由本机 launcher 启动，或日志已轮转。请使用 dsh web 启动时打印的 URL。'
    })

    // 一枚 token 只有目标实例当前这一代进程接受才算数。DSH 对正确的 token 回 303 与
    // cookie，对上一代进程的 token 回 401，因此用一次回环请求判定；正文一律丢弃。
    const tokenAccepted = (port, token) => new Promise((resolve) => {
      let settled = false
      const done = (v) => { if (!settled) { settled = true; resolve(v) } }
      const req = http.get({
        host: '127.0.0.1',
        port,
        path: '/?token=' + encodeURIComponent(token),
        timeout: 1500
      }, (res) => {
        res.resume()
        done(res.statusCode >= 200 && res.statusCode < 400)
      })
      req.on('timeout', () => { req.destroy(); done(false) })
      req.on('error', () => done(false))
    })

    // 窗口内等一枚被接受的 token：替代实例先应答 action=self、再打印 token 行是可能
    // 的，就绪探测与日志写入没有顺序保证。窗口为 0 时只判一次。
    const resolveToken = async (port, { since = 0, windowMs = 0 } = {}) => {
      const deadline = Date.now() + windowMs
      for (;;) {
        const token = launchTokenFor(port, since)
        if (token !== null && await tokenAccepted(port, token)) return token
        if (Date.now() >= deadline) return null
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    // 该实例的应用根地址。使用相对请求的地址而不是回环字面量：面板本身通过受信 LAN
    // 地址访问时，重定向保持同源；端口是面板为这一行服务的端口。
    const redirectToInstance = (res, port) => {
      const token = launchTokenFor(port)
      if (token === null) {
        sendLaunchTokenUnavailable(res)
        return
      }
      // 用 303 让浏览器以 GET 跟随。token 只出现在这个响应头里，DSH 会把它换成
      // cookie 后重定向到干净的 `/`，因此不会留在用户最终停留的地址中。
      res.writeHead(303, {
        location: '/?token=' + encodeURIComponent(token),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      })
      res.end()
    }

    // 同一目标的绝对回环地址。桌面窗口需要这种形式：它自己的源（dsh-app://app）
    // 对其他任何目标都会被应用外壳拒绝，相对 URL 因此解析成一次外壳拒绝的导航；
    // 显式的 http:// 回环地址会被交给系统浏览器。`redirectToInstance` 刻意保留相对
    // 形式，让通过受信 LAN 地址访问的面板保持同源重定向。
    const absoluteTokenUrl = (port) => {
      const token = launchTokenFor(port)
      return token === null ? null : 'http://127.0.0.1:' + port + '/?token=' + encodeURIComponent(token)
    }

    // 交接地址的主机名部分：沿用浏览器访问面板时用的那个（回环或受信 LAN 名），只把
    // 端口换成替代实例的——面板经 LAN 地址打开时，回环字面量在浏览器里根本不是同一
    // 台机器。Host 缺失或不可解析时退回回环字面量。
    const handoffHost = (req, port) => {
      let host = ''
      try {
        host = new URL('http://' + String((req && req.headers && req.headers.host) || '')).hostname
      } catch (e) {
        host = ''
      }
      if (!host) return '127.0.0.1:' + port
      return (host.indexOf(':') === -1 ? host : '[' + host + ']') + ':' + port
    }

    // 交接只接受替代实例这一次启动写下的 token，并且要求它此刻能用：浏览器一旦跳过去
    // 就没有回头路，失败会把它留在一张 401 页面上，而旧实例已经开始退出。
    const handoffUrl = async (req, port, since) => {
      const token = await resolveToken(port, { since, windowMs: 5000 })
      if (token === null) return null
      return 'http://' + handoffHost(req, port) + '/?token=' + encodeURIComponent(token)
    }

    // ---- 跨实例会话摘要 ---------------------------------------------------
    // 会话标题来自 `ctx.sessionTitle`，它是一个可选服务，因此这里刻意不在 `inject` 里
    // 声明它：写进 inject 会让没有该服务的组合停在 PENDING，宿主启动审计把那算作失败，
    // 连带把面板拖下去——与上面 `tools` 服务的那段注释是同一条理由。因此每次读取时
    // 探测一次，缺失就返回 undefined。
    //
    // `get(session)` 返回折叠后的最新快照，标题在 `title`；还没有合格输入时是
    // undefined，投影因此省略该键而不是写 null。取值函数抛出的降级由
    // shared.summarizeSessions 统一承担，这里不再重复一层。
    const titleOfSession = (session) => {
      const titles = ctx.get('sessionTitle')
      if (!titles || typeof titles.get !== 'function') return undefined
      const snapshot = titles.get(session)
      return snapshot && typeof snapshot.title === 'string' ? snapshot.title : undefined
    }

    // 本实例活跃会话的纯标量投影（见 shared.summarizeSessions——绝不整体序列化
    // 实时 store 对象）。对端通过私有的 action=probe-sessions 端点访问它，与
    // stop-self 类似，不对外暴露面向浏览器的 sessions 操作。
    const describeSessions = () => {
      let list = []
      try {
        const store = ctx.get('sessions')
        list = store ? store.list() : []
      } catch (e) { list = [] }
      return {
        ok: true,
        port: currentPort(),
        total: Array.isArray(list) ? list.length : 0,
        sessions: summarizeSessions(list, 20, { titleOf: titleOfSession })
      }
    }
    // 本机、本地端口转发或 peer 链路：面板、agent 工具与链路自己的 answerQuery
    // 共用一条路径。
    const fleetQuery = async (peer, query, timeoutMs) => {
      if (!fleet) return { ok: false, code: 'fleet_disabled' }
      return fleet.queryPeer(peer, query, timeoutMs)
    }
    // 对 sessions 而言 `port` 可以缺失（表示“本实例”），但调用方实际给出的值必须是
    // 真实端口——否则一个笔误会静默地应答成另一个实例。对 logs 则绝不允许缺失：
    // 没有目标的日志读取没有定义。
    const sessionsFor = async (port, peer) => {
      const empty = port === undefined || port === null || port === ''
      const p = empty ? null : normalizePort(port)
      if (!empty && p === null) return { ok: false, code: 'no_port', error: 'invalid port' }
      if (peer) {
        const r = await fleetQuery(peer, { kind: 'sessions', port: p || undefined }, 5000)
        return r && r.ok ? Object.assign({}, r, { peer })
          : { ok: false, code: 'sessions_unavailable', error: 'peer 未提供会话概要（离线或版本过旧）' }
      }
      if (!p || p === currentPort()) return describeSessions()
      // 端口是调用方指定的，因此没有应答是一个发现，而不是扫描时预期中的安静。
      // 下面针对 probe-sessions 之前版本的兜底保持不记录：上面一行已经说明该端口
      // 没有应答，每次读取会重复两次。
      let r = await fetchJson(p, 'action=probe-sessions', 5000, undefined, 'answered')
      // 滚动升级：更早的插件版本只认识 action=sessions。
      if (r && r.code === 'unknown_action') r = await fetchJson(p, 'action=sessions', 5000)
      if (r && r.ok) return Object.assign({}, r, { port: p })
      return { ok: false, code: 'sessions_unavailable', error: '目标实例未提供会话概要（旧版面板或不可达）' }
    }
    const logsFor = async (port, stream, peer) => {
      const p = normalizePort(port)
      if (p === null) return { ok: false, code: 'no_port', error: 'invalid port' }
      const st = stream === 'err' ? 'err' : 'out'
      if (peer) {
        const r = await fleetQuery(peer, { kind: 'logs', port: p, stream: st }, 5000)
        return r && r.ok ? Object.assign({}, r, { peer })
          : { ok: false, code: 'logs_unavailable', error: 'peer 未提供日志（离线或版本过旧）' }
      }
      return Object.assign({ ok: true, port: p, stream: st }, readLogsFor(p, st))
    }

    // 崩溃黑匣子、自退出追踪与写操作追踪此前只有写入路径，没有任何读取路径：实例静默
    // 消失时，这三份共享文件就是全部证据，而唯一的查法是到磁盘上翻。诊断面把它们按
    // 实例归属读出来。
    //
    // 只走本地回环（用 guard 而不是 fleetGuard），也不做任何 fleet 转发：写操作追踪
    // 每行含对端地址与请求携带的 User-Agent，README 的安全章明确写了 Cookie 与
    // Authorization 既不读取也不写入，这个面不能把它送到 fleet 链路上。请求日志因此
    // 不接受 peer 参数——经过校验的本地端口就足以定位写它的那个实例。
    //
    // 归属判定与写入方一致：崩溃与自退出按 pid（实例身份），写操作按实例端口（记录
    // 行首的 `instance=`，即被写入行的端口，也就是正在服务本面板的那个实例）。
    //
    // pid 由调用方给出并在此校验：目标实例此刻多半已经不再应答（那正是要查它的
    // 原因），因此不能靠探测 `action=self` 反推——而实例列表本来就已经带着这个 pid。
    // 缺失或不合法时不筛选，返回整份共享文件：那正是没有选出实例时能拿到的全部。
    const diagnosticTail = (file, lines) => {
      const raw = tailFile(path.join(dshHome(), 'launcher', 'logs', file))
      return { exists: raw.exists, truncated: raw.truncated, lines: lines(raw.lines) }
    }
    const normalizePid = (raw) => {
      const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN)
      return Number.isSafeInteger(n) && n > 0 ? n : null
    }
    const diagnosticsFor = (port, rawPid) => {
      const p = normalizePort(port)
      if (p === null) return { ok: false, code: 'no_port', error: 'invalid port' }
      const pid = normalizePid(rawPid)
      return {
        ok: true,
        port: p,
        pid,
        crash: diagnosticTail('dshim-crash.log', (lines) => selectCrashRecords(lines, pid)),
        selfExit: diagnosticTail('dshim-selfexit.log', (lines) => selectSelfExitLines(lines, pid)),
        requests: diagnosticTail('dshim-requests.log', (lines) => selectRequestLines(lines, p))
      }
    }

    // $DSH_HOME/run/instances 下新鲜的心跳声明。撕裂写入与垃圾文件无法通过校验，
    // 会被忽略——扫描会重新覆盖它们。
    const readFreshRegistry = () => {
      const dir = registryDir(dshHome())
      let names
      try { names = fs.readdirSync(dir) } catch (e) { return [] }
      const now = Date.now()
      const entries = []
      for (const name of names) {
        if (!/^\d+\.json$/.test(name)) continue
        try {
          const entry = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
          if (isValidRegistryEntry(entry, now)) entries.push(entry)
        } catch (e) { }
      }
      return entries
    }

    // 先信任再验证：登记声明只有在目标应答 action=self 后才成为一行。心跳只由本
    // 版本写入，因此该声明已经保证那里提供标准路由。
    const verifyRegistryEntry = async (entry) => {
      const self = await fetchJson(entry.port, 'action=self', 1500)
      if (self && typeof self.pid === 'number' && typeof self.port === 'number') return self
      return null
    }

    const describeSelf = (self, port, selfPort) => ({
      port,
      pid: self.pid,
      // 列出进程自己的可执行文件名（同一次列表的每一行都相同），不是被列实例的：
      // 这里无法询问目标它的可执行文件叫什么，桌面宿主上报的是本应用的可执行文件。
      // 需要逐实例身份的调用方应使用 `runtime` 或该行自己的 pid/version。
      name: path.basename(process.execPath),
      ui: true,
      managed: true,
      current: port === selfPort,
      // 桌面端是肯定性上报，绝不靠推断：不应答 `runtime` 的目标按 'node' 处理。本机
      // 端口是例外——本进程确切知道自己的运行时，因此目标应答缺少该字段时当前行
      // 仍保留桌面端标记。
      runtime: port === selfPort ? HOST_RUNTIME : (self.runtime === 'desktop' ? 'desktop' : 'node'),
      startedAt: typeof self.startedAt === 'number' ? self.startedAt : null,
      sessions: typeof self.sessions === 'number' ? self.sessions : null,
      rss: typeof self.rss === 'number' ? self.rss : null,
      version: typeof self.version === 'string' ? self.version : null,
      url: 'http://127.0.0.1:' + port + '/'
    })

    // 仅本机行——来自扫描与登记文件，绝不包含对端表。
    //
    // 这是 FLEET 链路应答时使用的列表器。面板与 agent 工具需要下面的合并视图；
    // 对端询问本机 fleet 时必须得到一份自身不会再去询问任何人的列表，否则互相
    // peer 的两个实例会无休止地应答彼此。
    const listLocalInstances = async () => {
      const selfPort = currentPort()
      // 登记优先：每个新鲜心跳覆盖自己的端口，无需盲目探测；未覆盖的端口走下面的
      // 完整发现。固定扫描区间之外的心跳端口（用 --port 4000 手工启动的实例）加入
      // 扫描而不是被丢弃——登记项按 1-65535 校验正是为此。
      const covered = new Map(readFreshRegistry().map((e) => [e.port, e]))
      const range = portRange()
      const ports = unionPorts(range.min, range.max, [...range.extra, ...covered.keys()])
      const results = await Promise.all(ports.map(async (port) => {
        if (covered.has(port)) {
          const verified = await verifyRegistryEntry(covered.get(port))
          if (verified) return describeSelf(verified, port, selfPort)
          // 过期的心跳声明（心跳之间被强杀）：继续走探测。
        }
        const self = await fetchJson(port, 'action=self', 2500)
        if (self && typeof self.pid === 'number' && typeof self.port === 'number') {
          return describeSelf(self, port, selfPort)
        }
        const body = await probeBody(port)
        // 每个 dsh web 首页都带有注入的启动清单标记——它比可见的品牌字符串稳定
        // 得多，后者作为非常旧版本的兜底保留。任一标记只能证明目标是 dsh web
        // 页面，因此该行按未托管上报；从未应答 `action=self` 的目标无法说明自己的
        // 运行时。
        if (body.indexOf('__DSH_BOOT__') !== -1 || body.indexOf('DeepSeek Harness') !== -1) {
          return {
            port,
            pid: null,
            name: '',
            ui: true,
            managed: false,
            current: false,
            url: 'http://127.0.0.1:' + port + '/'
          }
        }
        if (body.length > 0) {
          return {
            port,
            pid: null,
            name: '',
            ui: false,
            managed: false,
            current: false,
            url: 'http://127.0.0.1:' + port + '/'
          }
        }
        return null
      }))
      return {
        items: orderInstances(results.filter(Boolean)),
        currentPort: selfPort,
        selfVersion: VERSION,
        selfSession: sessionToolName(),
        peers: {},
        error: null
      }
    }

    // 面板 / agent 视图：本机行加上 peer fleet（缓存至少 2 秒；每个对端 3.5 秒
    // 预算）。远端行保留自己的端口用于展示，但打上 peer id 并改写为对端来源的 URL；
    // 控制操作仍只作用于本机行。
    //
    // `orderInstances` 作用于合并后的列表，而不是各自的一半：当前实例优先的规则只有
    // 在行可以跨越本机/远端边界时才成立，把两个已排序的一半直接拼接，当前行只有在
    // 恰好位于前半部分时才会排第一。
    const listInstances = async () => {
      const local = await listLocalInstances()
      const peerFleets = await collectPeerFleets()
      return {
        items: orderInstances(local.items.concat(peerFleets.rows)),
        currentPort: local.currentPort,
        selfVersion: VERSION,
        selfSession: local.selfSession,
        peers: peerFleets.status,
        error: null
      }
    }

    // ---- fleet 对端链路 ---------------------------------------------------
    // 对端显式配置：设置中的 `peers` 字段使用与 DSHIM_PEERS 环境变量相同的字符串
    // 格式（"id@origin,id2@origin"，仍是 `base` 层）。链路通道
    // （/dsh-instance-manager/link）始终要求 fleet bearer——未配置 token 时失败
    // 关闭——`ws` 通过与 dsh-tools 相同的双路径加载（先找包，再找运行中 dsh 检出
    // 自己的依赖树）。`peers` 本身是提升的、由设置监听更新的变量。
    let wsLib
    const resolveWsLib = async () => {
      if (wsLib) return wsLib
      try {
        const m = await import('ws')
        wsLib = m.WebSocketServer ? m : (m.default || null)
        if (wsLib) return wsLib
      } catch (e) { }
      const bin = dshBin()
      if (bin) {
        try {
          wsLib = createRequire(bin)('ws')
          if (wsLib && !wsLib.WebSocketServer && wsLib.default) wsLib = wsLib.default
        } catch (e) { }
      }
      return wsLib
    }
    // 释放操作会与下面异步加载 `ws` 竞争：模块可能在本插件被拆除之后才解析完成
    // （快速关闭，或实例在 import 完成前停止），此时创建的中枢会活过插件，且没有
    // 任何对象负责释放它。
    let fleet = null
    let fleetDisposed = false
    const peerCache = { ts: 0, rows: [], status: {} }
    const collectPeerFleets = async () => {
      if (!peers.length) return { rows: [], status: {} }
      if (Date.now() - peerCache.ts < 2000) return peerCache
      if (!fleet) return { rows: [], status: Object.fromEntries(peers.map((p) => [p.id, 'offline'])) }
      const settled = await Promise.allSettled(peers.map((p) =>
        fleet.queryPeer(p.id, { kind: 'fleet' }, 3500).then((r) => ({ p, r }))))
      const rows = []
      const status = {}
      for (const s of settled) {
        if (!s || s.status !== 'fulfilled') continue
        const { p, r } = s.value
        if (r && r.ok && Array.isArray(r.items)) {
          status[p.id] = 'online'
          let host = p.origin
          try { host = new URL(p.origin).host } catch (e) { }
          for (const it of r.items) {
            rows.push({
              port: it.port,
              managed: it.managed !== false,
              current: false,
              url: 'http://' + host + ':' + it.port + '/',
              source: p.id,
              remote: true,
              version: typeof it.version === 'string' ? it.version : undefined,
              sessions: typeof it.sessions === 'number' ? it.sessions : undefined,
              rss: typeof it.rss === 'number' ? it.rss : undefined,
              startedAt: typeof it.startedAt === 'number' ? it.startedAt : undefined,
              pid: typeof it.pid === 'number' ? it.pid : undefined
            })
          }
        } else {
          status[p.id] = (r && r.code) || 'unreachable'
        }
      }
      peerCache.ts = Date.now()
      peerCache.rows = rows
      peerCache.status = status
      return peerCache
    }
    const fleetUpgrade = {
      path: LINK_PATH,
      handler: (req, socket, head) => {
        if (!fleet) {
          try { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 9\r\n\r\nforbidden') } catch (e) { }
          return
        }
        fleet.handleUpgrade(req, socket, head).catch(() => {
          try { socket.end() } catch (e) { }
        })
      }
    }
    // 挂载（设置提交时重新挂载）fleet 中枢。对端列表变化时重新挂载，才能让 live
    // 命名空间如实生效：中枢构造函数连接每个对端并持有存活定时器，dispose() 拆除
    // server、链路与待决查询——因此编辑后几秒内对端会按自己的退避重连。进行中的
    // 查询解析为 { ok:false, code:'disposed' }，面板已将其渲染为对端不可达。
    const mountFleet = () => {
      if (fleetDisposed || !wsLib) return
      if (fleet) {
        try { fleet.dispose() } catch (e) { }
      }
      fleet = new FleetLinks({
        WebSocket: wsLib.WebSocket ? wsLib.WebSocket : wsLib,
        WebSocketServer: wsLib.WebSocketServer,
        safeTokenEqual,
        fleetId,
        resolveFleetToken,
        // 两类查询都走本地 HTTP 路由与 agent 工具使用的同一组辅助函数，对端因此
        // 无法到达面板自己会拒绝的代码路径。`sessions` 按面板的方式转发到请求的
        // 本机端口：在这里调用 describeSessions() 会丢掉 q.port，对任何被询问的
        // 端口都返回本实例的会话——错误的数据，而不是错误。
        answerQuery: createQueryResponder({
          // 用 listLocalInstances，而不是合并对端的 listInstances：对端的 fleet
          // 查询绝不能导致本机再去查询对端（见上文）。
          fleetId, version: VERSION, listLocalInstances, sessionsFor, logsFor
        })
      }, peers)
      fleet.startLiveness()
    }
    resolveWsLib().then((WS) => {
      if (!WS) {
        if (peers.length) console.error('dsh-instance-manager: ws module unavailable — fleet peering disabled')
        return
      }
      if (fleetDisposed) return
      wsLib = WS
      mountFleet()
    }).catch((e) => {
      // 没有这一行，resolveWsLib 抛出会让 fleet 链路永久离线且没有任何诊断。
      console.error('dsh-instance-manager: fleet mount failed:', String((e && e.message) || e))
    })

    // ---- fleet 上线/下线推送（SSE）----------------------------------------
    // 每个进程只有一个惰性差异轮询器，与订阅者数量无关：每 FLEET_TICK_MS 重新列出
    // fleet，向所有 text/event-stream 订阅者广播托管端口的加入与离开。订阅者连接时
    // 收到一帧基线（客户端据此播种，不弹出提示）；空闲轮询不产生网络数据——轮询本身
    // 也以登记文件为先。
    const FLEET_TICK_MS = 10000
    // 每个订阅者连接时都要一次完整的 fleet 列表（本机端口扫描加对端查询），之后每次
    // 轮询一帧，因此这个流需要上限：无界的 EventSource 循环会把一个页面变成本机扫描
    // 放大器。
    const MAX_SSE_CLIENTS = 8
    const sseClients = new Set()
    let fleetTimer = null
    let prevManaged = null
    let prevPeerStatus = null
    const broadcastFleet = (obj) => {
      const frame = 'event: fleet\ndata: ' + JSON.stringify(obj) + '\n\n'
      for (const res of sseClients) {
        if (res.destroyed || res.writableEnded) { sseClients.delete(res); continue }
        try {
          // write() === false 表示 socket 缓冲区已满：丢弃最慢的订阅者，而不是无限
          // 排队。它可以重连，错过的轮询可以从基线帧恢复。
          if (res.write(frame) === false) sseClients.delete(res)
        } catch (e) { sseClients.delete(res) }
      }
    }
    const fleetTick = async () => {
      try {
        const { items, peers: peerStatus } = await listInstances()
        // 仅本机端口：远端行共享的是其他机器的数字空间；它们的抖动不作为实例
        // 上线/下线弹出提示（基线由同一辅助函数播种，两者不会分歧）。
        const next = new Set(managedLocalPorts(items))
        const payload = {}
        if (prevManaged === null) {
          prevManaged = next
          prevPeerStatus = peerStatus || {}
          return
        }
        const diff = diffManagedPorts(prevManaged, next)
        prevManaged = next
        if (diff.added.length || diff.removed.length) Object.assign(payload, diff)
        // 对端可达性的变化走同一批帧。
        const prevPeers = prevPeerStatus || {}
        const peerUp = Object.keys(peerStatus || {}).filter((id) => prevPeers[id] !== 'online' && peerStatus[id] === 'online')
        const peerDown = Object.keys(prevPeers).filter((id) => prevPeers[id] === 'online' && (peerStatus || {})[id] !== 'online')
        prevPeerStatus = peerStatus || {}
        if (peerUp.length) payload.peerUp = peerUp
        if (peerDown.length) payload.peerDown = peerDown
        if (Object.keys(payload).length) broadcastFleet(payload)
      } catch (e) { /* 单次扫描失败时保留上一次基线 */ }
    }
    const ensureFleetTicker = () => {
      if (fleetTimer !== null || sseClients.size === 0) return
      fleetTimer = setInterval(fleetTick, FLEET_TICK_MS)
      if (fleetTimer.unref) fleetTimer.unref()
    }
    const stopFleetTickerIfIdle = () => {
      if (fleetTimer !== null && sseClients.size === 0) {
        clearInterval(fleetTimer)
        fleetTimer = null
        prevManaged = null
      }
    }

    // 解析 `peer` 查询参数。未配置的名字是错误，绝不静默退回本机实例：路由失败，
    // 而不是用本机数据应答对端查询。
    //
    // 两个哨兵值是 `String(undefined)` / `String(null)` 留在查询串里的形式。缓存中的
    // 旧 bundle 对每个本机行都发送 `peer=undefined`，含义是“没有对端”，这些客户端
    // 因此仍得到本机读取，而不是错误。
    const resolvePeerParam = (u) => {
      const raw = u.searchParams.get('peer')
      if (raw === null || raw === '' || raw === 'undefined' || raw === 'null') return { ok: true, peer: undefined }
      if (!peers.some((p) => p.id === raw)) return { ok: false, code: 'unknown_peer' }
      return { ok: true, peer: raw }
    }

    const apiRoute = {
      kind: 'exact',
      path: API_PATH,
      handler: async (req, res) => {
        try {
          const u = new URL(req.url || '/', 'http://x')
          const action = u.searchParams.get('action') || 'list'
          const peerAddress = req.socket && req.socket.remoteAddress
          if (peerAddress == null || String(peerAddress).trim() === '') {
            // 在考虑任何远端凭证路径之前，保留守卫对未识别对端的拒绝。
            fleetGuard(req, res)
            return
          }
          // 远端 fleet 对端用 bearer 认证。配置了受信 LAN 主机的 RC1 浏览器通过
          // Connection 独立认证；两种凭证不能互相替代。
          // 哪个准入路径打开了这个请求。每次被接受的写操作都会记录它，因为“fleet
          // 对端要求的”和“本机回环上的页面要求的”是对同一次停止的不同回答。
          let via = 'local-browser'
          const remote = requestNeedsBearer(req)
          if (action === 'diagnostics' && remote) {
            // 诊断面不参与 fleet 信任边界：写操作追踪每行含对端地址与请求携带的
            // User-Agent，它回答的是"本机实例为什么消失了"，把这个面开放给 fleet
            // 对端（哪怕它持有有效 bearer）等于把本机的请求元数据送到链路上。判定放在
            // 守卫之前，因为这里的拒绝理由与准入路径无关。
            sendJson(res, 403, { ok: false, code: 'loopback_only', error: 'diagnostics are loopback-only' })
            return
          }
          if (remote) {
            if (await authorizeRemote(req)) {
              // fleet 对端由 bearer 独立认证，同时仍要通过已有的元数据/源守卫。
              via = 'fleet-peer'
              if (!fleetGuard(req, res)) return
            } else if ((connection || connectionSeen) &&
              (action === 'list' || action === 'logs' || action === 'sessions' ||
                action === 'start' || action === 'stop' || action === 'stop-all' ||
                action === 'open' || action === 'open-url')) {
              // 访问 RC1 受信 LAN 主机的浏览器携带签名的 Connection cookie，而不是
              // fleet 对端 bearer。
              via = 'browser-lan'
              if (!authorizeBrowser(req, res)) return
            } else {
              sendJson(res, 403, { ok: false, code: 'fleet_auth', error: 'remote access requires a valid fleet token' })
              return
            }
          } else {
            if (!fleetGuard(req, res)) return
            if (action === 'self' || action === 'probe-sessions' || action === 'stop-self' ||
              action === 'diagnostics') {
              // 私有回环探测刻意不经过浏览器认证：子进程确认与兄弟实例转发都不携带
              // cookie。诊断面同样走这里——它读的是本机共享文件，写操作追踪里有对端
              // 地址与 User-Agent，因此连 fleetGuard 的宽松 Host 判定都不给它，只认
              // 严格回环的 guard。
              via = 'host-probe'
              if (!guard(req, res)) return
            } else if (!authorizeBrowser(req, res)) {
              return
            }
          }
          if (action === 'self') {
            sendJson(res, 200, {
              pid: process.pid,
              port: currentPort(),
              startedAt,
              sessions: activeSessionCount(),
              rss: process.memoryUsage().rss,
              version: VERSION,
              runtime: HOST_RUNTIME,
              fleetId: fleetId()
            })
            return
          }
          if (action === 'list') {
            sendJson(res, 200, await listInstances())
            return
          }
          if (action === 'open') {
            // 打开另一个实例的界面。用重定向而不是 JSON 正文中的 URL 回答：启动
            // token 不会进入面板状态，也不会进入链接的 href，浏览器只在重定向过程中
            // 访问带 token 的地址。
            const port = normalizePort(u.searchParams.get('port') ?? undefined)
            if (port === null) {
              sendJson(res, 400, { ok: false, code: 'no_port', error: 'no port' })
              return
            }
            redirectToInstance(res, port)
            return
          }
          if (action === 'open-url') {
            // `open` 重定向到的地址，这里改用 JSON 回答。只有绝对形式对桌面窗口
            // 有用：`open` 的相对 location 会基于 dsh-app://app 解析，而应用外壳对
            // 应用包以外的任何目标都拒绝它；显式的 http:// 回环地址则会被交给系统
            // 浏览器。token 因此抵达渲染进程，这个操作仍走浏览器路径，位于回环守卫
            // 与浏览器授权器之后，与 `open` 完全相同。
            const port = normalizePort(u.searchParams.get('port') ?? undefined)
            if (port === null) {
              sendJson(res, 400, { ok: false, code: 'no_port', error: 'no port' })
              return
            }
            const url = absoluteTokenUrl(port)
            if (url === null) {
              sendLaunchTokenUnavailable(res)
              return
            }
            sendJson(res, 200, { ok: true, port, url })
            return
          }
          if (action === 'logs') {
            // 启动器日志位于共享的 $DSH_HOME/launcher/logs 目录，任何本机实例都能
            // 直接读取，无需对端转发。端口会成为文件名的一部分——校验放在 logsFor，
            // 不在这里：处理器里的第二份副本会让共享 logsFor 的 fleet 路径在无人
            // 察觉的情况下退化。
            const stream = u.searchParams.get('stream') === 'err' ? 'err' : 'out'
            const rp = resolvePeerParam(u)
            if (!rp.ok) {
              sendJson(res, 400, { ok: false, code: rp.code, error: 'unknown peer' })
              return
            }
            const r = await logsFor(u.searchParams.get('port'), stream, rp.peer)
            sendJson(res, r.code === 'no_port' ? 400 : 200, r)
            return
          }
          if (action === 'diagnostics') {
            // 崩溃黑匣子、自退出与写操作追踪的有界尾部，按实例归属筛选。与 logs 一样，
            // 校验放在读取函数里：这里是唯一能把它变成文件路径的地方。
            //
            // 不接受 `peer`：这个面只回答本机磁盘上的事实，而写操作追踪含对端地址，
            // 转发它等于把本机的请求元数据交给 fleet 对端。
            const r = diagnosticsFor(
              u.searchParams.get('port'),
              u.searchParams.get('pid')
            )
            sendJson(res, r.code === 'no_port' ? 400 : 200, r)
            return
          }
          if (action === 'sessions') {
            // 这里的 port 可选（“省略 = 本实例”），但存在却无法解析的值返回 400，
            // 而不是静默退回本实例——否则一个笔误会应答成另一个实例。校验放在
            // sessionsFor，理由同 logs。
            const rp = resolvePeerParam(u)
            if (!rp.ok) {
              sendJson(res, 400, { ok: false, code: rp.code, error: 'unknown peer' })
              return
            }
            const r = await sessionsFor(u.searchParams.get('port') ?? undefined, rp.peer)
            sendJson(res, r.code === 'no_port' ? 400 : 200, r)
            return
          }
          if (action === 'probe-sessions') {
            sendJson(res, 200, describeSessions())
            return
          }
          if (action === 'start') {
            if (!requirePost(req, res, 'start')) return
            // 缺少 `port` 时保留自动选择（托管区间内第一个空闲端口）。提供了端口
            // 就必须是真实端口：笔误返回 400，而不是静默退回并在调用方没要求过的
            // 端口上启动实例。
            const rawStartPort = u.searchParams.get('port')
            let startPort
            if (rawStartPort !== null && rawStartPort !== '') {
              startPort = normalizePort(rawStartPort)
              if (startPort === null) {
                sendJson(res, 400, { ok: false, code: 'no_port', error: '端口无效：' + rawStartPort })
                return
              }
            }
            // 与 agent 工具共用：脱离派生并等到新子进程应答 action=self（包含
            // pid），在端口竞争失败时重试一次，启动慢时绝不重复派生。
            const started = await startWithRetry({ browserHandoff: true, port: startPort })
            noteRequest('start', req, { via, port: startPort, result: started && started.port ? 'spawned:' + started.port : 'not-spawned' })
            sendJson(res, 200, started)
            return
          }
          if (action === 'stop') {
            if (!requirePost(req, res, 'stop')) return
            // 使用与 logs/sessions 相同的 normalizePort 关卡：'1e3'、'0x10'、
            // '+80'、小数与越界值返回 400，而不是交给 http.get；后者会在 promise
            // 内部抛出 ERR_SOCKET_BAD_PORT，把请求变成 500。
            const port = normalizePort(u.searchParams.get('port') ?? undefined)
            if (port === null) {
              sendJson(res, 400, { ok: false, code: 'no_port', error: 'no port' })
              return
            }
            if (await isDesktopTarget(port)) {
              sendJson(res, 200, desktopRefusal(via, req, port, 'stop'))
              return
            }
            if (port === currentPort()) {
              noteRequest('stop', req, { via, port, result: 'self-exit' })
              scheduleSelfExit('stop:this-instance')
              sendJson(res, 200, { ok: true, note: 'stopping this instance' })
              return
            }
            // 8 秒让刚启动的目标完成初始化，再判断转发的停止是否未被确认。
            const r = await forwardStopRemote(port)
            noteRequest('stop', req, { via, port, result: r && r.ok ? 'forwarded' : 'stop_unconfirmed' })
            if (r && r.ok) {
              sendJson(res, 200, { ok: true })
              return
            }
            sendJson(res, 200, { ok: false, code: 'stop_unconfirmed', error: '目标实例没有确认停止（未挂载本管理面板或不可达）' })
            return
          }
          if (action === 'stop-all') {
            if (!requirePost(req, res, 'stop-all')) return
            const { items } = await listInstances()
            // stop-all 在构造上只作用于本机：远端行携带其他机器的端口号，按端口号
            // 转发 stop-self 会打到本机恰好监听该端口的任何东西。
            //
            // 桌面宿主是“全部”的例外：只统计并上报，绝不停掉（见 isDesktopTarget）。
            // 本宿主自身就是桌面宿主时，当前行也是其中之一——此时 stop-all 也不会结束
            // 本进程，因为那正是让桌面窗口进入错误状态的原因。
            const local = items.filter((i) => i.managed && !i.remote)
            const desktop = local.filter((i) => i.runtime === 'desktop')
            const targets = local.filter((i) => i.port !== currentPort() && i.runtime !== 'desktop')
            const acked = []
            await Promise.allSettled(targets.map(async (t) => {
              const r = await forwardStopRemote(t.port)
              if (r && r.ok) acked.push(t.port)
            }))
            const skippedUnmanaged = items.filter((i) => !i.managed).length
            const stopSelf = !isDesktopHost
            noteRequest('stop-all', req, {
              via,
              result: (stopSelf ? 'self-exit;' : 'desktop-kept;') +
                'forwarded=' + acked.length + ';desktop=' + desktop.length
            })
            if (stopSelf) scheduleSelfExit('stop-all')
            sendJson(res, 200, {
              ok: true,
              stoppedRemote: acked.length,
              stoppedSelf: stopSelf,
              skippedDesktop: desktop.length,
              skippedUnmanaged
            })
            return
          }
          if (action === 'restart') {
            if (!requirePost(req, res, 'restart')) return
            const port = normalizePort(u.searchParams.get('port') ?? undefined)
            if (port === null) {
              sendJson(res, 400, { ok: false, code: 'no_port', error: 'no port' })
              return
            }
            // 重启当前实例不能原地做：提供面板的进程会在应答到达浏览器之前离开。
            // 改为交接：在持久化会话里用自动端口启动替代实例，等它应答后读出它的
            // token URL，浏览器整页跳过去，旧进程再退出。没有 tmux/screen 时无从
            // 保证替代实例活过本次退出，仍按原样拒绝。
            if (port === currentPort()) {
              if (isDesktopHost) {
                sendJson(res, 200, desktopRefusal(via, req, port, 'restart'))
                return
              }
              if (sessionTools().length === 0) {
                noteRequest('restart', req, { via, port, result: 'self-refused' })
                sendJson(res, 200, {
                  ok: false,
                  code: 'restart_current_refused',
                  error: '当前实例无法从面板重启：未检测到 tmux 或 screen。请在持久化会话中手动重启本机 dsh。'
                })
                return
              }
              const replacement = await startWithRetry({ browserHandoff: false })
              if (!replacement || !replacement.ok) {
                noteRequest('restart', req, { via, port, result: (replacement && replacement.code) || 'failed' })
                sendJson(res, 200, replacement || { ok: false, code: 'internal', error: 'internal error' })
                return
              }
              const url = await handoffUrl(req, replacement.port, replacement.logSince)
              if (!url) {
                // 拿不到 token 就不交接：停掉刚起的替代实例，当前实例保持服务。
                await forwardStopRemote(replacement.port)
                noteRequest('restart', req, { via, port, result: 'handoff-token-unavailable' })
                sendJson(res, 200, {
                  ok: false,
                  code: 'launch_token_unavailable',
                  error: '替代实例已启动，但读不到它的启动 token；已将其停止，当前实例保持不变。'
                })
                return
              }
              noteRequest('restart', req, { via, port, result: 'handoff:' + replacement.port })
              sendJson(res, 200, Object.assign({}, replacement, {
                code: 'handoff',
                url,
                note: '替代实例已就绪，当前实例即将退出'
              }))
              // 应答先写出去；scheduleSelfExit 在有 timer 服务的宿主上还会再等 300ms。
              scheduleSelfExit('restart:self-handoff')
              return
            }
            if (await isDesktopTarget(port)) {
              sendJson(res, 200, desktopRefusal(via, req, port, 'restart'))
              return
            }
            // 面板触发的重启沿用启动的浏览器交接：新实例需要自己的启动 token 才能
            // 打开页面，与 stop 之后立刻点「启动新实例」是同一件事。
            const restarted = await restartPort(port, { browserHandoff: true })
            noteRequest('restart', req, {
              via,
              port,
              result: restarted && restarted.ok ? 'restarted:' + String(restarted.pid) : (restarted && restarted.code) || 'failed'
            })
            sendJson(res, 200, restarted)
            return
          }
          if (action === 'stop-self') {
            if (!requirePost(req, res, 'stop-self')) return
            noteRequest('stop-self', req, { via, result: 'self-exit' })
            scheduleSelfExit('stop-self')
            sendJson(res, 200, { ok: true })
            return
          }
          sendJson(res, 400, { ok: false, code: 'unknown_action', error: 'unknown action' })
        } catch (err) {
          // 原始消息留在宿主日志中：它可能引用绝对路径或对端来源，而响应正文会被
          // 持有连接的任何一方读取。客户端已经把已知的 `code` 本地化，因此固定 code
          // 就是界面需要的全部回答。
          console.error('dsh-instance-manager: api error', err && err.stack ? err.stack : String(err))
          sendJson(res, 500, { ok: false, code: 'internal', error: 'internal error' })
        }
      }
    }
    // ---- agent 工具 ---------------------------------------------------------
    // 通过 harness 的 `tools` 服务把同样的操作提供给会话内的 agent。
    // @deepseek-ai/dsh-tools 先从本包解析，失败后从运行中的 dsh 检出自己的依赖树解析
    // （对已解析的 bin 用 createRequire）——凡是 dsh 提供它的地方工具都能启用，两者
    // 都不存在时静默降级（不影响面板）。
    //
    // 服务本身是可选的，每次使用都重新读取，绝不在 apply 时读取一次：loader 行按服务
    // 可用性激活，而不是按行顺序，因此这里只调用一次 ctx.get('tools') 时，只要 tools
    // 服务在本行之后挂载就会失败，而且是静默失败，面板不报错。把它写进 `inject` 也不
    // 可行：没有 tools 服务的组合会让本行停在 PENDING，宿主启动审计会把它算作失败，
    // 连带把面板拖下去。因此：现在尝试一次，之后在 cordis 的 'internal/service' 信号
    // 上重试（每次提供服务都会带服务名发出），挂载或释放后闭锁。
    const loadDefineTool = async () => {
      try { return await import('@deepseek-ai/dsh-tools') } catch (e) { }
      const bin = dshBin()
      if (!bin) return null
      try { return createRequire(bin)('@deepseek-ai/dsh-tools') } catch (e) { return null }
    }
    const stopForAgent = async (rawPort) => {
      const port = normalizePort(rawPort)
      if (port === null) {
        return { ok: false, code: 'bad_port', error: 'port must be an integer in [1, 65535]' }
      }
      if (port === currentPort()) {
        return { ok: false, code: 'stop_current_refused', error: 'refusing to stop THIS instance from a tool (it hosts the conversation); use the sidebar panel instead' }
      }
      // 桌面宿主在这里同样拒绝：面板自己的控件不是唯一调用方，由工具停止窗口的
      // 后端，正是面板守卫要防止的失败。
      if (await isDesktopTarget(port)) {
        return { ok: false, code: 'stop_desktop_refused', error: 'the target is a desktop host: stopping it would leave the desktop window without a backend' }
      }
      const r = await forwardStopRemote(port)
      if (r && r.ok) return { ok: true, note: 'graceful stop acknowledged by :' + port }
      return { ok: false, code: 'stop_unconfirmed', error: 'target did not acknowledge the stop (not managed here, or unreachable)' }
    }
    // 原地重启，与面板的停止+启动按钮是同一条路径。拒绝的两个目标与停止相同：提供
    // 本次对话的实例（重启它会带走正在服务的面板），以及桌面宿主（它是桌面窗口唯一的
    // 后端）。
    const restartForAgent = async (rawPort) => {
      const port = normalizePort(rawPort)
      if (port === null) {
        return { ok: false, code: 'bad_port', error: 'port must be an integer in [1, 65535]' }
      }
      if (port === currentPort()) {
        return { ok: false, code: 'restart_current_refused', error: 'refusing to restart THIS instance from a tool (it hosts the conversation)' }
      }
      if (await isDesktopTarget(port)) {
        return { ok: false, code: 'stop_desktop_refused', error: 'the target is a desktop host: restarting it would leave the desktop window without a backend' }
      }
      // agent 触发的重启保持无头，与 agent 触发的启动同一理由。
      return restartPort(port, { browserHandoff: false })
    }

    const toolDisposers = []
    let toolsMounting = false
    let toolsMounted = false
    let toolsDisposed = false
    const mountAgentTools = async () => {
      if (toolsDisposed || toolsMounted || toolsMounting) return
      const toolsService = ctx.get('tools')
      if (!toolsService || typeof toolsService.register !== 'function') return
      toolsMounting = true
      try {
        const mod = await loadDefineTool()
        // await 之后重新检查：模块解析期间插件或服务可能已经离开。
        if (toolsDisposed || toolsMounted || !mod || typeof mod.defineTool !== 'function') return
        const api = {
          listInstances,
          start: () => startWithRetry({ browserHandoff: false }),
          stop: stopForAgent,
          restart: restartForAgent,
          logs: (port, stream, peer) => logsFor(port, stream, peer),
          sessions: (port, peer) => sessionsFor(port, peer)
        }
        for (const def of buildAgentTools(mod.defineTool, api)) {
          const release = toolsService.register(def)
          if (typeof release === 'function') toolDisposers.push(release)
        }
        toolsMounted = true
      } catch (e) {
        // 注册被拒只应让工具不可用，绝不能影响面板。
        console.error('dsh-instance-manager: agent tools registration failed', e && e.message ? e.message : e)
      } finally {
        toolsMounting = false
      }
    }
    ctx.effect(() => {
      void mountAgentTools()
      const off = ctx.on('internal/service', (name) => {
        if (name === 'tools') void mountAgentTools()
      })
      return () => {
        toolsDisposed = true
        toolsMounted = false
        if (typeof off === 'function') off()
        toolDisposers.splice(0).forEach((d) => { try { d() } catch (e) { } })
      }
    }, 'dsh-instance-manager: agent tools')

    // fleet 上线/下线流：仅同源（守卫与其他操作一样生效）。响应永不“完成”——客户端的
    // EventSource 持有生命周期，请求关闭即拆除订阅。
    const eventsRoute = {
      kind: 'exact',
      path: '/dsh-instance-manager/events',
      handler: async (req, res) => {
        try {
          if (!authorizeBrowser(req, res)) return
          if (sseClients.size >= MAX_SSE_CLIENTS) {
            sendJson(res, 503, { ok: false, code: 'too_many_streams', error: 'too many event streams; close one and retry' })
            return
          }
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            // 用 no-store 而不是 event-stream 常见的 no-cache：流上传输的是实时实例
            // 图——端口、pid、会话——没有任何可供中间层重新验证的内容，只有过期的
            // 副本会被发放出去。
            'cache-control': 'no-store',
            connection: 'keep-alive'
          })
          res.write(': connected\n\n')
          sseClients.add(res)
          ensureFleetTicker()
          // 这个订阅者的基线快照；它的端口也并入共享基线，并发进行的首次轮询才不会
          // 把它们重新播报为加入。
          ;(async () => {
            try {
              const { items } = await listInstances()
              const ports = managedLocalPorts(items)
              if (prevManaged === null) prevManaged = new Set(ports)
              else for (const p of ports) prevManaged.add(p)
              res.write('event: fleet\ndata: ' + JSON.stringify({ baseline: true, ports }) + '\n\n')
            } catch (e) { /* 下一次轮询会覆盖 */ }
          })()
          // 突然断开表现为请求/响应流上的异步 'error' 事件；未处理的 'error' 会让
          // 整个进程退出，因此每个流都挂监听器，并共用一条幂等的移除路径（'close'
          // 可能跟在 'error' 之后——两者都不重复处理）。
          const drop = () => {
            sseClients.delete(res)
            stopFleetTickerIfIdle()
          }
          res.on('error', drop)
          req.on('error', drop)
          req.on('close', drop)
        } catch (err) {
          console.error('dsh-instance-manager: events error', err && err.message ? err.message : err)
          try { res.end() } catch (e) { }
        }
      }
    }

    ctx.effect(() => [
      ws.register(apiRoute),
      ws.register(eventsRoute),
      // fleet 入站半边：没有它，链路只能拨出——每个对端的 `fleet` 查询都会超时，
      // 因为没有实例接受 socket。带条件：不支持 upgrade 的 webserver 构建不能把面板
      // 一起拖下去；此时对等互联退化为只能拨出。
      typeof ws.registerUpgrade === 'function' ? ws.registerUpgrade(fleetUpgrade) : () => { },
      // fleet 拆除：关闭中枢的 server、存活定时器、出站链路与待决查询，并闭锁上面
      // 异步的 `ws` 加载，晚到的解析无法在卸载后复活中枢。
      () => {
        fleetDisposed = true
        if (fleet) {
          try { fleet.dispose() } catch (e) { }
          fleet = null
        }
      },
      // 插件拆除（包括优雅退出）：停止心跳并带走自己的登记文件，对端不会看到幽灵端口。
      () => {
        clearInterval(heartbeatTimer)
        removeHeartbeat()
      },
      // SSE 拆除：停止差异轮询并结束所有打开的流。
      () => {
        if (fleetTimer !== null) clearInterval(fleetTimer)
        fleetTimer = null
        for (const res of sseClients) { try { res.end() } catch (e) { } }
        sseClients.clear()
      },
      // 崩溃黑匣子拆除：随插件释放进程钩子。
      () => {
        process.off('uncaughtException', onUncaught)
        process.off('unhandledRejection', onRejection)
      }
    ], 'dsh-instance-manager: api routes')
  },
}
