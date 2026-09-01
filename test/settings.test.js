// DIM-M1 settings seam tests.
//
// The schemastery `z` is a minimal stand-in that records declared fields and
// roles: nothing here resolves values THROUGH the schema — the register
// helpers normalize sections via resolve*Section — so the stub only has to be
// faithful about the shape DIM declares (field names, role('secret'),
// applies, base layer).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_NAMESPACE,
  SETTINGS_NAMESPACE_STARTUP,
  DOCK_PLACEMENT_FIELD,
  REFRESH_INTERVAL_FIELD,
  FLEET_TOKEN_FIELD,
  PEERS_FIELD,
  PORT_RANGE_FIELD,
  buildLiveBase,
  buildLiveSchema,
  buildStartupBase,
  resolveLiveSection,
  resolveStartupSection,
  registerLiveSettings,
  registerStartupSettings,
  parsePortRange
} from '../lib/shared.js'
import { parsePeers } from '../lib/fleet.js'

const field = (kind) => ({
  kind,
  roleName: undefined,
  role(name) { this.roleName = name; return this },
  default() { return this },
  step() { return this },
  min() { return this },
  max() { return this }
})
const z = {
  object: (fields) => ({ kind: 'object', fields }),
  string: () => field('string'),
  number: () => field('number'),
  union: (list) => Object.assign(field('union'), { list })
}

const mockSettingsHost = ({ fail = false, sections = {} } = {}) => {
  const calls = []
  const ctx = {
    settings: {
      register(ns, schema, options) {
        calls.push({ ns, schema, options })
        // Mirrors the documented registration-time trap: a stored section
        // that already fails the schema rejects the registration itself.
        if (fail) throw new TypeError('stored section fails the schema')
        return {
          get: () => sections[ns],
          watch() { return () => { } }
        }
      }
    }
  }
  return { ctx, calls }
}

test('live namespace registers dock/interval/token/peers with the env base layer', () => {
  const env = {
    DSHIM_FLEET_TOKEN: 'secret-token',
    DSHIM_PEERS: 'a@http://10.0.0.1:3080,b@10.0.0.2:3080'
  }
  const { ctx, calls } = mockSettingsHost()
  const r = registerLiveSettings({ ctx, z, env })
  assert.equal(r.registered, true)
  assert.equal(r.degraded, false)
  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.equal(call.ns, SETTINGS_NAMESPACE)
  assert.equal(call.options.applies, 'live')
  assert.deepEqual(call.options.base, {
    [FLEET_TOKEN_FIELD]: 'secret-token',
    [PEERS_FIELD]: 'a@http://10.0.0.1:3080,b@10.0.0.2:3080'
  })
  const fields = call.schema.fields
  assert.equal(fields[DOCK_PLACEMENT_FIELD].kind, 'union')
  assert.equal(fields[REFRESH_INTERVAL_FIELD].kind, 'number')
  assert.equal(fields[FLEET_TOKEN_FIELD].roleName, 'secret',
    'the token must be declared write-only so every wire read redacts it')
  assert.equal(fields[PEERS_FIELD].kind, 'string')
  // The owner read folds base into a normalized section even with no stored
  // user section (scope.get() answers undefined here).
  assert.equal(r.get()[FLEET_TOKEN_FIELD], 'secret-token')
  assert.equal(r.get()[PEERS_FIELD], 'a@http://10.0.0.1:3080,b@10.0.0.2:3080')
})

test('startup namespace registers the port range as applies:restart', () => {
  const env = { DSHIM_PORT_RANGE: '4000-4019' }
  const { ctx, calls } = mockSettingsHost()
  const r = registerStartupSettings({ ctx, z, env })
  assert.equal(r.registered, true)
  assert.equal(r.degraded, false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ns, SETTINGS_NAMESPACE_STARTUP)
  assert.equal(calls[0].options.applies, 'restart')
  assert.deepEqual(calls[0].options.base, { [PORT_RANGE_FIELD]: '4000-4019' })
  assert.deepEqual(r.get(), { [PORT_RANGE_FIELD]: '4000-4019' })
})

test('a corrupt stored section degrades to env/defaults and never blocks load', () => {
  const env = {
    DSHIM_FLEET_TOKEN: 'env-token',
    DSHIM_PEERS: 'a@x:1',
    DSHIM_PORT_RANGE: '4100-4109'
  }
  const warned = []
  const live = registerLiveSettings({
    ctx: mockSettingsHost({ fail: true }).ctx, z, env,
    warn: (m) => warned.push(m)
  })
  assert.equal(live.registered, false)
  assert.equal(live.degraded, true)
  assert.equal(live.get()[FLEET_TOKEN_FIELD], 'env-token')
  assert.equal(live.get()[PEERS_FIELD], 'a@x:1')
  assert.equal(live.get()[DOCK_PLACEMENT_FIELD], 'main-bottom-left')

  const startup = registerStartupSettings({
    ctx: mockSettingsHost({ fail: true }).ctx, z, env,
    warn: (m) => warned.push(m)
  })
  assert.equal(startup.registered, false)
  assert.equal(startup.degraded, true)
  assert.deepEqual(startup.get(), { [PORT_RANGE_FIELD]: '4100-4109' })
  assert.equal(warned.length, 2, 'both degradations warn once each')

  // With no env at all, degradation lands on pure schema defaults.
  const bare = registerLiveSettings({ ctx: mockSettingsHost({ fail: true }).ctx, z, env: {} })
  assert.equal(bare.get()[FLEET_TOKEN_FIELD], undefined)
  assert.equal(bare.get()[PEERS_FIELD], '')
  const bareStartup = registerStartupSettings({ ctx: mockSettingsHost({ fail: true }).ctx, z, env: {} })
  assert.deepEqual(parsePortRange(bareStartup.get()[PORT_RANGE_FIELD]), { min: 3080, max: 3129 })
})

