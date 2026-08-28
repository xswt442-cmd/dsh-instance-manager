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
