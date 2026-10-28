// 宿主侧的路由注册测试。
//
// 路由对象构造出来却没有交给 webserver 时，这个功能看起来已经实现、也写进了变更记录，
// 但运行时什么都不做；只有对注册调用本身断言才能发现它——模块内部不会自己执行这条
// 路径。
//
// apply() 只需要 webServer 服务以及 ctx.get / ctx.effect / ctx.on。其他服务刻意保持
// undefined：宿主侧因此走降级路径（没有会话、没有工具、没有凭证），端口也保持
// undefined，心跳登记文件从不写入。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import plugin from '../lib/index.js'

// 会话工具探测读取真实 PATH：开发机上的 tmux 会让每条启动用例真的创建会话并拉起
// 实例。默认把 PATH 指向一个空目录，启动测试因此确定性地走“没有持久化工具”的直接
// 派生路径；需要会话路径的用例自己把假的 tmux/dsh 放进 PATH（见 withSessionTools）。
const NO_TOOL_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-nopath-'))
const REAL_PATH = process.env.PATH
process.env.PATH = NO_TOOL_PATH
test.after(() => { fs.rmSync(NO_TOOL_PATH, { recursive: true, force: true }) })

const API_PATH = '/dsh-instance-manager/api'
const EVENTS_PATH = '/dsh-instance-manager/events'
const LINK_PATH = '/dsh-instance-manager/link'

// `config` 是 profile 条目作为第二个参数交给 apply() 的内容（0.1.7-rc.1 及以后）；
// 保持 undefined 可复现更早的版本，那里这些值只有设置服务一个来源。
const mount = ({ upgradeSupport = true, connection, config, port, tools, hostHome, sessions, sessionTitle } = {}) => {
  const routes = []
  const upgrades = []
  const getCalls = []
  const listeners = new Map()
  const webServer = {
    // 默认 undefined：registryFile() 返回 null，apply 因此不碰任何文件。需要服务
    // 端口身份的测试——自停止分支，以及门控它的同源 Origin 检查——会显式给出。
    port,
    register(route) {
      routes.push(route)
      return () => { const at = routes.indexOf(route); if (at !== -1) routes.splice(at, 1) }
    },
    ...(upgradeSupport ? {
      registerUpgrade(route) {
        upgrades.push(route)
        return () => { const at = upgrades.indexOf(route); if (at !== -1) upgrades.splice(at, 1) }
      }
    } : {})
  }
  const disposers = []
  const ctx = {
    webServer,
    get: (name) => {
      getCalls.push(name)
      if (name === 'webServer') return webServer
      // 仅在需要时提供：没有它时 agent 工具行保持未挂载，下面固定的服务查找次数
      // 维持原有形状。
      if (name === 'tools') return tools
      // 会话摘要的两个可选服务：没有它们时宿主走降级路径，正是会话增补要守住的那条。
      if (name === 'sessions') return sessions
      if (name === 'sessionTitle') return sessionTitle
      // 只有需要启动层 home 取值函数的挂载才提供它；没有时插件退回
      // resolveDshHome(process.env)。
      if (name === 'dshHomePath') return hostHome ? () => hostHome : undefined
      return undefined
    },
    effect(factory) {
      const result = factory()
      for (const d of Array.isArray(result) ? result : [result]) {
        if (typeof d === 'function') disposers.push(d)
      }
    },
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(fn)
      return () => { listeners.get(event).delete(fn) }
    },
    inject: (names, fn) => {
      if (!connection || !names.includes('connection')) return
      fn({
        connection,
        on: (event, cb) => {
          if (event === 'dispose') disposers.push(cb)
          return () => {}
        }
      })
    }
  }
  plugin.apply(ctx, config)
  const emit = (event, ...args) => {
    for (const fn of listeners.get(event) ?? []) fn(...args)
  }
  return {
    routes,
    upgrades,
    getCalls,
    emit,
    dispose: () => { disposers.reverse().forEach((d) => d()) }
  }
}

