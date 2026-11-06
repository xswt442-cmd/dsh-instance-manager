// lib/shared.js 中宿主侧纯函数的单元测试。
// 运行在普通 node:test 上（`npm test`），不需要开发依赖。
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
  hostDshHome,
  registryDir,
  isValidRegistryEntry,
  normalizePort,
  tailFile,
  selectCrashRecords,
  selectSelfExitLines,
  selectRequestLines,
  unionPorts,
  summarizeSessions,
  orderInstances,
  awaitChild,
  awaitPortFree,
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
  const ui = buildDshLaunchArgs('/opt/dsh/lib/bin.js', 3090, { browserHandoff: true })
  const agent = buildDshLaunchArgs('/opt/dsh/lib/bin.js', 3090)
  assert.deepEqual(ui.slice(-4), ['--profile', 'web', '--port', '3090'])
  assert.equal(ui.includes('--no-open'), false, 'browser start must open the one-time token URL')
  assert.equal(agent.includes('--no-open'), true, 'agent start must remain headless')
  assert.ok(agent.indexOf('--profile') < agent.indexOf('--no-open'))
})

test('detectRuntime recognises the desktop host by its entry script', () => {
  // 桌面应用自己的宿主：同一个可执行文件，运行从 app.asar 解包的 desktop-host
  // 入口。
  assert.equal(detectRuntime([
    '/opt/dsh/DeepSeek Harness.exe',
    '--expose-internals',
    '/opt/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'
  ]), 'desktop')
  assert.equal(detectRuntime(['/opt/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js']), 'desktop')
  assert.equal(detectRuntime(['node', '/opt/dsh/lib/index.js', '--dsh-desktop-host-marker']), 'desktop', 'any argv element may carry the marker')
})

test('an Electron-launched web instance stays node, not desktop', () => {
  // 实测反例：桌面面板用应用自己的可执行文件派生普通 web 实例，它们继承了
  // ELECTRON_RUN_AS_NODE=1。该环境标记因此只上报、从不参与判定——把它当成
  // “desktop”会让普通 web 实例无法被停止。
  const argv = [
    '/opt/dsh/DeepSeek Harness.exe',
    '--trace-exit',
    '--unhandled-rejections=strict',
    '/home/x/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js'
  ]
  assert.equal(detectRuntime(argv), 'node')
  assert.equal(isElectronNode({ ELECTRON_RUN_AS_NODE: '1' }, {}), true)
  assert.equal(isElectronNode({ ELECTRON_RUN_AS_NODE: '1' }, { electron: '38.0.0' }), true)
  assert.equal(isElectronNode({}, { electron: '38.0.0' }), true)
  assert.equal(isElectronNode({}, {}), false)
  // 不带参数调用时读取的是 LIVE 环境，桌面自己的进程树里已经带有该标记——普通 node
  // 测试运行器同样如此。这正是该标记不能决定运行时的原因，因此这里只断言类型，
  // 不断言依赖主机的值。
  assert.equal(typeof isElectronNode(), 'boolean')
})

test('detectRuntime never claims desktop from a missing or non-string argv', () => {
  assert.equal(detectRuntime([]), 'node')
  assert.equal(detectRuntime(undefined), 'node')
  assert.equal(detectRuntime(['node', null, 42, { a: 1 }]), 'node')
  assert.equal(DESKTOP_HOST_RE.test('/opt/dsh/lib/bin.js'), false)
})

