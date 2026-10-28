// dsh-instance-manager 宿主侧纯函数模块。
//
// 本文件不依赖其他包，也没有副作用，因此 node:test 测试（test/）运行的就是宿主侧
// 实际执行的代码：请求守卫、回环地址解析、dsh 启动器查找链，以及文件式实例发现的
// 登记项校验。只有宿主侧加载本模块，浏览器侧通过普通 HTTP 调用 API。
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { timingSafeEqual } from 'node:crypto'

// 必须与 package.json 的 "version" 相同：publish.yml 与兼容性静态检查都断言两者
// 相等，版本不一致时发布无法通过。
export const VERSION = '0.13.0'

// 下面三个宿主侧代码块不在本文件编写，而是从 dsh-mini-utility-dock 嵌入（见各块的
// 标记）：同一份守卫被多个插件共同使用，逐字一致才有意义。本插件只提供自己的错误
// 措辞。修改 dock 片段后运行对应的同步脚本：`loopback:sync` / `guard:sync` /
// `http:sync`。

// <dsh-loopback-helpers>
// The loopback predicates: which Host names and which peer addresses count as
// loopback, for a plugin's host half that binds an API to the loopback interface.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/loopback.js.
// A host half is plain Node ESM that its package ships standalone, so the
// fragment is embedded into `lib/shared.js` at build time by
//   npm run loopback:sync    (write it)
//   npm run loopback:check   (fail on drift)
// instead of being imported: a bare `import 'dsh-mini-utility-dock/...'` would
// put a runtime dependency on this package into the file that embeds it, and an
// embedding plugin ships standalone, with nothing else required.
//
// "Loopback" is decided in exactly one place — LOOPBACK_HOSTNAMES plus the
// IPv4-mapped IPv6 form of each entry — and both the name and the address
// predicate route through it, so the Host path and the peer path cannot
// disagree. Every spelling this file accepts is a documented one; anything
// unrecognised fails closed.
//
// Kept a separate fragment from the host guard on purpose: the predicates are
// stable facts about what an address is, while the guard is a policy about who
// may call an API. The guard block reads the names this block declares, so it
// depends on this block and never the other way round.

// Hostnames a request to a loopback-bound API may legitimately arrive with.
// Exact spellings only: `api.localhost` and `127.0.0.1.evil.example` must stay
// rejected, which is what keeps DNS rebinding out of the API surface.
export const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '::1']

// Canonicalize a Host-like value. Trims both ends and lowercases, so the
// allowlist match is case-insensitive and tolerates surrounding whitespace.
export const normalizeHostValue = (value) => String(value == null ? '' : value).trim().toLowerCase()

// Pull the hostname out of a Host header: "127.0.0.1:3080" -> "127.0.0.1",
// "[::1]:3080" -> "::1". A bracketed IPv6 literal carries its colons inside the
// brackets, so the brackets decide where the host ends, not the first colon.
export const hostHostname = (host) => {
  const value = normalizeHostValue(host)
  const bracketed = /^\[([^\]]+)\]/.exec(value)
  return bracketed ? bracketed[1] : value.split(':')[0]
}

// The IPv4 address inside an IPv4-mapped IPv6 literal, or null. Node reports a
// v4 peer on a dual-stack socket in the mapped form, so this is a routine input,
// not an exotic one. Two spellings reach us and both must work:
//
//   ::ffff:127.0.0.1   what Node puts in req.socket.remoteAddress, and what a
//                      client may legally write in a Host header
//   ::ffff:7f00:1      what the WHATWG URL parser normalises the above to, so
//                      this is the shape a browser's Origin header produces
//
// The v4 part is validated as four decimal octets, so `::ffff:1.2.3` and
// `::ffff:999.1.1.1` are not addresses and fail closed.
const mappedIpv4 = (value) => {
  if (!value.startsWith('::ffff:')) return null
  const rest = value.slice(7)
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(rest)) {
    return rest.split('.').every((octet) => Number(octet) <= 255) ? rest : null
  }
  // Hex form: ::ffff:7f00:1 -> 127.0.0.1. Exactly two groups, four hex digits
  // each, as the URL parser emits.
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest)
  if (!hex) return null
  const high = parseInt(hex[1], 16)
  const low = parseInt(hex[2], 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

/**
 * True when `name` is a loopback hostname — the Host-header side of the guard.
 * Accepts the documented spellings, the IPv4-mapped IPv6 form of 127.0.0.1, and
 * folds case. Fails closed on everything else, including a missing name.
 */
export const isLoopbackName = (name) => {
  const value = normalizeHostValue(name)
  if (!value) return false
  if (LOOPBACK_HOSTNAMES.indexOf(value) !== -1) return true
  const ipv4 = mappedIpv4(value)
  return ipv4 !== null && LOOPBACK_HOSTNAMES.indexOf(ipv4) !== -1
}

/**
 * True when `address` is a real loopback TCP peer address.
 * Headers cannot identify the network peer — a client sets `Host` freely — so
 * the socket address is the only trustworthy signal. Fail closed on anything
 * unrecognised, including a missing address.
 */
export const isLoopbackAddress = (address) => {
  const value = normalizeHostValue(address)
  if (!value) return false
  if (value === '::1') return true
  // IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is how Node reports a v4 peer on a
  // dual-stack socket; fold it back before the 127/8 test.
  const mapped = mappedIpv4(value)
  if (mapped !== null) return /^127\./.test(mapped)
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}
// </dsh-loopback-helpers>

// <dsh-host-guard>
// Host-side same-origin request guard, for a plugin's host half that binds an
// API to loopback.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/guard.js.
// A host half is plain Node ESM that its package ships standalone, so the
// fragment is embedded into `lib/shared.js` at build time by
//   npm run guard:sync    (write it)
//   npm run guard:check   (fail on drift)
// instead of being imported: a bare `import 'dsh-mini-utility-dock/...'` would
// put a runtime dependency on this package into the file that embeds it, and an
// embedding plugin ships standalone, with nothing else required.
//
// This file is the POLICY half. What counts as loopback is a separate fragment
// (`dist/loopback.js`, embedded under the `dsh-loopback-helpers` marker), and
// this module uses the predicates that block exports in the same file rather than
// restating them: `hostHostname`, `isLoopbackName` and `isLoopbackAddress` are
// module-scope names here, declared by the block above. That keeps one copy of
// them in a consumer, and makes the dependency one-way and visible — `guard:sync`
// needs `loopback:sync` to have produced a `lib/shared.js` that declares them.
//
// There is deliberately no `import` here. A consumer embeds both blocks into one
// file, so an import of another module would both break the standalone promise
// and collide with the exports the block above already declares.
//
// The enforcement order and every decision are fixed here, and the wording is
// supplied as data by the caller (`policy`): a plugin customizes the codes and
// messages its own API publishes without forking the checks. Keeping the
// vocabulary out of the decisions is what makes one copy of them enough.

// Default ports each scheme normalises away, so an Origin carrying no explicit
// port (for example `http://127.0.0.1`) compares equal to a server on 80/443.
// `new URL('http://127.0.0.1:80').port` is '', which would read as unequal to
// `80` and reject a legitimate same-origin request.
const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' }
export const portOf = (url) => url.port || DEFAULT_PORTS[url.protocol] || ''

// The reasons this guard can reject. Each is a stable, guard-owned name for one
// decision; the *reason* is fixed here, while the machine-readable `code` a
// plugin's API exposes and the human wording are policy.
//
// An unidentifiable peer and an off-loopback peer are deliberately distinct
// decisions, because they are distinct facts about the request. A caller may map
// both to the same `code`: that is a vocabulary choice about its published API,
// and nothing widens either way, because every reason rejects.
export const GUARD_REASONS = Object.freeze([
  'non_loopback_peer',
  'cross_site',
  'unknown_peer',
  'foreign_origin',
  'non_loopback_host'
])

/** Default machine-readable codes and wording, in English, per reason. */
export const DEFAULT_GUARD_POLICY = Object.freeze({
  non_loopback_peer: { code: 'non_loopback_peer', error: 'non-loopback peer rejected' },
  cross_site: { code: 'cross_site', error: 'cross-site request rejected' },
  unknown_peer: { code: 'unknown_peer', error: 'peer address is not identifiable' },
  foreign_origin: { code: 'foreign_origin', error: 'foreign origin rejected' },
  non_loopback_host: { code: 'non_loopback_host', error: 'non-loopback host rejected' }
})

/**
 * Build the same-origin request guard for a loopback-bound API route.
 *
 * Not exported under a plugin-facing name: each plugin publishes its own guard
 * bound to its own error vocabulary, so the name it exports — `createGuard` is
 * the conventional one — is the plugin's own to declare. This is the one factory
 * every plugin that embeds this block calls.
 *
 * Enforces, in order: Fetch Metadata, an unparseable Host, the TCP peer address,
 * then the Host allowlist, then the Origin. Rejects by calling
 * `respond(res, 403, { ok: false, code, error })` and returning false; returns
 * true when the request may proceed.
 *
 * @param currentPort - the port this server listens on. A function is called per
 *   request so an Origin check follows a server whose port changes; a plain
 *   value is accepted for a fixed server.
 * @param respond - rejection sink, normally the plugin's `sendJson`. Kept
 *   injectable so tests can capture the rejection code instead of standing up a
 *   real ServerResponse.
 * @param allowRemoteHost - optional predicate. When it returns true, an
 *   off-loopback peer AND an off-loopback Host are admitted, because the caller
 *   has opted into verifying its own credential per request; the guard
 *   deliberately knows nothing about tokens. The Origin check still applies, so
 *   the exemption never widens the browser-facing boundary. A plugin that omits
 *   the predicate keeps absolute peer and Host criteria.
 * @param policy - optional per-reason `{ code, error }` overrides, keyed by
 *   `GUARD_REASONS`. A partial override merges with the default, so a plugin
 *   names only the reasons whose vocabulary differs. An unknown key throws: a
 *   typo would otherwise silently leave the default in place, and the plugin
 *   would expose a code no test expects.
 */
const bindGuard = ({ currentPort, respond, allowRemoteHost, policy } = {}) => {
  const port = typeof currentPort === 'function' ? currentPort : () => currentPort
  const overrides = policy || {}
  for (const key of Object.keys(overrides)) {
    if (!GUARD_REASONS.includes(key)) {
      throw new Error(`bindGuard: unknown policy key ${JSON.stringify(key)}; expected one of ${GUARD_REASONS.join(', ')}`)
    }
  }
  const say = Object.fromEntries(GUARD_REASONS.map((reason) => [
    reason,
    { ...DEFAULT_GUARD_POLICY[reason], ...(overrides[reason] || {}) }
  ]))
  const deny = (res, reason) => {
    respond(res, 403, { ok: false, code: say[reason].code, error: say[reason].error })
    return false
  }
  const fleetAllowed = () => typeof allowRemoteHost === 'function' && allowRemoteHost()

  return function guard(req, res) {
    const headers = (req && req.headers) || {}

    const site = headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return deny(res, 'cross_site')
    }

    const host = headers.host || ''
    const parsedHost = host ? hostHostname(host) : ''
    // An empty parse is not permission. A Host header that carries no usable
    // hostname — an unbracketed IPv6 literal such as `::1:3080`, which RFC 7230
    // forbids but a client can still send — parses to '', and reading that as a
    // pass would skip the allowlist. It is a Host problem, so it is reported as
    // one. An ABSENT Host stays loopback so host-side callers keep working.
    if (host && parsedHost === '') {
      return deny(res, 'non_loopback_host')
    }
    const peerAddress = req.socket ? req.socket.remoteAddress : undefined
    if (peerAddress == null || String(peerAddress).trim() === '') {
      return deny(res, 'unknown_peer')
    }
    // `allowRemoteHost` buys exactly one thing: an off-loopback peer AND an
    // off-loopback Host stop being *rejected* by this guard — both checks below
    // are skipped — because the caller has opted into verifying its own
    // credential per request. Everything else still applies: the Origin check
    // below rejects cross-site traffic in both modes, so the exemption never
    // widens the browser-facing boundary. A plugin that does not pass the
    // predicate never enters this mode, so for it the peer and Host criteria
    // are absolute.
    const remote = fleetAllowed()
    if (!remote && !isLoopbackAddress(peerAddress)) {
      return deny(res, 'non_loopback_peer')
    }
    const hostLoopback = host ? (parsedHost !== '' && isLoopbackName(parsedHost)) : true
    if (!remote && !hostLoopback) {
      return deny(res, 'non_loopback_host')
    }

    const origin = headers.origin
    if (origin) {
      let same = false
      try {
        const parsed = new URL(origin)
        same = isLoopbackName(hostHostname(parsed.hostname)) &&
          portOf(parsed) === String(port() || '')
      } catch {
        same = false
      }
      if (!same) return deny(res, 'foreign_origin')
    }

    return true
  }
}
// </dsh-host-guard>

