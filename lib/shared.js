// dsh-instance-manager shared pure helpers.
//
// Everything here is dependency-free and side-effect-free so the node:test
// suite (test/) exercises the exact code the host half runs: request guards,
// loopback parsing, the dsh-bin resolution chain, and registry-entry
// validation for file-based discovery. Only the host half imports this
// module; the browser half talks to the API over plain HTTP.
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { timingSafeEqual } from 'node:crypto'

// Keep in lockstep with package.json "version": publish.yml and the compat
// static job both assert the equality, so a release cannot ship drifted.
export const VERSION = '0.10.6'

// The three host-side blocks below are not written here. They are embedded from
// dsh-mini-utility-dock at build time (see the marked blocks), because three
// plugins kept three hand-maintained copies of the same guard and they drifted
// twice — once rejecting IPv6 loopback everywhere, once disagreeing on which
// Host spellings count as loopback. This plugin supplies only its own error
// vocabulary. Edit the dock fragment, then run the matching sync script:
// `loopback:sync` / `guard:sync` / `http:sync`.

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

// The JSON reply, the POST-only gate and the browser authorizer are embedded
// here too, for the same reason as the two blocks above: this plugin kept its
// own closures for them, and they drifted on exactly the lines that carry
// weight — its own `sendJson` answered without `cache-control: no-store` on
// routes whose bodies name instance ports, pids and session summaries.
// `dsh-host-http` is independent of the two blocks above it (it imports neither
// and redeclares nothing), so the three coexist in one file in the order below.
// Edit the dock fragment, then run `npm run http:sync`.

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

// RC1 launches the browser through a one-time token URL and exchanges that
// token for the signed Connection cookie. UI-triggered starts must therefore
// allow the child to open its URL; agent-triggered starts remain headless.
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

/**
 * Whether a request must clear the fleet bearer. True when the real TCP peer
 * is off-loopback OR the Host header is off-loopback — either makes the request
 * untrusted, so the handler (which owns token verification) must challenge it.
 * An ABSENT Host is treated as loopback here so a bare local request is not
 * rejected on host grounds; the peer address is what actually decides trust. A
 * PRESENT Host that parses to no hostname (an unbracketed IPv6 literal such as
 * `::1:3080`, which RFC 7230 forbids but a client can still send) is off-loopback
 * — an empty parse must not read as a pass.
 *
 * Division of labor with the embedded guard, and why the two are not one:
 *
 *   * the guard (`dsh-host-guard`, above) answers WHETHER a request may proceed,
 *     and answers it by returning false after having already written the
 *     rejection to `res`;
 *   * this predicate answers WHICH CREDENTIAL the route must demand before the
 *     guard runs at all — a fleet peer with a bearer, or a browser through
 *     `authorizeBrowser`. `lib/index.js` calls it first and branches on it, so
 *     it must never write anything.
 *
 * Deriving it from the guard would mean calling the guard once with a throwaway
 * `respond` purely to read the rejection back, and three properties make that
 * worse rather than single-sourced:
 *
 *   1. the guard stops at its FIRST failing check, so the reason it reports for
 *      an off-loopback peer that also sends `sec-fetch-site: cross-site` (or a
 *      foreign Origin) is that earlier reason, not the peer — the branch would
 *      then be decided by the shared fragment's check ORDER;
 *   2. this plugin maps `non_loopback_peer` and `non_loopback_host` onto the one
 *      published code `bad_host`, and that mapping is per-repository POLICY: a
 *      future vocabulary change here, or a re-sync of the fragment, would move
 *      the bearer boundary without any code in this file changing;
 *   3. the guard cannot answer the "no peer at all" case as a credential
 *      question — it rejects it as `unknown_peer` before reaching the peer
 *      predicate, while the route has to decide between bearer and browser
 *      first. (The two still agree that an unidentified caller is never local:
 *      `test/host.test.js` asserts the blank-peer case on both paths.)
 *
 * So the criterion stays here, written with the same predicates the guard block
 * uses (`isLoopbackAddress` / `hostHostname` / `isLoopbackName` from the block
 * above), which is what keeps the two from disagreeing about what loopback IS.
 * `dsh-plugin-parity` exempts this predicate from its cross-repo comparison for
 * the same reason the guard factory name is exempt: the admission policy is
 * per-repository by design.
 */
export const requestNeedsBearer = (req) => {
  const peerLoopback = isLoopbackAddress(req.socket && req.socket.remoteAddress)
  const host = req.headers.host || ''
  const parsedHost = host ? hostHostname(host) : ''
  // `parsedHost !== ''` matters: an empty parse is off-loopback, not a pass.
  const hostLoopback = host ? (parsedHost !== '' && isLoopbackName(parsedHost)) : true
  return !peerLoopback || !hostLoopback
}

