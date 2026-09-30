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
  isLoopbackAddress,
  requestNeedsBearer,
  createGuard,
  sendJson,
  createRequirePost,
  createBrowserAuthorizer,
  connectionUnavailable,
  CONNECTION_UNAVAILABLE,
  resolveDshBin,
  resolveDshHome,
  registryDir,
  isValidRegistryEntry,
  normalizePort,
  tailFile,
  unionPorts,
  summarizeSessions,
  orderInstances,
  awaitChild,
  managedLocalPorts,
  diffManagedPorts,
  parsePortSpec,
  safeTokenEqual,
  buildDshLaunchArgs,
  DESKTOP_HOST_RE,
  detectRuntime,
  isElectronNode,
  LAUNCHER_ENV,
  PARENT_PID_ENV,
  launcherOf,
  parentPidOf,
  buildSpawnEnv,
  dshBinVersion
} from '../lib/shared.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('VERSION constant stays in lockstep with package.json', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(VERSION, pkg.version)
})

test('RC1 launch args split browser token handoff from headless agent starts', () => {
  const ui = buildDshLaunchArgs('C:/dsh/lib/bin.js', 3090, { browserHandoff: true })
  const agent = buildDshLaunchArgs('C:/dsh/lib/bin.js', 3090)
  assert.deepEqual(ui.slice(-4), ['--profile', 'web', '--port', '3090'])
  assert.equal(ui.includes('--no-open'), false, 'browser start must open the one-time token URL')
  assert.equal(agent.includes('--no-open'), true, 'agent start must remain headless')
  assert.ok(agent.indexOf('--profile') < agent.indexOf('--no-open'))
})

test('detectRuntime recognises the desktop host by its entry script', () => {
  // The desktop app's own host: the same exe, running the desktop-host entry
  // point unpacked from app.asar.
  assert.equal(detectRuntime([
    'E:\\DSH\\DeepSeek Harness.exe',
    '--expose-internals',
    'E:\\DSH\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js'
  ]), 'desktop')
  assert.equal(detectRuntime(['/opt/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js']), 'desktop')
  assert.equal(detectRuntime(['node', '/opt/dsh/lib/index.js', '--dsh-desktop-host-marker']), 'desktop', 'any argv element may carry the marker')
})

test('an Electron-launched web instance stays node, not desktop', () => {
  // Measured counterexample: the desktop panel spawns plain web instances from
  // the app's own executable, and they inherit ELECTRON_RUN_AS_NODE=1. The env
  // flag is therefore reported but never decisive — treating it as "desktop"
  // would leave an ordinary web instance impossible to stop.
  const argv = [
    'E:\\DSH\\DeepSeek Harness.exe',
    '--trace-exit',
    '--unhandled-rejections=strict',
    'C:\\Users\\x\\.dsh\\profiles\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
  ]
  assert.equal(detectRuntime(argv), 'node')
  assert.equal(isElectronNode({ ELECTRON_RUN_AS_NODE: '1' }, {}), true)
  assert.equal(isElectronNode({ ELECTRON_RUN_AS_NODE: '1' }, { electron: '38.0.0' }), true)
  assert.equal(isElectronNode({}, { electron: '38.0.0' }), true)
  assert.equal(isElectronNode({}, {}), false)
  // Called with its defaults this reads the LIVE environment, which inside the
  // desktop's own process tree already carries the flag — for this plain node
  // test runner too. That is exactly why the flag must not decide the runtime,
  // so only its type is asserted here rather than a host-dependent value.
  assert.equal(typeof isElectronNode(), 'boolean')
})

test('detectRuntime never claims desktop from a missing or non-string argv', () => {
  assert.equal(detectRuntime([]), 'node')
  assert.equal(detectRuntime(undefined), 'node')
  assert.equal(detectRuntime(['node', null, 42, { a: 1 }]), 'node')
  assert.equal(DESKTOP_HOST_RE.test('C:/dsh/lib/bin.js'), false)
})

