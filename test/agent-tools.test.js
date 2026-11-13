// lib/agent-tools.js 中 agent 工具定义的单元测试。
//
// 工具通过注入的 `defineTool` 构造，因此这些测试在未安装 @deepseek-ai/dsh-tools 的
// node:test 上也能运行：下面的恒等透传保留原始定义对象供检查，假的 api 闭包代替宿主侧
// 操作。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentTools } from '../lib/agent-tools.js'

// 恒等 defineTool——生产环境传入 dsh 的校验工厂，它必须接受这些断言固定的同一形状。
const identity = (d) => d

const makeApi = (over = {}) => {
  const calls = { stop: [], restart: [], logs: [], sessions: [] }
  const api = {
    listInstances: async () => ({
      items: [
        { port: 3080, pid: 111, managed: true, current: true, url: 'http://127.0.0.1:3080/', version: '0.7.0', sessions: 2, rss: 9, startedAt: 5 },
        { port: 4000, pid: null, managed: false, current: false, url: 'http://127.0.0.1:4000/' }
      ],
      currentPort: 3080,
      selfVersion: '0.7.0',
      error: null
    }),
    start: async () => ({ ok: true, port: 3099, pid: 222 }),
    stop: async (port) => { calls.stop.push(port); return { ok: true, note: 'stopped :' + port } },
    restart: async (port) => {
      calls.restart.push(port)
      return { ok: true, restarted: true, port, pid: 333 }
    },
    logs: (port, stream) => { calls.logs.push([port, stream]); return { exists: true, truncated: false, lines: ['a', 'b'] } },
    sessions: async (port) => {
      calls.sessions.push(port)
      return port === 4000
        ? { ok: false, code: 'sessions_unavailable', error: 'target does not expose session summaries' }
        : { ok: true, port, total: 2, sessions: [
            { id: 'abcdef1234567890', createdAt: 200, cwd: '/work/alpha', events: 12 },
            { id: 'ffff000011112222', createdAt: 100, subagent: true, events: 3 }
          ] }
    }
  }
  return { api: Object.assign(api, over), calls }
}

const byName = (defs) => Object.fromEntries(defs.map((d) => [d.name, d]))

test('buildAgentTools exposes the six instance tools with registry-ready shapes', () => {
  const { api } = makeApi()
  const tools = byName(buildAgentTools(identity, api))
  assert.deepEqual(Object.keys(tools).sort(), [
    'instance_list', 'instance_logs', 'instance_restart', 'instance_sessions', 'instance_start', 'instance_stop'
  ])
  for (const def of Object.values(tools)) {
    assert.equal(typeof def.description, 'string')
    assert.equal(typeof def.execute, 'function')
    // 输出契约：对象根、封闭，并带 render 投影。
    assert.equal(def.output.schema.type, 'object')
    assert.equal(def.output.schema.additionalProperties, false)
    assert.equal(typeof def.output.render, 'function')
  }
})

test('instance_list maps rows, prunes absent fields, and renders a table', async () => {
  const { api } = makeApi()
  const [def] = buildAgentTools(identity, api)
  const v = await def.execute({})
  assert.deepEqual(v.instances[0], {
    port: 3080, managed: true, current: true, url: 'http://127.0.0.1:3080/',
    pid: 111, version: '0.7.0', sessions: 2, rss: 9, startedAt: 5
  })
  // 未托管行：null pid 被删除（schema 没有可空节点）。
  assert.deepEqual(v.instances[1], { port: 4000, managed: false, current: false, url: 'http://127.0.0.1:4000/' })
  assert.equal(v.currentPort, 3080)

  const blocks = def.output.render({}, v)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /:3080 \| current \| pid 111/)
  assert.match(blocks[0].text, /:4000 \| non-dsh/)
})

test('instance_list renders a friendly empty fleet', async () => {
  const { api } = makeApi({ listInstances: async () => ({ items: [], currentPort: 3080 }) })
  const [def] = buildAgentTools(identity, api)
  const v = await def.execute({})
  assert.deepEqual(v.instances, [])
  assert.match(def.output.render({}, v)[0].text, /no dsh instances/)
})