// The rejections whose wording is this plugin's own API vocabulary. The shared
// guard owns the enforcement; these strings and codes are the published surface,
// so they stay exactly as they were.
const DIM_POLICY = {
  cross_site: { code: 'cross_site', error: '已拒绝跨站请求' },
  unknown_peer: { code: 'unknown_peer', error: '无法确定对端地址' },
  non_loopback_peer: { code: 'bad_host', error: '远程请求需要 fleet 模式' },
  foreign_origin: { code: 'bad_origin', error: 'Origin 不同源' },
  non_loopback_host: { code: 'bad_host', error: '远程请求需要 fleet 模式' }
}

/**
 * This plugin's request guard, bound to the shared enforcement.
 *
 * `respond` is injected so tests capture rejections without a real
 * ServerResponse; the host half passes `sendJson`. A caller may extend `policy`
 * for its own vocabulary; the entries here win for the codes this plugin has
 * already published, and an unknown key still reaches the shared factory's
 * validation rather than being dropped here.
 */
export const createGuard = ({ currentPort, respond, allowRemoteHost, policy }) => bindGuard({
  currentPort,
  respond,
  allowRemoteHost,
  policy: { ...(policy || {}), ...DIM_POLICY }
})

// Constant-time bearer comparison for the fleet trust boundary. Length
// mismatches burn a dummy comparison so failure timing does not leak token
// length; empty inputs never match (an unconfigured token fails closed).
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

// Prefer the exact entry script this instance was started with, falling back
// to the canonical profile location (fresh CI-like environments lack the
// profile copy of @deepseek-ai/dsh). `exists` is injected for tests; every
// segment goes through path.join so the fallback resolves beyond Windows.
export const resolveDshBin = ({ argv1 = '', home, exists }) => {
  if (argv1 && /bin\.js$/.test(argv1) && exists(argv1)) return argv1
  const profileBin = path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  return exists(profileBin) ? profileBin : ''
}

// Resolve the harness home with the same precedence as
// @deepseek-ai/dsh-home-paths: a non-blank $DSH_HOME, otherwise ~/.dsh.
// Existence is deliberately NOT a criterion — the harness itself accepts a
// home that does not exist yet and creates it on demand, so requiring the
// directory here made this plugin fall back to ~/.dsh on a first run with a
// fresh $DSH_HOME, splitting its registry and launcher logs away from the
// very instance it was managing. A blank override counts as unset, so a stray
// DSH_HOME=" " can never collapse the home onto the current directory.
export const resolveDshHome = (env = process.env, homeDir = os.homedir()) => {
  const raw = env.DSH_HOME
  const selected = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
  const value = selected === null ? path.join(homeDir, '.dsh') : selected
  // resolve() last, exactly like dshHomePath: the result is absolute on every
  // platform whether it came from the environment, the OS home, or a tilde.
  if (value === '~') return path.resolve(homeDir)
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.resolve(path.join(homeDir, value.slice(2)))
  return path.resolve(value)
}

// ---- file-based instance registry (discovery heartbeat) -----------------
//
// Every mounted instance heartbeats <home>/run/instances/<port>.json so the
// fleet can be listed without sweeping all 50 ports. Readers trust an entry
// only while it is structurally complete AND fresh; a hard-killed process
// leaves at most a REGISTRY_FRESH_MS ghost, and graceful exits delete the
// file through the plugin disposer.

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

// Coerce a caller-supplied port (query string, agent-tool arg, or a value
// that arrived over a fleet link) to an integer in [1, 65535], or null.
//
// This is the ONLY accepted way to turn untrusted input into a port: the
// value ends up interpolated into the launcher log filename
// (`server-<port>.<stream>.log`), so anything that survives as a non-integer
// (or a string like "../../..") is a path-traversal waiting to happen.
// Accepts integers and whitespace-padded digit strings only — never `1e3`,
// `0x10`, `+80` or `80.5`, all of which would widen the accepted set for no
// gain.
export const normalizePort = (raw) => {
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null
  return n
}

// Tail the last maxBytes of a text file, keeping at most maxLines whole
// lines. A missing file resolves to exists:false instead of throwing; a
// mid-file start drops the cut leading fragment so only complete lines are
// ever returned. Bounded reads keep huge launcher logs harmless.
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

