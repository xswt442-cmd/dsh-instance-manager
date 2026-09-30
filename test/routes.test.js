// Route-registration regressions for the host half.
//
// These tests exist because of one specific bug class: a route object was
// BUILT and then never handed to the webserver, so the surface looked
// implemented, shipped in the changelog, and did nothing at runtime
// (the F2 /link upgrade route). Asserting on the registration call is the
// only thing that catches it — nothing in the module exercises itself.
//
// apply() needs only a webServer service plus ctx.get / ctx.effect / ctx.on.
// Every other service stays undefined on purpose: the host half then takes
// its degraded paths (no sessions, no tools, no credentials), and the port
// stays undefined so the heartbeat registry file is never written.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import plugin from '../lib/index.js'

const API_PATH = '/dsh-instance-manager/api'
const EVENTS_PATH = '/dsh-instance-manager/events'
const LINK_PATH = '/dsh-instance-manager/link'

// `config` is what the profile entry hands to apply() as the second argument
// (0.1.7-rc.1 and later); leaving it undefined reproduces the older lines,
// where the settings service is the only source of these values.
const mount = ({ upgradeSupport = true, connection, config, port, tools, hostHome } = {}) => {
  const routes = []
  const upgrades = []
  const getCalls = []
  const listeners = new Map()
  const webServer = {
    // Undefined by default: registryFile() returns null, so apply touches no
    // files. A test that needs the serving-port identity — the self-stop
    // branch, and the same-origin Origin check that gates it — states it.
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
      // Opt-in only: without one, the agent-tool row stays unmounted and the
      // service-lookup counts the tests below pin keep their old shape.
      if (name === 'tools') return tools
      // Only the mount that needs the boot layer's home accessor supplies one;
      // without one the plugin falls back to resolveDshHome(process.env).
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

// One mount, any number of requests. The SSE subscriber ceiling lives in the
// mount's own closure, so a per-request mount could never reach it; this is the
// shape that can. The fake response captures the headers `writeHead` is given,
// because `cache-control` is exactly what these routes are judged on — a stub
// that dropped them would let a no-store regression pass silently.
const mountCaller = ({ connection, port } = {}) => {
  const { routes, dispose } = mount({ connection, port })
  const call = async ({ path = API_PATH, query = 'action=list', method = 'GET' } = {}) => {
    const route = routes.find((r) => r.path === path)
    assert.ok(route, 'no route registered at ' + path)
    let status = 0
    let body = ''
    const headers = {}
    // `heads` keeps every writeHead as given, so a test can assert on each reply
    // a handler wrote rather than only on the merged last one.
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
  // The stream carries the live instance map, so the usual `no-cache` for
  // event-streams would still let an intermediary hand out a stale copy.
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(result.headers.connection, 'keep-alive')
})

// The subscriber ceiling is a per-mount closure variable, so it is reachable only
// by opening the stream repeatedly against ONE mount — hence `mountCaller`. The
// refusal is a plain JSON reply and must carry the same `cache-control: no-store`
// as every other answer: this body names the live stream count. The loop is
// bounded well past the ceiling rather than matching it, so the case still says
// something if the number changes, and it never opens a real socket.
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
    assert.ok(refusal, 'the ceiling must be finite, or one page becomes a local-scan amplifier')
    assert.ok(opened > 0, 'and it is a ceiling on subscribers, not a refusal to serve')
    assert.equal(refusal.status, 503)
    assert.equal(refusal.json.code, 'too_many_streams')
    assert.equal(refusal.headers['cache-control'], 'no-store', 'the route\'s own reply policy, not a bare writeHead')
    assert.match(String(refusal.headers['content-type']), /application\/json/,
      'a refusal is a JSON answer, not an event stream that never ends')
  } finally {
    dispose()
  }
})