test('instance_start delegates to the shared launch flow', async () => {
  let started = 0
  const { api } = makeApi({ start: async () => { started++; return { ok: true, port: 3099, pid: 222 } } })
  const tools = byName(buildAgentTools(identity, api))
  const startDef = tools.instance_start
  const v = await startDef.execute({})
  assert.equal(started, 1)
  assert.deepEqual(v, { ok: true, port: 3099, pid: 222 })
  assert.match(startDef.output.render({}, v)[0].text, /started on port 3099 \(pid 222\)/)
})

// 输出根是 additionalProperties: false：任何未声明的键都会让整个工具结果被宿主拒绝，
// 而不是被忽略。宿主侧的启动结果还带面板交接用的内部字段，工具必须只采纳声明过的键。
const assertDeclaredOnly = (def, value) => {
  const declared = def.output.schema.properties
  assert.deepEqual(Object.keys(value).filter((k) => !(k in declared)), [])
}

test('instance_start drops launch-internal fields from its result', async () => {
  const { api } = makeApi({
    start: async () => ({
      ok: true, port: 3099, pid: 222,
      bin: '/opt/dsh/lib/bin.js', binVersion: '0.2.2-rc.1',
      logSince: 812, session: { tool: 'tmux', name: 'dsh-3099' }
    })
  })
  const def = byName(buildAgentTools(identity, api)).instance_start
  const v = await def.execute({})
  assert.deepEqual(v, {
    ok: true, port: 3099, pid: 222,
    bin: '/opt/dsh/lib/bin.js', binVersion: '0.2.2-rc.1'
  })
  assertDeclaredOnly(def, v)
  assert.match(def.output.render({}, v)[0].text, /\(v0\.2\.2-rc\.1\)/)
})

test('instance_start reports a missing launcher instead of failing output validation', async () => {
  const detail = '/home/u/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js'
  const { api } = makeApi({
    start: async () => ({
      ok: false, code: 'no_dsh_bin', detail,
      error: '未找到 dsh 启动器：PATH 中没有 dsh，也没有 ' + detail
    })
  })
  const def = byName(buildAgentTools(identity, api)).instance_start
  const v = await def.execute({})
  assert.equal(v.ok, false)
  assert.equal(v.code, 'no_dsh_bin')
  assert.equal('detail' in v, false, 'the diagnostic path stays in error, not in an undeclared key')
  assert.match(v.error, /bin\.js/)
  assertDeclaredOnly(def, v)
  assert.match(def.output.render({}, v)[0].text, /instance start failed/)
})

test('instance_restart drops the same launch-internal fields', async () => {
  const { api } = makeApi({
    restart: async (port) => ({
      ok: true, restarted: true, port, pid: 333,
      bin: '/opt/dsh/lib/bin.js', binVersion: '0.2.2-rc.1', logSince: 42
    })
  })
  const def = byName(buildAgentTools(identity, api)).instance_restart
  const v = await def.execute({ port: 3099 })
  assert.deepEqual(v, { ok: true, restarted: true, port: 3099, pid: 333 })
  assertDeclaredOnly(def, v)
})

test('instance_stop forwards foreign ports and validates its argument', async () => {
  const { api, calls } = makeApi()
  const stopDef = byName(buildAgentTools(identity, api)).instance_stop

  const ok = await stopDef.execute({ port: 3099 })
  assert.deepEqual(calls.stop, [3099])
  assert.equal(ok.ok, true)

  for (const bad of [0, -1, 70000, 1.5]) {
    const r = await stopDef.execute({ port: bad })
    assert.equal(r.ok, false, 'port ' + bad + ' must be rejected')
    assert.equal(r.code, 'bad_port')
  }
  assert.deepEqual(calls.stop, [3099], 'invalid ports never reach the api')
})