// 一次挂载，任意多次请求。SSE 订阅上限位于挂载自己的闭包里，按请求挂载永远触不到它；
// 这种形状才能。假的响应捕获 `writeHead` 收到的头，因为这些路由正是按 `cache-control`
// 判定的——丢掉响应头的桩会让 no-store 的退化静默通过。
const mountCaller = ({ connection, port } = {}) => {
  const { routes, dispose } = mount({ connection, port })
  const call = async ({ path = API_PATH, query = 'action=list', method = 'GET' } = {}) => {
    const route = routes.find((r) => r.path === path)
    assert.ok(route, 'no route registered at ' + path)
    let status = 0
    let body = ''
    const headers = {}
    // `heads` 按原样保留每次 writeHead，测试因此能断言处理器写出的每个应答，而不是
    // 只看到合并后的最后一个。
    const heads = []
    const res = {
      writeHead: (code, extra) => { status = code; heads.push({ code, headers: extra || {} }); Object.assign(headers, extra || {}) },
      setHeader: (name, value) => { headers[name.toLowerCase()] = value },
      write: () => true,
      end: (chunk) => { body = chunk || '' },
      on: () => {}
    }
    await route.handler({
      url: path + (query ? '?' + query : ''),
      method,
      headers: { host: '127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
      on: () => {}
    }, res)
    return { status, headers, heads, json: body ? JSON.parse(body) : null }
  }
  return { call, dispose }
}

const callMountedRoute = async (opts) => {
  const { call, dispose } = mountCaller(opts)
  try {
    return await call(opts)
  } finally {
    dispose()
  }
}

const paths = (routes) => routes.map((r) => r.path)

test('host registers the JSON api and the SSE stream, and nothing else', () => {
  const { routes, dispose } = mount()
  try {
    assert.deepEqual(paths(routes).sort(), [API_PATH, EVENTS_PATH].sort())
    for (const route of routes) assert.equal(route.kind, 'exact')
  } finally {
    dispose()
  }
})

test('RC1 Connection rejection is final for browser API actions', async () => {
  const calls = []
  const result = await callMountedRoute({
    connection: { requestRejection: (req) => { calls.push(req.url); return 401 } }
  })
  assert.equal(result.status, 401)
  assert.equal(result.json.code, 'unauthorized')
  assert.equal(calls.length, 1)
})

test('private sibling probes bypass Connection but browser sessions do not', async () => {
  let calls = 0
  const connection = { requestRejection: () => { calls += 1; return 401 } }
  const probe = await callMountedRoute({ connection, query: 'action=probe-sessions' })
  assert.equal(probe.status, 200)
  assert.equal(probe.json.ok, true)
  assert.equal(calls, 0)
  const browser = await callMountedRoute({ connection, query: 'action=sessions' })
  assert.equal(browser.status, 401)
  assert.equal(calls, 1)
})

test('RC1 Connection acceptance authorizes the SSE stream', async () => {
  const result = await callMountedRoute({
    connection: { requestRejection: () => undefined },
    path: EVENTS_PATH,
    query: ''
  })
  assert.equal(result.status, 200)
  assert.equal(result.headers['content-type'], 'text/event-stream')
  // 流上传输的是实时实例图，event-stream 常用的 `no-cache` 仍会让中间层发放过期副本。
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(result.headers.connection, 'keep-alive')
})

// 订阅上限是每次挂载的闭包变量，只有对同一次挂载反复打开流才能到达——因此需要
// `mountCaller`。拒绝是普通 JSON 应答，必须与其他应答一样携带
// `cache-control: no-store`：这个正文说明了当前流数量。循环上限远大于上限而不是恰好
// 相等，这样数字变化时用例仍有意义，而且它从不打开真实 socket。
test('the event stream caps its subscribers and answers the refusal like any JSON reply', async () => {
  const { call, dispose } = mountCaller()
  try {
    let refusal = null
    let opened = 0
    for (let i = 0; i < 32 && !refusal; i++) {
      const r = await call({ path: EVENTS_PATH, query: '' })
      if (r.status === 200) opened++
      else refusal = r
    }
    assert.ok(refusal, '上限必须有限，否则一个页面就会变成扫描放大器')
    assert.ok(opened > 0, '它限制的是订阅者数量，不是拒绝服务')
    assert.equal(refusal.status, 503)
    assert.equal(refusal.json.code, 'too_many_streams')
    assert.equal(refusal.headers['cache-control'], 'no-store', '这是路由自己的应答策略，不是裸的 writeHead')
    assert.match(String(refusal.headers['content-type']), /application\/json/,
      '拒绝是 JSON 应答，不是永不结束的事件流')
  } finally {
    dispose()
  }
})

test('host mounts the fleet link upgrade route (fleet queries would time out without it)', () => {
  const { upgrades, dispose } = mount()
  try {
    assert.equal(upgrades.length, 1, '/link 升级路由必须真正注册，而不只是构造出来')
    assert.equal(upgrades[0].path, LINK_PATH)
    assert.equal(typeof upgrades[0].handler, 'function')
  } finally {
    dispose()
  }
})

test('a webserver without upgrade support still mounts the panel', () => {
  const { routes, upgrades, dispose } = mount({ upgradeSupport: false })
  try {
    assert.equal(upgrades.length, 0)
    assert.deepEqual(paths(routes).sort(), [API_PATH, EVENTS_PATH].sort())
  } finally {
    dispose()
  }
})

test('disposal releases every route, upgrade included', () => {
  const { routes, upgrades, dispose } = mount()
  assert.equal(routes.length, 2)
  assert.equal(upgrades.length, 1)
  dispose()
  assert.equal(routes.length, 0)
  assert.equal(upgrades.length, 0)
})

test('the optional tools service is re-resolved when it appears after apply', () => {
  // loader 行按服务可用性激活，而不是按行顺序，因此 apply 时只调用一次
  // ctx.get('tools')，只要服务后来才挂载就会静默失去 agent 工具。本行也不能 inject
  // 它——没有 tools 的组合会停在 PENDING，启动审计会失败。
  const { getCalls, emit, dispose } = mount()
  try {
    const lookups = () => getCalls.filter((name) => name === 'tools').length
    const before = lookups()
    emit('internal/service', 'sessions')
    assert.equal(lookups(), before, '无关服务不得重新触发 tools 查找')
    emit('internal/service', 'tools')
    assert.equal(lookups(), before + 1, 'apply 之后到达的 tools 服务必须被发现')
  } finally {
    dispose()
  }
})

test('the fatal handler records the breadcrumb without pre-empting the harness exit', () => {
  // harness 在任何插件挂载前注册自己的 unhandledRejection 监听器，并在退出前等待
  // 一次释放（dispose + flush）。node 按注册顺序调用监听器，因此本插件无条件退出会
  // 截断那次释放。
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-crash-'))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const harnessListener = () => {}
  process.on('unhandledRejection', harnessListener)
  const { dispose } = mount()
  try {
    const mine = process.listeners('unhandledRejection').at(-1)
    const originalExit = process.exit
    let exits = 0
    process.exit = () => { exits += 1 }
    try {
      mine(new Error('boom'))
    } finally {
      process.exit = originalExit
    }
    assert.equal(exits, 0, '致命退出由 harness 负责，插件不得抢先')
    assert.ok(
      fs.existsSync(path.join(home, 'launcher', 'logs', 'dshim-crash.log')),
      '退出决定之前仍要写下追踪记录'
    )
  } finally {
    dispose()
    process.off('unhandledRejection', harnessListener)
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// ---- action=logs / action=sessions 的端口处理 -----------------------------
// 对端链路把这两种查询委托给这里测试的函数，因此在 HTTP 路径上验证过的拒绝同样适用于
// fleet 路径（委托关系本身见 test/fleet.test.js）。
const TRAVERSAL = '../'.repeat(8) + 'Windows/win.ini'

const callApi = async (query, method = 'GET') => {
  const { routes, dispose } = mount()
  try {
    const route = routes.find((r) => r.path === API_PATH)
    let status = 0
    let body = ''
    const res = {
      writeHead: (code) => { status = code },
      end: (chunk) => { body = chunk }
    }
    // 回环 Host，不带 Origin / Sec-Fetch-Site：守卫的正常路径。socket 对端也是回环
    // （本机浏览器/界面）——真实 HTTP 连接总带有对端，缺少它时守卫失败关闭。
    await route.handler({ url: API_PATH + '?' + query, method, headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } }, res)
    return { status, json: body ? JSON.parse(body) : null }
  } finally {
    dispose()
  }
}

// 完全控制请求：伪造非回环 socket 对端、设置 bearer，或彻底去掉 socket，以驱动信任
// 边界的各道关卡。
const callApiFull = async ({ query, method = 'GET', host = '127.0.0.1', remoteAddress, headers = {}, connection, config, port, sessions, sessionTitle }) => {
  const { routes, dispose } = mount({ connection, config, port, sessions, sessionTitle })
  try {
    const route = routes.find((r) => r.path === API_PATH)
    let status = 0
    let body = ''
    const res = {
      writeHead: (code) => { status = code },
      end: (chunk) => { body = chunk }
    }
    const req = { url: API_PATH + '?' + query, method, headers: { host, ...headers } }
    if (remoteAddress !== undefined) req.socket = { remoteAddress }
    await route.handler(req, res)
    return { status, json: body ? JSON.parse(body) : null }
  } finally {
    dispose()
  }
}

// ---- action=open（跨实例启动 token）--------------------------------------
// DSH 要求实例根 URL 携带每进程的启动 token，因此行链接必须通过提供 token 的重定向
// 解析。这里覆盖两种会让浏览器静默落到 401 的实现方式：从轮转过的日志里读取旧 token，
// 以及信任日志中的主机与端口。
const openRedirect = async (query) => {
  const { routes, dispose } = mount()
  try {
    const route = routes.find((r) => r.path === API_PATH)
    let status = 0
    let headers = null
    let body
    const res = {
      writeHead: (code, h) => { status = code; headers = h },
      end: (chunk) => { body = chunk }
    }
    await route.handler(
      { url: API_PATH + '?' + query, method: 'GET', headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } },
      res
    )
    return { status, headers, body }
  } finally {
    dispose()
  }
}

const withLauncherLog = async (port, content, fn) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-open-'))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const dir = path.join(home, 'launcher', 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'server-' + port + '.out.log'), content)
    return await fn()
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
}

test('action=open redirects to the token of the CURRENT process, not an earlier one', async () => {
  // 重启过的实例每个进程追加一条公告，token 每次都会重新生成。第一行的 token 已经
  // 失效；跟随它会像完全没有 token 一样返回 401。
  const log = [
    'dsh web: http://127.0.0.1:3101/?token=STALE_TOKEN_FROM_PREVIOUS_PROCESS',
    '[dsh-cost-meter] unrelated line',
    'dsh web: http://127.0.0.1:3101/?token=CURRENT_TOKEN'
  ].join('\n')
  const r = await withLauncherLog(3101, log, () => openRedirect('action=open&port=3101'))
  assert.equal(r.status, 303)
  assert.equal(r.headers.location, '/?token=CURRENT_TOKEN')
  // token 不能留在用户最终停留的地址中，重定向也不能被缓存或泄漏 referrer。
  assert.equal(r.headers['cache-control'], 'no-store')
  assert.equal(r.headers['referrer-policy'], 'no-referrer')
  // 浏览器不读取重定向正文，因此不能有正文。
  assert.equal(r.body, undefined)
})

test('action=open refuses a log whose host, port, or token does not match', async () => {
  const cases = [
    // 指明其他主机的日志行不能用于这个端口。
    ['http://evil.example:3101/?token=X', 'foreign host'],
    // token 属于另一个实例的端口。
    ['http://127.0.0.1:3102/?token=X', 'port mismatch'],
    // 没有可交付的 token。
    ['http://127.0.0.1:3101/', 'no token']
  ]
  for (const [line, label] of cases) {
    const r = await withLauncherLog(3101, 'dsh web: ' + line, () => openRedirect('action=open&port=3101'))
    assert.equal(r.status, 409, label)
    assert.match(r.body, /launch_token_unavailable/, label)
  }
  // 对照组：主机、端口与 token 都匹配时确实重定向，说明上面三次拒绝来自检查本身，
  // 而不是解析器失效。
  const ok = await withLauncherLog(3101, 'dsh web: http://127.0.0.1:3101/?token=X', () => openRedirect('action=open&port=3101'))
  assert.equal(ok.status, 303)
  assert.equal(ok.headers.location, '/?token=X')
})

// ---- action=open-url（给桌面外壳的绝对地址）-----------------------------
// 桌面窗口从 dsh-app://app 提供页面，`open` 的相对 location 在那里不是浏览器 URL，
// 而应用外壳拒绝所有非 http(s) 的 window.open——桌面行因此无法跟随重定向，必须改为
// 获取绝对地址。token 解析相同，守卫相同，少一次跳转。
test('action=open-url answers the absolute token address as JSON', async () => {
  const r = await withLauncherLog(3101, 'dsh web: http://127.0.0.1:3101/?token=ABS_TOKEN', () => (
    openRedirect('action=open-url&port=3101')
  ))
  assert.equal(r.status, 200)
  assert.equal(r.headers['cache-control'], 'no-store')
  const json = JSON.parse(r.body)
  assert.equal(json.ok, true)
  assert.equal(json.port, 3101)
  assert.equal(json.url, 'http://127.0.0.1:3101/?token=ABS_TOKEN')
})

test('action=open-url reports an unavailable token and an unusable port as codes', async () => {
  // 日志中没有 token：面板会把 code 映射为自己的措辞，因此 code 必须存在，不能只是
  // 一个裸的 409。
  const noToken = await withLauncherLog(3101, 'dsh web: http://127.0.0.1:3101/', () => (
    openRedirect('action=open-url&port=3101')
  ))
  assert.equal(noToken.status, 409)
  assert.equal(JSON.parse(noToken.body).code, 'launch_token_unavailable')
  // 属于另一个端口的 token 不会为这个端口发放。
  const otherPort = await withLauncherLog(3101, 'dsh web: http://127.0.0.1:3102/?token=OTHER', () => (
    openRedirect('action=open-url&port=3101')
  ))
  assert.equal(otherPort.status, 409)
  assert.equal(JSON.parse(otherPort.body).code, 'launch_token_unavailable')
  for (const bad of [TRAVERSAL, '1e3', '', '65536']) {
    const r = await callApi('action=open-url&port=' + encodeURIComponent(bad))
    assert.equal(r.status, 400, 'port=' + bad)
    assert.equal(r.json.code, 'no_port', 'port=' + bad)
  }
})

// ---- 桌面宿主：永远不是停止目标 --------------------------------------------
// 桌面应用把自身宿主的任何退出都视为失败，停止落到那里会让窗口失去后端，进入只有
// 重启才能清除的错误状态。端口号说明不了它背后是什么，因此目标由它自己的上报识别
// ——只有肯定性的 `runtime:'desktop'` 才拒绝：沉默或没有 runtime 的目标保留原有转发
// 与原有结论，靠推断会让所有早于该字段的实例被误伤。
const asDesktopHost = async (fn) => {
  // apply() 在挂载时按自己的 argv 决定运行时，因此换成桌面宿主入口脚本就是全部开关。
  const saved = process.argv
  process.argv = [
    saved[0],
    path.join('DSH', 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
  ]
  try { return await fn() } finally { process.argv = saved }
}

// 假实例：用给定的报告应答 action=self，其他请求用 `ack` 应答，并记录收到的内容，
// 测试因此能断言哪些请求没有到达。
const withFakeTarget = async ({ self, ack = { ok: false, note: 'no ack' } }, fn) => {
  const http = await import('node:http')
  const seen = []
  const server = http.createServer((req, res) => {
    const url = String(req.url)
    seen.push(url)
    const body = url.includes('action=self')
      ? (typeof self === 'function' ? self(server.address().port) : self)
      : ack
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    return await fn({ port: server.address().port, seen })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

// 临时 DSH_HOME 让这些挂载的心跳与追踪记录留在开发者真实 home 之外；自退出总是被替换
// 并计数：这些测试断言的正是哪个宿主安排了它。
const withTempHome = async (fn) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-desktop-'))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const originalExit = process.exit
  const exits = []
  process.exit = (code) => { exits.push(code) }
  try {
    return await fn({ home, exits })
  } finally {
    process.exit = originalExit
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
}

// 假的 tmux 只实现插件用到的那几条命令：`new-session` 把最后一个参数（由 sh 执行的
// 完整命令行）挂到 nohup 下，命令自己负责把输出写进启动日志；`has-session` 与
// `kill-session` 恒成功；`list-panes` 报一个稳定的 pane pid。
const TMUX_STUB = `#!/bin/sh
if [ "$1" = "new-session" ]; then
  for last do :; done
  nohup /bin/sh -c "$last" >/dev/null 2>&1 &
  exit 0
fi
if [ "$1" = "list-panes" ]; then
  echo 12345
  exit 0
fi
exit 0
`

// 假的 dsh 只实现 web 面板探测用到的最小面：`--port` 上监听、对任意 GET 回自身报告、
// 被 stop-self 停止；启动时把 token 打到 stdout（插件的 token 读取依赖这一行），并留下
// pid 文件供测试善后。
//
// token 按进程生成，并且根路径上的 `?token=` 与真实实例一样判真伪：正确的换成 cookie
// 后 303 到干净的 `/`，其余（包括同一端口上上一代进程的那枚）401。交接因此不能只凭
// “日志里最后一条 token 行”成立。
const DSH_STUB = `#!/usr/bin/env node
const fs = require('fs')
const http = require('http')
const path = require('path')
const at = process.argv.indexOf('--port')
const port = Number(process.argv[at + 1])
const token = 'TOKEN' + process.pid
const server = http.createServer((req, res) => {
  const url = String(req.url || '')
  const asked = /^\\/\\?token=([^&]+)$/.exec(url)
  if (asked) {
    if (asked[1] === token) {
      res.writeHead(303, { location: '/', 'set-cookie': 'dsh-auth-stub=1' })
      res.end()
    } else {
      res.writeHead(401, { 'content-type': 'text/plain' })
      res.end('dsh web authentication required')
    }
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: true, pid: process.pid, port, runtime: 'node' }))
  if (url.includes('action=stop-self')) {
    setImmediate(() => server.close(() => process.exit(0)))
  }
})
server.listen(port, '127.0.0.1', () => {
  const announce = () => console.log('dsh web: http://127.0.0.1:' + port + '/?token=' + token)
  try {
    fs.writeFileSync(path.join(__dirname, 'fake-dsh-' + port + '.pid'), String(process.pid))
  } catch (error) {}
  // 真实 dsh 可能先应答 action=self、后把 token 行写进 stdout；slow-token 标记让这个
  // 顺序在测试里确定性地出现，交接必须等 token 而不是立刻失败。
  if (fs.existsSync(path.join(__dirname, 'slow-token'))) setTimeout(announce, 800)
  else announce()
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0))
`

const writeExecutable = (dir, name, body) => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, body)
  fs.chmodSync(file, 0o755)
  return file
}

// 把 tmux 与 dsh 放进 PATH 最前面，让 launchInSession 选到它们；退出时恢复 PATH、按
// pid 文件停掉假实例并删掉目录。默认 PATH 已被模块顶部置空，所以不会碰到真 tmux。
const withSessionTools = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-session-'))
  const savedPath = process.env.PATH
  writeExecutable(dir, 'tmux', TMUX_STUB)
  writeExecutable(dir, 'dsh', DSH_STUB)
  // 假工具排在最前；真实 PATH 留在后面，让会话里的 `env`、`nohup` 和 node 仍可解析。
  process.env.PATH = dir + path.delimiter + REAL_PATH
  try {
    return await fn({ dir })
  } finally {
    process.env.PATH = savedPath
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('fake-dsh-') || !name.endsWith('.pid')) continue
      try {
        process.kill(Number(fs.readFileSync(path.join(dir, name), 'utf8')), 'SIGTERM')
      } catch (error) {}
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// 只有全局 dsh、没有会话工具时的 PATH。假 dsh 的 shebang 是 /usr/bin/env node，
// 因此把 node 指向当前解释器；PATH 里没有真实目录，开发机上的 tmux 不会被发现。
const withDshOnly = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-cli-'))
  const savedPath = process.env.PATH
  writeExecutable(dir, 'dsh', DSH_STUB)
  fs.symlinkSync(process.execPath, path.join(dir, 'node'))
  process.env.PATH = dir
  try {
    return await fn({ dir })
  } finally {
    process.env.PATH = savedPath
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('fake-dsh-') || !name.endsWith('.pid')) continue
      try {
        process.kill(Number(fs.readFileSync(path.join(dir, name), 'utf8')), 'SIGTERM')
      } catch (error) {}
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.on('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolve(port))
  })
})

