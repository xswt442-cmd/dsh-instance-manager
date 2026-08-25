// Unit tests for the agent tool definitions in lib/agent-tools.js.
//
// The tools are built through an injected `defineTool` so these tests run on
// the stock node:test runner with NO @deepseek-ai/dsh-tools installed: the
// identity pass-through below keeps the raw definition objects inspectable,
// and fake api closures stand in for the host half's operations.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentTools } from '../lib/agent-tools.js'

// Identity defineTool — production passes dsh's validating factory, which
// must accept the same shape these assertions pin down.
const identity = (d) => d

const makeApi = (over = {}) => {
  const calls = { stop: [], logs: [], sessions: [] }
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

test('buildAgentTools exposes the five instance tools with registry-ready shapes', () => {
  const { api } = makeApi()
  const tools = byName(buildAgentTools(identity, api))
  assert.deepEqual(Object.keys(tools).sort(), [
    'instance_list', 'instance_logs', 'instance_sessions', 'instance_start', 'instance_stop'
  ])
  for (const def of Object.values(tools)) {
    assert.equal(typeof def.description, 'string')
    assert.equal(typeof def.execute, 'function')
    // Output contract: object root, closed, with a render projection.
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
  // Unmanaged row: null pid pruned (schema has no nullable nodes).
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
  assert.match(text0, /abcdef12 · alpha · 12 ev/, 'short id + cwd basename + event count')
  assert.match(text0, /subagent/)

  // >8 rows collapse into a "+N more" tail.
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