test("instance_stop surfaces the host's desktop refusal unchanged", async () => {
  // 桌面端判定属于宿主（端口号说明不了它背后是什么），而本工具运行在普通 node:test
  // 上，因此拒绝以 api 结果的形式到达。code 与原因必须原样透传——agent 读的是渲染后
  // 的文本，不是状态码。
  const refusal = {
    ok: false,
    code: 'stop_desktop_refused',
    error: 'the target is a desktop host: stopping it would leave the desktop window without a backend'
  }
  const { api, calls } = makeApi({ stop: async (port) => { calls.stop.push(port); return refusal } })
  const stopDef = byName(buildAgentTools(identity, api)).instance_stop
  const r = await stopDef.execute({ port: 19387 })
  assert.deepEqual(r, refusal)
  assert.deepEqual(calls.stop, [19387])
  // 渲染行优先使用 `error` 而不是 `code`，因此人看到的是宿主自己的措辞，而不是一个
  // 光秃秃的 code。
  assert.match(stopDef.output.render({ port: 19387 }, r)[0].text, /desktop host/)
})

// 端口窗口期是重启的真实性质，因此工具描述必须写明它：模型只在描述里读到
// "restart" 时，无从知道停止与启动之间端口是空的、被抢占就失败。
test('instance_restart describes the port window and never promises another port', async () => {
  const { api } = makeApi()
  const def = byName(buildAgentTools(identity, api)).instance_restart
  assert.match(def.description, /same port/)
  assert.match(def.description, /empty/)
  assert.match(def.description, /port_in_use/)
  assert.match(def.description, /never moves to another port/)
})

test('instance_restart forwards foreign ports, validates its argument, and reports the new pid', async () => {
  const { api, calls } = makeApi()
  const def = byName(buildAgentTools(identity, api)).instance_restart

  const v = await def.execute({ port: 3099 })
  assert.deepEqual(calls.restart, [3099])
  assert.deepEqual(v, { ok: true, restarted: true, port: 3099, pid: 333 })
  assert.match(def.output.render({}, v)[0].text, /restarted on port 3099 \(pid 333\)/)

  for (const bad of [0, -1, 70000, 1.5, '3080', '../'.repeat(8) + 'Windows/win.ini']) {
    const r = await def.execute({ port: bad })
    assert.equal(r.ok, false, 'port ' + JSON.stringify(bad) + ' must be rejected')
    assert.equal(r.code, 'bad_port')
  }
  assert.deepEqual(calls.restart, [3099], 'invalid ports never reach the api')
})

test("instance_restart surfaces the host's refusals and window failures unchanged", async () => {
  const refused = { ok: false, code: 'port_still_in_use', port: 3099, error: 'the port is still taken' }
  const { api } = makeApi({ restart: async () => refused })
  const def = byName(buildAgentTools(identity, api)).instance_restart
  const r = await def.execute({ port: 3099 })
  assert.deepEqual(r, refused, '宿主是端口归属与窗口的判定方，理由原样透传')
  assert.match(def.output.render({}, r)[0].text, /restart failed: the port is still taken/)
})

test('instance_logs rejects a non-port before it can be forwarded to a peer', async () => {
  // 宿主也会校验，但这个端口可以经由 fleet 链路离开本机，并会在对端拼进文件名。
  const { api, calls } = makeApi()
  const logDef = byName(buildAgentTools(identity, api)).instance_logs
  for (const bad of [0, -1, 70000, 1.5, '3080', '../'.repeat(8) + 'Windows/win.ini']) {
    const r = await logDef.execute({ port: bad })
    assert.equal(r.ok, false, 'port ' + JSON.stringify(bad) + ' must be rejected')
    assert.equal(r.code, 'bad_port')
    assert.match(logDef.output.render({ port: bad }, r)[0].text, /logs failed: port must be an integer/)
  }
  assert.deepEqual(calls.logs, [], 'invalid ports never reach the api')
})

test('instance_logs defaults to stdout, honors stream=err, and maps the shape', async () => {
  const { api, calls } = makeApi()
  const logDef = byName(buildAgentTools(identity, api)).instance_logs

  const out = await logDef.execute({ port: 3081 })
  assert.deepEqual(calls.logs, [[3081, 'out']])
  assert.deepEqual(out, { exists: true, truncated: false, lines: ['a', 'b'], stream: 'out' })

  const err = await logDef.execute({ port: 3081, stream: 'err' })
  assert.deepEqual(err.stream, 'err')
  assert.deepEqual(calls.logs[1], [3081, 'err'])

  const rendered = logDef.output.render({ port: 3081 }, out)
  assert.match(rendered[0].text, /^a\nb$/)
})