test('launcherOf and parentPidOf read the spawn markers and fail to null', () => {
  assert.equal(launcherOf({ [LAUNCHER_ENV]: 'desktop' }), 'desktop')
  assert.equal(launcherOf({ [LAUNCHER_ENV]: 'web' }), 'web')
  assert.equal(launcherOf({ [LAUNCHER_ENV]: 'elsewhere' }), null)
  assert.equal(launcherOf({}), null)
  assert.equal(launcherOf(undefined), null)
  assert.equal(parentPidOf({ [PARENT_PID_ENV]: '4242' }), 4242)
  // 0、负数和垃圾值都是“未知”，不是 pid。
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
  // 从桌面启动的 web 实例继承该标记，并且必须保留：同一个 Electron 可执行文件只有
  // 在该标记存在时才是 node 运行时。
  const inherited = buildSpawnEnv({ ELECTRON_RUN_AS_NODE: '1' }, { runtime: 'node', parentPid: 42 })
  assert.equal(inherited.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(inherited[LAUNCHER_ENV], 'web')
  assert.equal(inherited[PARENT_PID_ENV], '42')
  // 普通 node 宿主两个都不添加。
  const plain = buildSpawnEnv({ PATH: '/bin' }, { runtime: 'node', parentPid: null })
  assert.equal(plain.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(plain[LAUNCHER_ENV], 'web')
  assert.equal(plain[PARENT_PID_ENV], undefined)
})

test('dshBinVersion reads the package beside the launcher and degrades to null', () => {
  const bin = path.join('/home', 'x', '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  let asked = null
  const read = (f) => { asked = f; return JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.1' }) }
  assert.equal(dshBinVersion(bin, read), '0.2.0-rc.1')
  assert.equal(asked, path.join('/home', 'x', '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  // 缺少、不可读或没有版本的 package 报告“未知”而不是抛出：启动本身已经成功，
  // 仍须上报。
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
  // 允许列表只接受确切的写法——127.0.0.1 的 v4-mapped v6 形式之所以被接受，是因为
  // 它映射到允许列表中的名字，而不是因为它被列入了名单。
  assert.equal(isLoopbackName('127.0.0.2'), false)
  assert.equal(isLoopbackName('api.localhost'), false)
})

// 回环谓词来自生成的块（lib/shared.js 的 `dsh-loopback-helpers` 标记）。两种写法
// 在两条路径上都必须判为回环：WHATWG URL 解析器会把点分形式改写成十六进制，Origin
// 路径因此只会看到后者。
test('the IPv4-mapped IPv6 loopback form is loopback in both spellings', () => {
  for (const name of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:7F00:1']) {
    assert.ok(isLoopbackName(name), name)
    assert.ok(isLoopbackName(hostHostname(`[${name}]:3080`)), `bracketed: ${name}`)
  }
  // 非回环的映射地址仍不是回环。
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

// 守卫测试装置：记录拒绝内容，不接触真实响应。
const makeGuard = (currentPort = () => 3080) => {
  const rejections = []
  const respond = (res, code, obj) => { rejections.push({ code, obj }) }
  return { guard: createGuard({ currentPort, respond }), rejections }
}
// 真实 HTTP 请求总带有 socket 对端；默认设为回环（本机浏览器/界面）以走正常路径，
// 测试也可以传入伪造的非回环地址来模拟远端攻击者。
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
  // 非回环 Host 通过守卫；bearer 检查由处理器负责。
  assert.equal(fleetGuard(reqOf({ host: 'box.lan:3080' })), true)
  // 纵深防御不变：外来的跨站流量仍被拒绝。
  assert.equal(fleetGuard(reqOf({ origin: 'https://evil.example', host: 'box.lan:3080' })), false)
  assert.equal(fleetGuard(reqOf({ 'sec-fetch-site': 'cross-site', host: 'box.lan:3080' })), false)

  // 没有该开关时，行为与严格模式完全一致。
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
  // 远端攻击者伪造回环 Host 并省略 Origin/Sec-Fetch-Site——只按 Host 判断会放行并
  // 跳过 bearer。对端地址是唯一不可伪造的信号，因此守卫把它当作远端。
  assert.equal(fleetGuard(reqOf({ host: '127.0.0.1:3080' }, '203.0.113.5')), true,
    'guard defers to the handler; bearer is enforced there')
  // 严格（events）守卫没有 fleet 模式，同样的非回环对端直接被拒绝——这是纯加固，
  // 没有任何合法的本地请求会走这条路。
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
  // 守卫必须把空地址当作“未识别”而不是“非远端”：空白的 remoteAddress 不能说明
  // 任何调用方身份。`reqOf` 无法表达这种情况——它会把假值地址默认成回环——因此这些
  // 请求对象手工构造。
  const rejections = []
  const respond = (res, code, obj) => { rejections.push({ code, obj }) }
  const fleetGuard = createGuard({ currentPort: () => 3080, respond, allowRemoteHost: () => true })
  for (const blank of ['', '   ']) {
    assert.equal(fleetGuard({ headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: blank } }), false, JSON.stringify(blank))
    assert.equal(rejections.at(-1).obj.code, 'unknown_peer')
  }
  // 路由层判定必须与守卫一致：任一者把未识别的调用方当作本地，bearer 关卡就可被
  // 绕过。
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
  // WHATWG 会把 `http://127.0.0.1` 的端口归一化为 ""，若直接与 "80" 比较会误判为
  // bad_origin；默认端口必须按 scheme 补全。
  const { guard, rejections } = makeGuard(() => 80)
  assert.equal(guard(reqOf({ origin: 'http://127.0.0.1' })), true)
  assert.equal(guard(reqOf({ origin: 'http://127.0.0.1:80' })), true)
  assert.equal(guard(reqOf({ host: '127.0.0.1' })), true)
  assert.equal(rejections.length, 0)
  // 真正异源的默认端口 Origin 仍被拒绝。
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
  // 完全没有 argv1 -> 回退
  assert.equal(resolveDshBin({ argv1: '', home: '/h', exists: () => true }), expected)
  // argv1 存在但不像 bin.js -> 回退
  assert.equal(resolveDshBin({ argv1: '/somewhere/cli.mjs', home: '/h', exists: () => true }), expected)
  // argv1 名为 bin.js 但磁盘上不存在 -> 回退
  assert.equal(
    resolveDshBin({ argv1: '/gone/bin.js', home: '/h', exists: (f) => f === expected }),
    expected
  )
})

test('resolveDshBin resolves empty when neither candidate exists', () => {
  assert.equal(resolveDshBin({ argv1: '', home: '/h', exists: () => false }), '')
})

// 端口会被拼进启动器日志文件名，因此这个函数是 fleet 对端与路径穿越之间的唯一
// 屏障。
test('normalizePort accepts exactly the integers in [1, 65535]', () => {
  assert.equal(normalizePort(1), 1)
  assert.equal(normalizePort(3080), 3080)
  assert.equal(normalizePort(65535), 65535)
  assert.equal(normalizePort('3080'), 3080)
  assert.equal(normalizePort(' 3080 '), 3080)
})

test('normalizePort rejects everything that is not a bare integer in range', () => {
  // 路径穿越——这个函数存在的原因。
  for (const bad of [
    '../'.repeat(8) + 'Windows/win.ini',
    '..\\..\\..\\..\\secret',
    '../../etc/passwd'
  ]) {
    assert.equal(normalizePort(bad), null, bad)
  }
  // 非整数、越界，以及只是“看起来”像数字的强制转换。
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

// ---- fleet 列表顺序 -------------------------------------------------------

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
  // 端口更高的对端行不能跳到本机行前面：两者共用一列端口，破坏升序浏览正是当前行
  // 置顶规则要避免的。
  const rows = [
    { port: 3080, current: false },
    { port: 3090, current: false, remote: true, source: 'aaa' }
  ]
  assert.deepEqual(orderInstances(rows).map((r) => r.port), [3080, 3090])
})

test('orderInstances is stable across equals and never mutates its input', () => {
  // 两台机器可以都列出 :3080；source id 防止它们在轮询之间互换位置。
  const rows = [
    { port: 3080, current: false, remote: true, source: 'zulu' },
    { port: 3080, current: false, remote: true, source: 'alpha' }
  ]
  const original = rows.slice()
  assert.deepEqual(orderInstances(rows).map((r) => r.source), ['alpha', 'zulu'])
  assert.deepEqual(rows, original, 'input order untouched')
  assert.deepEqual(orderInstances(undefined), [])
  assert.deepEqual(orderInstances(null), [])
  // 缺少 port/current/remote 的行排序时不抛出；当前行仍然优先。
  assert.equal(orderInstances([{ current: true }, {}])[0].current, true)
})

// ---- 会话摘要 -------------------------------------------------------------

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
  // 非摘要项被跳过，绝不因此抛出。
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

// ---- 会话摘要的标题与谱系 -------------------------------------------------
//
// 标题与谱系都来自可选服务或可选的 header 字段，因此两条性质必须同时成立：有值时
// 出现在摘要里；没有值时摘要不增加任何键——后者是跨版本 fleet 的前提，旧实例的应答
// 会原样穿过本插件。

test('summarizeSessions adds the title when the host provides one', () => {
  const rows = summarizeSessions(
    [{ id: 'a', header: { createdAt: 1 } }, { id: 'b', header: { createdAt: 2 } }],
    20,
    { titleOf: (s) => (s.id === 'a' ? '修复登录' : undefined) }
  )
  assert.equal(rows[1].title, '修复登录')
  assert.equal('title' in rows[0], false, '没有合格输入的会话省略该键，而不是写 null')
})

test('summarizeSessions adds lineage from the session header', () => {
  const rows = summarizeSessions([
    {
      id: 'child',
      header: {
        createdAt: 30,
        origin: 'subagent',
        agentPreset: 'reviewer',
        parentSession: 'abcdef0123456789',
        delegationDepth: 2
      }
    },
    { id: 'top', header: { createdAt: 20, agentPreset: '', parentSession: '', delegationDepth: 0 } }
  ])
  assert.deepEqual(rows[0], {
    id: 'child', createdAt: 30, subagent: true, agentPreset: 'reviewer',
    parentSession: 'abcdef0123456789', delegationDepth: 2
  })
  assert.deepEqual(rows[1], { id: 'top', createdAt: 20 },
    '顶层会话的深度 0、空预设与空父会话都省略：深度 1 与"没有父会话"对读者是两件事')
})

// 跨版本 fleet 的前提：缺少标题服务时，摘要不得多出任何键——本插件的输出 schema 声明
// additionalProperties: false，混入编造的键会让对端整个工具结果校验失败。
test('summarizeSessions without a title service adds no optional key', () => {
  const sessions = [
    { id: 'aaa', header: { createdAt: 100, cwd: '/work/alpha', origin: 'subagent' }, seq: 7 },
    { id: 'bbb', header: { createdAt: 200 } },
    { id: 'ccc', header: { createdAt: 150, cwd: '' }, seq: 0 }
  ]
  const expected = [
    { id: 'bbb', createdAt: 200 },
    { id: 'ccc', createdAt: 150, events: 0 },
    { id: 'aaa', createdAt: 100, cwd: '/work/alpha', subagent: true, events: 7 }
  ]
  assert.equal(JSON.stringify(summarizeSessions(sessions)), JSON.stringify(expected),
    '省略 titleOf 时，摘要不含 title 键')
  // 取值函数存在但没有服务（本插件的降级路径）同样如此。
  assert.equal(JSON.stringify(summarizeSessions(sessions, 20, { titleOf: () => undefined })), JSON.stringify(expected))
  // 抛出也不能让摘要变形：服务可以在会话释放后失效。
  assert.equal(
    JSON.stringify(summarizeSessions(sessions, 20, { titleOf: () => { throw new Error('disposed') } })),
    JSON.stringify(expected)
  )
})

test('summarizeSessions ignores a non-string title from the resolver', () => {
  const rows = summarizeSessions([{ id: 'a', header: { createdAt: 1 } }], 20, {
    titleOf: () => null
  })
  assert.deepEqual(rows, [{ id: 'a', createdAt: 1 }])
})

test('awaitPortFree waits for the listener to settle and never returns a busy port', async () => {
  // 时钟由测试注入：结论必须是「端口确实空出来了」，而不是「等够了这么久」。
  let probes = 0
  const sleeping = []
  const sleep = () => new Promise((resolve) => { sleeping.push(resolve) })
  const nextTurn = () => new Promise((resolve) => setImmediate(resolve))
  const wakeOne = async () => {
    const w = sleeping.shift()
    assert.ok(w, 'the wait loop must be sleeping on its injected clock')
    w()
    await nextTurn()
  }
  let now = 0
  const clock = () => now
  // 第三次探测才空出来：模拟优雅退出刷写会话之后监听器才结算。
  const available = async (port) => {
    probes += 1
    assert.equal(port, 3080)
    return probes >= 3
  }
  const pending = awaitPortFree({ port: 3080, available, timeoutMs: 10_000, sleep, now: clock })
  assert.equal(await nextTurn(), undefined)
  await wakeOne()
  await wakeOne()
  assert.equal(await pending, true, '端口空出来就立即返回，不把窗口用尽')
  assert.equal(probes, 3)
})

test('awaitPortFree answers false when the port is never released', async () => {
  let probes = 0
  let slept = 0
  const clock = { value: 0 }
  const pending = awaitPortFree({
    port: 3080,
    available: async () => { probes += 1; return false },
    timeoutMs: 1000,
    sleep: async () => { slept += 1; clock.value += 300 },
    now: () => clock.value
  })
  assert.equal(await pending, false, '窗口用尽时必须如实报告端口仍在使用')
  assert.ok(probes >= 2 && slept >= 1, '它确实轮询过，而不是一次就放弃')
})

// ---- 诊断记录的实例归属 --------------------------------------------------
//
// 三份诊断文件由本机所有实例共用，筛选必须在共享的行里挑出属于某个实例的那些。
// 崩溃记录最容易错：异常栈跨多行，只按头筛选会让栈泄漏到别的实例名下，或者整条
// 记录被丢掉——那正是"实例为什么消失了"唯一的证据。

test('crash records keep their whole stack when filtered by pid', () => {
  const lines = [
    '[2026-01-02T03:04:05.000Z] uncaughtException pid=41 port=3080',
    'Error: boom',
    '    at tick (/tmp/a.js:1:1)',
    '[2026-01-02T03:05:05.000Z] unhandledRejection pid=42 port=3081',
    'Error: other',
    '    at tick (/tmp/b.js:2:2)',
    '    at again (/tmp/b.js:3:3)'
  ]
  assert.deepEqual(selectCrashRecords(lines, 41), lines.slice(0, 3),
    '头与栈必须一起保留，另一实例的记录不得混入')
  assert.deepEqual(selectCrashRecords(lines, 42), lines.slice(3),
    '第二个实例拿到的是自己的头加两行栈')
  assert.deepEqual(selectCrashRecords(lines, 99), [],
    '没有记录的实例返回空，而不是别人的记录')
})

test('crash and self-exit lines fall back to the whole file without a valid pid', () => {
  const crash = ['[2026-01-02T03:04:05.000Z] uncaughtException pid=41 port=3080', 'Error: boom']
  const exits = ['[2026-01-02T03:04:06.000Z] self-exit trigger=stop-self pid=41 port=3080']
  for (const pid of [null, undefined, 0, -1, 1.5, '41']) {
    assert.deepEqual(selectCrashRecords(crash, pid), crash, 'pid=' + pid)
    assert.deepEqual(selectSelfExitLines(exits, pid), exits, 'pid=' + pid)
  }
  assert.deepEqual(selectCrashRecords(undefined, 41), [])
})

test('self-exit and request lines filter by whole token, never by prefix', () => {
  const exits = [
    '[2026-01-02T03:04:06.000Z] self-exit trigger=stop-self pid=4 port=3080',
    '[2026-01-02T03:04:07.000Z] self-exit trigger=stop-self pid=41 port=3081'
  ]
  assert.deepEqual(selectSelfExitLines(exits, 4), [exits[0]], 'pid=4 不能匹配 pid=41')
  assert.deepEqual(selectSelfExitLines(exits, 41), [exits[1]])
  // 端口在写操作追踪里以 `instance=` 出现，同一个前缀问题因此同样成立。
  const reqs = [
    '[2026-01-02T03:04:08.000Z] action=stop instance=3080 target=3081 via=local-browser',
    '[2026-01-02T03:04:09.000Z] action=stop instance=3081 target=3080 via=local-browser'
  ]
  assert.deepEqual(selectRequestLines(reqs, 3080), [reqs[0]])
  assert.deepEqual(selectRequestLines(reqs, 3081), [reqs[1]])
  assert.deepEqual(selectRequestLines(reqs, null), reqs, '没有选出实例时整份文件就是全部')
  assert.deepEqual(selectRequestLines(undefined, 3080), [])
})

// ---- fleet 上线/下线差异 --------------------------------------------------

// ---- 启动器子进程：就绪 / 退出 / 派生失败 --------------------------------
// 'error' 情况最关键：无法启动的 ChildProcess 只发 'error'、不发 'exit'，而没有
// 监听器的 'error' 会让进程退出，因此 'error' 总是被消费，失败的启动只会上报。
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
  // 首次启动慢不算失败：调用方保持该子进程，而不是再派生一个。
  const child = fakeChild()
  const pending = awaitChild({ child, confirmMs: 0, sleep: noSleep, probe: async () => false })
  assert.deepEqual(await pending, {})
})

test('awaitChild stops probing once the race has a verdict', async () => {
  // 时钟是注入的而不是真实的：测试持有每一次待决 sleep，只发放它需要的 tick，
  // “没有再次探测”因此是观察到的事实。若依赖 setTimeout，就变成 5ms tick 与 25ms
  // 挂钟窗口之间的竞争，在负载高的机器上会无故失败。
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
  assert.equal(probes, 2, '结论产生时循环仍在探测')

  child.fire('exit', 1)
  assert.deepEqual(await pending, { died: true, code: 1 })
  await drain()
  assert.equal(probes, 2, '竞争结算后不得再探测')
})

test('managedLocalPorts tracks managed LOCAL rows only', () => {
  // 基线帧与差异轮询必须使用同一个过滤条件：包含远端行时，首次轮询会把每个 peer
  // 端口都读成“已移除”，为一直在线的主机弹出实例下线提示。两处共用这个辅助函数，
  // 因此不会再分歧。
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
  // 内置默认值扫描 dsh 文档约定的 Web 端口段，以及桌面宿主默认占用的端口，因此未
  // 挂载本插件的桌面宿主仍能被发现。
  const fallback = { min: 3080, max: 3129, extra: [19387] }
  assert.deepEqual(parsePortSpec(undefined), fallback)
  assert.deepEqual(parsePortSpec(''), fallback)
  assert.deepEqual(parsePortSpec('junk'), fallback)
  assert.deepEqual(parsePortSpec('4000-4010'), { min: 4000, max: 4010, extra: [] })
  assert.deepEqual(parsePortSpec(' 4000 - 4010 '), { min: 4000, max: 4010, extra: [] }, 'whitespace tolerated')
  assert.deepEqual(parsePortSpec('80-80'), { min: 80, max: 80, extra: [] }, 'single-port band allowed')
  // 第一个区间也是启动区间；后续区间只用于扫描。
  assert.deepEqual(parsePortSpec('3080-3129,19387'), fallback)
  assert.deepEqual(parsePortSpec('4000, 3080-3082'), { min: 4000, max: 4000, extra: [3080, 3081, 3082] })
  assert.deepEqual(parsePortSpec('3080-3082,3081-3083'), { min: 3080, max: 3082, extra: [3083] },
    'an overlapping range contributes only the ports outside the first')
  assert.deepEqual(parsePortSpec('3080-3129,19387-19390'),
    { min: 3080, max: 3129, extra: [19387, 19388, 19389, 19390] })
  // 形状非法的配置与越界值整体回退；单个裸端口本身就是一份合法配置，不是被拒绝的
  // 区间。
  assert.deepEqual(parsePortSpec('4000'), { min: 4000, max: 4000, extra: [] })
  assert.deepEqual(parsePortSpec('5000-4000'), fallback)
  assert.deepEqual(parsePortSpec('0-100'), fallback)
  assert.deepEqual(parsePortSpec('1-70000'), fallback)
  assert.deepEqual(parsePortSpec('3080-3129,'), fallback, 'a trailing comma is malformed')
  assert.deepEqual(parsePortSpec('3080-3129,19387,junk'), fallback, 'one bad part rejects the whole spec')
  // 探测会对配置里的每个端口并发发起，因此上限约束的是总数，不是每个区间。
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
    // 30 行编号文本 -> 在相近的默认上限下取最后 10 行
    writeFileSync(path.join(dir, 'a.log'), Array.from({ length: 30 }, (_, i) => 'line-' + (i + 1)).join('\n') + '\n')
    const t1 = tailFile(path.join(dir, 'a.log'), 65536, 10)
    assert.equal(t1.exists, true)
    assert.equal(t1.lines.length, 10)
    assert.equal(t1.lines[0], 'line-21')
    assert.equal(t1.lines[9], 'line-30')
    assert.equal(t1.truncated, true)

    // 小文件：全部容纳，不截断
    writeFileSync(path.join(dir, 'b.log'), 'hello\nworld\n')
    const t2 = tailFile(path.join(dir, 'b.log'), 65536, 200)
    assert.deepEqual(t2, { exists: true, truncated: false, lines: ['hello', 'world'] })

    // 字节上限小于文件 -> 被截断的首行片段被丢弃
    writeFileSync(path.join(dir, 'c.log'), 'START-cut-line\nwhole-one\nwhole-two\n')
    const t3 = tailFile(path.join(dir, 'c.log'), 24, 200)
    assert.equal(t3.exists, true)
    assert.deepEqual(t3.lines, ['whole-one', 'whole-two'])

    // 文件缺失 -> exists:false，而不是抛出
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
  // 已配置但尚不存在的 home 仍是该 home：harness 会按需创建，退回默认值会让登记
  // 文件分裂到另一处。
  assert.equal(resolveDshHome({ DSH_HOME: '/not/created/yet' }, home), path.resolve('/not/created/yet'))
})

test('resolveDshHome expands a tilde prefix against the OS home', () => {
  const home = '/home/tester'
  assert.equal(resolveDshHome({ DSH_HOME: '~' }, home), path.resolve(home))
  assert.equal(resolveDshHome({ DSH_HOME: '~/elsewhere' }, home), path.resolve(path.join(home, 'elsewhere')))
  assert.equal(resolveDshHome({ DSH_HOME: '~\\elsewhere' }, home), path.resolve(path.join(home, 'elsewhere')))
})

// 登记文件按一个 home 列出所有实例，因此 home 与 harness 不一致的实例会列出除自己
// 之外的所有实例。启动层自己的取值函数就是正确答案，只要它存在。
test('hostDshHome prefers the host accessor and falls back without one', () => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = '/srv/from-env'
  try {
    let calls = 0
    const accessor = () => { calls += 1; return '/srv/from-host' }
    const hosted = { get: (name) => (name === 'dshHomePath' ? accessor : undefined) }
    assert.equal(hostDshHome(hosted), '/srv/from-host')
    assert.equal(calls, 1)

    // 没有提供取值函数的上下文，或提供的东西不是函数，其值都不会被当作 home 读取。
    for (const ctx of [{}, { get: () => undefined }, { get: () => '/srv/not-a-function' }]) {
      assert.equal(hostDshHome(ctx), path.resolve('/srv/from-env'))
    }
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