// agent 工具通过第二扇门到达同一守卫，因此这里需要一个捕获定义的 services，以及可
// 解析的 @deepseek-ai/dsh-tools：loadDefineTool 会退回 createRequire(dshBin())，这是
// 未安装真实 harness 时唯一可用的解析路径。
const stubToolsResolution = (home) => {
  const dshDir = path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  const toolsDir = path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools')
  fs.mkdirSync(dshDir, { recursive: true })
  fs.mkdirSync(toolsDir, { recursive: true })
  fs.writeFileSync(path.join(dshDir, 'bin.js'), '')
  fs.writeFileSync(path.join(toolsDir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-tools', version: '0.0.0', main: 'index.js'
  }))
  fs.writeFileSync(path.join(toolsDir, 'index.js'), 'module.exports = { defineTool: (d) => d }\n')
}

const mountTools = async ({ config, port }) => {
  const registered = []
  const { dispose } = mount({ config, port, tools: { register: (def) => { registered.push(def) } } })
  // mountAgentTools 异步解析模块：等待定义完成注册，而不是假定 apply 返回时已经
  // 注册完毕。
  const deadline = Date.now() + 3000
  while (registered.length < 6 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return { registered, dispose }
}

test('action=stop refuses a target whose own report says desktop, without forwarding', async () => {
  const r = await withFakeTarget({ self: (port) => ({ ok: true, pid: 4242, port, runtime: 'desktop' }) }, async ({ port, seen }) => {
    const out = await callApi('action=stop&port=' + port, 'POST')
    return { out, seen: [...seen] }
  })
  assert.equal(r.out.status, 200)
  assert.equal(r.out.json.ok, false)
  assert.equal(r.out.json.code, 'stop_desktop_refused')
  // 拒绝来自询问目标：从不探测的实现会连普通 web 实例一起拒绝，这个用例固定的正是
  // 这一点。
  assert.equal(r.seen.filter((u) => u.includes('action=self')).length, 1)
  assert.equal(r.seen.some((u) => u.includes('stop-self')), false, 'a refused stop is never forwarded')
})

test('action=stop still forwards when the target is not desktop or does not say', async () => {
  const node = await withFakeTarget({ self: (port) => ({ ok: true, pid: 7, port, runtime: 'node' }), ack: { ok: true } }, async ({ port, seen }) => {
    const out = await callApi('action=stop&port=' + port, 'POST')
    return { out, seen: [...seen] }
  })
  assert.equal(node.out.json.ok, true)
  assert.equal(node.seen.filter((u) => u.includes('action=stop-self')).length, 1)

  // 没有 runtime 的报告不是桌面宿主的证据：执行原有转发，调用方得到原有结论。
  const silent = await withFakeTarget({ self: (port) => ({ ok: true, pid: 9, port }) }, async ({ port, seen }) => {
    const out = await callApi('action=stop&port=' + port, 'POST')
    return { out, seen: [...seen] }
  })
  assert.equal(silent.out.json.code, 'stop_unconfirmed')
  assert.equal(silent.seen.filter((u) => u.includes('action=stop-self')).length, 1)

  // 完全没有应答也一样：同一契约，同一结论。
  const http = await import('node:http')
  const originalWarn = console.warn
  console.warn = () => {}
  let server
  try {
    server = http.createServer((req, res) => { res.writeHead(200); res.end('{}') })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const gone = server.address().port
    await new Promise((resolve) => server.close(resolve))
    const r = await callApi('action=stop&port=' + gone, 'POST')
    assert.equal(r.json.code, 'stop_unconfirmed')
  } finally {
    console.warn = originalWarn
  }
})

test('action=stop-all skips a desktop row, and a desktop host never stops itself', async () => {
  await withTempHome(async ({ exits }) => {
    const r = await withFakeTarget({ self: (port) => ({ ok: true, pid: 4242, port, runtime: 'desktop' }) }, async ({ port, seen }) => {
      const out = await asDesktopHost(() => callApiFull({
        query: 'action=stop-all',
        method: 'POST',
        remoteAddress: '127.0.0.1',
        config: { startup: { portRange: String(port) } },
        port: 3600
      }))
      return { out, seen: [...seen] }
    })
    assert.equal(r.out.status, 200)
    assert.equal(r.out.json.ok, true)
    assert.equal(r.out.json.skippedDesktop, 1, '桌面行被报告为跳过')
    assert.equal(r.out.json.stoppedRemote, 0)
    assert.equal(r.out.json.stoppedSelf, false, 'the desktop host keeps serving')
    assert.equal(r.seen.some((u) => u.includes('stop-self')), false)
    assert.deepEqual(exits, [], '并且不安排自退出')
  })
})

test('a node host skips the desktop row too, and still stops itself', async () => {
  await withTempHome(async ({ exits }) => {
    const r = await withFakeTarget({ self: (port) => ({ ok: true, pid: 4242, port, runtime: 'desktop' }) }, async ({ port, seen }) => {
      const out = await callApiFull({
        query: 'action=stop-all',
        method: 'POST',
        remoteAddress: '127.0.0.1',
        config: { startup: { portRange: String(port) } },
        port: 3600
      })
      return { out, seen: [...seen] }
    })
    assert.equal(r.out.json.skippedDesktop, 1)
    assert.equal(r.out.json.stoppedRemote, 0)
    assert.equal(r.out.json.stoppedSelf, true)
    assert.equal(r.seen.some((u) => u.includes('stop-self')), false)
    assert.deepEqual(exits, [0], '普通宿主仍按请求离开')
  })
})

test('the agent stop tool refuses a desktop target and never forwards it', async () => {
  await withTempHome(async ({ home }) => {
    stubToolsResolution(home)
    const desktop = await withFakeTarget({ self: (port) => ({ ok: true, pid: 4242, port, runtime: 'desktop' }) }, async ({ port, seen }) => {
      const { registered, dispose } = await mountTools({ config: { startup: { portRange: String(port) } }, port: 3600 })
      try {
        const def = registered.find((d) => d.name === 'instance_stop')
        assert.ok(def, '停止工具已注册到假服务')
        return { out: await def.execute({ port }), seen: [...seen] }
      } finally {
        dispose()
      }
    })
    assert.equal(desktop.out.ok, false)
    assert.equal(desktop.out.code, 'stop_desktop_refused')
    assert.equal(desktop.seen.some((u) => u.includes('stop-self')), false)
  })
})

// ---- action=restart（同一端口原地重启）-------------------------------------
// 顺序是契约：转发 stop → 端口真正空出来 → 同端口启动。三步任何一步被跳过，得到的
// 都不是"原端口重启"——换端口等于换了一个实例。
//
// 假实例可以真实地停机：转发 stop-self 之后关闭自己的监听器，这与优雅退出在端口上的
// 表现相同，因此后面的端口等待与同端口启动跑的是真实路径。
const withRestartableTarget = async (opts, fn) => {
  const http = await import('node:http')
  const seen = []
  const server = http.createServer((req, res) => {
    const url = String(req.url)
    seen.push(url)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, pid: 7, port: server.address().port, runtime: 'node' }))
    if (url.includes('action=stop-self')) {
      // 优雅退出：应答之后监听器才结算。这里同步关闭，让端口等待看到真实的释放过程。
      setImmediate(() => server.close())
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    return await fn({ port: server.address().port, seen })
  } finally {
    try { server.closeAllConnections() } catch (e) { }
    await new Promise((resolve) => server.close(resolve))
  }
}

