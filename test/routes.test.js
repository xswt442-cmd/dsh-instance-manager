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

const mount = ({ upgradeSupport = true } = {}) => {
  const routes = []
  const upgrades = []
  const getCalls = []
  const listeners = new Map()
  const webServer = {
    // Undefined port: registryFile() returns null, so apply touches no files.
    port: undefined,
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
      return name === 'webServer' ? webServer : undefined
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
    }
  }
  plugin.apply(ctx)
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

const callApi = async (query) => {
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
    await route.handler({ url: API_PATH + '?' + query, method: 'GET', headers: { host: '127.0.0.1' } }, res)
    return { status, json: body ? JSON.parse(body) : null }
  } finally {
    dispose()
  }
}

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
