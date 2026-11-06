// 设置接缝测试。
//
// schemastery 的 `z` 是最小替身，只记录声明的字段与角色：这里没有通过 schema 解析
// 值——注册辅助函数用 resolve*Section 归一化分节——因此替身只需忠实于本插件声明的
// 形状（字段名、role('secret')、applies、base 层）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_NAMESPACE,
  SETTINGS_NAMESPACE_STARTUP,
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
  parsePortSpec
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
        // 与文档描述的注册期行为一致：已不符合 schema 的存储分节会让注册本身失败。
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

test('live namespace registers interval/token/peers with the env base layer', () => {
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
  assert.equal(fields[REFRESH_INTERVAL_FIELD].kind, 'number')
  assert.equal(fields[FLEET_TOKEN_FIELD].roleName, 'secret',
    'token 必须声明为只写，所有线路读取都会脱敏')
  assert.equal(fields[PEERS_FIELD].kind, 'string')
  // 即使没有存储的用户分节（这里 scope.get() 返回 undefined），所有者的读取也会把
  // base 合并进归一化分节。
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
  assert.equal(live.get()[REFRESH_INTERVAL_FIELD], 4000)

  const startup = registerStartupSettings({
    ctx: mockSettingsHost({ fail: true }).ctx, z, env,
    warn: (m) => warned.push(m)
  })
  assert.equal(startup.registered, false)
  assert.equal(startup.degraded, true)
  assert.deepEqual(startup.get(), { [PORT_RANGE_FIELD]: '4100-4109' })
  assert.equal(warned.length, 2, '两次降级各警告一次')

  // 完全没有环境变量时，降级落在纯 schema 默认值上。
  const bare = registerLiveSettings({ ctx: mockSettingsHost({ fail: true }).ctx, z, env: {} })
  assert.equal(bare.get()[FLEET_TOKEN_FIELD], undefined)
  assert.equal(bare.get()[PEERS_FIELD], '')
  const bareStartup = registerStartupSettings({ ctx: mockSettingsHost({ fail: true }).ctx, z, env: {} })
  assert.deepEqual(parsePortSpec(bareStartup.get()[PORT_RANGE_FIELD]), { min: 3080, max: 3129, extra: [19387] })
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
  // token 绝不能混进 fleet 代码使用、面板渲染的 peers 描述中。
  assert.equal(JSON.stringify(parsePeers(section[PEERS_FIELD])).includes('tok'), false)
  assert.equal(JSON.stringify(buildLiveBase(env)).indexOf('"' + FLEET_TOKEN_FIELD + '":"tok"') > -1, true,
    '环境变量中的 token 只通过声明的 secret base 字段进入')
})

test('missing schemastery or settings service degrades without throwing', () => {
  assert.equal(registerLiveSettings({ ctx: {}, z: null }).registered, false)
  assert.equal(registerStartupSettings({ ctx: {}, z: null }).registered, false)
  assert.equal(registerLiveSettings({ z }).registered, false)
  assert.equal(registerStartupSettings({ z }).registered, false)
  // 降级后的取值函数仍返回可用的分节。
  assert.equal(registerLiveSettings({ ctx: {}, z: null }).get()[REFRESH_INTERVAL_FIELD], 4000)
})

test('port spec resolution: user over env over default; garbage falls back at consumption', () => {
  assert.deepEqual(
    resolveStartupSection({ [PORT_RANGE_FIELD]: '4200-4209' }, { DSHIM_PORT_RANGE: '4300-4309' }),
    { [PORT_RANGE_FIELD]: '4200-4209' })
  assert.deepEqual(resolveStartupSection({}, { DSHIM_PORT_RANGE: '4300-4309' }),
    { [PORT_RANGE_FIELD]: '4300-4309' })
  assert.deepEqual(resolveStartupSection(undefined, {}), { [PORT_RANGE_FIELD]: '3080-3129,19387' })
  // 垃圾值会留在分节中（schema 只是普通字符串），但 parsePortSpec 会回退到默认值。
  const garbage = resolveStartupSection({ [PORT_RANGE_FIELD]: 'nonsense' }, {})
  assert.deepEqual(parsePortSpec(garbage[PORT_RANGE_FIELD]), { min: 3080, max: 3129, extra: [19387] })
  // 列表值原样经由环境变量 base 层传递。
  assert.deepEqual(buildStartupBase({ DSHIM_PORT_RANGE: '3080-3129,19387' }), { [PORT_RANGE_FIELD]: '3080-3129,19387' })
  // 垃圾环境变量绝不进入 base 层（垃圾 base 会让整个分节在注册时校验失败）。
  assert.deepEqual(buildStartupBase({ DSHIM_PORT_RANGE: 'junk' }), {})
})