test('action=restart forwards the stop, waits for the port, and launches on the same port', async () => {
  await withTempHome(async ({ home }) => {
    // 一个可解析的启动器：重启必须真的走到派生那一步，而不是停在 no_dsh_bin 上。
    stubToolsResolution(home)
    const r = await withRestartableTarget({}, async ({ port, seen }) => {
      const out = await callApiFull({
        query: 'action=restart&port=' + port,
        method: 'POST',
        remoteAddress: '127.0.0.1',
        config: { startup: { portRange: String(port) } },
        port: 3600
      })
      return { out, seen: [...seen], port }
    })
    assert.equal(r.out.status, 200)
    assert.equal(r.seen.filter((u) => u.includes('action=stop-self')).length, 1,
      '停止必须先转发，让目标经自己的 appExit 优雅退出')
    // 同端口启动：启动器日志按端口命名，因此文件存在即证明派生发生在同一个端口上。
    assert.equal(fs.existsSync(path.join(home, 'launcher', 'logs', 'server-' + r.port + '.out.log')), true,
      '重启必须在原端口派生新实例')
    assert.equal(r.out.json.port, r.port, '端口不变：换端口等于换了一个实例')
  })
})

test('action=restart refuses the current instance without forwarding anything', async () => {
  const r = await callApiFull({
    query: 'action=restart&port=3600',
    method: 'POST',
    remoteAddress: '127.0.0.1',
    port: 3600
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, false)
  assert.equal(r.json.code, 'restart_current_refused',
    '没有持久化会话时，提供面板的进程仍然会随重启一起离开')
})

test('action=restart hands the current instance over to a persistent session, then jumps to it', async () => {
  await withTempHome(async ({ home, exits }) => {
    await withSessionTools(async ({ dir }) => {
      fs.writeFileSync(path.join(dir, 'slow-token'), '')
      const port = await freePort()
      const r = await callApiFull({
        query: 'action=restart&port=3600',
        method: 'POST',
        remoteAddress: '127.0.0.1',
        config: { startup: { portRange: String(port) } },
        port: 3600
      })
      assert.equal(r.status, 200)
      assert.equal(r.json.ok, true)
      assert.equal(r.json.code, 'handoff')
      // 替代实例必须换到新端口：同端口无法在旧进程离开前就绪。
      assert.equal(r.json.port, port)
      assert.equal(r.json.session.tool, 'tmux')
      assert.match(r.json.session.name, /^dshim-/)
      // 跳转目标带替代实例自己的启动 token（假 dsh 按进程生成），浏览器落到那里时
      // 不必再登录一次。
      assert.match(r.json.url, new RegExp('^http://127\\.0\\.0\\.1:' + port + '/\\?token=TOKEN\\d+$'))
      assert.equal(r.json.bin, path.join(dir, 'dsh'),
        '没有 profile 启动器时，会话里执行的是 PATH 上的 dsh web')
      // 取代者就绪后旧进程必须退出，否则面板会一直留在旧端口上。
      assert.deepEqual(exits, [0])
      assert.match(fs.readFileSync(path.join(home, 'launcher', 'logs', 'server-' + port + '.out.log'), 'utf8'),
        /dsh web:/, '替代实例的启动输出落在按端口命名的日志里')
    })
  })
})

test('action=restart ignores a token the previous process on that port left in the log', async () => {
  await withTempHome(async ({ home, exits }) => {
    await withSessionTools(async ({ dir }) => {
      // 替代实例先应答 action=self、后写 token 行：交接发生在只有旧行的那一刻。
      fs.writeFileSync(path.join(dir, 'slow-token'), '')
      const port = await freePort()
      // 启动日志按端口命名且是追加的：这个端口上一代实例的 token 行仍在文件里，重启
      // 复用同一端口后它排在新行之前。它格式完全合法，却是上一代进程的，浏览器带着
      // 它过去只会落到 401。
      const logDir = path.join(home, 'launcher', 'logs')
      fs.mkdirSync(logDir, { recursive: true })
      fs.writeFileSync(path.join(logDir, 'server-' + port + '.out.log'),
        'dsh web: http://127.0.0.1:' + port + '/?token=STALETOKEN\n')
      const r = await callApiFull({
        query: 'action=restart&port=3600',
        method: 'POST',
        remoteAddress: '127.0.0.1',
        config: { startup: { portRange: String(port) } },
        port: 3600
      })
      assert.equal(r.status, 200)
      assert.equal(r.json.code, 'handoff')
      assert.doesNotMatch(r.json.url, /STALETOKEN/,
        '上一代进程的 token 不能交给浏览器：它已被替代实例以 401 拒绝')
      assert.match(r.json.url, /token=TOKEN\d+$/)
      assert.deepEqual(exits, [0], '交接成功时旧进程照常退出')
    })
  })
})

test('action=start runs dsh web inside the session tool when no profile launcher exists', async () => {
  await withTempHome(async ({ home }) => {
    await withSessionTools(async ({ dir }) => {
      const port = await freePort()
      const r = await callApiFull({
        query: 'action=start&port=' + port,
        method: 'POST',
        remoteAddress: '127.0.0.1',
        config: { startup: { portRange: String(port) } },
        port: 3600
      })
      assert.equal(r.status, 200)
      assert.equal(r.json.ok, true)
      assert.equal(r.json.port, port)
      assert.equal(r.json.bin, path.join(dir, 'dsh'))
      assert.equal(r.json.session.tool, 'tmux')
      assert.equal(r.json.pid, 12345, 'tmux 会话里取到的 pane pid')
      assert.match(fs.readFileSync(path.join(home, 'launcher', 'logs', 'server-' + port + '.out.log'), 'utf8'),
        /dsh web:/)
    })
  })
})

test('action=start falls back to the dsh on PATH when there is no session tool', async () => {
  await withTempHome(async ({ home }) => {
    await withDshOnly(async ({ dir }) => {
      const port = await freePort()
      const r = await callApiFull({
        query: 'action=start&port=' + port,
        method: 'POST',
        remoteAddress: '127.0.0.1',
        config: { startup: { portRange: String(port) } },
        port: 3600
      })
      assert.equal(r.status, 200)
      assert.equal(r.json.ok, true)
      assert.equal(r.json.port, port)
      assert.equal(r.json.bin, path.join(dir, 'dsh'))
      assert.equal(r.json.session, undefined, '没有会话工具时仍是直接派生')
      assert.match(fs.readFileSync(path.join(home, 'launcher', 'logs', 'server-' + port + '.out.log'), 'utf8'),
        /dsh web:/)
    })
  })
})

test('action=list advertises the session tool panel launches will use', async () => {
  await withTempHome(async () => {
    await withSessionTools(async () => {
      const r = await callApiFull({
        query: 'action=list',
        remoteAddress: '127.0.0.1',
        config: { startup: { portRange: '65530' } },
        port: 3600
      })
      assert.equal(r.json.selfSession, 'tmux')
    })
  })
})

test('action=restart refuses a desktop target without forwarding anything', async () => {
  const r = await withFakeTarget({ self: (port) => ({ ok: true, pid: 4242, port, runtime: 'desktop' }) }, async ({ port, seen }) => {
    const out = await callApi('action=restart&port=' + port, 'POST')
    return { out, seen: [...seen] }
  })
  assert.equal(r.out.status, 200)
  assert.equal(r.out.json.code, 'stop_desktop_refused')
  assert.equal(r.seen.some((u) => u.includes('stop-self')), false, 'a refused restart is never forwarded')
})

test('action=restart reports an unconfirmed stop instead of starting a second instance', async () => {
  const r = await withFakeTarget({ self: (port) => ({ ok: true, pid: 7, port, runtime: 'node' }), ack: { ok: false } }, async ({ port, seen }) => {
    const out = await callApi('action=restart&port=' + port, 'POST')
    return { out, seen: [...seen] }
  })
  assert.equal(r.out.json.ok, false)
  assert.equal(r.out.json.code, 'stop_unconfirmed',
    '目标没有确认停止时不得启动第二个实例占住同一端口')
})

test('action=restart requires POST and a usable port', async () => {
  const get = await callApi('action=restart&port=3080', 'GET')
  assert.equal(get.status, 405)
  assert.equal(get.json.code, 'need_post')
  assert.match(get.json.error, /restart/, '回显被拒绝的 action')
  for (const bad of [TRAVERSAL, '80.5', '1e3', '0', '65536', 'abc', '']) {
    const r = await callApi('action=restart&port=' + encodeURIComponent(bad), 'POST')
    assert.equal(r.status, 400, 'port=' + bad)
    assert.equal(r.json.code, 'no_port', 'port=' + bad)
  }
})

test('the agent restart tool refuses the current instance and a desktop target', async () => {
  await withTempHome(async ({ home }) => {
    stubToolsResolution(home)
    const current = await mountTools({ config: { startup: { portRange: '3600' } }, port: 3600 })
    try {
      const def = current.registered.find((d) => d.name === 'instance_restart')
      assert.ok(def, '重启工具已注册到假服务')
      const self = await def.execute({ port: 3600 })
      assert.equal(self.ok, false)
      assert.equal(self.code, 'restart_current_refused')
      assert.equal((await def.execute({ port: 0 })).code, 'bad_port')
      assert.equal((await def.execute({ port: 70000 })).code, 'bad_port')
    } finally {
      current.dispose()
    }

    const desktop = await withFakeTarget({ self: (port) => ({ ok: true, pid: 4242, port, runtime: 'desktop' }) }, async ({ port, seen }) => {
      const { registered, dispose } = await mountTools({ config: { startup: { portRange: String(port) } }, port: 3600 })
      try {
        const def = registered.find((d) => d.name === 'instance_restart')
        return { out: await def.execute({ port }), seen: [...seen] }
      } finally {
        dispose()
      }
    })
    assert.equal(desktop.out.ok, false)
    assert.equal(desktop.out.code, 'stop_desktop_refused')
    assert.equal(desktop.seen.some((u) => u.includes('stop-self')), false)
  })
})

test('the agent stop tool still stops an ordinary target', async () => {
  await withTempHome(async ({ home }) => {
    stubToolsResolution(home)
    const r = await withFakeTarget({ self: (port) => ({ ok: true, pid: 7, port, runtime: 'node' }), ack: { ok: true } }, async ({ port }) => {
      const { registered, dispose } = await mountTools({ config: { startup: { portRange: String(port) } }, port: 3600 })
      try {
        const def = registered.find((d) => d.name === 'instance_stop')
        return { out: await def.execute({ port }) }
      } finally {
        dispose()
      }
    })
    assert.equal(r.out.ok, true, '守卫不得把每次工具停止都变成拒绝')
  })
})

// ---- action=start（显式端口）--------------------------------------------
// 缺少端口时保留自动选择；提供端口就是调用方明确表达的意图。两种出错方式是吞掉非法值
// 后静默自动选择，以及把“已被占用”报告成普通的启动失败。
test('action=start rejects an unusable port instead of falling back to auto', async () => {
  for (const bad of [TRAVERSAL, '80.5', '1e3', '0', '65536', 'abc', '-1', '99999']) {
    const r = await callApi('action=start&port=' + encodeURIComponent(bad), 'POST')
    assert.equal(r.status, 400, 'port=' + bad)
    assert.equal(r.json.code, 'no_port', 'port=' + bad)
  }
})

test('action=start reports a requested port that is already serving', async () => {
  // 在临时端口上启动真实监听器：tryConnect 必须判定它已被占用。
  const net = await import('node:net')
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const busy = server.address().port
  try {
    const r = await callApi('action=start&port=' + busy, 'POST')
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.code, 'port_in_use')
    assert.equal(r.json.port, busy, 'the answer names the port that was requested')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('action=open reports a missing log instead of redirecting to a bare root', async () => {
  // 不是本宿主启动的实例（没有启动器日志）没有可读的 token。重定向到裸根地址会重现
  // 那次 401。
  const r = await openRedirect('action=open&port=3199')
  assert.equal(r.status, 409)
  assert.match(r.body, /launch_token_unavailable/)
})

test('action=open refuses a port that is not an integer in range', async () => {
  for (const bad of [TRAVERSAL, '80.5', '1e3', '0', '65536', 'abc', '']) {
    const r = await openRedirect('action=open&port=' + encodeURIComponent(bad))
    assert.equal(r.status, 400, 'port=' + bad)
    assert.match(r.body, /no_port/)
  }
})

test('action=logs refuses a port that is not an integer in range', async () => {
  // 端口会被拼进 $DSH_HOME/launcher/logs/server-<port>.*.log，因此这里的穿越字符串
  // 会构成真实的文件读取原语。
  for (const bad of [TRAVERSAL, '80.5', '1e3', '0', '65536', 'abc', '']) {
    const r = await callApi('action=logs&port=' + encodeURIComponent(bad))
    assert.equal(r.status, 400, 'port=' + bad)
    assert.equal(r.json.code, 'no_port')
  }
})

test('action=logs refuses a missing port, and reads a valid one', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-logs-'))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    assert.equal((await callApi('action=logs')).status, 400, 'logs has no "self" default')
    const ok = await callApi('action=logs&port=3080')
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.json, { ok: true, port: 3080, stream: 'out', exists: false, truncated: false, lines: [] })
    const err = await callApi('action=logs&port=3080&stream=err')
    assert.equal(err.json.stream, 'err')
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// 未配置任何内容的 `peer` 必须被拒绝，而不是静默用本机数据应答——这是“用错误答案代替
// 失败”的同一形状，会话摘要的端口问题也属于这一类。
test('action=logs rejects an unknown peer instead of falling back to local', async () => {
  const r = await callApi('action=logs&port=3080&peer=nope')
  assert.equal(r.status, 400)
  assert.equal(r.json.code, 'unknown_peer')
})

test('action=sessions rejects an unknown peer instead of falling back to local', async () => {
  const r = await callApi('action=sessions&port=3080&peer=nope')
  assert.equal(r.status, 400)
  assert.equal(r.json.code, 'unknown_peer')
})

// ---- action=diagnostics ---------------------------------------------------
// 崩溃黑匣子、自退出与写操作追踪此前只有写入路径。三份文件由本机所有实例共用，读取
// 必须按实例归属筛选，而且端口在这里同样会拼进文件名——校验与 logs 一样不可省。

const withDiagnosticLogs = async (files, fn) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-diag-'))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const dir = path.join(home, 'launcher', 'logs')
    fs.mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content)
    }
    return await fn()
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
}

