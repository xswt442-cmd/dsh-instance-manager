// Unit tests for the fleet peer-link helpers in lib/fleet.js (F2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePeers, LINK_PATH, createQueryResponder, FleetLinks } from '../lib/fleet.js'
import { normalizePort } from '../lib/shared.js'

test('parsePeers parses id@origin pairs into ws link descriptors', () => {
  const peers = parsePeers('office@http://192.168.1.20:3080, laptop@example.com:3081')
  assert.deepEqual(peers, [
    { id: 'office', origin: 'http://192.168.1.20:3080', wsUrl: 'ws://192.168.1.20:3080' + LINK_PATH },
    { id: 'laptop', origin: 'http://example.com:3081', wsUrl: 'ws://example.com:3081' + LINK_PATH }
  ])
})

test('parsePeers keeps https origins on wss and tolerates bare hosts', () => {
  const peers = parsePeers('a@https://secure.example,b@10.0.0.9')
  assert.equal(peers[0].wsUrl, 'wss://secure.example' + LINK_PATH)
  assert.equal(peers[1].origin, 'http://10.0.0.9', 'scheme-less origins default to http')
})

test('parsePeers drops junk, dedupes ids, strips trailing slashes, caps', () => {
  assert.deepEqual(parsePeers(''), [])
  assert.deepEqual(parsePeers('no-at-sign, @no-id, id@'), [])
  const dup = parsePeers('x@http://a,x@http://b')
  assert.equal(dup.length, 1)
  assert.equal(dup[0].origin, 'http://a')
  const many = parsePeers('p1@http://a,p2@http://b,p3@http://c', 2)
  assert.equal(many.length, 2, 'cap bounds the peer table')
})

// ---- inbound query answering (F3) ---------------------------------------
// These used to be an inline closure inside the host's apply(), which meant
// `ws` being absent in unit tests made them unreachable there — and two bugs
// shipped through that gap: `sessions` dropped the requested port (answering
// with the wrong instance's data instead of erroring) and `logs` handed an
// unvalidated value to a filename. Both now delegate to the same functions
// the local HTTP route uses, and these tests pin the delegation.
const makeResponder = (over = {}) => {
  const calls = []
  const deps = {
    fleetId: () => 'fleet-abc',
    version: '9.9.9',
    listLocalInstances: async () => ({
      currentPort: 3080,
      items: [{ port: 3080, remote: false }, { port: 4099, remote: true }]
    }),
    sessionsFor: async (port) => { calls.push(['sessions', port]); return { ok: true, port } },
    logsFor: async (port, stream) => { calls.push(['logs', port, stream]); return { ok: true, port, stream } },
    ...over
  }
  return { calls, answer: createQueryResponder(deps) }
}

test('query responder answers ping (and a missing query) with identity', async () => {
  const { answer, calls } = makeResponder()
  assert.deepEqual(await answer({ kind: 'ping' }), { ok: true, fleetId: 'fleet-abc', version: '9.9.9' })
  assert.deepEqual(await answer(undefined), { ok: true, fleetId: 'fleet-abc', version: '9.9.9' })
  assert.deepEqual(calls, [], 'ping must not touch any instance state')
})

test('query responder answers fleet with local rows only', async () => {
  const { answer } = makeResponder()
  const r = await answer({ kind: 'fleet' })
  assert.equal(r.ok, true)
  assert.equal(r.currentPort, 3080)
  assert.deepEqual(r.items.map((i) => i.port), [3080], 'remote rows must never be echoed back to a peer')
})

test('query responder forwards the REQUESTED port to sessions', async () => {
  // Regression: this branch used to call describeSessions() directly, so
  // asking peer X for :3090 silently returned :3080's sessions — wrong data
  // rather than an error, which is the worst failure mode for a fleet view.
  const { answer, calls } = makeResponder()
  const r = await answer({ kind: 'sessions', port: 3090 })
  assert.deepEqual(calls, [['sessions', 3090]], 'the requested port must survive the hop')
  assert.equal(r.port, 3090)
})

test('query responder treats an omitted sessions port as "yourself"', async () => {
  const { answer, calls } = makeResponder()
  await answer({ kind: 'sessions' })
  assert.deepEqual(calls, [['sessions', undefined]], 'no port means the peer\'s own instance')
})

test('query responder passes logs port and stream through untouched', async () => {
  // The port lands in a filename on the answering side; validation lives in
  // the shared logsFor/normalizePort pair, deliberately NOT duplicated here.
  const { answer, calls } = makeResponder()
  await answer({ kind: 'logs', port: 3090, stream: 'err' })
  await answer({ kind: 'logs', port: 3090 })
  assert.deepEqual(calls, [['logs', 3090, 'err'], ['logs', 3090, undefined]])
})

test('query responder passes a peer-supplied logs port straight to the validating helper', async () => {
  // The responder deliberately does NOT validate: it forwards verbatim and
  // lets logsFor/normalizePort — the same gate the HTTP route uses — decide.
  // Duplicating the rule here would create a second, weaker copy.
  const attack = '../'.repeat(8) + 'Windows/win.ini'
  const { answer, calls } = makeResponder()
  await answer({ kind: 'logs', port: attack })
  assert.equal(calls[0][1], attack, 'forwarded untouched')
  assert.equal(normalizePort(calls[0][1]), null, 'and the shared validator rejects it before any filename is built')
})