test('launcherOf and parentPidOf read the spawn markers and fail to null', () => {
  assert.equal(launcherOf({ [LAUNCHER_ENV]: 'desktop' }), 'desktop')
  assert.equal(launcherOf({ [LAUNCHER_ENV]: 'web' }), 'web')
  assert.equal(launcherOf({ [LAUNCHER_ENV]: 'elsewhere' }), null)
  assert.equal(launcherOf({}), null)
  assert.equal(launcherOf(undefined), null)
  assert.equal(parentPidOf({ [PARENT_PID_ENV]: '4242' }), 4242)
  // 0, negatives and junk are "unknown", not a pid.
  for (const bad of ['0', '-3', '12.5', '1e3', 'abc', '']) {
    assert.equal(parentPidOf({ [PARENT_PID_ENV]: bad }), null, bad)
  }
  assert.equal(parentPidOf({}), null)
  assert.equal(parentPidOf(undefined), null)
})

test('buildSpawnEnv forces ELECTRON_RUN_AS_NODE on the desktop and keeps inheritance', () => {
  const base = { PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' }
  const desktop = buildSpawnEnv(base, { runtime: 'desktop', parentPid: 99 })
  assert.equal(desktop.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(desktop[LAUNCHER_ENV], 'desktop')
  assert.equal(desktop[PARENT_PID_ENV], '99')
  assert.equal(desktop.PATH, '/bin')
  assert.equal(base[LAUNCHER_ENV], undefined, 'the base env must not be mutated')
  // A web instance started FROM the desktop inherits the flag and must keep it:
  // the same Electron exe is the node runtime only while that flag is set.
  const inherited = buildSpawnEnv({ ELECTRON_RUN_AS_NODE: '1' }, { runtime: 'node', parentPid: 42 })
  assert.equal(inherited.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(inherited[LAUNCHER_ENV], 'web')
  assert.equal(inherited[PARENT_PID_ENV], '42')
  // A plain node host adds neither.
  const plain = buildSpawnEnv({ PATH: '/bin' }, { runtime: 'node', parentPid: null })
  assert.equal(plain.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(plain[LAUNCHER_ENV], 'web')
  assert.equal(plain[PARENT_PID_ENV], undefined)
})

test('dshBinVersion reads the package beside the launcher and degrades to null', () => {
  const bin = path.join('C:', 'Users', 'x', '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  let asked = null
  const read = (f) => { asked = f; return JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.1' }) }
  assert.equal(dshBinVersion(bin, read), '0.2.0-rc.1')
  assert.equal(asked, path.join('C:', 'Users', 'x', '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  // A missing, unreadable or versionless package reports "unknown" instead of
  // throwing: the start itself succeeded and must still be reported.
  assert.equal(dshBinVersion(bin, () => 'not json'), null)
  assert.equal(dshBinVersion(bin, () => { throw new Error('ENOENT') }), null)
  assert.equal(dshBinVersion(bin, () => JSON.stringify({ name: 'x' })), null)
  assert.equal(dshBinVersion(bin, () => JSON.stringify({ version: '' })), null)
  assert.equal(dshBinVersion(undefined, read), null)
  assert.equal(dshBinVersion(bin, null), null)
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
  // The allowlist is exact spellings only — the v4-mapped v6 form of 127.0.0.1
  // is accepted because it maps to an allowlisted name, not by being listed.
  assert.equal(isLoopbackName('127.0.0.2'), false)
  assert.equal(isLoopbackName('api.localhost'), false)
})

// Regression: the loopback predicates arrive here through a generated block
// (the `dsh-loopback-helpers` marker in lib/shared.js). This repo previously
// carried a dead '::ffff:127.0.0.1' allowlist entry — unreachable from the
// Origin path, because the WHATWG URL parser rewrites the dotted form to hex.
// Both spellings must be loopback, on both paths.
test('the IPv4-mapped IPv6 loopback form is loopback in both spellings', () => {
  for (const name of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:7F00:1']) {
    assert.ok(isLoopbackName(name), name)
    assert.ok(isLoopbackName(hostHostname(`[${name}]:3080`)), `bracketed: ${name}`)
  }
  // Non-loopback mapped addresses stay non-loopback.
  for (const name of ['::ffff:10.0.0.1', '::ffff:8.8.8.8']) {
    assert.equal(isLoopbackName(name), false, name)
  }
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
// A real HTTP request always carries a socket peer; default it to loopback
// (local browser/UI) so the happy path is exercised, and let a test pass a
// forged off-loopback address to simulate a remote attacker.
const reqOf = (headers, remoteAddress) =>
  ({ headers, socket: { remoteAddress: remoteAddress || '127.0.0.1' } })

test('guard passes same-origin browser traffic', () => {
  const { guard, rejections } = makeGuard()
  for (const headers of [
    {},
    { 'sec-fetch-site': 'same-origin' },
    { 'sec-fetch-site': 'none' },
    { host: '127.0.0.1:3080' },
    { origin: 'http://127.0.0.1:3080' },
    { host: '[::1]:3080', origin: 'http://localhost:3080' },
    { host: '[::1]:3080', origin: 'http://[::1]:3080' }
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
  assert.equal(guard(reqOf({ origin: 'http://evil.localhost:3080' })), false)
  assert.equal(guard(reqOf({ origin: 'http://127.0.0.1:3999' })), false)
  assert.equal(guard(reqOf({ origin: 'http://[::1]:3999' })), false)
  assert.equal(rejections.every((r) => r.code === 403), true)
  assert.equal(rejections.every((r) => r.obj.code === 'bad_origin'), true)
})

test('guard rejects non-loopback Host with 403 (DNS rebinding closed)', () => {
  const { guard, rejections } = makeGuard()
  assert.equal(guard(reqOf({ host: 'rebound.example' })), false)
  assert.equal(guard(reqOf({ host: 'rebound.example:3080' })), false)
  assert.equal(guard(reqOf({ host: 'evil.localhost:3080' })), false)
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

test('isLoopbackAddress trusts only the real socket peer, never headers', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true, 'IPv4-mapped IPv6 folds back to 127/8')
  assert.equal(isLoopbackAddress('::FFFF:127.0.0.1'), true, 'case-insensitive')
  assert.equal(isLoopbackAddress('127.255.255.254'), true)
  assert.equal(isLoopbackAddress(''), false, 'missing fails closed')
  assert.equal(isLoopbackAddress(undefined), false)
  assert.equal(isLoopbackAddress('0.0.0.0'), false, 'wildcard is not loopback')
  assert.equal(isLoopbackAddress('8.8.8.8'), false)
  assert.equal(isLoopbackAddress('::ffff:8.8.8.8'), false, 'mapped non-loopback stays non-loopback')
  assert.equal(isLoopbackAddress('example.com'), false)
})

test('guard requires the fleet bearer for an off-loopback TCP peer (closes forged-loopback-Host bypass)', () => {
  const rejections = []
  const respond = (res, code, obj) => { rejections.push({ code, obj }) }
  const fleetGuard = createGuard({ currentPort: () => 3080, respond, allowRemoteHost: () => true })
  // Remote attacker forges a loopback Host and omits Origin/Sec-Fetch-Site —
  // the OLD guard passed this and skipped the bearer. The peer address is the
  // only unforgeable signal, so the guard now treats it as remote.
  assert.equal(fleetGuard(reqOf({ host: '127.0.0.1:3080' }, '203.0.113.5')), true,
    'guard defers to the handler; bearer is enforced there')
  // The strict (events) guard has no fleet mode, so the same off-loopback peer
  // is rejected outright — pure hardening, no legitimate local request uses it.
  const strictGuard = createGuard({ currentPort: () => 3080, respond })
  assert.equal(strictGuard(reqOf({ host: '127.0.0.1:3080' }, '203.0.113.5')), false)
  assert.equal(rejections.at(-1).obj.code, 'bad_host')
})

test('guard accepts loopback peers regardless of address shape, with no bearer', () => {
  const { guard, rejections } = makeGuard()
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(guard(reqOf({ host: '127.0.0.1:3080' }, peer)), true, peer)
  }
  assert.equal(rejections.length, 0)
})

test('guard fails closed when the socket peer is missing (cannot identify caller)', () => {
  const rejections = []
  const respond = (res, code, obj) => { rejections.push({ code, obj }) }
  const fleetGuard = createGuard({ currentPort: () => 3080, respond, allowRemoteHost: () => true })
  const noSocket = { headers: { host: '127.0.0.1:3080' } }
  assert.equal(fleetGuard(noSocket), false)
  assert.equal(rejections.at(-1).obj.code, 'unknown_peer')
})

test('guard fails closed on a blank peer address (empty string identifies nobody)', () => {
  // Regression: the guard only tested `peerAddress == null`, so an empty
  // remoteAddress passed as "not remote" even though it identifies no caller.
  // `reqOf` cannot express this case — it defaults a falsy address back to
  // loopback — so these request objects are built by hand.
  const rejections = []
  const respond = (res, code, obj) => { rejections.push({ code, obj }) }
  const fleetGuard = createGuard({ currentPort: () => 3080, respond, allowRemoteHost: () => true })
  for (const blank of ['', '   ']) {
    assert.equal(fleetGuard({ headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: blank } }), false, JSON.stringify(blank))
    assert.equal(rejections.at(-1).obj.code, 'unknown_peer')
  }
  // The route-level decision has to agree with the guard: if one of them
  // treats an unidentified caller as local, the bearer gate is bypassable.
  assert.equal(requestNeedsBearer({ headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '' } }), true)
})

test('requestNeedsBearer mirrors the guard: peer OR Host off-loopback demands the bearer', () => {
  const local = { headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(requestNeedsBearer(local), false, 'loopback peer + loopback Host is trusted')
  const forged = { headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '203.0.113.5' } }
  assert.equal(requestNeedsBearer(forged), true, 'loopback Host cannot hide an off-loopback peer')
  const badHost = { headers: { host: 'box.lan:3080' }, socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(requestNeedsBearer(badHost), true, 'off-loopback Host still demands the bearer')
})

test('guard accepts a same-origin request whose default port is omitted (service on 80)', () => {
  // Regression (P2): WHATWG normalises `http://127.0.0.1` to port "", which the
  // old `String(o.port || '')` compared against "80" and rejected as bad_origin.
  const { guard, rejections } = makeGuard(() => 80)
  assert.equal(guard(reqOf({ origin: 'http://127.0.0.1' })), true)
  assert.equal(guard(reqOf({ origin: 'http://127.0.0.1:80' })), true)
  assert.equal(guard(reqOf({ host: '127.0.0.1' })), true)
  assert.equal(rejections.length, 0)
  // A genuinely foreign default-port origin is still rejected.
  const { guard: g2, rejections: r2 } = makeGuard(() => 80)
  assert.equal(g2(reqOf({ origin: 'http://10.0.0.9' })), false)
  assert.equal(r2.at(-1).obj.code, 'bad_origin')
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

// ---- fleet list order -----------------------------------------------------

test('orderInstances pins the current instance first', () => {
  const rows = [
    { port: 3080, current: false },
    { port: 3081, current: false },
    { port: 3082, current: true },
    { port: 3083, current: false }
  ]
  assert.deepEqual(orderInstances(rows).map((r) => r.port), [3082, 3080, 3081, 3083])
})

test('orderInstances sorts everything else by ascending port, local or remote', () => {
  const rows = [
    { port: 3090, current: false },
    { port: 3082, current: false, remote: true, source: 'office' },
    { port: 3091, current: false },
    { port: 3080, current: false, remote: true, source: 'office' }
  ]
  assert.deepEqual(orderInstances(rows).map((r) => r.port), [3080, 3082, 3090, 3091])
})

test('orderInstances lets port outrank the source id', () => {
  // A peer row without a lower port must not jump ahead of a local one: the
  // two share a port column, and breaking the ascending scan is what the
  // current-row pin exists to avoid.
  const rows = [
    { port: 3080, current: false },
    { port: 3090, current: false, remote: true, source: 'aaa' }
  ]
  assert.deepEqual(orderInstances(rows).map((r) => r.port), [3080, 3090])
})

test('orderInstances is stable across equals and never mutates its input', () => {
  // Two machines can both list :3080; the source id keeps them from swapping
  // position between polls.
  const rows = [
    { port: 3080, current: false, remote: true, source: 'zulu' },
    { port: 3080, current: false, remote: true, source: 'alpha' }
  ]
  const original = rows.slice()
  assert.deepEqual(orderInstances(rows).map((r) => r.source), ['alpha', 'zulu'])
  assert.deepEqual(rows, original, 'input order untouched')
  assert.deepEqual(orderInstances(undefined), [])
  assert.deepEqual(orderInstances(null), [])
  // Rows missing port/current/remote sort without throwing; the current row
  // still wins.
  assert.equal(orderInstances([{ current: true }, {}])[0].current, true)
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
// emits 'error' and NO 'exit', and an unlistened 'error' event is process-fatal,
// so 'error' is always consumed and a failed launch is only ever reported.
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

test('awaitChild stops probing once the race has a verdict', async () => {
  // Regression: the probe loop kept running to the full confirm window after
  // the race settled, probing a dead child every 500ms and racing a retry
  // launch's probes.
  //
  // The clock here is INJECTED rather than real: the test holds every pending
  // sleep and hands out exactly the ticks it means to, so "no further probe
  // fired" is an observed fact. Written against setTimeout it was a race between
  // a 5ms tick and a 25ms wall-clock window, which failed on a loaded runner
  // without anything being wrong with the code.
  let probes = 0
  const sleeping = []
  const sleep = () => new Promise((resolve) => { sleeping.push(resolve) })
  const nextTurn = () => new Promise((resolve) => setImmediate(resolve))
  const advance = async (rounds) => {
    for (let i = 0; i < rounds; i++) {
      const wake = sleeping.shift()
      assert.ok(wake, 'the probe loop must be waiting on its injected sleep')
      wake()
      await nextTurn()
    }
  }
  const drain = async () => {
    while (sleeping.length) await advance(1)
  }
  const child = fakeChild()
  const pending = awaitChild({
    child,
    confirmMs: 10_000,
    sleep,
    probe: async () => { probes += 1; return false }
  })
  await advance(2)
  assert.equal(probes, 2, 'the loop is still probing when the verdict lands')

  child.fire('exit', 1)
  assert.deepEqual(await pending, { died: true, code: 1 })
  await drain()
  assert.equal(probes, 2, 'no further probe may fire after the race settles')
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

test('parsePortSpec reads a list spec and falls back silently', () => {
  // The built-in default sweeps dsh's Web band plus the port the desktop host
  // takes by default, so a desktop host without this plugin is still found.
  const fallback = { min: 3080, max: 3129, extra: [19387] }
  assert.deepEqual(parsePortSpec(undefined), fallback)
  assert.deepEqual(parsePortSpec(''), fallback)
  assert.deepEqual(parsePortSpec('junk'), fallback)
  assert.deepEqual(parsePortSpec('4000-4010'), { min: 4000, max: 4010, extra: [] })
  assert.deepEqual(parsePortSpec(' 4000 - 4010 '), { min: 4000, max: 4010, extra: [] }, 'whitespace tolerated')
  assert.deepEqual(parsePortSpec('80-80'), { min: 80, max: 80, extra: [] }, 'single-port band allowed')
  // The first range is also the start range; later ranges are swept only.
  assert.deepEqual(parsePortSpec('3080-3129,19387'), fallback)
  assert.deepEqual(parsePortSpec('4000, 3080-3082'), { min: 4000, max: 4000, extra: [3080, 3081, 3082] })
  assert.deepEqual(parsePortSpec('3080-3082,3081-3083'), { min: 3080, max: 3082, extra: [3083] },
    'an overlapping range contributes only the ports outside the first')
  assert.deepEqual(parsePortSpec('3080-3129,19387-19390'),
    { min: 3080, max: 3129, extra: [19387, 19388, 19389, 19390] })
  // invalid shapes and bounds fall back, and a bare single port is now a spec
  // of its own rather than a rejected range
  assert.deepEqual(parsePortSpec('4000'), { min: 4000, max: 4000, extra: [] })
  assert.deepEqual(parsePortSpec('5000-4000'), fallback)
  assert.deepEqual(parsePortSpec('0-100'), fallback)
  assert.deepEqual(parsePortSpec('1-70000'), fallback)
  assert.deepEqual(parsePortSpec('3080-3129,'), fallback, 'a trailing comma is malformed')
  assert.deepEqual(parsePortSpec('3080-3129,19387,junk'), fallback, 'one bad part rejects the whole spec')
  // The probe fans out over every port in the spec, so the bound covers the
  // total, not each range.
  assert.deepEqual(parsePortSpec('1-65535'), fallback)
  assert.deepEqual(parsePortSpec('3080-4104'), fallback, '1025-wide band is over the bound')
  assert.deepEqual(parsePortSpec('3080-4103'), { min: 3080, max: 4103, extra: [] }, '1024-wide band is still allowed')
  assert.deepEqual(parsePortSpec('3080-3600,4000-4700'), fallback, 'the ranges add up past the bound')
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