test('settings section overrides env base; absent fields re-inherit env', () => {
  const env = { DSHIM_FLEET_TOKEN: 'env-token', DSHIM_PEERS: 'a@x:1' }
  const withUser = mockSettingsHost({
    sections: { [SETTINGS_NAMESPACE]: { [FLEET_TOKEN_FIELD]: 'user-token', [PEERS_FIELD]: 'c@y:2' } }
  })
  const r = registerLiveSettings({ ctx: withUser.ctx, z, env })
  assert.equal(r.get()[FLEET_TOKEN_FIELD], 'user-token')
  assert.equal(r.get()[PEERS_FIELD], 'c@y:2')

  const noUser = mockSettingsHost({ sections: { [SETTINGS_NAMESPACE]: {} } })
  const r2 = registerLiveSettings({ ctx: noUser.ctx, z, env })
  assert.equal(r2.get()[FLEET_TOKEN_FIELD], 'env-token')
  assert.equal(r2.get()[PEERS_FIELD], 'a@x:1')
})

test('an explicit empty peers string clears the env base list', () => {
  const env = { DSHIM_PEERS: 'a@x:1' }
  const { ctx } = mockSettingsHost({ sections: { [SETTINGS_NAMESPACE]: { [PEERS_FIELD]: '' } } })
  const r = registerLiveSettings({ ctx, z, env })
  assert.equal(r.get()[PEERS_FIELD], '')
  assert.deepEqual(parsePeers(r.get()[PEERS_FIELD]), [])
})

test('the fleet token survives only under its schema-declared secret field', () => {
  const env = { DSHIM_FLEET_TOKEN: 'tok', DSHIM_PEERS: 'a@x:1' }
  assert.equal(buildLiveSchema(z).fields[FLEET_TOKEN_FIELD].roleName, 'secret')
  const section = resolveLiveSection(undefined, env)
  assert.equal(section[FLEET_TOKEN_FIELD], 'tok')
  // The token must never ride along in the peers descriptors the fleet code
  // consumes and the panel renders.
  assert.equal(JSON.stringify(parsePeers(section[PEERS_FIELD])).includes('tok'), false)
  assert.equal(JSON.stringify(buildLiveBase(env)).indexOf('"' + FLEET_TOKEN_FIELD + '":"tok"') > -1, true,
    'the env token enters ONLY through the declared secret base field')
})

test('missing schemastery or settings service degrades without throwing', () => {
  assert.equal(registerLiveSettings({ ctx: {}, z: null }).registered, false)
  assert.equal(registerStartupSettings({ ctx: {}, z: null }).registered, false)
  assert.equal(registerLiveSettings({ z }).registered, false)
  assert.equal(registerStartupSettings({ z }).registered, false)
  // Degraded getters still answer usable sections.
  assert.equal(registerLiveSettings({ ctx: {}, z: null }).get()[DOCK_PLACEMENT_FIELD], 'main-bottom-left')
})

test('port range resolution: user over env over default; garbage falls back at consumption', () => {
  assert.deepEqual(
    resolveStartupSection({ [PORT_RANGE_FIELD]: '4200-4209' }, { DSHIM_PORT_RANGE: '4300-4309' }),
    { [PORT_RANGE_FIELD]: '4200-4209' })
  assert.deepEqual(resolveStartupSection({}, { DSHIM_PORT_RANGE: '4300-4309' }),
    { [PORT_RANGE_FIELD]: '4300-4309' })
  assert.deepEqual(resolveStartupSection(undefined, {}), { [PORT_RANGE_FIELD]: '3080-3129' })
  // Garbage survives in the section (the schema is a plain string) but
  // parsePortRange falls back exactly like the old env-only path.
  const garbage = resolveStartupSection({ [PORT_RANGE_FIELD]: 'nonsense' }, {})
  assert.deepEqual(parsePortRange(garbage[PORT_RANGE_FIELD]), { min: 3080, max: 3129 })
  // Garbage env is never carried into the base layer (a garbage base would
  // fail the whole section at registration).
  assert.deepEqual(buildStartupBase({ DSHIM_PORT_RANGE: 'junk' }), {})
})