test('host mounts the fleet link upgrade route (fleet queries would time out without it)', () => {
  const { upgrades, dispose } = mount()
  try {
    assert.equal(upgrades.length, 1, 'the /link upgrade route must actually be registered, not just constructed')
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
  // Loader rows activate on service availability, not on row order, so a
  // single ctx.get('tools') at apply time silently lost the agent tools
  // whenever the service mounted later. The row cannot inject it either —
  // a composition without tools would hang in PENDING and fail the boot audit.
  const { getCalls, emit, dispose } = mount()
  try {
    const lookups = () => getCalls.filter((name) => name === 'tools').length
    const before = lookups()
    emit('internal/service', 'sessions')
    assert.equal(lookups(), before, 'an unrelated service must not retrigger the tools lookup')
    emit('internal/service', 'tools')
    assert.equal(lookups(), before + 1, 'the tools service arriving after apply must be picked up')
  } finally {
    dispose()
  }
})

test('the fatal handler records the breadcrumb without pre-empting the harness exit', () => {
  // The harness registers its own unhandledRejection listener before any
  // plugin mounts, and awaits a release (dispose + flush) before exiting.
  // Node calls listeners in registration order, so this plugin exiting
  // unconditionally would truncate that release mid-flight.
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
    assert.equal(exits, 0, 'the harness owns the fatal exit; the plugin must not pre-empt it')
    assert.ok(
      fs.existsSync(path.join(home, 'launcher', 'logs', 'dshim-crash.log')),
      'the breadcrumb is still written before the exit decision'
    )
  } finally {
    dispose()
    process.off('unhandledRejection', harnessListener)
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// ---- action=logs / action=sessions port handling -------------------------
// The peer link answers these same two kinds by delegating to the functions
// exercised here, so a rejection proven on the HTTP path is a rejection on
// the fleet path too (see test/fleet.test.js for the delegation itself).
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
    // Loopback Host with no Origin / Sec-Fetch-Site: the guard's happy path.
    // The socket peer is loopback (local browser/UI) — a real HTTP connection
    // always carries one, and the guard fails closed without it.
    await route.handler({ url: API_PATH + '?' + query, method, headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } }, res)
    return { status, json: body ? JSON.parse(body) : null }
  } finally {
    dispose()
  }
}

// Full control over the request: forge an off-loopback socket peer, set a
// bearer, or drop the socket entirely to exercise the trust-boundary gates.
const callApiFull = async ({ query, method = 'GET', host = '127.0.0.1', remoteAddress, headers = {}, connection, config, port }) => {
  const { routes, dispose } = mount({ connection, config, port })
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

// ---- action=open (cross-instance launch token) ----------------------------
// DSH requires a per-process launch token on an instance's root URL, so the row
// link must resolve through a redirect that supplies it. These cover the two
// ways a plausible-looking implementation silently sends the browser to a 401:
// reading a stale token from a rotated log, and trusting the log's host/port.
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
  // A restarted instance appends one announcement per process, and the token is
  // regenerated each time. The first line's token is dead; following it answers
  // 401 exactly like sending no token at all, which is the bug this replaced.
  const log = [
    'dsh web: http://127.0.0.1:3101/?token=STALE_TOKEN_FROM_PREVIOUS_PROCESS',
    '[dsh-cost-meter] unrelated line',
    'dsh web: http://127.0.0.1:3101/?token=CURRENT_TOKEN'
  ].join('\n')
  const r = await withLauncherLog(3101, log, () => openRedirect('action=open&port=3101'))
  assert.equal(r.status, 303)
  assert.equal(r.headers.location, '/?token=CURRENT_TOKEN')
  // The token must not persist in what the user lands on, and the redirect must
  // not be cached or leak the referrer.
  assert.equal(r.headers['cache-control'], 'no-store')
  assert.equal(r.headers['referrer-policy'], 'no-referrer')
  // A redirect body is not read by the browser, so there must not be one.
  assert.equal(r.body, undefined)
})

test('action=open refuses a log whose host, port, or token does not match', async () => {
  const cases = [
    // A log line naming another host must not be used for this port.
    ['http://evil.example:3101/?token=X', 'foreign host'],
    // The token belongs to a different instance's port.
    ['http://127.0.0.1:3102/?token=X', 'port mismatch'],
    // Nothing to hand over.
    ['http://127.0.0.1:3101/', 'no token']
  ]
  for (const [line, label] of cases) {
    const r = await withLauncherLog(3101, 'dsh web: ' + line, () => openRedirect('action=open&port=3101'))
    assert.equal(r.status, 409, label)
    assert.match(r.body, /launch_token_unavailable/, label)
  }
  // Control: the same shape with a matching host/port/token does redirect, so the
  // three rejections above are the checks firing rather than the parser failing.
  const ok = await withLauncherLog(3101, 'dsh web: http://127.0.0.1:3101/?token=X', () => openRedirect('action=open&port=3101'))
  assert.equal(ok.status, 303)
  assert.equal(ok.headers.location, '/?token=X')
})

