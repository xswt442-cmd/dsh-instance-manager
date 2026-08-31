// dsh-instance-manager fleet peer links (remote-fleet F2).
//
// One WebSocket channel per instance at /dsh-instance-manager/link. Every
// socket is dual-role (interconnect's model): hello announces identity,
// `query` frames are answered locally, `query-result` frames settle our own
// outbound queries.
//
//   {type:'hello', sender}                     both directions, on open
//   {type:'query', reqId, query}               request
//   {type:'query-result', reqId, result}       correlated response
// query.kind: 'ping'     -> {ok, fleetId, version}
//             'fleet'    -> {ok, fleetId, currentPort, items[]}  (local rows only)
//             'sessions' -> port's session summary, answered on the peer's
//                           machine with the SAME semantics as that peer's
//                           action=sessions&port=<p> route: port omitted or
//                           equal to the peer's own port means "yourself",
//                           any other port is forwarded locally there.
//             'logs'     -> bounded tail of that port's launcher log.
//                           port is REQUIRED and must be an integer in
//                           [1, 65535] — it is interpolated into a filename.
//
// Security posture (lessons adopted, see testplace research):
//   - The link channel ALWAYS requires the fleet bearer — it exists solely
//     for peering, and an unconfigured token means the whole surface is off
//     (fail-closed, interconnect's rule).
//   - Upgrade failures end the socket manually: a hanging client plus an
//     escaping async rejection is exactly the 0.7.1 crash class.
//   - Every socket gets 'error' + 'close' listeners on attach.
//
// `ws` is injected (the dual-path loader in index.js), so this module stays
// unit-testable without the dependency present.

export const LINK_PATH = '/dsh-instance-manager/link'
const PING_INTERVAL_MS = 30000
const BACKOFF_INITIAL_MS = 1000
const BACKOFF_MAX_MS = 30000
const WS_OPEN = 1