// JSON 应答、仅允许 POST 的检查和浏览器授权器也嵌入在这里，原因同上：这些实现必须
// 与 dock 片段逐字一致。`dsh-host-http` 不依赖它上面的两个块（既不 import，也不
// 重复声明），因此三个块可以按下面的顺序共存于一个文件。修改 dock 片段后运行
// `npm run http:sync`。

// <dsh-host-http>
// Host-side HTTP glue, for a plugin's host half that answers its own API.
//
// This fragment has ONE source of truth: dsh-mini-utility-dock/dist/host-http.js.
// A host half is plain Node ESM that its package ships standalone, so the
// fragment is embedded into `lib/shared.js` at build time by
//   npm run http:sync    (write it)
//   npm run http:check   (fail on drift)
// instead of being imported: a bare `import 'dsh-mini-utility-dock/...'` would
// put a runtime dependency on this package into the file that embeds it, and an
// embedding plugin ships standalone, with nothing else required.
//
// There is deliberately no `import` here. The block sits BELOW `dsh-host-guard`
// in the consumer's `lib/shared.js` and declares nothing the blocks above it
// already declared, so the three host-side blocks coexist in one file and a
// plugin that needs only this one can embed only this one.
//
// These lines are the response policy, so they are stated once here: every JSON
// reply carries `cache-control: no-store`, because a body naming instance ports,
// pids or session ids must never be servable from an intermediary cache — that
// header is a security posture, not cosmetics. The "browser authorization is
// unavailable" reply and the POST gate each have one definition, so a change to
// one reaches every file that embeds this block at the same time.
//
// What legitimately differs between plugins — a machine-readable `code`, the
// human wording, whether the rejected `action` is echoed — is supplied as data
// (`policy`), exactly the way `dist/guard.js` separates enforcement from
// vocabulary.

/**
 * Send a JSON reply and end the response.
 *
 * `cache-control: no-store` is part of this function rather than of each call
 * site: a route that reports live host facts (ports, pids, session data) must
 * not be servable from an intermediary cache, and a two-line helper that each
 * call site restates is where such a header goes missing.
 */
export function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(text)
}

/**
 * The one reply for "browser authorization is unavailable right now". Exported
 * as data so a call site that cannot go through `connectionUnavailable()` — a
 * test, or a route that composes its own body — still states it once.
 */
export const CONNECTION_UNAVAILABLE = Object.freeze({
  ok: false,
  code: 'connection_unavailable',
  error: 'browser authentication unavailable'
})

/**
 * Answer `res` with 503 and the shared `connection_unavailable` payload, and
 * return false so a caller can hand its own verdict back in one statement.
 * `respond` has the same injectable sink shape as the guard block's `bindGuard`
 * — `(res, status, body)` — and it defaults to this block's `sendJson`, so the
 * no-store policy is not something a call site can drop.
 */
export const connectionUnavailable = (res, respond = sendJson) => {
  respond(res, 503, { ...CONNECTION_UNAVAILABLE })
  return false
}

/**
 * The reasons the POST gate can reject. One today; the table exists so the
 * wording is overridable by key and a typo in that key is an error rather than a
 * silent no-op — the same contract the guard block's `GUARD_REASONS` offers.
 */
export const REQUIRE_POST_REASONS = Object.freeze(['method_not_allowed'])

/** Default code and wording. `{action}` in `error` is substituted per call. */
export const DEFAULT_REQUIRE_POST_POLICY = Object.freeze({
  method_not_allowed: { code: 'method', error: 'action "{action}" requires POST' }
})

/**
 * Build the POST-only gate for a mutating action.
 *
 * Behavior is fixed: the method is read case-insensitively (an absent method
 * reads as `GET`, which is not POST), POST passes, anything else is answered
 * 405 and returns false. What a plugin publishes — the `code`, the language of
 * `error`, and whether the rejected `action` is echoed in the body — is policy:
 *
 *   createRequirePost()                                          // `{ code: 'method' }`
 *   createRequirePost({ policy: { method_not_allowed: {          // an established API keeps its shape
 *     code: 'need_post', error: '{action} 需要 POST 请求', includeAction: true
 *   } } })
 *
 * @param respond - rejection sink, defaults to this block's `sendJson`, so the
 *   `no-store` header is not a thing a caller can forget to pass.
 * @param policy - optional per-reason `{ code, error, includeAction }` overrides
 *   keyed by `REQUIRE_POST_REASONS`; a partial override merges with the default,
 *   and an unknown key throws.
 */