// ---- action=open-url (absolute address for the desktop shell) --------------
// The desktop window is served from dsh-app://app, where `open`'s relative
// location is not a browser URL and the app shell denies every window.open that
// is not http(s) — so the desktop row cannot follow the redirect and has to fetch
// the absolute address instead. Same token resolution, same guard, one fewer hop.
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
  // No token in the log: the panel maps the code into its own wording, so the
  // code must be the client's key and not a naked 409.
  const noToken = await withLauncherLog(3101, 'dsh web: http://127.0.0.1:3101/', () => (
    openRedirect('action=open-url&port=3101')
  ))
  assert.equal(noToken.status, 409)
  assert.equal(JSON.parse(noToken.body).code, 'launch_token_unavailable')
  // A token belonging to another port is not handed out for this one.
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

// ---- desktop host: never a stop target ------------------------------------
// The desktop app treats ANY exit of its own host as a failure, so a stop that
// lands there leaves the window without a backend, in an error state only a
// relaunch clears. A port number says nothing about what is behind it, so the
// target is identified by its OWN report — and only a positive
// `runtime:'desktop'` refuses: a silent or runtime-less target keeps the old
// forward and the old conclusion, because inferring instead would strand every
// instance that predates the field.
const asDesktopHost = async (fn) => {
  // apply() decides the runtime from its own argv at mount time, so swapping in
  // the desktop host's entry script is the whole switch.
  const saved = process.argv
  process.argv = [
    saved[0],
    path.join('DSH', 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
  ]
  try { return await fn() } finally { process.argv = saved }
}

// A fake instance: answers action=self with the report it was given and every
// other request with `ack`, and records what it received so a test can assert
// what did NOT arrive.
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

// A temp DSH_HOME keeps these mounts' heartbeats and breadcrumbs out of the
// developer's real home, and the self-exit is always stubbed and counted: which
// host schedules it is exactly what these tests assert.
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

// The agent tools reach the same guard through a second door, so this needs a
// service that captures definitions and a resolvable @deepseek-ai/dsh-tools:
// loadDefineTool falls back to createRequire(dshBin()), which is the only
// resolution path available without the real harness installed.
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
  // mountAgentTools resolves its module asynchronously: wait for the five
  // definitions instead of assuming they registered by the time apply returned.
  const deadline = Date.now() + 3000
  while (registered.length < 5 && Date.now() < deadline) {
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
  // The refusal came from asking the target: one that never probed would also
  // refuse an ordinary web instance, which is the regression this pins.
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

  // A report that carries no runtime is not evidence of a desktop host: the old
  // forward happens, and the caller gets the old conclusion.
  const silent = await withFakeTarget({ self: (port) => ({ ok: true, pid: 9, port }) }, async ({ port, seen }) => {
    const out = await callApi('action=stop&port=' + port, 'POST')
    return { out, seen: [...seen] }
  })
  assert.equal(silent.out.json.code, 'stop_unconfirmed')
  assert.equal(silent.seen.filter((u) => u.includes('action=stop-self')).length, 1)

  // Neither is no answer at all: the same contract, the same conclusion.
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
    assert.equal(r.out.json.skippedDesktop, 1, 'the desktop row is reported as skipped')
    assert.equal(r.out.json.stoppedRemote, 0)
    assert.equal(r.out.json.stoppedSelf, false, 'the desktop host keeps serving')
    assert.equal(r.seen.some((u) => u.includes('stop-self')), false)
    assert.deepEqual(exits, [], 'and no self-exit is scheduled')
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
    assert.deepEqual(exits, [0], 'the ordinary host still leaves on request')
  })
})