test('instance_logs renders the missing-file hint', async () => {
  const { api } = makeApi({ logs: () => ({ exists: false, truncated: false, lines: [] }) })
  const logDef = byName(buildAgentTools(identity, api)).instance_logs
  const v = await logDef.execute({ port: 3000 })
  assert.equal(v.exists, false)
  assert.match(logDef.output.render({ port: 3000 }, v)[0].text, /no log file for :3000/)
})

// ---- instance_sessions ----------------------------------------------------

test('instance_sessions forwards to the api and renders a compact list', async () => {
  const { api, calls } = makeApi()
  const def = byName(buildAgentTools(identity, api)).instance_sessions

  const v = await def.execute({ port: 3080 })
  assert.deepEqual(calls.sessions, [3080])
  assert.equal(v.ok, true)
  assert.equal(v.total, 2)
  assert.equal(v.sessions[0].id, 'abcdef1234567890')

  const text0 = def.output.render({}, v)[0].text
  assert.match(text0, /:3080 — 2 live session/)
  assert.match(text0, /abcdef12 · alpha · 12 ev/, '短 id + 工作目录基本名 + 事件数')
  assert.match(text0, /subagent/)

  // 超过 8 行折叠成 “+N more” 尾巴。
  const many = Object.assign({}, v, {
    total: 10,
    sessions: Array.from({ length: 10 }, (_, i) => ({ id: 'id' + i, createdAt: i }))
  })
  assert.match(def.output.render({}, many)[0].text, /\+2 more/)
})

test('instance_sessions surfaces unavailability and rejects bad ports', async () => {
  const { api, calls } = makeApi()
  const def = byName(buildAgentTools(identity, api)).instance_sessions

  const legacy = await def.execute({ port: 4000 })
  assert.equal(legacy.ok, false)
  assert.equal(legacy.code, 'sessions_unavailable')
  assert.match(def.output.render({}, legacy)[0].text, /failed/)

  for (const bad of [0, -1, 70000, 2.5]) {
    const r = await def.execute({ port: bad })
    assert.equal(r.code, 'bad_port', 'port ' + bad + ' must be rejected')
  }
  assert.deepEqual(calls.sessions, [4000], 'only the valid port reaches the api')
})

// 应答可能来自另一个实例，其新旧路由字段超出本工具的输出 schema。多余字段在
// tools 服务里会因 `additionalProperties: false` 失败，而 render() 在成功路径上
// 直接索引 `sessions`，缺失时在那里抛出。
test('instance_sessions projects a foreign reply onto the declared keys', async () => {
  const declaration = byName(buildAgentTools(identity, makeApi().api)).instance_sessions
  const declared = Object.keys(declaration.output.schema.properties).sort()

  const { api } = makeApi({
    sessions: async () => ({
      ok: true,
      port: 3080,
      total: 1,
      sessions: [{ id: 'a', createdAt: 1 }],
      // 本工具从未声明的字段：旧版面板路由会返回它们，新版还可能增加更多。
      currentPort: 3080,
      selfVersion: '0.7.0',
      cursor: null
    })
  })
  const def = byName(buildAgentTools(identity, api)).instance_sessions

  const v = await def.execute({ port: 3080 })
  for (const key of Object.keys(v)) {
    assert.ok(declared.includes(key), `${key} is not a declared output property`)
  }
})

test('instance_sessions survives a reply with no sessions array', async () => {
  const { api } = makeApi({ sessions: async () => ({ ok: true, port: 3080 }) })
  const def = byName(buildAgentTools(identity, api)).instance_sessions

  const v = await def.execute({ port: 3080 })
  assert.equal(v.ok, true)
  assert.deepEqual(v.sessions, [])
  assert.equal(v.total, 0, '回退值按实际返回的行计数')
  // 投影之前，render() 在这里索引 `v.sessions.length` 并抛出。
  assert.match(def.output.render({}, v)[0].text, /no active sessions/)
})