test('action=diagnostics returns the three shared logs scoped to one instance', async () => {
  const r = await withDiagnosticLogs({
    'dshim-crash.log': [
      '[2026-01-02T03:04:05.000Z] uncaughtException pid=41 port=3080',
      'Error: boom',
      '    at tick (/tmp/a.js:1:1)',
      '[2026-01-02T03:05:05.000Z] uncaughtException pid=42 port=3080',
      'Error: neighbour',
      ''
    ].join('\n'),
    'dshim-selfexit.log': '[2026-01-02T03:04:06.000Z] self-exit trigger=stop-self pid=41 port=3080\n',
    'dshim-requests.log': '[2026-01-02T03:04:08.000Z] action=stop instance=3080 target=3081 via=local-browser peer=127.0.0.1 ua=browser\n'
  }, () => callApi('action=diagnostics&port=3080&pid=41'))
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.port, 3080)
  assert.equal(r.json.pid, 41)
  // 崩溃：头与栈一起出现，同机另一实例的记录不得混入。
  assert.deepEqual(r.json.crash.lines, [
    '[2026-01-02T03:04:05.000Z] uncaughtException pid=41 port=3080',
    'Error: boom',
    '    at tick (/tmp/a.js:1:1)'
  ])
  assert.equal(r.json.selfExit.lines.length, 1)
  assert.match(r.json.selfExit.lines[0], /pid=41/)
  // 写操作追踪按实例端口归属：这一行确实含有对端地址与 User-Agent。
  assert.equal(r.json.requests.lines.length, 1)
  assert.match(r.json.requests.lines[0], /peer=127\.0\.0\.1/)
})