test('the agent stop tool refuses a desktop target and never forwards it', async () => {
  await withTempHome(async ({ home }) => {
    stubToolsResolution(home)
    const desktop = await withFakeTarget({ self: (port) => ({ ok: true, pid: 4242, port, runtime: 'desktop' }) }, async ({ port, seen }) => {
      const { registered, dispose } = await mountTools({ config: { startup: { portRange: String(port) } }, port: 3600 })
      try {
        const def = registered.find((d) => d.name === 'instance_stop')
        assert.ok(def, 'the stop tool registered against the fake service')
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
    assert.equal(r.out.ok, true, 'the guard must not turn every tool stop into a refusal')
  })
})

// ---- action=start (explicit port) ----------------------------------------
// An absent port keeps the auto pick; a present one is the caller's stated
// intent. The two ways to get that wrong are to swallow a bad value and silently
// auto-pick, and to report "in use" as a generic start failure.
test('action=start rejects an unusable port instead of falling back to auto', async () => {
  for (const bad of [TRAVERSAL, '80.5', '1e3', '0', '65536', 'abc', '-1', '99999']) {
    const r = await callApi('action=start&port=' + encodeURIComponent(bad), 'POST')
    assert.equal(r.status, 400, 'port=' + bad)
    assert.equal(r.json.code, 'no_port', 'port=' + bad)
  }
})

test('action=start reports a requested port that is already serving', async () => {
  // A real listener on an ephemeral port: tryConnect must see it as occupied.
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
  // An instance this host did not launch (no launcher log) has no readable
  // token. Redirecting to the bare root would reproduce the original 401.
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
  // The port is interpolated into $DSH_HOME/launcher/logs/server-<port>.*.log,
  // so a traversal string here was a real file-read primitive.
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

// A `peer` that names nothing configured must be rejected, not silently
// answered with local data — the same wrong-answer-instead-of-failure shape
// as the F3 sessions bug.
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

// Regression: the client bundle stringified an absent `peer` as the literal
// "undefined", which arrived as a well-formed peer id and routed EVERY local
// read through the (always-failing) peer path — local logs span on "loading"
// forever. The sentinel means "no peer", so those clients still read local.
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
  // Absent means "this instance", so it must stay legal — only a value the
  // caller actually supplied gets rejected, otherwise a typo would silently
  // answer with the wrong instance.
  const bad = await callApi('action=sessions&port=' + encodeURIComponent(TRAVERSAL))
  assert.equal(bad.status, 400)
  assert.equal(bad.json.code, 'no_port')

  const self = await callApi('action=sessions')
  assert.equal(self.status, 200, 'an omitted port means this instance, not a bad request')
  assert.equal(self.json.ok, true)
})

// The stop action forwards stop-self to the target port, so what counts as a
// port has to be exactly what logs/sessions accept: stop parses with
// normalizePort, which refuses '1e3', '0x10' and '+80' (Number() reads those as
// 1000, 16 and 80 — ports stop would forward that logs rejects with a 400) and
// refuses fractional or negative values before http.get can throw
// ERR_SOCKET_BAD_PORT out of the handler as a 500 for a bad request.
test('action=stop parses the port with the same rule as logs and sessions', async () => {
  for (const bad of [TRAVERSAL, '1e3', '0x10', '80.5', '-1', '+80', '0', '65536', 'abc', '']) {
    const r = await callApi('action=stop&port=' + encodeURIComponent(bad), 'POST')
    assert.equal(r.status, 400, 'port=' + bad)
    assert.equal(r.json.code, 'no_port', 'port=' + bad)
  }
  // Omitted entirely is the same bad request, never "stop something".
  const none = await callApi('action=stop', 'POST')
  assert.equal(none.status, 400)
  assert.equal(none.json.code, 'no_port')
})

test('action=stop still requires POST before it looks at the port', async () => {
  // The 405 must win: a GET stop must never be parsed, let alone forwarded.
  const r = await callApi('action=stop&port=1e3', 'GET')
  assert.equal(r.status, 405)
  assert.equal(r.json.code, 'need_post')
  // The embedded gate matches the method case-insensitively, so a lowercase
  // `post` clears it and the port parser answers 400. Pinned on the mounted
  // route because the case-insensitive match is the gate's behavior this
  // package ships (see the note at its binding).
  const lowered = await callApi('action=stop&port=1e3', 'post')
  assert.notEqual(lowered.status, 405, 'a lowercase method is not refused as a non-POST')
  assert.equal(lowered.status, 400, 'it reached the port parser, which is the next gate')
  assert.equal(lowered.json.code, 'no_port')
})

// The discovery sweep is supposed to meet closed ports, so a fetch that fails
// there is silence by design — but a read the caller ASKED for is not. Both
// failure classes resolve to the same swallowed `null`, so "a foreign service
// owns our API path" and "this instance went away" are told apart in the host
// log, each with its own class name. The value callers see is unchanged; only
// the diagnosis is added.
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
    assert.equal(junk.json.ok, false, 'the answer shape is unchanged')
    assert.equal(junk.json.code, 'sessions_unavailable')
    assert.equal(warnings.filter((l) => /\[body\]/.test(l)).length, 1, 'exactly one line, classed as a body failure')
    assert.match(warnings[0], /content-type=text\/html/, 'and it says who answered')
    assert.match(warnings[0], new RegExp(':' + port + ' failed'), 'and names the port')

    warnings.length = 0
    await new Promise((resolve) => server.close(resolve))
    const gone = await callApi('action=sessions&port=' + port)
    assert.equal(gone.json.code, 'sessions_unavailable', 'the same answer for a different failure')
    assert.equal(warnings.filter((l) => /\[request\]/.test(l)).length, 1, 'classed as a request failure instead')
    assert.equal(warnings.some((l) => /\[body\]/.test(l)), false)
  } finally {
    console.warn = originalWarn
    if (server && server.listening) await new Promise((resolve) => server.close(resolve))
  }
})