test('instance_sessions drops rows it cannot promise, instead of padding them', async () => {
  const { api } = makeApi({
    sessions: async () => ({
      ok: true,
      sessions: [
        { id: 'complete', createdAt: 10, cwd: '/w', events: 2 },
        { id: 'no-created-at' },
        { id: '', createdAt: 3 },
        null
      ]
    })
  })
  const def = byName(buildAgentTools(identity, api)).instance_sessions

  const v = await def.execute({ port: 3080 })
  assert.deepEqual(v.sessions, [{ id: 'complete', createdAt: 10, cwd: '/w', events: 2 }])
  assert.equal(v.total, 1)
})

test('instance_sessions reports a failure reply as not-ok without inventing rows', async () => {
  const { api } = makeApi({ sessions: async () => ({ ok: false, port: 4000 }) })
  const def = byName(buildAgentTools(identity, api)).instance_sessions

  const v = await def.execute({ port: 4000 })
  assert.equal(v.ok, false, '非布尔但为假值的应答也必须读成 false')
  assert.match(def.output.render({}, v)[0].text, /failed/)
})

// 标题与谱系是跨版本可选的：新版本的本机实例返回它们，旧版本的本机实例与旧版本的
// 远端实例都不返回。投影因此逐个按类型采纳，缺失即省略——`additionalProperties: false`
// 之下写入 null 与编造值同等危险。
test('instance_sessions keeps the title and lineage a newer instance reports', async () => {
  const { api } = makeApi({
    sessions: async () => ({
      ok: true,
      port: 3080,
      total: 1,
      sessions: [{
        id: 'abcdef0123456789',
        createdAt: 100,
        title: '修复登录',
        cwd: '/w',
        subagent: true,
        agentPreset: 'reviewer',
        parentSession: 'aaa',
        delegationDepth: 2,
        events: 12
      }]
    })
  })
  const def = byName(buildAgentTools(identity, api)).instance_sessions
  const v = await def.execute({ port: 3080 })
  assert.deepEqual(v.sessions[0], {
    id: 'abcdef0123456789',
    createdAt: 100,
    title: '修复登录',
    cwd: '/w',
    subagent: true,
    agentPreset: 'reviewer',
    parentSession: 'aaa',
    delegationDepth: 2,
    events: 12
  })
  const rendered = def.output.render({}, v)[0].text
  assert.match(rendered, /修复登录/, '有标题时用它替代没有辨识度的短 id')
  assert.match(rendered, /reviewer/)
  assert.match(rendered, /depth 2/)
})

test('instance_sessions omits the optional fields a legacy reply lacks', async () => {
  const declaration = byName(buildAgentTools(identity, makeApi().api)).instance_sessions
  const rowSchema = declaration.output.schema.properties.sessions.items
  assert.equal(rowSchema.additionalProperties, false, '会话行同样是封闭的')
  const declared = Object.keys(rowSchema.properties).sort()
  assert.ok(declared.includes('title') && declared.includes('agentPreset') &&
    declared.includes('parentSession') && declared.includes('delegationDepth'),
    '新字段必须一并声明，否则宿主返回它们时会被 additionalProperties:false 拒绝')

  // 旧版本实例的应答：一个 id、一个 createdAt，此外什么都没有。
  const { api } = makeApi({
    sessions: async () => ({ ok: true, port: 3080, total: 1, sessions: [{ id: 'legacy01', createdAt: 100 }] })
  })
  const def = byName(buildAgentTools(identity, api)).instance_sessions
  const v = await def.execute({ port: 3080 })
  assert.deepEqual(v.sessions, [{ id: 'legacy01', createdAt: 100 }],
    '缺失即省略，不写 null 或空串')
  assert.match(def.output.render({}, v)[0].text, /legacy01/)
})

test('instance_sessions drops lineage values it cannot promise', async () => {
  const { api } = makeApi({
    sessions: async () => ({
      ok: true,
      sessions: [{
        id: 'a', createdAt: 1,
        title: '', agentPreset: null, parentSession: 42, delegationDepth: 0
      }]
    })
  })
  const def = byName(buildAgentTools(identity, api)).instance_sessions
  assert.deepEqual((await def.execute({ port: 3080 })).sessions, [{ id: 'a', createdAt: 1 }],
    '空串、null、错类型与深度 0 都不进入摘要')
})