export const createRequirePost = ({ respond = sendJson, policy } = {}) => {
  const overrides = policy || {}
  for (const key of Object.keys(overrides)) {
    if (!REQUIRE_POST_REASONS.includes(key)) {
      throw new Error(`createRequirePost: unknown policy key ${JSON.stringify(key)}; expected one of ${REQUIRE_POST_REASONS.join(', ')}`)
    }
  }
  const say = Object.fromEntries(REQUIRE_POST_REASONS.map((reason) => [
    reason,
    { ...DEFAULT_REQUIRE_POST_POLICY[reason], ...(overrides[reason] || {}) }
  ]))
  const render = (template, action) => String(template).replace(/\{action\}/g, action == null ? '' : String(action))

  return function requirePost(req, res, action) {
    if (String((req && req.method) || 'GET').toUpperCase() === 'POST') return true
    const words = say.method_not_allowed
    respond(res, 405, {
      ok: false,
      code: words.code,
      error: render(words.error, action),
      ...(words.includeAction ? { action } : {})
    })
    return false
  }
}

/**
 * Build the browser authorizer for a route that is guarded by RC1's Connection
 * when the host provides one, and by the plugin's own same-origin guard when it
 * does not.
 *
 * @param getConnection - `() => connection`, an ACCESSOR, never the value. A host
 *   half keeps its Connection in a closure variable that service unload/reload
 *   reassigns to `null` and later back to a new instance; a captured value would
 *   keep authorizing against a disposed Connection forever.
 * @param getConnectionSeen - `() => connectionSeen`, an accessor for the latch
 *   that records "this host has had an RC1 Connection at least once". Same
 *   reason, same consequence: read it per request.
 * @param guard - the plugin's bound request guard, used only on a host that has
 *   never had a Connection (older hosts, where the guard IS the boundary).
 * @param respond - rejection sink, defaults to this block's `sendJson`.
 * @returns `(req, res) => boolean`, true when the request may proceed.
 *
 * The decision order is the security property, so it is fixed here:
 *
 *   1. A Connection that throws is not a Connection that permits. The request is
 *      rejected 503 and must never fall through to the route handler.
 *   2. A rejection code from the Connection is final: the status is that code,
 *      401 reads as `unauthorized`, anything else as `forbidden`.
 *   3. No Connection but a seen one: 503, and deliberately NOT the guard. Once
 *      the host has had an RC1 Connection, an unload gap must not reopen the
 *      route through the weaker loopback fence — a local socket peer is not the
 *      same statement as an authorized browser.
 *   4. No Connection and none ever seen: this is a pre-RC1 host, and the
 *      plugin's own guard is the whole boundary, so it decides.
 *
 * These two codes and their wording state the decision itself rather than a
 * plugin's published vocabulary, so they are not policy and are not injectable;
 * only wording that legitimately differs between plugins belongs in a table.
 */
export const createBrowserAuthorizer = ({ getConnection, getConnectionSeen, guard, respond = sendJson }) => {
  if (typeof getConnection !== 'function') {
    throw new Error('createBrowserAuthorizer: getConnection must be an accessor (`() => connection`); a Connection captured here is stale the first time the service reloads')
  }
  if (typeof getConnectionSeen !== 'function') {
    throw new Error('createBrowserAuthorizer: getConnectionSeen must be an accessor (`() => connectionSeen`); the latch is set once an RC1 Connection exists and must never be read from a captured copy')
  }
  if (typeof guard !== 'function') {
    throw new Error('createBrowserAuthorizer: guard is required; a host without an RC1 Connection falls back to the plugin request guard')
  }

  return function authorizeBrowser(req, res) {
    const connection = getConnection()
    if (connection) {
      let rejection
      try {
        rejection = connection.requestRejection(req)
      } catch {
        return connectionUnavailable(res, respond)
      }
      if (rejection !== undefined) {
        respond(res, rejection, {
          ok: false,
          code: rejection === 401 ? 'unauthorized' : 'forbidden',
          error: rejection === 401 ? 'browser authentication required' : 'request rejected'
        })
        return false
      }
      return true
    }
    // Once an RC1 Connection has existed, a reload gap answers 503 — it does not
    // downgrade to the guard fence.
    if (getConnectionSeen()) return connectionUnavailable(res, respond)
    return guard(req, res)
  }
}

/**
 * Accept only a bounded, plausible session id from query or body input.
 * Returns the trimmed value or null; `null` is the caller's "missing/invalid"
 * signal, so an empty string never reaches a lookup.
 */
export function optionalSessionId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 512) return null
  return trimmed
}
// </dsh-host-http>

// RC1 用一次性 token 链接打开浏览器，再用该 token 换取签名的 Connection cookie。
// 因此从界面触发的启动必须允许子进程打开自己的 URL；agent 触发的启动保持无头。
export const buildDshLaunchArgs = (bin, port, { browserHandoff = false } = {}) => [
  '--trace-exit',
  '--unhandled-rejections=strict',
  '--report-uncaught-exception',
  bin,
  '--profile',
  'web',
  ...(browserHandoff ? [] : ['--no-open']),
  '--port',
  String(port)
]

// `dsh` CLI 的参数：`dsh web` 等价于 `dsh --profile web`，其余选项直接交给 web 应用。
// 当 profile 里没有 @deepseek-ai/dsh 的副本、argv1 也不是 bin.js 时，这是唯一还能启动
// 实例的路（本插件的启动器查找链此前只认 bin.js，因此那种机器只会得到
// no_dsh_bin）。放在会话持久化工具里执行时，实例不随面板进程退出。
export const buildDshWebArgs = (port, { browserHandoff = false } = {}) => [
  'web',
  ...(browserHandoff ? [] : ['--no-open']),
  '--port',
  String(port)
]

// ---- 会话持久化工具（tmux / screen） ---------------------------------------
//
// 面板启动的实例应当活得比面板久：面板宿主退出、终端关闭、SSH 断开都不该带走它。
// tmux 与 screen 都提供脱离终端的会话；检测到任意一个就把 `dsh web` 交给它，而不是
// 直接派生子进程。TUIOS 仍是早期项目，未纳入。

export const SESSION_TOOLS = ['tmux', 'screen']

// 在 PATH 中查找可执行文件。`exists` 供测试注入；不解析符号链接——调用方需要真实
// 路径时自行 realpath（这里只回答“命令能不能被 shell 找到”）。
export const findExecutable = (name, { env = process.env, exists = fs.existsSync } = {}) => {
  if (typeof name !== 'string' || !name) return ''
  const raw = env && (env.PATH !== undefined ? env.PATH : env.Path)
  if (typeof raw !== 'string') return ''
  for (const dir of raw.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      if (exists(candidate)) return candidate
    } catch (e) { }
  }
  return ''
}

// 按固定顺序（tmux 在前）返回本机可用的会话工具。返回全部而不是第一个：某个工具的
// 会话创建失败时，调用方还能试下一个。
export const detectSessionTools = ({ env = process.env, exists = fs.existsSync } = {}) => {
  const found = []
  for (const tool of SESSION_TOOLS) {
    const bin = findExecutable(tool, { env, exists })
    if (bin) found.push({ tool, bin })
  }
  return found
}

// 会话名只用于让操作者能在 `tmux ls` / `screen -ls` 里认出是哪个端口；时间戳后缀让
// 同一端口的旧会话（例如上一次交接失败留下的）不阻塞新会话。screen 的会话名有长度
// 上限，数字与字母足够短。
export const sessionNameFor = (port, tool, now = Date.now()) =>
  'dshim-' + String(port) + '-' + Math.floor(now).toString(36)

// POSIX shell 单引号转义：会话工具最终把命令交给 /bin/sh，参数里的空格、引号与
// `$` 都不能被再次解释。
export const shellQuote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'"

