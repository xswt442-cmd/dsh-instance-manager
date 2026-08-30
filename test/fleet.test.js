// Unit tests for the fleet peer-link helpers in lib/fleet.js (F2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePeers, LINK_PATH, createQueryResponder } from '../lib/fleet.js'
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
    listInstances: async () => ({
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