test('action=diagnostics reports a missing log file instead of failing', async () => {
  const r = await withDiagnosticLogs({}, () => callApi('action=diagnostics&port=3080&pid=41'))
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  for (const key of ['crash', 'selfExit', 'requests']) {
    assert.deepEqual(r.json[key], { exists: false, truncated: false, lines: [] }, key)
  }
})

test('action=diagnostics refuses a port that is not an integer in range', async () => {
  // 端口在这里同样会拼进文件名，因此穿越字符串必须在这里就失败。
  for (const bad of [TRAVERSAL, '80.5', '1e3', '0', '65536', 'abc', '']) {
    const r = await callApi('action=diagnostics&port=' + encodeURIComponent(bad))
    assert.equal(r.status, 400, 'port=' + bad)
    assert.equal(r.json.code, 'no_port')
  }
})

// 诊断面回答的是"本机实例为什么消失了"，而写操作追踪每行含对端地址与请求携带的
// User-Agent。它因此不走 fleet：有效的 bearer 也不能打开它，非回环 Host 与可信
// 局域网浏览器的签名 cookie 同样不行。
test('action=diagnostics refuses every remote caller, bearer included', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-diagremote-'))
  const savedHome = process.env.DSH_HOME
  const savedToken = process.env.DSHIM_FLEET_TOKEN
  process.env.DSH_HOME = home
  process.env.DSHIM_FLEET_TOKEN = 'test-fleet-token'
  try {
    const bearer = await callApiFull({
      query: 'action=diagnostics&port=3080&pid=41',
      remoteAddress: '203.0.113.5',
      headers: { host: '127.0.0.1:3080', authorization: 'Bearer test-fleet-token' }
    })
    assert.equal(bearer.status, 403, '持有有效 fleet bearer 的对端仍然读不到诊断面')
    assert.equal(bearer.json.code, 'loopback_only')

    const lan = await callApiFull({
      query: 'action=diagnostics&port=3080&pid=41',
      host: 'lab.internal:3080',
      remoteAddress: '192.0.2.50',
      connection: { requestRejection: () => undefined }
    })
    assert.equal(lan.status, 403, 'trusted-LAN 浏览器的 Connection cookie 也不打开诊断面')
    assert.equal(lan.json.code, 'loopback_only')
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    if (savedToken === undefined) delete process.env.DSHIM_FLEET_TOKEN
    else process.env.DSHIM_FLEET_TOKEN = savedToken
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// 本地回环上的诊断面必须能应答，且不要求 bearer。
test('action=diagnostics answers a loopback peer without a token', async () => {
  const r = await withDiagnosticLogs({}, () => callApi('action=diagnostics&port=3080'))
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.pid, null, '没有 pid 就返回整份共享文件，而不是猜测归属')
})

// 诊断面同样拒绝跨站 Origin——它走的是严格回环守卫，不接受 fleetGuard 的宽松判定。
test('action=diagnostics is refused a cross-site request', async () => {
  const r = await callApiFull({
    query: 'action=diagnostics&port=3080',
    remoteAddress: '127.0.0.1',
    headers: { origin: 'http://evil.example' }
  })
  assert.equal(r.status, 403)
  assert.equal(r.json.code, 'bad_origin')
})

// ---- 会话摘要的标题与谱系 -----------------------------------------------
//
// 标题服务是可选的，而且刻意没有写进 `inject`：写进去会让没有该服务的组合停在
// PENDING，宿主启动审计把那算作失败。下面的用例因此用「ctx.get 返回 undefined」
// 驱动降级路径，而不是断言 inject 的内容。

const LIVE_SESSION = {
  id: 'abcdef0123456789',
  header: { createdAt: 100, cwd: '/work/alpha', origin: 'subagent', agentPreset: 'reviewer', parentSession: 'aaa', delegationDepth: 1 },
  seq: 12
}

test('action=sessions carries the folded title when the optional service provides one', async () => {
  const r = await callApiFull({
    query: 'action=sessions',
    remoteAddress: '127.0.0.1',
    port: 3080,
    sessions: { list: () => [LIVE_SESSION] },
    sessionTitle: { get: () => ({ title: '修复登录' }) }
  })
  assert.equal(r.json.ok, true)
  assert.deepEqual(r.json.sessions, [{
    id: 'abcdef0123456789',
    createdAt: 100,
    title: '修复登录',
    cwd: '/work/alpha',
    subagent: true,
    agentPreset: 'reviewer',
    parentSession: 'aaa',
    delegationDepth: 1,
    events: 12
  }])
})

// 跨版本 fleet 的前提：服务缺失时摘要必须与增补之前逐字节相同，混入 title:null 会让
// 对端输出 schema（additionalProperties: false）之外的编造值变成 ToolOutputError。
test('action=sessions without the title service answers exactly the pre-enrichment payload', async () => {
  const plain = {
    id: 'abcdef0123456789',
    header: { createdAt: 100, cwd: '/work/alpha', origin: 'subagent' },
    seq: 12
  }
  const before = JSON.stringify({
    ok: true,
    port: 3080,
    total: 1,
    sessions: [{
      id: 'abcdef0123456789',
      createdAt: 100,
      cwd: '/work/alpha',
      subagent: true,
      events: 12
    }]
  })
  const missing = await callApiFull({
    query: 'action=sessions',
    remoteAddress: '127.0.0.1',
    port: 3080,
    sessions: { list: () => [plain] }
  })
  assert.equal(JSON.stringify(missing.json), before, '服务缺失时逐字节相同')

  // 服务在但会话还没有合格标题时同样不写该键——`get` 返回 undefined 是真实存在的状态
  // （用户还没有发出第一条消息）。
  const untitled = await callApiFull({
    query: 'action=sessions',
    remoteAddress: '127.0.0.1',
    port: 3080,
    sessions: { list: () => [plain] },
    sessionTitle: { get: () => undefined }
  })
  assert.equal(JSON.stringify(untitled.json), before, '没有标题时同样省略该键')
})

// 客户端会把缺失的 `peer` 字符串化成字面量 "undefined"，它到达宿主时是一个格式合法的
// peer id，会让每一次本机读取都走（总是失败的）对端路径——本机日志会一直停在“加载
// 中”。哨兵值表示“没有对端”，这些客户端因此仍读本机。
test('a stringified absent peer is read as no peer, not as a peer named undefined', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-peer-'))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    for (const sentinel of ['undefined', 'null', '']) {
      const logs = await callApi('action=logs&port=3080&peer=' + sentinel)
      assert.equal(logs.status, 200, 'peer=' + sentinel)
      assert.equal(logs.json.ok, true, 'peer=' + sentinel + ' must not route through a peer')

      const sess = await callApi('action=sessions&peer=' + sentinel)
      assert.equal(sess.status, 200, 'peer=' + sentinel)
      assert.equal(sess.json.ok, true, 'peer=' + sentinel + ' must not route through a peer')
    }
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('action=sessions refuses a present-but-invalid port, allows an absent one', async () => {
  // 省略表示“本实例”，因此必须保持合法——只有调用方实际给出的值才被拒绝，否则一个
  // 笔误会静默应答成另一个实例。
  const bad = await callApi('action=sessions&port=' + encodeURIComponent(TRAVERSAL))
  assert.equal(bad.status, 400)
  assert.equal(bad.json.code, 'no_port')

  const self = await callApi('action=sessions')
  assert.equal(self.status, 200, 'an omitted port means this instance, not a bad request')
  assert.equal(self.json.ok, true)
})

// stop 操作会把 stop-self 转发到目标端口，因此“什么算端口”必须与 logs/sessions 完全
// 一致：stop 用 normalizePort 解析，它拒绝 '1e3'、'0x10' 与 '+80'（Number() 会把它们
// 读成 1000、16、80——stop 会转发 logs 以 400 拒绝的端口），也拒绝小数与负数，避免
// http.get 在处理器内抛出 ERR_SOCKET_BAD_PORT，把坏请求变成 500。
test('action=stop parses the port with the same rule as logs and sessions', async () => {
  for (const bad of [TRAVERSAL, '1e3', '0x10', '80.5', '-1', '+80', '0', '65536', 'abc', '']) {
    const r = await callApi('action=stop&port=' + encodeURIComponent(bad), 'POST')
    assert.equal(r.status, 400, 'port=' + bad)
    assert.equal(r.json.code, 'no_port', 'port=' + bad)
  }
  // 完全省略同样是坏请求，绝不能被理解成“停止某个东西”。
  const none = await callApi('action=stop', 'POST')
  assert.equal(none.status, 400)
  assert.equal(none.json.code, 'no_port')
})

test('action=stop still requires POST before it looks at the port', async () => {
  // 405 必须优先：GET 的 stop 绝不能被解析，更不能被转发。
  const r = await callApi('action=stop&port=1e3', 'GET')
  assert.equal(r.status, 405)
  assert.equal(r.json.code, 'need_post')
  // 嵌入的入口按大小写不敏感匹配方法，因此小写 `post` 通过它，由端口解析器返回 400。
  // 在挂载路由上固定这一点，是因为大小写不敏感匹配正是本包发布的入口行为（见其绑定
  // 处的说明）。
  const lowered = await callApi('action=stop&port=1e3', 'post')
  assert.notEqual(lowered.status, 405, '小写方法不会被当作非 POST 拒绝')
  assert.equal(lowered.status, 400, '它到达了端口解析器，也就是下一道关卡')
  assert.equal(lowered.json.code, 'no_port')
})

// 发现扫描按设计会不断遇到关闭的端口，那里的失败是刻意的安静——但调用方明确要求的
// 读取不是。两类失败都解析为同一个被吞掉的 `null`，因此“API 路径被其他服务占据”和
// “这个实例已经离开”要在宿主日志中分开说明，各自带类名。调用方看到的值不变，只是
// 增加了诊断。
test('a forwarded read tells an unparsable answer from no answer at all', async () => {
  const http = await import('node:http')
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  let server
  let port
  try {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html>something else lives here</html>')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = server.address().port

    const junk = await callApi('action=sessions&port=' + port)
    assert.equal(junk.json.ok, false, '应答形状不变')
    assert.equal(junk.json.code, 'sessions_unavailable')
    assert.equal(warnings.filter((l) => /\[body\]/.test(l)).length, 1, '恰好一行，归类为正文失败')
    assert.match(warnings[0], /content-type=text\/html/, '并说明是谁应答的')
    assert.match(warnings[0], new RegExp(':' + port + ' failed'), '并指明端口')

    warnings.length = 0
    await new Promise((resolve) => server.close(resolve))
    const gone = await callApi('action=sessions&port=' + port)
    assert.equal(gone.json.code, 'sessions_unavailable', '另一种失败得到同样的应答')
    assert.equal(warnings.filter((l) => /\[request\]/.test(l)).length, 1, '改归类为请求失败')
    assert.equal(warnings.some((l) => /\[body\]/.test(l)), false)
  } finally {
    console.warn = originalWarn
    if (server && server.listening) await new Promise((resolve) => server.close(resolve))
  }
})

// 盲扫 50 个端口会遇到 49 个关闭的端口：同样的失败绝不能进入日志，否则每次面板刷新
// 都会写 50 行。
test('the discovery sweep stays silent about ports that do not answer', async () => {
  const http = await import('node:http')
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  let server
  try {
    server = http.createServer((req, res) => { res.writeHead(404); res.end('nope') })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    // 某个端口的心跳是新鲜的、但应答的不是 API，这是常规情况：实例被强杀，别的进程
    // 接管了端口，发现流程落到原始探测。该读取的调用方没有设定预期，因此不得记录。
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-sweep-'))
    const savedHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const dir = path.join(home, 'run', 'instances')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, server.address().port + '.json'), JSON.stringify({
        pid: 1, port: server.address().port, startedAt: Date.now(), ts: Date.now()
      }))
      const r = await callApi('action=list')
      assert.equal(r.status, 200)
      assert.deepEqual(warnings, [], '不再应答的心跳是正常情况')
    } finally {
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
      fs.rmSync(home, { recursive: true, force: true })
    }
  } finally {
    console.warn = originalWarn
    if (server && server.listening) await new Promise((resolve) => server.close(resolve))
  }
})