// 构造在会话里执行 argv 的命令。两个工具对“工作目录”和“命令行”的接受方式不同：
// tmux 有 -c 且把单个字符串交给 shell；screen 没有工作目录开关，必须自己 cd，并把
// /bin/sh -c 作为显式命令。日志用追加重定向，和直接派生时写入的文件一致，token
// 因此仍能从 server-<port>.out.log 读到。
export const buildSessionLaunch = ({ tool, bin, name, cwd, argv, env = {}, out, err }) => {
  if (!Array.isArray(argv) || argv.length === 0) throw new TypeError('session launch needs argv')
  if (!bin) throw new TypeError('session launch needs a binary')
  if (!name) throw new TypeError('session launch needs a session name')
  const envPrefix = Object.keys(env)
    .map((key) => shellQuote(key + '=' + env[key]))
    .join(' ')
  const redirect = ' >> ' + shellQuote(out) + ' 2>> ' + shellQuote(err)
  const command = ['exec', 'env', envPrefix, argv.map(shellQuote).join(' ')]
    .filter(Boolean).join(' ') + redirect
  if (tool === 'tmux') {
    return { tool, name, file: bin, args: ['new-session', '-d', '-s', name, '-c', cwd, command] }
  }
  if (tool === 'screen') {
    return {
      tool,
      name,
      file: bin,
      args: ['-dmS', name, '/bin/sh', '-c', 'cd ' + shellQuote(cwd) + ' && ' + command]
    }
  }
  throw new TypeError('unknown session tool: ' + tool)
}

// 会话存活探测：启动确认窗口内用它尽早发现 dsh 已经退出。超时则不清理——留下一个
// 可能只是启动慢的会话，比清掉后永远没有实例更好。
export const buildSessionProbe = ({ tool, bin, name }) => {
  if (tool === 'tmux') return { file: bin, args: ['has-session', '-t', name] }
  if (tool === 'screen') return { file: bin, args: ['-S', name, '-Q', 'select', '.'] }
  throw new TypeError('unknown session tool: ' + tool)
}

// 会话里实际运行的进程 pid（tmux 能从 pane 读出）。screen 没有等价的稳定查询，
// 返回 null；调用方只把它当诊断信息，不参与判定。
export const parseSessionPid = (tool, stdout) => {
  if (tool !== 'tmux') return null
  const first = String(stdout || '').split('\n')[0].trim()
  const pid = Number(first)
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

// 与 awaitChild 同一套判定，但没有子进程可等待：`alive` 每轮报告会话是否还在，
// `probe` 报告实例是否已经应答。先探测再判死，避免刚创建会话时的瞬时竞争。
export const awaitSession = async ({ confirmMs, probe, sleep, alive, intervalMs = 500 }) => {
  const deadline = Date.now() + confirmMs
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    if (await probe()) return { ready: true }
    if (alive && !(await alive())) return { died: true }
  }
  return {}
}

// --- 运行时身份 -------------------------------------------------------------
// 一个进程属于哪种 DSH 宿主，由它被要求运行的入口决定：桌面应用用 app.asar 里的
// desktop-host 入口启动宿主，其他方式都不这样做。环境变量不是判据——从桌面面板启动的
// web 实例会继承应用的 ELECTRON_RUN_AS_NODE=1，甚至由应用自己的可执行文件派生，因此
// 环境里的 electron 描述的是启动链，不是宿主本身。
export const DESKTOP_HOST_RE = /app\.asar|dsh-desktop-host/
export const detectRuntime = (argv = process.argv) => {
  const args = Array.isArray(argv) ? argv : []
  return args.some((a) => typeof a === 'string' && DESKTOP_HOST_RE.test(a)) ? 'desktop' : 'node'
}

// 诊断用伴随信号，只上报、从不参与判定：应用二进制自身以及继承了
// ELECTRON_RUN_AS_NODE 的进程都为 true，包括桌面面板派生的普通 web 实例。
export const isElectronNode = (env = process.env, versions = process.versions) =>
  !!((versions && versions.electron !== undefined) ||
    (env && env.ELECTRON_RUN_AS_NODE === '1'))

// 派生的宿主写进心跳的启动者身份：由哪种宿主启动，以及该宿主的 pid。两者都通过
// 子进程环境传递，手工启动的宿主因此报告 null，而不是猜测一个值。
export const LAUNCHER_ENV = 'DSHIM_LAUNCHER'
export const PARENT_PID_ENV = 'DSHIM_PARENT_PID'

export const launcherOf = (env = process.env) => {
  const value = env ? env[LAUNCHER_ENV] : undefined
  return value === 'desktop' || value === 'web' ? value : null
}

export const parentPidOf = (env = process.env) => {
  // 本插件写入的是十进制 pid，其余形式（空、带符号、指数、浮点）都表示未知，
  // 而不是一个会被读成进程标识的数字。
  const raw = env ? env[PARENT_PID_ENV] : undefined
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return value > 0 ? value : null
}

// 派生实例使用的环境变量。桌面宿主用自己的可执行文件启动子进程，所以显式设置
// ELECTRON_RUN_AS_NODE；启动者身份让子进程的心跳能说明是谁启动了自己。
export const buildSpawnEnv = (base = {}, { runtime = 'node', parentPid = null } = {}) => {
  const env = Object.assign({}, base)
  if (runtime === 'desktop') env.ELECTRON_RUN_AS_NODE = '1'
  env[LAUNCHER_ENV] = runtime === 'desktop' ? 'desktop' : 'web'
  if (Number.isInteger(parentPid) && parentPid > 0) env[PARENT_PID_ENV] = String(parentPid)
  return env
}