test('query responder reports unknown kinds instead of guessing', async () => {
  const { answer, calls } = makeResponder()
  assert.deepEqual(await answer({ kind: 'stop-everything' }), { ok: false, code: 'unknown_query' })
  assert.deepEqual(calls, [], 'an unrecognized kind must not reach any instance state')
})

// ---- mutual peering must not amplify (F2) -------------------------------
// The natural fleet config is two machines that each list the other. Answering
// a peer's `fleet` query by re-listing the WHOLE fleet — peers included — made
// that pair answer each other forever: A asks B, B's answer asks A, A's answer
// asks B... measured at 5000 nested listings in 70 ms, every one a full 50-port
// sweep, on both machines, from a single panel refresh.
//
// The host removes it at the source (the responder gets the peer-free
// listLocalInstances). This test pins the transport-level guard that holds
// even when the injected lister is NOT peer-free.
const WS_OPEN = 1
class MemSocket {
  constructor(url) { this.url = url; this.readyState = WS_OPEN; this.h = {}; this.remote = null; this.isAlive = true }
  on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return this }
  emit(ev, ...a) { for (const fn of this.h[ev] || []) fn(...a) }
  send(data) {
    const text = String(data)
    queueMicrotask(() => {
      if (this.remote && this.remote.readyState === WS_OPEN) this.remote.emit('message', text)
    })
  }
  ping() { }
  close() { this.readyState = 3; this.emit('close') }
  terminate() { this.close() }
}
class MemWSS { handleUpgrade(req, socket, head, cb) { cb(socket) } }

const wireMutualPeers = async () => {
  const dials = []
  const counts = { a: 0, b: 0 }
  class Dial extends MemSocket { constructor(url) { super(url); dials.push(this) } }
  const build = (name, peerName) => {
    const node = { name, peerName }
    node.hub = new FleetLinks({
      WebSocket: Dial,
      WebSocketServer: MemWSS,
      safeTokenEqual: (x, y) => x === y,
      fleetId: () => 'fleet-' + name,
      resolveToken: async () => 'tok',
      // Deliberately the WRONG shape for this test: answering a fleet query
      // re-lists the whole fleet, peers included. The guard must survive it.
      answerQuery: createQueryResponder({
        fleetId: () => 'fleet-' + name,
        version: '0.9.1',
        listLocalInstances: async () => {
          counts[name] += 1
          if (counts[name] > 200) throw new Error('runaway: ' + name + ' listed ' + counts[name] + ' times')
          await node.hub.queryPeer(node.peerName, { kind: 'fleet' }, 300)
          return { currentPort: 3080, items: [{ port: 3080, remote: false }] }
        },
        sessionsFor: async () => ({ ok: true }),
        logsFor: async () => ({ ok: true })
      })
    }, [{ id: peerName, wsUrl: 'ws://' + peerName + '/link' }])
    return node
  }
  const A = build('a', 'b')
  const B = build('b', 'a')
  await new Promise((r) => setTimeout(r, 10))
  // A dials B and B dials A: hand each outbound socket to the other's inbound.
  const aSide = dials.find((d) => d.url === 'ws://b/link')
  const bSide = dials.find((d) => d.url === 'ws://a/link')
  assert.ok(aSide && bSide, 'both peers must have dialed')
  const bAccept = new MemSocket()
  const aAccept = new MemSocket()
  aSide.remote = bAccept; bAccept.remote = aSide; aSide.emit('open')
  bSide.remote = aAccept; aAccept.remote = bSide; bSide.emit('open')
  B.hub.attachInbound(bAccept)
  A.hub.attachInbound(aAccept)
  return { A, B, counts }
}

test('a mutually-peered pair answers one fleet query without amplification', async () => {
  const { A, B, counts } = await wireMutualPeers()
  try {
    const res = await A.hub.queryPeer('b', { kind: 'fleet' }, 1000)
    assert.equal(res.ok, true, 'the peer must still answer: ' + JSON.stringify(res))
    assert.equal(counts.b, 1, 'the answering side lists exactly once')
    assert.equal(counts.a, 0, 'and must NOT be pulled into listing itself')
  } finally {
    A.hub.dispose(); B.hub.dispose()
  }
})

test('a fleet query nested inside an inbound fleet answer is refused, not forwarded', async () => {
  const { A, B, counts } = await wireMutualPeers()
  try {
    // Drive the nested query directly: while B is answering A, B may not ask
    // anyone. This is the invariant the amplification test above exercises
    // end-to-end; here it is asserted on the returned code.
    B.hub.answeringFleet += 1
    const nested = await B.hub.queryPeer('a', { kind: 'fleet' }, 300)
    B.hub.answeringFleet -= 1
    assert.deepEqual(nested, { ok: false, code: 'fleet_query_nested' })
    assert.equal(counts.b, 0, 'a refused query must never reach the lister')
    // Non-fleet kinds stay available (a nested sessions/log read is legal).
    const other = await B.hub.queryPeer('a', { kind: 'sessions', port: 3080 }, 300)
    assert.ok(other.ok !== undefined, 'only fleet queries are guarded')
  } finally {
    A.hub.dispose(); B.hub.dispose()
  }
})