// A blind sweep is 49 closed ports out of 50: the same failures there must NOT
// reach the log, or every panel refresh writes 50 lines.
test('the discovery sweep stays silent about ports that do not answer', async () => {
  const http = await import('node:http')
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  let server
  try {
    server = http.createServer((req, res) => { res.writeHead(404); res.end('nope') })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    // A fresh heartbeat for a port that answers something other than the API is
    // the routine case: the instance was hard-killed and something else took the
    // port, and discovery handles it by falling through to the raw probe. The
    // caller of that read set no expectation, so nothing may be logged about it.
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
      assert.deepEqual(warnings, [], 'a heartbeat that no longer answers is the normal case')
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

// The POST gate is the embedded `dsh-host-http` fragment, and this is the
// shape this package has published since 0.4.1: the `need_post` code and the
// rejected `action` in the body. Both are supplied as policy, so a re-sync of
// the fragment that dropped the override would answer `{ code: 'method' }` and
// break every caller that switches on the code or reads the action back.
test('the 405 keeps this package\'s published body: need_post plus the action', async () => {
  const r = await callApi('action=stop&port=3080', 'GET')
  assert.equal(r.status, 405)
  assert.equal(r.json.ok, false)
  assert.equal(r.json.code, 'need_post', 'not the fragment default "method"')
  assert.equal(r.json.action, 'stop')
  assert.equal(r.json.error, 'stop 需要 POST 请求')
})

// The route answers carry instance ports, pids and session summaries, so
// `cache-control: no-store` is part of the boundary rather than a header nobody
// reads: an intermediary that cached `action=list` would keep serving a dead
// instance's pid to the next browser that asks.
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

// A 500 is the one answer whose text cannot be trusted: the message of an
// unexpected exception quotes paths, origins, and whatever a peer put into a
// response. The raw text belongs in the host log; the body carries a code the
// client already localizes.
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
    // An absolute-but-malformed request target is what makes `new URL(req.url)`
    // inside the handler throw, i.e. a genuine unexpected failure.
    await route.handler(
      { url: 'http://[', method: 'GET', headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } },
      res
    )
    const json = JSON.parse(body)
    assert.equal(status, 500)
    assert.equal(json.ok, false)
    assert.equal(json.code, 'internal', 'the code the client maps into its own wording')
    assert.doesNotMatch(String(json.error), /Invalid URL|invalid url/i, 'the exception text stayed out of the body')
    assert.equal(logged.some((line) => /Invalid URL|invalid url/i.test(line)), true,
      'and reached the host log instead')
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

// ---- P1: forged-loopback-Host bypass of the fleet bearer ------------------
// A remote attacker cannot set the socket peer, only the Host header. The
// bearer gate must therefore be driven by the real TCP peer, not Host.
test('a forged loopback Host from an off-loopback peer cannot skip the bearer (stop-all stays unexecuted)', async () => {
  // No fleet token configured: the remote surface must fail closed.
  const r = await callApiFull({
    query: 'action=stop-all',
    method: 'POST',
    remoteAddress: '203.0.113.5',
    headers: { host: '127.0.0.1:3080' }
  })
  assert.equal(r.status, 403, 'off-loopback peer must clear the bearer first')
  assert.equal(r.json.code, 'fleet_auth', 'the mutating action is never reached')
  assert.notEqual(typeof r.json.stoppedRemote, 'number', 'stop-all did NOT execute')
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
    assert.equal(r.status, 200, 'valid bearer over a remote peer is allowed')
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
  // 0.1.7-rc.1 dropped `settings.register`, so the only remaining source for
  // the live section is the config cordis hands to apply(). This is the same
  // assertion as the env-token case above, with the value coming from there
  // and the env deliberately unset — otherwise the base layer would serve it
  // and the test would pass without the new path working at all.
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
    assert.equal(r.status, 200, 'the entry config must reach resolveFleetToken')
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

// A graceful self-exit leaves no crash log, no diagnostic report and no stderr
// line, so "the instance serving my panel died on its own" and "something
// killed it" look identical in the logs. Every self-exit therefore records WHO
// asked for it, and that record has to name the trigger rather than just prove
// an exit happened.
test('a self-exit records its trigger before the process leaves', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-selfexit-'))
  const savedHome = process.env.DSH_HOME
  const savedExit = process.exit
  process.env.DSH_HOME = home
  // The exit runs on a real timer; the process must not actually leave mid-test.
  const exits = []
  process.exit = (code) => { exits.push(code) }
  try {
    // A real browser request always carries a loopback socket peer; the guard
    // fails closed without one, so this test states the peer it means.
    const r = await callApiFull({ query: 'action=stop-self', method: 'POST', remoteAddress: '127.0.0.1' })
    assert.equal(r.status, 200, 'got ' + JSON.stringify(r.json))
    assert.equal(r.json.ok, true)
    assert.deepEqual(exits, [0], 'the no-appExit path leaves through process.exit(0)')
    const log = path.join(home, 'launcher', 'logs', 'dshim-selfexit.log')
    assert.ok(fs.existsSync(log), 'a self-exit must leave a breadcrumb')
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

// The trigger breadcrumb still cannot separate the two callers that matter:
// the panel's own stop button and a local script both send `stop` for the
// serving port. Provenance is what separates them, so the same event has to be
// recorded twice — once as "this process was asked to leave", once as "by whom,
// through which door". A page cannot avoid sending Origin/Referer/User-Agent;
// a script can, and the difference is the answer.
test('an accepted stop records who asked and how the request got in', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-requests-'))
  const savedHome = process.env.DSH_HOME
  const savedExit = process.exit
  process.env.DSH_HOME = home
  const exits = []
  process.exit = (code) => { exits.push(code) }
  try {
    // The exact shape that took a served instance down: a same-origin POST
    // from the page itself, asking for the port it is already on.
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
    assert.deepEqual(exits, [0], 'the no-appExit path leaves through process.exit(0)')

    const log = path.join(home, 'launcher', 'logs', 'dshim-requests.log')
    assert.ok(fs.existsSync(log), 'an accepted mutation must leave a provenance line')
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

    // Neither breadcrumb substitutes for the other: the self-exit log names the
    // trigger, the request log names the caller.
    const selfExit = fs.readFileSync(path.join(home, 'launcher', 'logs', 'dshim-selfexit.log'), 'utf8')
    assert.match(selfExit, /trigger=stop:this-instance/)
  } finally {
    process.exit = savedExit
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// Instance discovery is registry-first, and the registry is read from the
// harness home. A process whose own idea of that home disagrees with the host's
// therefore lists every instance except the one doing the listing, so the home
// the host names has to win over $DSH_HOME. Both homes are real directories
// here, which is what lets the assertion say WHICH one received the heartbeat.
test('the host accessor, not $DSH_HOME, decides where the heartbeat is written', () => {
  const envHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-env-home-'))
  const hostHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dshim-host-home-'))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = envHome
  let mounted = null
  try {
    mounted = mount({ port: 3081, hostHome })
    assert.ok(fs.existsSync(path.join(hostHome, 'run', 'instances', '3081.json')),
      'the heartbeat lands under the home the host named')
    assert.equal(fs.existsSync(path.join(envHome, 'run', 'instances', '3081.json')), false,
      '$DSH_HOME is not consulted when the host answers for itself')
  } finally {
    if (mounted) mounted.dispose()
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
    fs.rmSync(envHome, { recursive: true, force: true })
    fs.rmSync(hostHome, { recursive: true, force: true })
  }
})
