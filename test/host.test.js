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
  registryDir,
  isValidRegistryEntry,
  firstNonNull,
  tailFile,
  unionPorts,
  summarizeSessions,
  diffManagedPorts
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

test('firstNonNull resolves the first fulfilled non-null value', async () => {
  assert.equal(await firstNonNull([async () => null, async () => 'b']), 'b')
  assert.equal(await firstNonNull([async () => { throw new Error('x') }, async () => 7]), 7)
})

test('firstNonNull resolves null when everything misses or rejects', async () => {
  const slowNull = () => new Promise((resolve) => setTimeout(() => resolve(null), 5))
  assert.equal(await firstNonNull([
    async () => { throw new Error('x') },
    async () => null,
    slowNull
  ]), null)
  assert.equal(await firstNonNull([]), null)
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

test('diffManagedPorts reports joins and leaves between ticks', () => {
  assert.deepEqual(
    diffManagedPorts(new Set([3080, 3081]), new Set([3081, 3082])),
    { added: [3082], removed: [3080] }
  )
  assert.deepEqual(diffManagedPorts(new Set(), new Set([4000])), { added: [4000], removed: [] })
  assert.deepEqual(diffManagedPorts(new Set([3080]), new Set([3080])), { added: [], removed: [] })
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
