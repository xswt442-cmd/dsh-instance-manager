// Unit tests for the pure host-side helpers in lib/shared.js.
// Runs on the stock node:test runner (`npm test`) — no dev dependencies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  VERSION,
  LOOPBACK_HOSTNAMES,
  isLoopbackName,
  hostHostname,
  createGuard,
  resolveDshBin,
  resolveDshHome,
  registryDir,
  isValidRegistryEntry,
  normalizePort,
  tailFile,
  unionPorts,
  summarizeSessions,
  awaitChild,
  managedLocalPorts,
  diffManagedPorts,
  parsePortRange,
  safeTokenEqual
} from '../lib/shared.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('VERSION constant stays in lockstep with package.json', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(VERSION, pkg.version)
})

test('isLoopbackName accepts every documented loopback name', () => {
  for (const name of LOOPBACK_HOSTNAMES) {
    assert.ok(isLoopbackName(name), name)
    assert.ok(isLoopbackName(name.toUpperCase()), 'case-insensitive: ' + name)
  }
})

test('isLoopbackName rejects foreign and empty names', () => {
  assert.equal(isLoopbackName('rebound.example'), false)
  assert.equal(isLoopbackName('0.0.0.0'), false)
  assert.equal(isLoopbackName('::ffff:8.8.8.8'), false)
  assert.equal(isLoopbackName(''), false)
  assert.equal(isLoopbackName(undefined), false)
})

test('hostHostname strips ports and brackets', () => {
  assert.equal(hostHostname('127.0.0.1:3080'), '127.0.0.1')
  assert.equal(hostHostname('[::1]:3080'), '::1')
  assert.equal(hostHostname('[::ffff:127.0.0.1]:80'), '::ffff:127.0.0.1')
  assert.equal(hostHostname('rebound.example'), 'rebound.example')
  assert.equal(hostHostname('REBOUND.EXAMPLE'), 'rebound.example')
  assert.equal(hostHostname(undefined), '')
})

// Guard harness: records rejections instead of touching a real response.
const makeGuard = (currentPort = () => 3080) => {
  const rejections = []
  const respond = (res, code, obj) => { rejections.push({ code, obj }) }
  return { guard: createGuard({ currentPort, respond }), rejections }
}
const reqOf = (headers) => ({ headers })

test('guard passes same-origin browser traffic', () => {
  const { guard, rejections } = makeGuard()
  for (const headers of [
    {},
    { 'sec-fetch-site': 'same-origin' },
    { 'sec-fetch-site': 'none' },
    { host: '127.0.0.1:3080' },
    { origin: 'http://127.0.0.1:3080' },
    { host: '[::1]:3080', origin: 'http://localhost:3080' }
  ]) {
    assert.equal(guard(reqOf(headers)), true, JSON.stringify(headers))
  }
  assert.equal(rejections.length, 0)
})