// The order every fleet listing is presented in: the instance serving the
// caller first, then ascending port.
//
// `current` is the row the panel badges as 当前会话 — it is what the user came
// to look at (open it, read its logs, stop it), and the list is polled every
// few seconds, so putting it anywhere but first means scanning the list for
// the one row that matters most.
//
// Port decides everything else, and the source id only breaks a tie on the
// SAME port: two machines both listing :3080 keep a fixed order between polls
// instead of swapping places. Source must not outrank port — a peer's rows and
// this machine's share one port column, and sorting a remote :3090 above a
// local :3080 would break the ascending scan the panel relies on.
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

// Sweep range ∪ heartbeat-known ports, deduped, ascending. Registry entries
// validate 1-65535 precisely so an instance hand-started OUTSIDE the fixed
// sweep range still reaches the fleet list through its own heartbeat.
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

// Scalar-only projection of live Session objects. DSH session/store objects
// are internal live data — never serialized wholesale — so exactly the
// display fields are extracted (id, createdAt, cwd, subagent origin, event
// count), sorted newest-first and capped.
export const summarizeSessions = (list, cap = 20) => {
  const rows = []
  for (const s of Array.isArray(list) ? list : []) {
    try {
      const id = String(s.id || '')
      const h = s.header
      if (!id || !h || typeof h.createdAt !== 'number') continue
      const row = { id, createdAt: h.createdAt }
      if (typeof h.cwd === 'string' && h.cwd) row.cwd = h.cwd
      if (h.origin === 'subagent') row.subagent = true
      if (typeof s.seq === 'number') row.events = s.seq
      rows.push(row)
    } catch (e) { /* one bad entry never sinks the summary */ }
  }
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows.length > cap ? rows.slice(0, cap) : rows
}

// Wait for a just-spawned launcher child: resolve to {ready:true} once
// `probe()` says it answers, {died:true, code} if it exits, or {} when the
// confirm window closes with it still silent (a slow boot — never a reason to
// spawn a second one).
//
// The child's 'error' event is ALWAYS consumed. A ChildProcess that fails to
// spawn (ENOENT, EACCES, EMFILE) emits 'error' and NO 'exit', and an unlistened
// 'error' event is process-fatal — one click on "start new instance" in such a
// window used to take the whole instance down through the crash handler. Here
// it is reported as just another failed launch, so the caller can retry once.
export const awaitChild = ({ child, confirmMs, probe, sleep }) => {
  const spawnFailed = new Promise((resolve) => child.once('error', (e) =>
    resolve({ died: true, code: 'spawn:' + ((e && e.code) || 'error') })))
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve({ died: true, code })))
  // The probe loop must stop once the race has a verdict: without the flag a
  // dead child still gets probed every 500ms until the full confirm window
  // expires, and a retry launch races the zombie loop's probes.
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

// The port set the SSE up/down push tracks: managed rows from THIS machine.
// Remote rows carry other machines' port numbers — they share the local
// number space but never the local lifecycle, so their flapping must not
// toast as instance up/down here.
//
// Shared deliberately: the baseline frame a new subscriber is seeded with and
// the diff ticker must agree port-for-port. When the baseline inlined a wider
// filter (`i.managed`, remote rows included), the first tick read every peer
// port as "removed" and toasted a fleet-wide instance-down for machines that
// had been up the entire time.
export const managedLocalPorts = (items) =>
  (Array.isArray(items) ? items : []).filter((i) => i.managed && !i.remote).map((i) => i.port)

// Fleet membership diff for the SSE up/down push: which managed ports
// appeared and which disappeared between two ticks.
export const diffManagedPorts = (prev, next) => {
  const added = []
  const removed = []
  for (const p of next) if (!prev.has(p)) added.push(p)
  for (const p of prev) if (!next.has(p)) removed.push(p)
  return { added, removed }
}

// Pick the port an AUTO start may spawn on: the first candidate in `range`
// whose `available(port)` check passes, skipping `exclude`.
//
// `exclude` exists because of a real loop: a first attempt died on port P, the
// scan reported P free again (the failed child's bind had not settled), the
// retry spawned on P, and that child died the same way. The retry is only worth
// making somewhere the caller did not just watch die, so the exclusion belongs
// in the picker rather than in the retry's bookkeeping.
export const pickStartPort = async ({ range, exclude, available }) => {
  for (let p = range.min; p <= range.max; p++) {
    if (p === exclude) continue
    if (await available(p)) return p
  }
  return 0
}

