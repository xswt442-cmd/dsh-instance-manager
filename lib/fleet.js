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
// query.kind: 'ping'  -> {ok, fleetId, version}
//             'fleet' -> {ok, fleetId, currentPort, items[]}
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
      Promise.resolve(this.answerQuery(frame.query || {})).then((result) => {
        this.sendTo(websocket, { type: 'query-result', reqId: frame.reqId, result })
      }).catch(() => {
        this.sendTo(websocket, { type: 'query-result', reqId: frame.reqId, result: { ok: false, code: 'internal' } })
      })
    }
  }

  /** Correlated query to ONE configured peer over its outbound link. */
  queryPeer(peerId, query, timeoutMs = 3500) {
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