// POST 入口来自嵌入的 `dsh-host-http` 片段，这里固定本包已发布的形状：`need_post`
// code 与正文中被拒绝的 `action`。两者都由策略提供，重新同步片段时若丢掉覆盖，应答会
// 变成 `{ code: 'method' }`，所有按 code 分支或读回 action 的调用方都会失效。
test('the 405 keeps this package\'s published body: need_post plus the action', async () => {
  const r = await callApi('action=stop&port=3080', 'GET')
  assert.equal(r.status, 405)
  assert.equal(r.json.ok, false)
  assert.equal(r.json.code, 'need_post', '不是片段的默认值 "method"')
  assert.equal(r.json.action, 'stop')
  assert.equal(r.json.error, 'stop 需要 POST 请求')
})

// 路由应答包含实例端口、pid 与会话摘要，因此 `cache-control: no-store` 是边界的一部分，
// 而不是没人读取的响应头：缓存了 `action=list` 的中间层会继续把已死实例的 pid 发给
// 下一个询问的浏览器。
test('every route answer forbids caching, including the rejections', async () => {
  const { call, dispose } = mountCaller()
  try {
    for (const [query, method] of [
      ['action=list', 'GET'],
      ['action=self', 'GET'],
      ['action=sessions', 'GET'],
      ['action=stop&port=3080', 'GET']
    ]) {
      const r = await call({ query, method })
      assert.ok(r.heads.length > 0, query + ' answered')
      for (const h of r.heads) {
        assert.equal(h.headers['cache-control'], 'no-store', query + ' (' + h.code + ')')
        assert.match(String(h.headers['content-type']), /application\/json/, query + ' (' + h.code + ')')
      }
    }
  } finally {
    dispose()
  }
})

// 500 是唯一不能信任其文字的应答：意外异常的消息会引用路径、来源，以及对端写进响应的
// 任何内容。原始文字属于宿主日志；正文只带客户端已经本地化的 code。
test('an unexpected handler failure answers a fixed code, never the raw message', async () => {
  const { routes, dispose } = mount()
  const originalError = console.error
  const logged = []
  console.error = (...args) => { logged.push(args.map(String).join(' ')) }
  try {
    const route = routes.find((r) => r.path === API_PATH)
    let status = 0
    let body = ''
    const res = {
      writeHead: (code) => { status = code },
      end: (chunk) => { body = chunk }
    }
    // 绝对但格式错误的请求目标会让处理器内的 `new URL(req.url)` 抛出，也就是一次
    // 真正的意外失败。
    await route.handler(
      { url: 'http://[', method: 'GET', headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } },
      res
    )
    const json = JSON.parse(body)
    assert.equal(status, 500)
    assert.equal(json.ok, false)
    assert.equal(json.code, 'internal', '客户端会把这个 code 映射为自己的措辞')
    assert.doesNotMatch(String(json.error), /Invalid URL|invalid url/i, '异常文字没有进入正文')
    assert.equal(logged.some((line) => /Invalid URL|invalid url/i.test(line)), true,
      '而是进入了宿主日志')
  } finally {
    console.error = originalError
    dispose()
  }
})

test('disposal releases the process fatal-path hooks', () => {
  const before = process.listenerCount('uncaughtException')
  const beforeRejection = process.listenerCount('unhandledRejection')
  const { dispose } = mount()
  assert.equal(process.listenerCount('uncaughtException'), before + 1)
  assert.equal(process.listenerCount('unhandledRejection'), beforeRejection + 1)
  dispose()
  assert.equal(process.listenerCount('uncaughtException'), before)
  assert.equal(process.listenerCount('unhandledRejection'), beforeRejection)
})