// 已解析的启动器所属检出（`<pkg>/lib/bin.js`）的版本。每次启动都上报它：桌面宿主
// 解析到的检出可能与应用自带的检出不同，否则无法看出实际运行的是哪一个。
export const dshBinVersion = (bin, readFile) => {
  if (!bin || typeof readFile !== 'function') return null
  try {
    const pkg = JSON.parse(readFile(path.join(path.dirname(bin), '..', 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : null
  } catch (e) {
    return null
  }
}

/**
 * 请求是否必须通过 fleet bearer。实际 TCP 对端不在回环地址，或 Host 头不在
 * 回环地址，任一成立就视为不可信，处理器（负责校验 token）必须要求该请求出示凭证。
 *
 * 缺失 Host 按回环处理，裸的本地请求不会因 Host 被拒；真正决定信任的是对端地址。
 * Host 存在却解析不出主机名（例如 RFC 7230 禁止、客户端仍可能发出的无括号 IPv6
 * 字面量 `::1:3080`）属于非回环——空解析绝不能当作通过。
 *
 * 与嵌入守卫的分工：
 *
 *   * 守卫（上方的 `dsh-host-guard`）回答请求能否继续执行，拒绝时自己写完响应并
 *     返回 false；
 *   * 本函数回答路由在守卫运行前必须要求哪种凭证——fleet 对端带 bearer，浏览器
 *     走 `authorizeBrowser`。`lib/index.js` 先调用它再分支，所以它绝不能写响应。
 *
 * 这个判断不能从守卫推导：守卫在第一个失败的检查处停止，对一个同时携带跨站
 * `sec-fetch-site` 或异源 Origin 的远程对端，它报告的是更早的原因而不是对端地址；
 * 本插件还把 `non_loopback_peer` 与 `non_loopback_host` 映射为已发布的
 * `bad_host`，这是本仓库的措辞策略；守卫也无法把“没有对端地址”当作凭证问题回答，
 * 因为它在到达对端判断前就以 `unknown_peer` 拒绝，而路由必须先决定要求 bearer 还是
 * 浏览器认证。两者对“未识别的调用方不算本地”的判断一致，`test/host.test.js`
 * 在双方都断言了空对端地址的情形。
 *
 * 判据因此留在这里，但使用守卫块提供的同一组谓词（`isLoopbackAddress` /
 * `hostHostname` / `isLoopbackName`），两者对“什么是回环”不会产生分歧。
 */
export const requestNeedsBearer = (req) => {
  const peerLoopback = isLoopbackAddress(req.socket && req.socket.remoteAddress)
  const host = req.headers.host || ''
  const parsedHost = host ? hostHostname(host) : ''
  // `parsedHost !== ''` 很重要：空解析属于非回环，不能当成通过。
  const hostLoopback = host ? (parsedHost !== '' && isLoopbackName(parsedHost)) : true
  return !peerLoopback || !hostLoopback
}

// 本插件已发布的拒绝措辞：共享守卫负责执行检查，这些字符串与 code 对外可见，
// 因此保持原样。
const DIM_POLICY = {
  cross_site: { code: 'cross_site', error: '已拒绝跨站请求' },
  unknown_peer: { code: 'unknown_peer', error: '无法确定对端地址' },
  non_loopback_peer: { code: 'bad_host', error: '远程请求需要 fleet 模式' },
  foreign_origin: { code: 'bad_origin', error: 'Origin 不同源' },
  non_loopback_host: { code: 'bad_host', error: '远程请求需要 fleet 模式' }
}

/**
 * 本插件的请求守卫，绑定到共享的执行逻辑。
 *
 * `respond` 可注入，测试因此不必构造真实的 ServerResponse 就能取得拒绝内容；
 * 宿主侧传入 `sendJson`。调用方可以通过 `policy` 扩展措辞；本插件已发布的 code
 * 由这里的条目决定，未知键仍会交给共享工厂校验，不会在本层被丢弃。
 */
export const createGuard = ({ currentPort, respond, allowRemoteHost, policy }) => bindGuard({
  currentPort,
  respond,
  allowRemoteHost,
  policy: { ...(policy || {}), ...DIM_POLICY }
})

// fleet 信任边界上的常量时间 bearer 比较。长度不同时也执行一次比较，避免响应
// 时间泄漏 token 长度；空输入永不匹配（未配置 token 时失败关闭）。
export const safeTokenEqual = (received, expectedBearer) => {
  const a = Buffer.from(String(received || ''), 'utf8')
  const b = Buffer.from(String(expectedBearer || ''), 'utf8')
  if (a.length === 0 || b.length === 0) return false
  if (a.length !== b.length) {
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

// 优先使用本实例启动时的入口脚本，取不到时退回规范的 profile 位置（干净的类 CI
// 环境没有 @deepseek-ai/dsh 的 profile 副本）。`exists` 供测试注入；各段都用
// path.join 拼接，回退路径在 Windows 之外也能解析。
export const resolveDshBin = ({ argv1 = '', home, exists }) => {
  if (argv1 && /bin\.js$/.test(argv1) && exists(argv1)) return argv1
  const profileBin = path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  return exists(profileBin) ? profileBin : ''
}

// 按 @deepseek-ai/dsh-home-paths 的同一优先级解析 harness 主目录：非空的
// $DSH_HOME，否则 ~/.dsh。
//
// 宿主没有提供自己的取值函数时使用本函数；插件代码调用 hostDshHome()，让 DSH 宿主
// 按 harness 自己的规则回答。
//
// 目录是否存在刻意不作为判据：harness 接受尚不存在的 home 并按需创建；若要求目录
// 存在，首次使用全新的 $DSH_HOME 时会退回 ~/.dsh，把本插件的登记文件与启动器日志
// 挪到正在管理的实例之外。空白覆盖值视为未设置，DSH_HOME=" " 不会把 home 折叠成
// 当前目录。
export const resolveDshHome = (env = process.env, homeDir = os.homedir()) => {
  const raw = env.DSH_HOME
  const selected = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
  const value = selected === null ? path.join(homeDir, '.dsh') : selected
  // 最后调用 resolve()，与 dshHomePath 一致：无论值来自环境变量、系统 home 还是
  // 波浪号前缀，结果在各平台上都是绝对路径。
  if (value === '~') return path.resolve(homeDir)
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.resolve(path.join(homeDir, value.slice(2)))
  return path.resolve(value)
}

// 解析本插件所挂载宿主的 harness 主目录，优先采用宿主自己的答案。启动层在插件树
// 挂载前提供 `dshHomePath`，这套规则只属于 harness：按本文件推导出的略有差异的
// home 写登记文件，列出的会是除宿主之外的所有实例。该取值函数是普通函数而不是
// 服务，生成的 Cordis 目录也不包含它，因此用 `ctx.get` 读取，缺失属于正常情况：
// 没有启动层的裸 Cordis 嵌入方挂载本插件时退回 resolveDshHome()。每次调用都重新
// 读取，调用之间切换的 home 能被观察到，而不是在挂载时冻结。
export const hostDshHome = (ctx) => {
  // 真实的 Cordis 上下文一定带 `get`；路由测试用手工构造的上下文调用 apply()，
  // 这个探测不值得新增一项挂载要求。
  const provided = typeof ctx.get === 'function' ? ctx.get('dshHomePath') : null
  return typeof provided === 'function' ? provided() : resolveDshHome(process.env)
}

// ---- 文件式实例登记（发现用的心跳） -----------------------------------------
//
// 每个已挂载实例向 <home>/run/instances/<port>.json 写心跳，fleet 无需扫描全部
// 50 个端口就能列出实例。读取方只在登记项结构完整且新鲜时信任它；被强杀的进程最多
// 留下 REGISTRY_FRESH_MS 时长的幽灵记录，正常退出则通过插件 disposer 删除文件。

export const REGISTRY_FRESH_MS = 30000

export const registryDir = (home) => path.join(home, 'run', 'instances')

export const isValidRegistryEntry = (e, now = Date.now(), freshMs = REGISTRY_FRESH_MS) => {
  if (!e || typeof e !== 'object') return false
  if (typeof e.pid !== 'number' || typeof e.port !== 'number') return false
  if (!(e.port >= 1 && e.port <= 65535)) return false
  if (typeof e.startedAt !== 'number' || typeof e.ts !== 'number') return false
  const age = now - e.ts
  return age >= 0 && age <= freshMs
}

// 把调用方提供的端口（查询串、agent 工具参数，或经由 fleet 链路到达的值）转成
// [1, 65535] 内的整数，否则返回 null。
//
// 这是把不可信输入变成端口的唯一入口：该值会拼进启动器日志文件名
// （`server-<port>.<stream>.log`），任何不是整数的残留（例如 "../../.."）都会成为
// 路径穿越。只接受整数与带空白填充的十进制数字串，不接受 `1e3`、`0x10`、`+80` 或
// `80.5`。
export const normalizePort = (raw) => {
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null
  return n
}

// 读取文本文件末尾 maxBytes 字节，最多保留 maxLines 个完整行。文件不存在时返回
// exists:false 而不是抛出；从文件中间开始时丢弃被截断的首行片段，因此返回的始终是
// 完整行。读取有上限，巨大的启动器日志也不会造成负担。
export const tailFile = (file, maxBytes = 65536, maxLines = 200) => {
  let fd
  try {
    const size = fs.statSync(file).size
    const start = size > maxBytes ? size - maxBytes : 0
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    let text = buf.toString('utf8')
    if (start > 0) {
      const nl = text.indexOf('\n')
      if (nl < 0) return { exists: true, truncated: true, lines: [] }
      text = text.slice(nl + 1)
    }
    const lines = text.split(/\r?\n/)
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    return {
      exists: true,
      truncated: start > 0 || lines.length > maxLines,
      lines: lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines
    }
  } catch (e) {
    if (e && e.code === 'ENOENT') return { exists: false, truncated: false, lines: [] }
    throw e
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch (e) { } }
  }
}

// ---- 诊断记录：崩溃黑匣子 / 自退出 ---------------------------------------
//
// 三个诊断文件由本机所有实例共用，用户要回答的却是"这一行为什么消失了"。因此每条
// 记录都要能按 pid 归属筛出来，筛选放在读取之后、渲染之前。

// 崩溃黑匣子的一行记录头。记录正文（异常栈）跨多行，因此按 pid 筛选必须保留整条
// 记录：栈的行属于它上面那个头，丢掉头就等于丢掉这次崩溃。
const CRASH_RECORD_HEAD = /^\[([^\]]+)\] (\S+) pid=(\d+) port=(\S+)\s*$/

/**
 * 崩溃黑匣子按 pid 筛选，每个匹配记录的头与其正文行都保留。
 *
 * `pid` 不是有效 pid 时不筛选：这样的调用方还没有选出实例，返回整份共享文件正是
 * 它能拿到的全部。
 * @param lines 共享崩溃日志的有界尾部，最旧在前。
 * @param pid 目标实例的 pid，或 null 表示不过滤。
 * @returns 属于该 pid 的行；头行重新保留，因此渲染仍能看出是哪个实例。
 */
export const selectCrashRecords = (lines, pid) => {
  const all = Array.isArray(lines) ? lines : []
  if (!Number.isSafeInteger(pid) || pid < 1) return all.slice()
  const wanted = String(pid)
  const kept = []
  let owned = false
  for (const line of all) {
    const head = CRASH_RECORD_HEAD.exec(String(line))
    if (head) owned = head[3] === wanted
    if (owned) kept.push(line)
  }
  return kept
}

/**
 * 自退出记录按 pid 筛选。每条退出只占一行，因此按行筛选即可。
 * @param lines 共享自退出日志的有界尾部，最旧在前。
 * @param pid 目标实例的 pid，或 null 表示不过滤。
 * @returns 属于该 pid 的行。
 */
export const selectSelfExitLines = (lines, pid) => selectByToken(lines, 'pid=' + pid, pid)

/**
 * 写操作追踪按实例端口筛选。每条被接受的写操作只占一行，行首记录被写入行的实例端口。
 *
 * 该文件含有对端地址与浏览器 User-Agent，因此它只出现在回环诊断面上，面板必须
 * 明示它记录了什么。
 * @param lines 共享写操作日志的有界尾部，最旧在前。
 * @param port 目标实例的端口，或 null 表示不过滤。
 * @returns 属于该实例的行。
 */
export const selectRequestLines = (lines, port) => selectByToken(lines, 'instance=' + port, port)

// 单行记录按 `字段=值` token 筛选。比较的是 token 而不是子串：`pid=12` 不能匹配
// `pid=123`；值不是有效端口/pid 时不过滤，与上面两个筛选器一致。
const selectByToken = (lines, token, value) => {
  const all = Array.isArray(lines) ? lines : []
  if (!Number.isSafeInteger(value) || value < 1) return all.slice()
  return all.filter((line) => {
    const at = String(line).indexOf(token)
    return at !== -1 && !/\d/.test(String(line).charAt(at + token.length))
  })
}

// 诊断面展示的三份共享文件，以及各自在本面板里的用途说明。崩溃与自退出按 pid
// 归属，写操作追踪按实例端口归属。
export const DIAGNOSTIC_KINDS = Object.freeze([
  { key: 'crash', file: 'dshim-crash.log', pidScoped: true },
  { key: 'selfexit', file: 'dshim-selfexit.log', pidScoped: true },
  { key: 'requests', file: 'dshim-requests.log', pidScoped: false }
])

// 每次 fleet 列表的展示顺序：正在服务调用方的实例排在最前，其余按端口升序。
//
// `current` 是面板标记为“当前会话”的行——用户打开它、读它的日志、停止它，而列表
// 每几秒轮询一次，因此它必须排第一，否则最重要的行需要逐行查找。
//
// 其余顺序由端口决定，source id 只用于同一端口上的并列：两台机器都列出 :3080 时，
// 轮询之间保持固定顺序，不会互换位置。source 不能优先于端口——远端行与本机行共用
// 一列端口，把远端 :3090 排到本机 :3080 之前会破坏面板依赖的升序浏览。
export const orderInstances = (items) => {
  const rank = (it) => (it && it.current ? 0 : 1)
  return (Array.isArray(items) ? items.slice() : []).sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    const byPort = ((a && a.port) || 0) - ((b && b.port) || 0)
    if (byPort !== 0) return byPort
    return String((a && a.source) || '').localeCompare(String((b && b.source) || ''))
  })
}

// 合并扫描区间与心跳已知端口，去重后升序。登记项按 1-65535 校验，正是为了让手工
// 在固定扫描区间之外启动的实例也能通过自己的心跳进入 fleet 列表。
export const unionPorts = (min, max, extra = []) => {
  const seen = new Set()
  const out = []
  const push = (p) => { if (!seen.has(p)) { seen.add(p); out.push(p) } }
  for (let p = min; p <= max; p++) push(p)
  for (const p of extra) {
    if (Number.isInteger(p) && p >= 1 && p <= 65535) push(p)
  }
  return out.sort((a, b) => a - b)
}

// 活跃 Session 对象的纯标量投影。DSH 的 session/store 对象是内部实时数据，绝不整体
// 序列化，因此只取展示字段（id、createdAt、cwd、子代理来源、事件数），按时间倒序
// 并限制条数。
//
// `titleOf` 是可选的标题取值函数，由宿主侧提供（`ctx.sessionTitle` 是可选服务，
// 摘要因此不能假设它存在）。省略时行为与它不存在时完全一致：不写 title 键，而不是
// 写入 null——输出 schema 声明了 `additionalProperties: false`，而会话摘要要经过 fleet
// 链路与 agent 工具，缺失与 null 在那里不是同一件事。
export const summarizeSessions = (list, cap = 20, { titleOf } = {}) => {
  const rows = []
  for (const s of Array.isArray(list) ? list : []) {
    try {
      const id = String(s.id || '')
      const h = s.header
      if (!id || !h || typeof h.createdAt !== 'number') continue
      const row = { id, createdAt: h.createdAt }
      // 标题单独降级：取值函数属于可选服务，会在会话释放后失效。丢掉标题仍留下一行
      // 可读的会话，丢掉整行才是把一个字段的失败升级成整份摘要的失败。
      if (typeof titleOf === 'function') {
        let title
        try { title = titleOf(s) } catch (e) { title = undefined }
        if (typeof title === 'string' && title !== '') row.title = title
      }
      if (typeof h.cwd === 'string' && h.cwd) row.cwd = h.cwd
      if (h.origin === 'subagent') row.subagent = true
      // 谱系：预设决定该会话的工具与提示，父会话与委派深度说明它从哪里来。三者都来自
      // SessionHeader，因此按缺失省略。
      if (typeof h.agentPreset === 'string' && h.agentPreset) row.agentPreset = h.agentPreset
      if (typeof h.parentSession === 'string' && h.parentSession) row.parentSession = h.parentSession
      // 顶层会话的深度是 0 或缺失，只在真正被委派过时才带上——深度 1 与"没有父会话"
      // 对读者是两件事。
      if (Number.isInteger(h.delegationDepth) && h.delegationDepth > 0) row.delegationDepth = h.delegationDepth
      if (typeof s.seq === 'number') row.events = s.seq
      rows.push(row)
    } catch (e) { /* 单条坏数据不应让整份摘要失败 */ }
  }
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows.length > cap ? rows.slice(0, cap) : rows
}

// 等待刚派生的启动器子进程：`probe()` 应答后返回 {ready:true}；子进程退出则返回
// {died:true, code}；确认窗口结束时仍无应答返回 {}（启动较慢，绝不是再派生一个的
// 理由）。
//
// 子进程的 'error' 事件总要被消费。启动失败（ENOENT、EACCES、EMFILE）的子进程只发
// 'error'、不发 'exit'，而没有监听器的 'error' 事件会让进程退出：在那种环境下点一次
// “启动新实例”就能让整个实例挂掉。这里把它当作一次失败的启动上报，调用方可以再试
// 一次。
export const awaitChild = ({ child, confirmMs, probe, sleep }) => {
  const spawnFailed = new Promise((resolve) => child.once('error', (e) =>
    resolve({ died: true, code: 'spawn:' + ((e && e.code) || 'error') })))
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve({ died: true, code })))
  // 结论一旦产生，探测循环必须停止：否则已死的子进程仍会每 500ms 被探测，直到整个
  // 确认窗口结束，重试启动还会与这个僵尸循环的探测互相干扰。
  let settled = false
  const readyOrSlow = (async () => {
    const deadline = Date.now() + confirmMs
    while (Date.now() < deadline) {
      await sleep(500)
      if (settled) return {}
      if (await probe()) return { ready: true }
    }
    return {}
  })()
  return Promise.race([spawnFailed, exited, readyOrSlow]).finally(() => { settled = true })
}