/** Parse DSHIM_PEERS ("id@origin,id2@origin") into peer descriptors. */
export const parsePeers = (raw, cap = 16) => {
  const peers = []
  const seen = new Set()
  for (const part of String(raw || '').split(',')) {
    const m = /^\s*([A-Za-z0-9_-]{1,32})@(\S+)\s*$/.exec(part || '')
    if (!m) continue
    const id = m[1]
    let origin = m[2].replace(/\/+$/, '')
    if (!/^https?:\/\//.test(origin)) origin = 'http://' + origin
    if (seen.has(id)) continue
    seen.add(id)
    peers.push({ id, origin, wsUrl: origin.replace(/^http/, 'ws') + LINK_PATH })
    if (peers.length >= cap) break
  }
  return peers
}

// Answer one inbound peer query (the `query.kind` table at the top of this
// file). Split out of the host's apply() as a pure factory over injected
// closures for the same reason agent-tools.js is: `ws` is absent in unit
// tests, so a handler that only ever exists inside the async FleetLinks
// construction is unreachable there — and unreachable is exactly how the
// two F3 bugs shipped (`sessions` ignoring the requested port, `logs`
// interpolating it into a filename unvalidated).
//
// Both F3 kinds delegate to the SAME functions the local HTTP route and the
// agent tools use, so a peer cannot reach a code path the panel itself
// would refuse.
//
// `listLocalInstances` MUST be a peer-free lister. It is deliberately named
// for that: the host has two listers, and handing this one the peer-merging
// `listInstances` made a mutually-peered pair answer each other's `fleet`
// query forever (see the cycle guard in queryPeer — it breaks the loop at
// the transport, this contract removes it at the source).
export const createQueryResponder = ({ fleetId, version, listLocalInstances, sessionsFor, logsFor }) => async (q) => {
  if (!q || q.kind === 'ping') return { ok: true, fleetId: fleetId(), version }
  if (q.kind === 'fleet') {
    const local = await listLocalInstances()
    return {
      ok: true,
      fleetId: fleetId(),
      currentPort: local.currentPort,
      items: local.items.filter((i) => !i.remote)
    }
  }
  if (q.kind === 'sessions') return sessionsFor(q.port)
  if (q.kind === 'logs') return logsFor(q.port, q.stream)
  return { ok: false, code: 'unknown_query' }
}

/** One outbound peer link: dial, re-dial with exponential backoff after drops. */
class LinkState {
  constructor(id, wsUrl, fleet) {
    this.id = id
    this.wsUrl = wsUrl
    this.fleet = fleet
    this.socket = undefined
    this.backoffMs = BACKOFF_INITIAL_MS
    this.retryTimer = undefined
    this.closed = false
    this.dial()
  }

  isOpen() {
    return this.socket !== undefined && this.socket.readyState === WS_OPEN
  }

  dial() {
    if (this.closed) return
    this.fleet.resolveToken().then((token) => {
      if (this.closed) return
      if (!token) { this.scheduleRetry(); return } // no token, no dial
      let socket
      try {
        socket = new this.fleet.WebSocket(this.wsUrl, { headers: { authorization: 'Bearer ' + token } })
      } catch (e) { this.scheduleRetry(); return }
      this.socket = socket
      socket.on('open', () => {
        this.backoffMs = BACKOFF_INITIAL_MS
        this.fleet.sendTo(socket, { type: 'hello', sender: this.fleet.fleetId() })
      })
      socket.on('message', (data) => this.fleet.handleSocketFrame(this.id, socket, String(data)))
      // 'error' before 'close' is the 0.7.1 lesson: never let it escape.
      socket.on('error', () => { })
      socket.on('close', () => {
        if (this.socket === socket) this.socket = undefined
        this.scheduleRetry()
      })
    }).catch(() => this.scheduleRetry())
  }

  scheduleRetry() {
    if (this.closed || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      this.dial()
    }, this.backoffMs)
    // A pending reconnect must never hold the process open. The liveness ping
    // timer is unref'd for the same reason; this one would otherwise keep a
    // stopped fleet alive for up to BACKOFF_MAX_MS after everything else had
    // let go — long enough to outlive the graceful-exit backstop.
    if (this.retryTimer.unref) this.retryTimer.unref()
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS)
  }

  send(frame) {
    if (!this.isOpen()) return false
    try { this.socket.send(JSON.stringify(frame)); return true } catch (e) { return false }
  }

  dispose() {
    this.closed = true
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined }
    if (this.socket) { try { this.socket.close() } catch (e) { } this.socket = undefined }
  }
}

/**
 * The per-instance fleet link hub (dual-role, like interconnect's service):
 * inbound half answers peer queries; outbound half dials configured peers.
 * @param deps {{ WebSocket, WebSocketServer, safeTokenEqual,
 *                fleetId: () => string, resolveToken: () => Promise<string|undefined>,
 *                answerQuery: (query: object) => Promise<object>,
 *                log?: (...a: any[]) => void }}
 */
export class FleetLinks {
  constructor(deps, peers) {
    this.deps = deps
    this.peers = peers
    this.fleetId = deps.fleetId
    this.resolveToken = deps.resolveToken
    this.answerQuery = deps.answerQuery
    this.log = deps.log || (() => { })
    this.WebSocket = deps.WebSocket
    this.server = new deps.WebSocketServer({ noServer: true })
    this.inbound = new Set()
    this.links = new Map() // peerId -> LinkState
    this.pending = new Map() // reqId -> { resolve, timer }
    this.reqIdCounter = 0
    this.pingTimer = undefined
    // Depth of `fleet` queries this instance is CURRENTLY ANSWERING. See
    // queryPeer: while > 0 we refuse to issue one ourselves.
    this.answeringFleet = 0
    for (const p of peers) this.links.set(p.id, new LinkState(p.id, p.wsUrl, this))
  }