// ---- 伪造回环 Host 绕过 fleet bearer --------------------------------------
// 远端攻击者无法设置 socket 对端，只能设置 Host 头。bearer 关卡因此必须由真实 TCP
// 对端驱动，而不是 Host。
test('a forged loopback Host from an off-loopback peer cannot skip the bearer (stop-all stays unexecuted)', async () => {
  // 未配置 fleet token：远端面必须失败关闭。
  const r = await callApiFull({
    query: 'action=stop-all',
    method: 'POST',
    remoteAddress: '203.0.113.5',
    headers: { host: '127.0.0.1:3080' }
  })
  assert.equal(r.status, 403, '非回环对端必须先通过 bearer')
  assert.equal(r.json.code, 'fleet_auth', '写操作根本没有被执行')
  assert.notEqual(typeof r.json.stoppedRemote, 'number', 'stop-all 没有执行')
})

test('a configured fleet token unlocks the remote mode for an off-loopback peer', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-remote-'))
  const savedHome = process.env.DSH_HOME
  const savedToken = process.env.DSHIM_FLEET_TOKEN
  process.env.DSH_HOME = home
  process.env.DSHIM_FLEET_TOKEN = 'test-fleet-token'
  try {
    const r = await callApiFull({
      query: 'action=logs&port=3080',
      method: 'GET',
      remoteAddress: '203.0.113.5',
      headers: { host: '127.0.0.1:3080', authorization: 'Bearer test-fleet-token' }
    })
    assert.equal(r.status, 200, '远端对端携带有效 bearer 时允许访问')
    assert.equal(r.json.ok, true)
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    if (savedToken === undefined) delete process.env.DSHIM_FLEET_TOKEN
    else process.env.DSHIM_FLEET_TOKEN = savedToken
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('the profile entry config serves the fleet token (0.1.7-rc.1, no settings service)', async () => {
  // 0.1.7-rc.1 不再提供 `settings.register`，live 分节唯一剩下的来源就是 cordis 交给
  // apply() 的 config。这与上面的环境变量 token 用例是同一断言，只是值来自 config，
  // 且环境变量刻意未设置——否则 base 层会提供它，测试会在新路径完全没生效的情况下
  // 通过。
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-entrycfg-'))
  const savedHome = process.env.DSH_HOME
  const savedToken = process.env.DSHIM_FLEET_TOKEN
  process.env.DSH_HOME = home
  delete process.env.DSHIM_FLEET_TOKEN
  try {
    const r = await callApiFull({
      query: 'action=logs&port=3080',
      method: 'GET',
      remoteAddress: '203.0.113.5',
      headers: { host: '127.0.0.1:3080', authorization: 'Bearer from-entry-config' },
      config: { live: { fleetToken: 'from-entry-config' } }
    })
    assert.equal(r.status, 200, '条目配置必须到达 resolveFleetToken')
    assert.equal(r.json.ok, true)
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    if (savedToken === undefined) delete process.env.DSHIM_FLEET_TOKEN
    else process.env.DSHIM_FLEET_TOKEN = savedToken
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('an RC1 trusted-host browser uses Connection without becoming a fleet peer', async () => {
  let checked = 0
  const r = await callApiFull({
    query: 'action=list',
    host: 'lab.internal:3080',
    remoteAddress: '192.0.2.50',
    connection: {
      requestRejection(req) {
        checked += 1
        assert.equal(req.headers.host, 'lab.internal:3080')
        return undefined
      }
    }
  })
  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.json.items))
  assert.equal(checked, 1)
})

test('loopback peers (127.0.0.1, ::1, ::ffff:127.0.0.1) need no bearer', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-lb-'))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const r = await callApiFull({ query: 'action=logs&port=3080', remoteAddress: peer })
      assert.equal(r.status, 200, peer)
      assert.equal(r.json.ok, true, peer)
    }
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a request with no socket peer fails closed at the guard', async () => {
  const r = await callApiFull({ query: 'action=list', remoteAddress: undefined })
  assert.equal(r.status, 403)
  assert.equal(r.json.code, 'unknown_peer')
})

// 优雅自退出不会留下崩溃日志、诊断报告或 stderr 行，因此在日志中“服务我面板的实例
// 自己死了”和“有东西杀了它”看起来一样。每次自退出都记录是谁要求的，而且该记录必须
// 说明触发者，而不只是证明发生过退出。
test('a self-exit records its trigger before the process leaves', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-selfexit-'))
  const savedHome = process.env.DSH_HOME
  const savedExit = process.exit
  process.env.DSH_HOME = home
  // 退出在真实定时器上运行；测试过程中进程不能真的离开。
  const exits = []
  process.exit = (code) => { exits.push(code) }
  try {
    // 真实浏览器请求总带有回环 socket 对端；缺少它时守卫失败关闭，因此这里显式给出
    // 它所指的对端。
    const r = await callApiFull({ query: 'action=stop-self', method: 'POST', remoteAddress: '127.0.0.1' })
    assert.equal(r.status, 200, 'got ' + JSON.stringify(r.json))
    assert.equal(r.json.ok, true)
    assert.deepEqual(exits, [0], '没有 appExit 的路径通过 process.exit(0) 离开')
    const log = path.join(home, 'launcher', 'logs', 'dshim-selfexit.log')
    assert.ok(fs.existsSync(log), '自退出必须留下追踪记录')
    const text = fs.readFileSync(log, 'utf8')
    assert.match(text, /trigger=stop-self/)
    assert.match(text, /pid=\d+/)
  } finally {
    process.exit = savedExit
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// 触发者记录仍不能区分真正重要的两个调用方：面板自己的停止按钮和本地脚本都会对服务
// 端口发送 `stop`。来源才区分它们，因此同一事件必须记录两次——一次是“这个进程被要求
// 离开”，一次是“谁、通过哪扇门要求”。页面无法避免发送 Origin/Referer/User-Agent；
// 脚本可以，差别就是答案。
test('an accepted stop records who asked and how the request got in', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-requests-'))
  const savedHome = process.env.DSH_HOME
  const savedExit = process.exit
  process.env.DSH_HOME = home
  const exits = []
  process.exit = (code) => { exits.push(code) }
  try {
    // 让服务中的实例下线的精确形状：页面自身发出的同源 POST，请求它已经在用的端口。
    const r = await callApiFull({
      query: 'action=stop&port=3600',
      method: 'POST',
      port: 3600,
      host: '127.0.0.1:3600',
      remoteAddress: '127.0.0.1',
      headers: {
        origin: 'http://127.0.0.1:3600',
        referer: 'http://127.0.0.1:3600/',
        'user-agent': 'Mozilla/5.0 (panel probe)'
      }
    })
    assert.equal(r.status, 200, 'got ' + JSON.stringify(r.json))
    assert.equal(r.json.note, 'stopping this instance')
    assert.deepEqual(exits, [0], '没有 appExit 的路径通过 process.exit(0) 离开')

    const log = path.join(home, 'launcher', 'logs', 'dshim-requests.log')
    assert.ok(fs.existsSync(log), '被接受的写操作必须留下来源记录')
    const text = fs.readFileSync(log, 'utf8')
    assert.match(text, /action=stop /)
    assert.match(text, /instance=3600/)
    assert.match(text, /target=3600/)
    assert.match(text, /via=local-browser/)
    assert.match(text, /peer=127\.0\.0\.1/)
    assert.match(text, /origin=http:\/\/127\.0\.0\.1:3600/)
    assert.match(text, /referer=http:\/\/127\.0\.0\.1:3600\//)
    assert.match(text, /ua=Mozilla\/5\.0 \(panel probe\)/)
    assert.match(text, /result=self-exit/)

    // 两条记录不能互相替代：自退出日志说明触发者，请求日志说明调用方。
    const selfExit = fs.readFileSync(path.join(home, 'launcher', 'logs', 'dshim-selfexit.log'), 'utf8')
    assert.match(selfExit, /trigger=stop:this-instance/)
  } finally {
    process.exit = savedExit
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// 实例发现以登记文件为先，登记文件从 harness home 读取。自身 home 与宿主不一致的进程
// 因此会列出除自己之外的所有实例，所以宿主给出的 home 必须优先于 $DSH_HOME。这里两个
// home 都是真实目录，断言才能说明心跳写进了哪一个。
test('the host accessor, not $DSH_HOME, decides where the heartbeat is written', () => {
  const envHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-env-home-'))
  const hostHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-host-home-'))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = envHome
  let mounted = null
  try {
    mounted = mount({ port: 3081, hostHome })
    assert.ok(fs.existsSync(path.join(hostHome, 'run', 'instances', '3081.json')),
      '心跳落在宿主指定的 home 下')
    assert.equal(fs.existsSync(path.join(envHome, 'run', 'instances', '3081.json')), false,
      '宿主能自己回答时，不查询 $DSH_HOME')
  } finally {
    if (mounted) mounted.dispose()
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(envHome, { recursive: true, force: true })
    fs.rmSync(hostHome, { recursive: true, force: true })
  }
})