// SSE 上线/下线推送跟踪的端口集合：本机的托管行。远端行携带其他机器的端口号，
// 与本机共享数字空间但不共享生命周期，因此它们的抖动不在本机弹出上线/下线提示。
//
// 刻意共用：新订阅者的基线帧与差异轮询必须逐端口一致。基线若使用更宽的过滤条件
// （包含远端行），第一次轮询会把每个 peer 端口都读成“已移除”，为一直在线的主机弹出
// 全 fleet 的实例下线提示。
export const managedLocalPorts = (items) =>
  (Array.isArray(items) ? items : []).filter((i) => i.managed && !i.remote).map((i) => i.port)

// SSE 上线/下线推送的 fleet 成员差异：两次轮询之间出现与消失的托管端口。
export const diffManagedPorts = (prev, next) => {
  const added = []
  const removed = []
  for (const p of next) if (!prev.has(p)) added.push(p)
  for (const p of prev) if (!next.has(p)) removed.push(p)
  return { added, removed }
}

/**
 * 原地重启的第二步：等待目标端口真正空出来。
 *
 * 转发 stop 得到的是"目标收到了请求"，不是"目标已经不在监听"：优雅退出经
 * `appExit` 释放插件树，进程离开前还要刷写会话，监听器因此在这之后才结算。
 * 立刻在同一个端口派生子进程，绑定就会输给仍在结算的旧监听器。
 *
 * 只有绑定探测算数：连接探测回答的是"现在有东西占用"，失败的监听器可能尚未结算，
 * 扫描会短暂地把一个正在关闭的端口报告为空闲。
 *
 * 窗口用尽返回 false，调用方必须如实报告端口窗口期已经结束——绝不能改用其他端口
 * 悄悄启动：用户要的就是原端口重启。
 * @param options.port 目标端口。
 * @param options.available 绑定探测，答 true 表示端口空出来了。
 * @param options.timeoutMs 窗口上限。
 * @param options.sleep 等待一拍的函数。
 * @param options.now 读时钟的函数，与 `sleep` 一起注入以便测试驱动窗口。
 * @returns 端口在窗口内空出时 true，用尽时 false。
 */