// How many times START may spawn, and where the second attempt may go.
//
// The retry exists for exactly one failure: the child DIED inside its confirm
// window, whose usual cause is having lost the scan/bind race for an auto-picked
// port. It must not:
//
//   - retry when the caller named a port — that would start an instance
//     somewhere the caller did not ask for;
//   - retry a merely SLOW boot: `start_unconfirmed` means the child is still
//     alive and may yet answer, so a second spawn leaves two live instances;
//   - re-pick the port the first attempt died on: doing so is how one failed
//     attempt became a loop over the same port, each child dying with
//     EADDRINUSE inside its confirm window.
//
// Kept here, out of the host half, so those three properties are testable
// without spawning a real child: `launch(options)` is the single-attempt spawn.
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
    error: first.error + '；自动换口重试仍失败'
  }
}

// Parse the DSHIM_PORT_RANGE env override ("min-max"). The 3080-3129 band is
// a dsh-side DOCUMENTATION convention, not a compiled contract — the
// webserver takes its port from composition config and even accepts 0 (OS-
// assigned). Discovery is already heartbeat-driven and port-agnostic; this
// only scopes where START may spawn. Invalid input falls back silently.
// ---- user settings namespace (DIM-M1 1a) -------------------------------
//
// The harness owns preference storage: `ctx.settings.register(ns, schema,
// { base })` resolves schema defaults, then the registrant's composition
// `base`, then the user's stored section, and the browser half reads the very
// same namespace through `ctx.settingsScope.bind()` — persistence, revision
// fencing, redaction, and the schema-driven form all come for free.
//
// `applies` is NAMESPACE-level, not per field, and a `restart` namespace's
// owner never watches its value. The hot-applicable fields (dock placement,
// poll interval, peer list, fleet token) live in the LIVE namespace; the
// load-time constants (port range) live in the STARTUP namespace.
//
// NOTE on the startup name: the design doc sketched `dsh-instance-manager.startup`,
// but the settings service validates namespaces against /^[a-z][a-z0-9-]*$/
// (packages/settings/settings/src/index.ts) — a dot throws a TypeError at
// register(). A pure kebab suffix is used instead.
//
// Peer and token fields deliberately keep the ENV STRING format ("id@origin,..."
// and the raw token): parsePeers owns validation/dedupe/cap and is already
// tested, and a flat string avoids a nested schema for M1's form.
//
// Nothing below is required for the panel to work. Every accessor degrades to
// the constants, and `register()` itself is wrapped so a corrupt stored
// section can never stop the plugin from mounting.
export const SETTINGS_NAMESPACE = 'dsh-instance-manager'
export const SETTINGS_NAMESPACE_STARTUP = 'dsh-instance-manager-startup'
export const REFRESH_INTERVAL_FIELD = 'refreshIntervalMs'
export const FLEET_TOKEN_FIELD = 'fleetToken'
export const PEERS_FIELD = 'peers'
export const PORT_RANGE_FIELD = 'portRange'
export const DEFAULT_REFRESH_INTERVAL_MS = 4000
export const REFRESH_INTERVAL_MIN_MS = 1000
export const REFRESH_INTERVAL_MAX_MS = 60000
// Environment overrides, kept as the composition `base` layer so an operator
// who set them keeps working (see the doc note: `base` is frozen at
// registration, which is exactly right for process environment).
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

/** Narrow one stored, composed, or env value to a poll interval in ms. */
export const normalizeRefreshIntervalMs = (raw, fallback = DEFAULT_REFRESH_INTERVAL_MS) => {
  const value = coerceIntervalMs(raw)
  return value === null ? fallback : value
}

/** The registered namespace's schema. `z` is @deepseek-ai/schemastery. */
export const buildLiveSchema = (z) => z.object({
  [REFRESH_INTERVAL_FIELD]: z.number().step(1).min(REFRESH_INTERVAL_MIN_MS)
    .max(REFRESH_INTERVAL_MAX_MS).default(DEFAULT_REFRESH_INTERVAL_MS),
  // Write-only in every UI: describe({redactSecrets:true}) strips it from
  // value/base/user and enumerates {path, set}, so no API response or log
  // ever carries the token (packages/settings/settings/src/redact.ts).
  [FLEET_TOKEN_FIELD]: z.string().role('secret'),
  // Same string format as DSHIM_PEERS; parsePeers owns validation.
  [PEERS_FIELD]: z.string().default('')
})

const nonEmptyString = (raw) =>
  typeof raw === 'string' && raw.length > 0 ? raw : undefined

// Env overrides become the composition `base` — user edits land in the layer
// ABOVE it and win. Only well-formed values are carried: `base` is merged
// before the schema runs, so a garbage env value here would fail the whole
// section and take the registration down with it.
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