  /** WebUpgradeRoute handler: authenticate, then accept into the pool. */
  async handleUpgrade(req, socket, head) {
    let token
    try { token = await this.resolveToken() } catch (e) { token = undefined }
    if (!token) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 9\r\n\r\nforbidden')
      return
    }
    if (!this.deps.safeTokenEqual(String(req.headers.authorization || ''), 'Bearer ' + token)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 12\r\n\r\nunauthorized')
      return
    }
    this.server.handleUpgrade(req, socket, head, (websocket) => this.attachInbound(websocket))
  }

  attachInbound(websocket) {
    this.inbound.add(websocket)
    websocket.isAlive = true
    websocket.on('pong', () => { websocket.isAlive = true })
    websocket.on('message', (data) => this.handleSocketFrame(undefined, websocket, String(data)))
    // 0.7.1 lesson: async 'error' events on streams are process-fatal unhandled.
    websocket.on('error', () => { this.inbound.delete(websocket) })
    websocket.on('close', () => { this.inbound.delete(websocket) })
    this.sendTo(websocket, { type: 'hello', sender: this.fleetId() })
  }

  /**
   * Frames from ANY socket (server-accepted or client-dialed):
   *   hello          -> noted (per-socket attribution kept minimal in F2)
   *   query          -> answered locally, correlated by reqId
   *   query-result   -> settles OUR earlier outbound query
   */
  handleSocketFrame(peerId, websocket, text) {
    let frame
    try { frame = JSON.parse(text) } catch (e) { return }
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'hello') return
    if (frame.type === 'query-result' && frame.reqId) {
      const p = this.pending.get(frame.reqId)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(frame.reqId)
      p.resolve(frame.result)
      return
    }
    if (frame.type === 'query' && frame.reqId) {
      // Count the whole answer as "inside a fleet query", so any nested
      // outbound fleet query this answer triggers is refused (see queryPeer).
      const nested = !!(frame.query && frame.query.kind === 'fleet')
      if (nested) this.answeringFleet += 1
      const settle = (result) => {
        if (nested) this.answeringFleet -= 1
        this.sendTo(websocket, { type: 'query-result', reqId: frame.reqId, result })
      }
      Promise.resolve(this.answerQuery(frame.query || {})).then(settle).catch(() => {
        settle({ ok: false, code: 'internal' })
      })
    }
  }

  /** Correlated query to ONE configured peer over its outbound link. */
  queryPeer(peerId, query, timeoutMs = 3500) {
    // Cycle guard. Two instances that peer with each other used to answer
    // each other's `fleet` query forever: A asks B, B's answer re-lists ITS
    // whole fleet (which asks A), and so on — measured at 5000 nested
    // listings in 70 ms, every one of them a full 50-port sweep. Refusing to
    // issue a fleet query from inside the answer to one breaks the cycle at
    // the transport, independent of what the injected lister happens to do.
    if (query && query.kind === 'fleet' && this.answeringFleet > 0) {
      return Promise.resolve({ ok: false, code: 'fleet_query_nested' })
    }
    const link = this.links.get(peerId)
    if (!link) return Promise.resolve({ ok: false, code: 'unknown_peer' })
    const reqId = `q${++this.reqIdCounter}-${Date.now().toString(36)}`
    if (!link.send({ type: 'query', reqId, query })) {
      return Promise.resolve({ ok: false, code: 'unreachable' })
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        resolve({ ok: false, code: 'timeout' })
      }, timeoutMs)
      this.pending.set(reqId, { resolve, timer })
    })
  }

  sendTo(websocket, frame) {
    if (!websocket || websocket.readyState !== WS_OPEN) return false
    try { websocket.send(JSON.stringify(frame)); return true } catch (e) { return false }
  }

  startLiveness() {
    if (this.pingTimer) return
    this.pingTimer = setInterval(() => {
      for (const ws of this.inbound) {
        if (ws.isAlive === false) { ws.terminate(); this.inbound.delete(ws); continue }
        ws.isAlive = false
        try { ws.ping() } catch (e) { }
      }
    }, PING_INTERVAL_MS)
    if (this.pingTimer.unref) this.pingTimer.unref()
  }

  dispose() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = undefined
    for (const link of this.links.values()) link.dispose()
    this.links.clear()
    for (const ws of this.inbound) { try { ws.close() } catch (e) { } }
    this.inbound.clear()
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.resolve({ ok: false, code: 'disposed' })
    }
    this.pending.clear()
  }
}
