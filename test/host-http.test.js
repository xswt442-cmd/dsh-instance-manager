// The `dsh-host-http` block, as this repository runs it.
//
// What is asserted here: (1) the block is embedded exactly once and in order — a
// check compares only the markers its pinned dock version knows, so this file is
// what notices it missing, doubled or misplaced; and (2) the reply policy this
// plugin publishes still comes out of the exported functions, including
// `cache-control: no-store` on bodies that name instance ports, pids and session
// summaries, and the `need_post` vocabulary with the rejected `action` echoed
// back.
//
// Every case below CALLS an export. Matching `lib/index.js` as a string proves
// nothing that module loading does not already prove — an import that broke would
// fail the file before any assertion ran — so the "the host half configures the
// shared factories rather than keeping a private copy" guarantee is carried by
// the mounted-route cases in `test/routes.test.js`, which answer through this
// plugin's real `requirePost`, `authorizeBrowser` and `sendJson` bindings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  sendJson,
  createRequirePost,
  createBrowserAuthorizer,
  connectionUnavailable,
  CONNECTION_UNAVAILABLE
} from '../lib/shared.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const sharedSource = readFileSync(path.join(ROOT, 'lib', 'shared.js'), 'utf8')

// `sendJson` writes a status with headers and ends the response, so a two-method
// stub is the whole contract — and it is the only way to see the headers, which
// is what these routes are judged on.
const fakeRes = () => {
  const written = []
  return {
    written,
    writeHead: (status, headers) => written.push({ status, headers }),
    end: (body) => written.push({ body })
  }
}
const replied = (res) => ({
  status: res.written[0].status,
  headers: res.written[0].headers,
  json: JSON.parse(res.written.find((w) => w.body !== undefined).body)
})

const openMarker = (name) => sharedSource.split(`// <${name}>`).length - 1
const closeMarker = (name) => sharedSource.split(`// </${name}>`).length - 1

test('dsh-host-http is embedded exactly once, below the guard it sits under', () => {
  assert.equal(openMarker('dsh-host-http'), 1, 'exactly one opening marker')
  assert.equal(closeMarker('dsh-host-http'), 1, 'exactly one closing marker')
  // The block order in the file must match the fragment order the dock CLI
  // splices in (loopback -> guard -> host-http); a reordered file makes `check`
  // rewrite a block out from under the next one.
  const at = (name) => sharedSource.indexOf(`// <${name}>`)
  assert.ok(at('dsh-loopback-helpers') < at('dsh-host-guard'), 'loopback above guard')
  assert.ok(at('dsh-host-guard') < at('dsh-host-http'), 'guard above host-http')
  for (const name of ['dsh-loopback-helpers', 'dsh-host-guard', 'dsh-host-http']) {
    assert.ok(at(name) > -1, `${name} present`)
  }
})

test('sendJson answers with no-store, on every route that names host facts', () => {
  const res = fakeRes()
  sendJson(res, 200, { ok: true, items: [{ port: 3080, pid: 4242 }] })
  const r = replied(res)
  assert.equal(r.status, 200)
  assert.equal(r.headers['cache-control'], 'no-store')
  assert.match(r.headers['content-type'], /application\/json/)
  assert.equal(r.json.items[0].port, 3080)
})

test('the POST gate keeps this plugin\'s published 405 vocabulary through policy', () => {
  const requirePost = createRequirePost({
    policy: { method_not_allowed: { code: 'need_post', error: '{action} 需要 POST 请求', includeAction: true } }
  })
  const res = fakeRes()
  assert.equal(requirePost({ method: 'GET' }, res, 'stop-all'), false)
  const r = replied(res)
  assert.equal(r.status, 405)
  assert.equal(r.headers['cache-control'], 'no-store', 'the gate replies through the same policy')
  assert.equal(r.json.code, 'need_post', 'the code this plugin has always published')
  assert.equal(r.json.action, 'stop-all', 'and the rejected action stays echoed')
  assert.equal(r.json.error, 'stop-all 需要 POST 请求')
  assert.equal(requirePost({ method: 'POST' }, fakeRes(), 'stop-all'), true)
})

test('the gate\'s defaults and its validation are the block\'s, not a local fork', () => {
  const plain = createRequirePost()
  const res = fakeRes()
  assert.equal(plain({ method: 'GET' }, res, 'kill'), false)
  assert.equal(replied(res).json.code, 'method', 'the fragment default')
  assert.equal(replied(res).json.action, undefined, 'and no action echo unless policy asks for it')
  assert.equal(replied(res).headers['cache-control'], 'no-store',
    'with no `respond` passed the rejection still goes through this block\'s sendJson')
  // A partial override merges with the default rather than replacing it, so a
  // plugin that renames only the code cannot answer with an empty message.
  const merged = fakeRes()
  const onlyCode = createRequirePost({ policy: { method_not_allowed: { code: 'own_code' } } })
  assert.equal(onlyCode({ method: 'DELETE' }, merged, 'restart'), false)
  assert.equal(replied(merged).json.code, 'own_code')
  assert.equal(replied(merged).json.error, 'action "restart" requires POST', 'the default wording survives')
  // A typo in a policy key must be an error rather than a silent default, or a
  // plugin publishes a code no test expects.
  assert.throws(() => createRequirePost({ policy: { wrong_key: { code: 'x' } } }), /unknown policy key/)
  // The method is read case-insensitively and an absent one reads as GET — the
  // wider reading, kept on purpose (see the note at the binding in
  // `lib/index.js`). `test/routes.test.js` pins the same verdict on the mounted
  // route rather than on a source string.
  assert.equal(plain({ method: 'post' }, fakeRes(), 'kill'), true)
  assert.equal(plain({}, fakeRes(), 'kill'), false)
})