/** Resolve a live section (or pure env/default fallback when `value` is absent). */
export const resolveLiveSection = (value, env = process.env) => {
  const stored = value && typeof value === 'object' ? value : {}
  const base = buildLiveBase(env)
  const fallbackPeers = env && typeof env[ENV_PEERS] === 'string' ? env[ENV_PEERS] : ''
  return {
    [REFRESH_INTERVAL_FIELD]: normalizeRefreshIntervalMs(
      stored[REFRESH_INTERVAL_FIELD] === undefined ? base[REFRESH_INTERVAL_FIELD] : stored[REFRESH_INTERVAL_FIELD]),
    // The token survives only under its schema-declared secret field. A
    // resolved section carries the schema/base/user layering already, so a
    // STRING here (including '' — an explicit user clear) is authoritative;
    // undefined only means the degraded/no-section path, which falls back to
    // the raw env.
    [FLEET_TOKEN_FIELD]: typeof stored[FLEET_TOKEN_FIELD] === 'string'
      ? (stored[FLEET_TOKEN_FIELD].length > 0 ? stored[FLEET_TOKEN_FIELD] : undefined)
      : nonEmptyString(base[FLEET_TOKEN_FIELD]) ?? nonEmptyString(env && env[ENV_FLEET_TOKEN]),
    [PEERS_FIELD]: typeof stored[PEERS_FIELD] === 'string'
      ? stored[PEERS_FIELD]
      : nonEmptyString(base[PEERS_FIELD]) ?? fallbackPeers
  }
}

/**
 * Register the LIVE namespace on an already-injected settings context.
 *
 * `register()` is the one call here that can throw: stored sections are
 * judged at registration, where no last-good value exists yet, so a section
 * that already fails the schema rejects the registration itself. A corrupt
 * settings document must therefore degrade to in-memory defaults and warn —
 * never keep the panel from mounting.
 * @param options - injected `ctx` carrying `settings`, the schemastery `z`,
 * the process env, and an optional warn sink.
 * @returns `{ registered, degraded, scope?, get() }`; `get()` always answers
 * a usable section.
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

// ---- startup namespace (DIM-M1 1b) ---------------------------------------
// applies:'restart': the owner reads the value ONCE at construction and never
// watches, so the settings UI marks pending edits as 待生效. Only the port
// range qualifies — findFreePort and the discovery sweep must not change
// under a running instance.

export const buildStartupSchema = (z) => z.object({
  [PORT_RANGE_FIELD]: z.string().default('3080-3129')
})

export const buildStartupBase = (env = process.env) => {
  const base = {}
  const raw = env ? env[ENV_PORT_RANGE] : undefined
  // parsePortRange-shaped input only, for the same "garbage base fails the
  // whole section" reason as buildLiveBase.
  if (typeof raw === 'string' && /^\d{1,5}\s*-\s*\d{1,5}$/.test(raw.trim())) {
    base[PORT_RANGE_FIELD] = raw.trim()
  }
  return base
}

/** Resolve a startup section (or pure env/default fallback when absent). */
export const resolveStartupSection = (value, env = process.env) => {
  const stored = value && typeof value === 'object' ? value : {}
  const base = buildStartupBase(env)
  const fallback = env && typeof env[ENV_PORT_RANGE] === 'string' && env[ENV_PORT_RANGE].trim().length > 0
    ? env[ENV_PORT_RANGE].trim()
    : '3080-3129'
  return {
    [PORT_RANGE_FIELD]: nonEmptyString(stored[PORT_RANGE_FIELD]) ??
      nonEmptyString(base[PORT_RANGE_FIELD]) ?? fallback
  }
}

/**
 * Register the STARTUP namespace. Same degradation contract as
 * {@link registerLiveSettings}: a corrupt stored section rejects register()
 * itself, so it is caught here and the caller falls back to env/defaults.
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
 * Widest port range one setting may describe. The local probe fans out with
 * Promise.all over the whole range, so this bound is what stops a typo like
 * `1-65535` from turning the panel into a 65k-way scan of the local host.
 */
export const MAX_PORT_RANGE_SPAN = 1024

export const parsePortRange = (raw, fallbackMin = 3080, fallbackMax = 3129) => {
  const m = /^(\d{1,5})\s*-\s*(\d{1,5})$/.exec(String(raw || '').trim())
  if (!m) return { min: fallbackMin, max: fallbackMax }
  const min = Number(m[1])
  const max = Number(m[2])
  if (!(min >= 1 && max >= min && max <= 65535)) return { min: fallbackMin, max: fallbackMax }
  if (max - min + 1 > MAX_PORT_RANGE_SPAN) return { min: fallbackMin, max: fallbackMax }
  return { min, max }
}