export const awaitPortFree = async ({ port, available, timeoutMs, sleep, now = Date.now }) => {
  const deadline = now() + timeoutMs
  // 先探一次：目标可能已经退出，窗口不该白白花掉。
  if (await available(port)) return true
  while (now() < deadline) {
    await sleep(300)
    if (await available(port)) return true
  }
  return false
}

// 自动启动可用的端口：`range` 内第一个通过 `available(port)` 检查且不等于
// `exclude` 的端口。
//
// `exclude` 用于避开一个真实的循环：第一次尝试在端口 P 上死掉，扫描又把 P 报告为
// 空闲（失败子进程的绑定尚未结算），重试仍落在 P 上并同样死掉。重试只在调用方才
// 观察过失败的地方之外才有意义，因此排除项放在选取器里，而不是重试的记账逻辑里。
export const pickStartPort = async ({ range, exclude, available }) => {
  for (let p = range.min; p <= range.max; p++) {
    if (p === exclude) continue
    if (await available(p)) return p
  }
  return 0
}

// START 最多派生几次，以及第二次尝试可以去哪里。
//
// 重试只针对一种失败：子进程在确认窗口内退出，通常原因是自动选取的端口在扫描与
// 绑定之间被抢占。重试不适用于：
//
//   - 调用方指定了端口——那会启动在调用方没要求的位置；
//   - 启动只是慢：`start_unconfirmed` 表示子进程仍存活且可能应答，再派生一个会留下
//     两个实例；
//   - 重新选择第一次失败的端口：那会让一次失败变成同一端口上的循环，每个子进程都在
//     确认窗口内以 EADDRINUSE 退出。
//
// 放在宿主侧之外，这三个性质无需派生真实子进程即可测试：`launch(options)` 是单次
// 启动。
export const retryableStart = (options, result) => {
  const autoPort = !options || options.port === undefined
  return autoPort && !!result && result.ok === false && result.code === 'start_failed'
}

export const startOnceOrRetry = async (launch, options) => {
  const first = await launch(options)
  if (!retryableStart(options, first)) return first
  const second = await launch({ ...(options || {}), excludePort: first.port })
  if (second.ok) return second
  return {
    ok: false,
    code: second.code,
    port: second.port !== undefined ? second.port : null,
    pid: second.pid,
    error: first.error + '；自动换口重试仍失败：' + (second.error || second.code || '未知原因')
  }
}

// ---- 用户设置命名空间 ------------------------------------------------------
//
// 偏好存储由 harness 负责：`ctx.settings.register(ns, schema, { base })` 依次解析
// schema 默认值、注册方的 composition `base`、用户保存的分节；浏览器侧通过
// `ctx.settingsScope.bind()` 或 `configForms.get()` 读取同一命名空间，持久化、修订
// 围栏、脱敏与 schema 驱动的表单都由 harness 提供。
//
// `applies` 是命名空间级而不是字段级，`restart` 命名空间的所有者不监听取值变化。
// 可热更新的字段（轮询间隔、peer 列表、fleet token）放在 LIVE 命名空间；启动期常量
// （端口范围）放在 STARTUP 命名空间。
//
// STARTUP 命名空间名使用纯连字符后缀：设置服务按 /^[a-z][a-z0-9-]*$/ 校验命名空间，
// 带点的 `dsh-instance-manager.startup` 会在 register() 抛出 TypeError。
//
// peer 与 token 字段保持环境变量的字符串格式（"id@origin,..." 与原始 token）：
// parsePeers 负责校验、去重与数量上限，扁平字符串也避免为表单引入嵌套 schema。
//
// 以下任何一项都不是面板工作的前提：每个取值函数都降级到常量，`register()` 本身
// 也被包裹，损坏的存储分节不会阻止插件挂载。
export const SETTINGS_NAMESPACE = 'dsh-instance-manager'
export const SETTINGS_NAMESPACE_STARTUP = 'dsh-instance-manager-startup'
export const REFRESH_INTERVAL_FIELD = 'refreshIntervalMs'
export const FLEET_TOKEN_FIELD = 'fleetToken'
export const PEERS_FIELD = 'peers'
export const PORT_RANGE_FIELD = 'portRange'

// 逗号分隔的区间与单端口。每个区间都进入扫描，第一个区间同时也是新实例可以启动的
// 范围。
const PORT_SPEC_RE = /^\d{1,5}(\s*-\s*\d{1,5})?(\s*,\s*\d{1,5}(\s*-\s*\d{1,5})?)*$/

// 扫描覆盖 dsh 文档约定的 Web 端口段，以及桌面宿主默认占用的端口。未挂载本插件的
// 桌面宿主不写心跳，只能靠扫描进入列表，其行也没有 runtime：只有运行本插件的宿主才
// 会上报。START 只从第一个区间取端口，因此桌面端口不会被交给子进程。
export const DEFAULT_PORT_SPEC = '3080-3129,19387'
export const DEFAULT_REFRESH_INTERVAL_MS = 4000
export const REFRESH_INTERVAL_MIN_MS = 1000
export const REFRESH_INTERVAL_MAX_MS = 60000
// 环境变量覆盖作为 composition `base` 层：设置过它们的运维方式继续有效。`base` 在
// 注册时冻结，对进程环境来说正合适。
export const ENV_REFRESH_INTERVAL_MS = 'DSHIM_REFRESH_INTERVAL_MS'
export const ENV_FLEET_TOKEN = 'DSHIM_FLEET_TOKEN'
export const ENV_FLEET_TOKEN_REF = 'DSHIM_FLEET_TOKEN_REF'
export const ENV_PORT_RANGE = 'DSHIM_PORT_RANGE'
export const ENV_PEERS = 'DSHIM_PEERS'

const coerceIntervalMs = (raw) => {
  const n = typeof raw === 'number'
    ? raw
    : (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN)
  if (!Number.isFinite(n)) return null
  return Math.min(REFRESH_INTERVAL_MAX_MS, Math.max(REFRESH_INTERVAL_MIN_MS, Math.round(n)))
}

/** 把一个存储值、合成值或环境变量值收敛为毫秒级的轮询间隔。 */
export const normalizeRefreshIntervalMs = (raw, fallback = DEFAULT_REFRESH_INTERVAL_MS) => {
  const value = coerceIntervalMs(raw)
  return value === null ? fallback : value
}

/** 已注册命名空间的 schema。`z` 是 @deepseek-ai/schemastery。 */
export const buildLiveSchema = (z) => z.object({
  [REFRESH_INTERVAL_FIELD]: z.number().step(1).min(REFRESH_INTERVAL_MIN_MS)
    .max(REFRESH_INTERVAL_MAX_MS).default(DEFAULT_REFRESH_INTERVAL_MS),
  // 在所有界面中只写不读：describe({redactSecrets:true}) 会从 value/base/user 中
  // 移除它并只列出 {path, set}，因此 API 响应与日志都不会带上 token。
  [FLEET_TOKEN_FIELD]: z.string().role('secret'),
  // 与 DSHIM_PEERS 相同的字符串格式；校验由 parsePeers 负责。
  [PEERS_FIELD]: z.string().default('')
})

const nonEmptyString = (raw) =>
  typeof raw === 'string' && raw.length > 0 ? raw : undefined

// 环境变量覆盖成为 composition `base`，用户编辑落在它之上并优先。只携带格式正确的
// 值：`base` 在 schema 运行前合并，垃圾值会让整个分节校验失败，连带注册一起失败。
export const buildLiveBase = (env = process.env) => {
  const base = {}
  const interval = env ? coerceIntervalMs(env[ENV_REFRESH_INTERVAL_MS]) : null
  if (interval !== null) base[REFRESH_INTERVAL_FIELD] = interval
  const token = env ? nonEmptyString(env[ENV_FLEET_TOKEN]) : undefined
  if (token !== undefined) base[FLEET_TOKEN_FIELD] = token
  const peers = env ? nonEmptyString(env[ENV_PEERS]) : undefined
  if (peers !== undefined && peers.trim().length > 0) base[PEERS_FIELD] = peers
  return base
}