test('connectionUnavailable writes through the default sendJson', () => {
  assert.equal(CONNECTION_UNAVAILABLE.code, 'connection_unavailable')
  assert.ok(Object.isFrozen(CONNECTION_UNAVAILABLE), 'the constant is frozen: every call site shares one wording')
  const res = fakeRes()
  assert.equal(connectionUnavailable(res), false,
    'it returns false so a caller can hand its own verdict back in one statement')
  const r = replied(res)
  assert.equal(r.status, 503)
  assert.deepEqual(r.json, { ok: false, code: 'connection_unavailable', error: 'browser authentication unavailable' })
  assert.equal(r.headers['cache-control'], 'no-store',
    'the no-store policy is not something a call site can drop')
})

test('an injected sink reaches every 503 path, and the body handed out is a copy', () => {
  const written = []
  const respond = (res, status, body) => written.push({ res, status, body })
  const res = { which: 'injected' }
  assert.equal(connectionUnavailable(res, respond), false)
  assert.equal(written.length, 1)
  assert.equal(written[0].res, res, 'the same (res, status, body) sink shape the guard block uses')
  assert.equal(written[0].status, 503)
  assert.notEqual(written[0].body, CONNECTION_UNAVAILABLE, 'a caller receives a copy, never the frozen object')
  assert.deepEqual(written[0].body, { ...CONNECTION_UNAVAILABLE })
  // The authorizer threads that same sink into both 503 paths, so a route that
  // composes its own replies still cannot lose the shared wording.
  const thrown = createBrowserAuthorizer({
    getConnection: () => ({ requestRejection: () => { throw new Error('disposed') } }),
    getConnectionSeen: () => false,
    guard: () => true,
    respond
  })
  assert.equal(thrown({}, res), false)
  const gap = createBrowserAuthorizer({
    getConnection: () => null,
    getConnectionSeen: () => true,
    guard: () => true,
    respond
  })
  assert.equal(gap({}, res), false)
  assert.equal(written.length, 3, 'both 503s went to the injected sink, not to sendJson')
  assert.deepEqual(written.slice(1).map((w) => w.status), [503, 503])
  assert.deepEqual(written[1].body, { ...CONNECTION_UNAVAILABLE })
})

// The authorizer's decision ORDER is the security property, and the host half
// wires it to two closure variables a service reload reassigns. Accessors are
// therefore load-bearing: a captured value would keep authorizing against a
// disposed Connection.
const authorizerCase = ({ connection = null, seen = false, guardVerdict = true, throwing = false } = {}) => {
  const guardCalls = []
  const res = fakeRes()
  const authorize = createBrowserAuthorizer({
    getConnection: () => connection,
    getConnectionSeen: () => seen,
    guard: (req, r) => { guardCalls.push(req); return guardVerdict }
  })
  let outcome
  try {
    outcome = authorize({ method: 'GET', url: '/x' }, res)
  } catch (e) {
    if (!throwing) throw e
  }
  return { outcome, res, guardCalls, replied: res.written.length ? replied(res) : null }
}

test('the authorizer validates the seams that would otherwise go stale', () => {
  assert.throws(() => createBrowserAuthorizer({ getConnection: null, getConnectionSeen: () => false, guard: () => true }),
    /getConnection must be an accessor/)
  assert.throws(() => createBrowserAuthorizer({ getConnection: () => null, getConnectionSeen: false, guard: () => true }),
    /getConnectionSeen must be an accessor/)
  assert.throws(() => createBrowserAuthorizer({ getConnection: () => null, getConnectionSeen: () => false }),
    /guard is required/)
})

test('a Connection that throws is not a Connection that permits', () => {
  const seen = []
  const res = fakeRes()
  const authorize = createBrowserAuthorizer({
    getConnection: () => ({ requestRejection: () => { throw new Error('disposed') } }),
    getConnectionSeen: () => true,
    guard: (req) => { seen.push(req); return true }
  })
  assert.equal(authorize({ method: 'GET' }, res), false)
  assert.equal(replied(res).status, 503)
  assert.equal(replied(res).json.code, 'connection_unavailable')
  assert.deepEqual(seen, [], 'and it must never fall through to the guard or the handler')
})

test('a Connection rejection code is final, and only 401 reads as unauthorized', () => {
  for (const [code, expected] of [[401, 'unauthorized'], [403, 'forbidden']]) {
    const res = fakeRes()
    const authorize = createBrowserAuthorizer({
      getConnection: () => ({ requestRejection: () => code }),
      getConnectionSeen: () => true,
      guard: () => true
    })
    assert.equal(authorize({}, res), false, code)
    assert.equal(replied(res).status, code, code)
    assert.equal(replied(res).json.code, expected, code)
  }
  const ok = fakeRes()
  const authorize = createBrowserAuthorizer({
    getConnection: () => ({ requestRejection: () => undefined }),
    getConnectionSeen: () => false,
    guard: () => false
  })
  assert.equal(authorize({}, ok), true, 'no rejection means the browser may proceed')
})

test('a reload gap answers 503 rather than reopening the route through the guard', () => {
  const case1 = authorizerCase({ connection: null, seen: true, guardVerdict: true })
  assert.equal(case1.outcome, false)
  assert.equal(case1.replied.status, 503)
  assert.deepEqual(case1.guardCalls, [], 'the weaker loopback fence is not consulted')
  // Pre-RC1 host: never had a Connection, so the plugin guard IS the boundary.
  const case2 = authorizerCase({ connection: null, seen: false, guardVerdict: false })
  assert.equal(case2.outcome, false)
  assert.equal(case2.guardCalls.length, 1, 'the guard decides there')
  assert.equal(case2.replied, null, 'and the guard answered, not this block')
})
