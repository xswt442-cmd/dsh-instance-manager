// Unit tests for the fleet peer-link helpers in lib/fleet.js (F2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePeers, LINK_PATH } from '../lib/fleet.js'

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