/** 解析一个 live 分节（`value` 缺失时退回环境变量与默认值）。 */
export const resolveLiveSection = (value, env = process.env) => {
  const stored = value && typeof value === 'object' ? value : {}
  const base = buildLiveBase(env)
  const fallbackPeers = env && typeof env[ENV_PEERS] === 'string' ? env[ENV_PEERS] : ''
  return {
    [REFRESH_INTERVAL_FIELD]: normalizeRefreshIntervalMs(
      stored[REFRESH_INTERVAL_FIELD] === undefined ? base[REFRESH_INTERVAL_FIELD] : stored[REFRESH_INTERVAL_FIELD]),
    // token 只以 schema 声明的 secret 字段传递。解析后的分节已经包含
    // schema/base/user 三层，因此这里的字符串（包括 ''——用户显式清除）就是最终
    // 结论；undefined 只出现在降级或没有分节的路径，此时回退到原始环境变量。
    [FLEET_TOKEN_FIELD]: typeof stored[FLEET_TOKEN_FIELD] === 'string'
      ? (stored[FLEET_TOKEN_FIELD].length > 0 ? stored[FLEET_TOKEN_FIELD] : undefined)
      : nonEmptyString(base[FLEET_TOKEN_FIELD]) ?? nonEmptyString(env && env[ENV_FLEET_TOKEN]),
    [PEERS_FIELD]: typeof stored[PEERS_FIELD] === 'string'
      ? stored[PEERS_FIELD]
      : nonEmptyString(base[PEERS_FIELD]) ?? fallbackPeers
  }
}

/**
 * 在已注入的设置上下文上注册 LIVE 命名空间。
 *
 * `register()` 是这里唯一可能抛出的调用：存储分节在注册时校验，此时还没有可回退的
 * 上一次有效值，因此已不符合 schema 的分节会让注册本身失败。损坏的设置文档必须
 * 降级到内存默认值并给出警告，绝不能阻止面板挂载。
 * @param options - 注入的 `ctx`（带 `settings`）、schemastery 的 `z`、进程环境，以及
 *   可选的警告输出函数。
 * @returns `{ registered, degraded, scope?, get() }`；`get()` 总能给出可用的分节。
 */
export const registerLiveSettings = ({ ctx, z, env = process.env, warn } = {}) => {
  const report = (message) => {
    try { (warn || ((m) => console.warn(m)))('dsh-instance-manager: ' + message) } catch (e) { }
  }
  const idle = (extra) => Object.assign({
    registered: false,
    degraded: false,
    get: () => resolveLiveSection(undefined, env)
  }, extra)
  try {
    if (!z || typeof z.object !== 'function') return idle({ reason: 'schema-unavailable' })
    const settings = ctx && ctx.settings
    if (!settings || typeof settings.register !== 'function') return idle({ reason: 'settings-unavailable' })
    const scope = settings.register(SETTINGS_NAMESPACE, buildLiveSchema(z), {
      base: buildLiveBase(env),
      applies: 'live'
    })
    return {
      registered: true,
      degraded: false,
      scope,
      get: () => resolveLiveSection(scope.get && scope.get(), env)
    }
  } catch (error) {
    report('用户设置分节无效，已降级为默认值（' +
      ((error && error.message) ? error.message : String(error)) + '）')
    return idle({ degraded: true, error })
  }
}

// ---- startup 命名空间 ------------------------------------------------------
// applies:'restart'：所有者只在构造时读取一次，不监听后续变化，设置界面因此把待生效
// 的编辑标记为“待生效”。只有端口范围属于这一类——运行中的实例里，空闲端口查找与
// 发现扫描不能改变。

export const buildStartupSchema = (z) => z.object({
  [PORT_RANGE_FIELD]: z.string().default(DEFAULT_PORT_SPEC)
})

export const buildStartupBase = (env = process.env) => {
  const base = {}
  const raw = env ? env[ENV_PORT_RANGE] : undefined
  // 只接受 parsePortSpec 能解析的形状，理由同 buildLiveBase：垃圾 base 会让整个
  // 分节校验失败。
  if (typeof raw === 'string' && PORT_SPEC_RE.test(raw.trim())) {
    base[PORT_RANGE_FIELD] = raw.trim()
  }
  return base
}

/** 解析一个 startup 分节（缺失时退回环境变量与默认值）。 */
export const resolveStartupSection = (value, env = process.env) => {
  const stored = value && typeof value === 'object' ? value : {}
  const base = buildStartupBase(env)
  const fallback = env && typeof env[ENV_PORT_RANGE] === 'string' && env[ENV_PORT_RANGE].trim().length > 0
    ? env[ENV_PORT_RANGE].trim()
    : DEFAULT_PORT_SPEC
  return {
    [PORT_RANGE_FIELD]: nonEmptyString(stored[PORT_RANGE_FIELD]) ??
      nonEmptyString(base[PORT_RANGE_FIELD]) ?? fallback
  }
}

/**
 * 注册 STARTUP 命名空间。降级规则与 {@link registerLiveSettings} 相同：损坏的
 * 存储分节会让 register() 本身失败，这里捕获后由调用方退回环境变量与默认值。
 */
export const registerStartupSettings = ({ ctx, z, env = process.env, warn } = {}) => {
  const report = (message) => {
    try { (warn || ((m) => console.warn(m)))('dsh-instance-manager: ' + message) } catch (e) { }
  }
  const idle = (extra) => Object.assign({
    registered: false,
    degraded: false,
    get: () => resolveStartupSection(undefined, env)
  }, extra)
  try {
    if (!z || typeof z.object !== 'function') return idle({ reason: 'schema-unavailable' })
    const settings = ctx && ctx.settings
    if (!settings || typeof settings.register !== 'function') return idle({ reason: 'settings-unavailable' })
    const scope = settings.register(SETTINGS_NAMESPACE_STARTUP, buildStartupSchema(z), {
      base: buildStartupBase(env),
      applies: 'restart'
    })
    return {
      registered: true,
      degraded: false,
      scope,
      get: () => resolveStartupSection(scope.get && scope.get(), env)
    }
  } catch (error) {
    report('实例启动设置分节无效，已降级为默认值（' +
      ((error && error.message) ? error.message : String(error)) + '）')
    return idle({ degraded: true, error })
  }
}

/**
 * 一项设置允许描述的最大扫描宽度。本地探测用 Promise.all 对配置里的每个端口并发
 * 发起请求，这个上限阻止 `1-65535` 这样的笔误把面板变成对本机的 65k 路扫描。
 */
export const MAX_PORT_RANGE_SPAN = 1024

/**
 * 解析一份扫描配置；任一部分不可用时返回 null：格式错误、端口超出 1-65535、区间
 * 反向，或总宽度超过 {@link MAX_PORT_RANGE_SPAN}，整份配置都会被拒绝，笔误不会把
 * 扫描范围缩成用户所写内容的一个子集。
 *
 * @param {string} spec 逗号分隔的区间与单端口。
 * @returns {{ min: number, max: number, extra: number[] } | null} 第一个区间（新实例
 *   也可以在这里启动），以及其余所有端口，升序排列。
 */
const planPortSpec = (spec) => {
  const text = String(spec || '').trim()
  if (!PORT_SPEC_RE.test(text)) return null
  const ranges = []
  for (const part of text.split(',')) {
    const [lo, hi] = part.trim().split('-').map((value) => Number(value.trim()))
    const max = hi === undefined ? lo : hi
    if (!(lo >= 1 && max >= lo && max <= 65535)) return null
    ranges.push([lo, max])
  }
  const width = ranges.reduce((sum, [min, max]) => sum + (max - min + 1), 0)
  if (width > MAX_PORT_RANGE_SPAN) return null
  const [first, ...rest] = ranges
  const extra = new Set()
  for (const [min, max] of rest) {
    for (let port = min; port <= max; port++) {
      if (port < first[0] || port > first[1]) extra.add(port)
    }
  }
  return { min: first[0], max: first[1], extra: [...extra].sort((a, b) => a - b) }
}

const DEFAULT_PORT_PLAN = planPortSpec(DEFAULT_PORT_SPEC) ||
  { min: 3080, max: 3129, extra: [19387] }

/**
 * 把扫描配置与内置默认值合并解析。
 *
 * @param {string} raw 来自设置或环境变量的配置，例如 `3080-3129,19387`。
 * @returns {{ min: number, max: number, extra: number[] }} 实际生效的扫描计划。
 */
export const parsePortSpec = (raw) => planPortSpec(raw) || DEFAULT_PORT_PLAN
