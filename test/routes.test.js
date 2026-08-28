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
import plugin from '../lib/index.js'

const API_PATH = '/dsh-instance-manager/api'
const EVENTS_PATH = '/dsh-instance-manager/events'
const LEGACY_PATH = '/dsh-easy-port-manager/api'
const LINK_PATH = '/dsh-instance-manager/link'

const mount = ({ upgradeSupport = true } = {}) => {
  const routes = []
  const upgrades = []
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
    get: (name) => (name === 'webServer' ? webServer : undefined),
    effect(factory) {
      const result = factory()
      for (const d of Array.isArray(result) ? result : [result]) {
        if (typeof d === 'function') disposers.push(d)
      }
    },
    on: () => () => {}
  }
  plugin.apply(ctx)
  return { routes, upgrades, dispose: () => { disposers.reverse().forEach((d) => d()) } }
}

const paths = (routes) => routes.map((r) => r.path)

test('host registers the JSON api, the SSE stream, and the pre-rename alias', () => {
  const { routes, dispose } = mount()
  try {
    assert.deepEqual(paths(routes).sort(), [API_PATH, EVENTS_PATH, LEGACY_PATH].sort())
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
    assert.deepEqual(paths(routes).sort(), [API_PATH, EVENTS_PATH, LEGACY_PATH].sort())
  } finally {
    dispose()
  }
})

test('disposal releases every route, upgrade included', () => {
  const { routes, upgrades, dispose } = mount()
  assert.equal(routes.length, 3)
  assert.equal(upgrades.length, 1)
  dispose()
  assert.equal(routes.length, 0)
  assert.equal(upgrades.length, 0)
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