test('guard rejects cross-site fetch metadata with 403', () => {
  const { guard, rejections } = makeGuard()
  assert.equal(guard(reqOf({ 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(guard(reqOf({ 'sec-fetch-site': 'same-site' })), false)
  assert.deepEqual(rejections.map((r) => r.code), [403, 403])
  assert.equal(rejections[0].obj.code, 'cross_site')
})

test('guard rejects foreign Origin with 403 (including right host, wrong port)', () => {
  const { guard, rejections } = makeGuard()
  assert.equal(guard(reqOf({ origin: 'https://evil.example' })), false)
  assert.equal(guard(reqOf({ origin: 'http://127.0.0.1:3999' })), false)
  assert.equal(rejections.every((r) => r.code === 403), true)
  assert.equal(rejections.every((r) => r.obj.code === 'bad_origin'), true)
})

test('guard rejects non-loopback Host with 403 (DNS rebinding closed)', () => {
  const { guard, rejections } = makeGuard()
  assert.equal(guard(reqOf({ host: 'rebound.example' })), false)
  assert.equal(guard(reqOf({ host: 'rebound.example:3080' })), false)
  assert.equal(rejections.every((r) => r.code === 403), true)
  assert.equal(rejections.every((r) => r.obj.code === 'bad_host'), true)
})

test('guard Origin check follows the live currentPort()', () => {
  let port = 3080
  const { guard, rejections } = makeGuard(() => port)
  assert.equal(guard(reqOf({ origin: 'http://127.0.0.1:3080' })), true)
  port = 3099
  assert.equal(guard(reqOf({ origin: 'http://127.0.0.1:3080' })), false)
  assert.equal(guard(reqOf({ origin: 'http://127.0.0.1:3099' })), true)
  assert.equal(rejections.length, 1)
})

test('guard allowRemoteHost defers non-loopback Hosts to bearer verification', () => {
  const rejections = []
  const respond = (res, code, obj) => { rejections.push({ code, obj }) }
  const fleetGuard = createGuard({ currentPort: () => 3080, respond, allowRemoteHost: () => true })
  // Non-loopback Host passes the guard; the HANDLER owns the bearer gate.
  assert.equal(fleetGuard(reqOf({ host: 'box.lan:3080' })), true)
  // Defense-in-depth unchanged: foreign cross-site traffic still rejected.
  assert.equal(fleetGuard(reqOf({ origin: 'https://evil.example', host: 'box.lan:3080' })), false)
  assert.equal(fleetGuard(reqOf({ 'sec-fetch-site': 'cross-site', host: 'box.lan:3080' })), false)

  // Without the flag, behavior is byte-for-byte the old strict mode.
  const strictGuard = createGuard({ currentPort: () => 3080, respond })
  assert.equal(strictGuard(reqOf({ host: 'box.lan:3080' })), false)
  assert.equal(rejections.some((r) => r.obj.code === 'bad_host'), true)
})

test('safeTokenEqual fails closed and never leaks length by timing', () => {
  assert.equal(safeTokenEqual('Bearer s3cret', 'Bearer s3cret'), true)
  assert.equal(safeTokenEqual('Bearer s3cerx', 'Bearer s3cret'), false)
  assert.equal(safeTokenEqual('Bearer s3cre', 'Bearer s3cret'), false, 'length mismatch')
  assert.equal(safeTokenEqual('', 'Bearer s3cret'), false, 'empty header')
  assert.equal(safeTokenEqual(undefined, undefined), false, 'both unconfigured')
})

test('resolveDshBin prefers the running entry script when it looks like one', () => {
  const exists = { '/x/bin.js': true, '/p/b.js': false }
  assert.equal(
    resolveDshBin({ argv1: '/x/bin.js', home: '/h', exists: (f) => !!exists[f] }),
    '/x/bin.js'
  )
})

test('resolveDshBin falls back to the profile path built with path.join', () => {
  const expected = path.join('/h', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  // argv1 missing entirely -> fallback
  assert.equal(resolveDshBin({ argv1: '', home: '/h', exists: () => true }), expected)
  // argv1 exists but does not look like bin.js -> fallback
  assert.equal(resolveDshBin({ argv1: '/somewhere/cli.mjs', home: '/h', exists: () => true }), expected)
  // argv1 named bin.js but absent on disk -> fallback
  assert.equal(
    resolveDshBin({ argv1: '/gone/bin.js', home: '/h', exists: (f) => f === expected }),
    expected
  )
})

test('resolveDshBin resolves empty when neither candidate exists', () => {
  assert.equal(resolveDshBin({ argv1: '', home: '/h', exists: () => false }), '')
})

// The port is interpolated into the launcher log filename, so this function
// is the only thing standing between a fleet peer and a path traversal.
test('normalizePort accepts exactly the integers in [1, 65535]', () => {
  assert.equal(normalizePort(1), 1)
  assert.equal(normalizePort(3080), 3080)
  assert.equal(normalizePort(65535), 65535)
  assert.equal(normalizePort('3080'), 3080)
  assert.equal(normalizePort(' 3080 '), 3080)
})

test('normalizePort rejects everything that is not a bare integer in range', () => {
  // Path traversal — the reason this function exists.
  for (const bad of [
    '../'.repeat(8) + 'Windows/win.ini',
    '..\\..\\..\\..\\secret',
    '../../etc/passwd'
  ]) {
    assert.equal(normalizePort(bad), null, bad)
  }
  // Non-integers, out-of-range, and coercions that only "look" numeric.
  for (const bad of [
    0, -1, 65536, 80.5, NaN, Infinity, -Infinity,
    '', '   ', '80abc', 'abc', '1e3', '0x10', '+80',
    null, undefined, true, false, {}, [], ['80']
  ]) {
    assert.equal(normalizePort(bad), null, JSON.stringify(bad))
  }
})

test('registryDir nests run/instances under the dsh home', () => {
  assert.equal(registryDir('/home/.dsh'), path.join('/home/.dsh', 'run', 'instances'))
})

const validEntry = (over = {}) => ({
  pid: 4242, port: 3081, startedAt: 1000, ts: 9000, version: '0.6.0', ...over
})

test('registry entries validate structurally and by freshness', () => {
  const now = 10000
  assert.equal(isValidRegistryEntry(validEntry(), now), true)
  assert.equal(isValidRegistryEntry(validEntry({ ts: now - 29999 }), now), true, 'just fresh enough')
  for (const bad of [
    null,
    undefined,
    'json',
    validEntry({ pid: 'x' }),
    validEntry({ port: 0 }),
    validEntry({ port: 70000 }),
    validEntry({ startedAt: null }),
    validEntry({ ts: undefined }),
    validEntry({ ts: now - 30001 }),
    validEntry({ ts: now + 1 })
  ]) {
    assert.equal(isValidRegistryEntry(bad, now), false, JSON.stringify(bad))
  }
})

test('unionPorts merges the sweep range with out-of-range heartbeat ports', () => {
  assert.deepEqual(unionPorts(3080, 3082), [3080, 3081, 3082])
  assert.deepEqual(
    unionPorts(3080, 3081, [4000, 3080, 70000, 0, -3, 1.5]),
    [3080, 3081, 4000],
    'dedupes, keeps only valid integer ports, sorts ascending'
  )
  assert.deepEqual(unionPorts(3080, 3080, [250, 80]), [80, 250, 3080])
})

// ---- session summaries ----------------------------------------------------

test('summarizeSessions extracts scalar fields, sorts newest-first, caps', () => {
  const sessions = [
    { id: 'aaa', header: { createdAt: 100, cwd: '/work/alpha', origin: 'subagent' }, seq: 7 },
    { id: 'bbb', header: { createdAt: 200 } },
    { id: 'ccc', header: { createdAt: 150, cwd: '' }, seq: 0 }
  ]
  const rows = summarizeSessions(sessions)
  assert.deepEqual(rows.map((r) => r.id), ['bbb', 'ccc', 'aaa'], 'newest first')
  assert.deepEqual(rows[1], { id: 'ccc', createdAt: 150, events: 0 }, 'empty cwd pruned, zero events kept')
  assert.equal(rows[2].cwd, '/work/alpha')
  assert.equal(rows[2].subagent, true)
  // Non-summaries are skipped, never thrown over.
  assert.deepEqual(summarizeSessions([null, {}, { id: 'x' }, 'junk', sessions[0]]).map((r) => r.id), ['aaa'])
  assert.equal(summarizeSessions(undefined).length, 0)
})

test('summarizeSessions caps at N newest rows', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: 's' + i, header: { createdAt: i * 10 }, seq: i
  }))
  const rows = summarizeSessions(many, 20)
  assert.equal(rows.length, 20)
  assert.equal(rows[0].id, 's29', 'cap keeps the NEWEST rows')
})

// ---- fleet up/down diff ---------------------------------------------------

// ---- launcher child: ready / exited / failed-to-spawn --------------------
// The 'error' case is the one that matters: a ChildProcess that cannot start
// emits 'error' and NO 'exit', and an unlistened 'error' event is
// process-fatal, so a single failed launch used to kill the whole instance.
const fakeChild = () => {
  const handlers = {}
  return {
    once: (ev, fn) => { handlers[ev] = fn; return this },
    fire: (ev, arg) => { if (handlers[ev]) handlers[ev](arg) }
  }
}
const noSleep = async () => { }

test('awaitChild reports a child that failed to spawn as died, not as a crash', async () => {
  const child = fakeChild()
  const pending = awaitChild({ child, confirmMs: 50, sleep: noSleep, probe: async () => false })
  const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
  child.fire('error', err)
  assert.deepEqual(await pending, { died: true, code: 'spawn:ENOENT' },
    'a spawn failure must surface as a failed launch, never as an unhandled error event')
})

test('awaitChild reports an exiting child with its exit code', async () => {
  const child = fakeChild()
  const pending = awaitChild({ child, confirmMs: 50, sleep: noSleep, probe: async () => false })
  child.fire('exit', 9)
  assert.deepEqual(await pending, { died: true, code: 9 })
})

test('awaitChild resolves ready as soon as the child answers', async () => {
  let calls = 0
  const child = fakeChild()
  const pending = awaitChild({ child, confirmMs: 50, sleep: noSleep, probe: async () => (++calls >= 2) })
  assert.deepEqual(await pending, { ready: true })
  assert.equal(calls, 2, 'polling must stop at the first positive probe')
})

test('awaitChild returns empty (not died) when the confirm window just closes', async () => {
  // A slow first boot is not a failure: the caller leaves the child alone
  // rather than spawning a second one.
  const child = fakeChild()
  const pending = awaitChild({ child, confirmMs: 0, sleep: noSleep, probe: async () => false })
  assert.deepEqual(await pending, {})
})

test('managedLocalPorts tracks managed LOCAL rows only', () => {
  // Regression: the SSE baseline seeded this set with an inline
  // `i.managed` filter while the diff ticker used `i.managed && !i.remote`,
  // so the first tick after subscribing read every peer port as "removed"
  // and toasted instance-down for machines that were up the whole time.
  // Both call sites now share this helper, so they cannot disagree again.
  const items = [
    { port: 3080, managed: true },
    { port: 3081, managed: true, remote: true, source: 'office' },
    { port: 3082, managed: false },
    { port: 3083, managed: true, remote: true, source: 'laptop' }
  ]
  assert.deepEqual(managedLocalPorts(items), [3080])
  assert.deepEqual(managedLocalPorts(null), [], 'a null fleet is not an error')
  assert.deepEqual(managedLocalPorts(undefined), [])
})

test('diffManagedPorts reports joins and leaves between ticks', () => {
  assert.deepEqual(
    diffManagedPorts(new Set([3080, 3081]), new Set([3081, 3082])),
    { added: [3082], removed: [3080] }
  )
  assert.deepEqual(diffManagedPorts(new Set(), new Set([4000])), { added: [4000], removed: [] })
  assert.deepEqual(diffManagedPorts(new Set([3080]), new Set([3080])), { added: [], removed: [] })
})

test('parsePortRange honors the env override and falls back silently', () => {
  assert.deepEqual(parsePortRange(undefined), { min: 3080, max: 3129 })
  assert.deepEqual(parsePortRange(''), { min: 3080, max: 3129 })
  assert.deepEqual(parsePortRange('junk'), { min: 3080, max: 3129 })
  assert.deepEqual(parsePortRange('4000-4010'), { min: 4000, max: 4010 })
  assert.deepEqual(parsePortRange(' 4000 - 4010 '), { min: 4000, max: 4010 }, 'whitespace tolerated')
  assert.deepEqual(parsePortRange('80-80'), { min: 80, max: 80 }, 'single-port band allowed')
  // invalid shapes and bounds fall back
  assert.deepEqual(parsePortRange('4000'), { min: 3080, max: 3129 })
  assert.deepEqual(parsePortRange('5000-4000'), { min: 3080, max: 3129 })
  assert.deepEqual(parsePortRange('0-100'), { min: 3080, max: 3129 })
  assert.deepEqual(parsePortRange('1-70000'), { min: 3080, max: 3129 })
})

// ---- tailFile ------------------------------------------------------------

test('tailFile returns whole lines only, bounded by maxLines and maxBytes', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'dshim-tail-'))
  try {
    // 30 numbered lines -> last 10 with default-ish cap
    writeFileSync(path.join(dir, 'a.log'), Array.from({ length: 30 }, (_, i) => 'line-' + (i + 1)).join('\n') + '\n')
    const t1 = tailFile(path.join(dir, 'a.log'), 65536, 10)
    assert.equal(t1.exists, true)
    assert.equal(t1.lines.length, 10)
    assert.equal(t1.lines[0], 'line-21')
    assert.equal(t1.lines[9], 'line-30')
    assert.equal(t1.truncated, true)

    // small file: everything fits, no truncation
    writeFileSync(path.join(dir, 'b.log'), 'hello\nworld\n')
    const t2 = tailFile(path.join(dir, 'b.log'), 65536, 200)
    assert.deepEqual(t2, { exists: true, truncated: false, lines: ['hello', 'world'] })

    // byte bound smaller than the file -> cut leading fragment is dropped
    writeFileSync(path.join(dir, 'c.log'), 'START-cut-line\nwhole-one\nwhole-two\n')
    const t3 = tailFile(path.join(dir, 'c.log'), 24, 200)
    assert.equal(t3.exists, true)
    assert.deepEqual(t3.lines, ['whole-one', 'whole-two'])

    // missing file -> exists:false instead of a throw
    const t4 = tailFile(path.join(dir, 'nope.log'))
    assert.deepEqual(t4, { exists: false, truncated: false, lines: [] })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveDshHome follows the harness precedence and treats blank as unset', () => {
  const home = '/home/tester'
  const fallback = path.resolve(path.join(home, '.dsh'))
  assert.equal(resolveDshHome({ DSH_HOME: '/srv/dsh' }, home), path.resolve('/srv/dsh'))
  assert.equal(resolveDshHome({}, home), fallback)
  assert.equal(resolveDshHome({ DSH_HOME: '' }, home), fallback)
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }, home), fallback)
  // A configured home that does not exist yet is still the home: the harness
  // creates it on demand, and falling back here would split the registry.
  assert.equal(resolveDshHome({ DSH_HOME: '/not/created/yet' }, home), path.resolve('/not/created/yet'))
})

test('resolveDshHome expands a tilde prefix against the OS home', () => {
  const home = '/home/tester'
  assert.equal(resolveDshHome({ DSH_HOME: '~' }, home), path.resolve(home))
  assert.equal(resolveDshHome({ DSH_HOME: '~/elsewhere' }, home), path.resolve(path.join(home, 'elsewhere')))
  assert.equal(resolveDshHome({ DSH_HOME: '~\\elsewhere' }, home), path.resolve(path.join(home, 'elsewhere')))
})
