// dsh-instance-manager 的 fleet 对端链路。
//
// 每个实例在 /dsh-instance-manager/link 上一条 WebSocket 通道。每条 socket 承担
// 双向职责：hello 通报身份，`query` 帧由本机就地应答，`query-result` 帧结算本机发出
// 的查询。
//
//   {type:'hello', sender}                     双向，连接建立时
//   {type:'query', reqId, query}               请求
//   {type:'query-result', reqId, result}       关联的应答
// query.kind: 'ping'     -> {ok, fleetId, version}
//             'fleet'    -> {ok, fleetId, currentPort, items[]}  （仅本机行）
//             'sessions' -> 该端口的会话摘要，在对端机器上按与该端
//                           action=sessions&port=<p> 路由相同的语义应答：省略端口或
//                           端口等于对端自己的端口表示“你自己”，其他端口在对端本地
//                           继续转发。
//             'logs'     -> 该端口启动器日志的有界尾部。port 必填，且必须是
//                           [1, 65535] 内的整数——它会被拼进文件名。
//
// 安全约束：
//   - 链路通道始终要求 fleet bearer：它只为对等互联存在，未配置 token 时整个面关闭
//     （失败关闭：没有 token 就没有通道）。
//   - 升级失败时手动结束 socket：挂起的客户端加上逃逸的异步拒绝会让进程退出。
//   - 每个 socket 在接入时都挂上 'error' 与 'close' 监听器。
//
// `ws` 由 index.js 的双路径加载器注入，因此本模块在没有该依赖时仍可做单元测试。

export const LINK_PATH = '/dsh-instance-manager/link'
const PING_INTERVAL_MS = 30000
const BACKOFF_INITIAL_MS = 1000
const BACKOFF_MAX_MS = 30000
const WS_OPEN = 1
// 对端接受了 TCP 却迟迟不完成 101 升级时，链路不能永远卡在 CONNECTING。
const HANDSHAKE_TIMEOUT_MS = 10 * 1000

// 每个对端能驱动本机的上限。两者都针对开销：应答一次 `fleet` 查询就是本机全端口
// 扫描，否则一个已认证的对端可以让每个实例整天在列实例。
//
// MAX_FRAME_BYTES 作为 maxPayload 交给 `ws`，覆盖任何帧，即使上限被放宽，也不会把
// 100 MiB 的文本帧交给 JSON.parse。QUERY_LIMIT 只统计 *query* 帧——hello 与对
// 本机自己发起的查询的应答不是本机替别人做的工作。
//
// 导出这些常量，单元测试才能在不等待真实时间窗口的情况下驱动边界。
export const MAX_FRAME_BYTES = 64 * 1024
export const QUERY_WINDOW_MS = 5000
export const QUERY_LIMIT = 40

/** 把 DSHIM_PEERS（"id@origin,id2@origin"）解析为对端描述。 */
export const parsePeers = (raw, cap = 16) => {
  const peers = []
  const seen = new Set()
  for (const part of String(raw || '').split(',')) {
    const m = /^\s*([A-Za-z0-9_-]{1,32})@(\S+)\s*$/.exec(part || '')
    if (!m) continue
    const id = m[1]
    // 对端用 fleet bearer 认证，凭证不放在 URL 里。带 userinfo 的地址直接拒绝：
    // 它会出现在 WebSocket URL 中，也会进入错误详情。先去掉 scheme，才能识别
    // `scheme://user:pass@host` 里的 userinfo。
    if (/^[^/]*@/.test(m[2].replace(/^https?:\/\//, ''))) continue
    let origin = m[2].replace(/\/+$/, '')
    if (!/^https?:\/\//.test(origin)) origin = 'http://' + origin
    if (seen.has(id)) continue
    seen.add(id)
    peers.push({ id, origin, wsUrl: origin.replace(/^http/, 'ws') + LINK_PATH })
    if (peers.length >= cap) break
  }
  return peers
}

// 应答一条入站对端查询（查询种类见文件开头）。拆成以注入闭包为参数的纯工厂，理由与
// agent-tools.js 相同：单元测试里没有 `ws`，只存在于 FleetLinks 异步构造内部的处理器
// 在测试中不可达，而不可达正是实现缺陷无法被发现的原因。
//
// 两类查询都委托给本地 HTTP 路由和 agent 工具使用的同一组函数，对端因此无法到达面板
// 自己会拒绝的代码路径。
//
// `listLocalInstances` 必须是不含对端的列表器，命名即为此：宿主有两个列表器，把合并
// 对端行的 `listInstances` 交给这里，会让互相 peer 的一对实例永远应答彼此的 `fleet`
// 查询（queryPeer 里的循环守卫在传输层断开它，这个约定从源头消除它）。
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

/** 一条出站对端链路：建立连接，断开后按指数退避重连。 */
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
      if (!token) { this.scheduleRetry(); return } // 没有 token 就不拨号
      let socket
      try {
        socket = new this.fleet.WebSocket(this.wsUrl, { headers: { authorization: 'Bearer ' + token } })
      } catch (e) { this.scheduleRetry(); return }
      this.socket = socket
      // 对端接受了 TCP 却迟迟不完成 101 升级时，链路会永远卡在 CONNECTING：
      // 'close' 不触发，退避循环不会重启，对端表现为永久不可达且没有任何痕迹。
      // 因此给握手设上限；超时后终止 socket，'close' 随之触发，重连循环恢复。
      const handshakeTimer = setTimeout(() => {
        if (this.socket === socket && socket.readyState !== WS_OPEN) {
          if (typeof socket.terminate === 'function') socket.terminate()
        }
      }, HANDSHAKE_TIMEOUT_MS)
      if (handshakeTimer.unref) handshakeTimer.unref()
      socket.on('open', () => {
        clearTimeout(handshakeTimer)
        this.backoffMs = BACKOFF_INITIAL_MS
        this.fleet.sendTo(socket, { type: 'hello', sender: this.fleet.fleetId() })
      })
      socket.on('message', (data) => this.fleet.handleSocketFrame(this.id, socket, String(data)))
      // 'error' 可能先于 'close' 到达，而流上的异步 'error' 没有监听器会让进程
      // 退出，因此始终消费它。
      socket.on('error', () => { })
      socket.on('close', () => {
        clearTimeout(handshakeTimer)
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
    // 未完成的重新连接不能拖住进程。存活性 ping 定时器同样 unref；否则一台已停止的
    // fleet 会在其他资源都释放后继续存活最多 BACKOFF_MAX_MS，长到足以越过优雅退出的
    // 兜底时限。
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
 * 每实例的 fleet 链路中枢（双向）：入站半边应答对端查询，出站半边连接配置的对端。
 * @param deps {{ WebSocket, WebSocketServer, safeTokenEqual,
 *                fleetId: () => string, resolveToken: () => Promise<string|undefined>,
 *                answerQuery: (query: object) => Promise<object> }}
 */
export class FleetLinks {
  constructor(deps, peers) {
    this.deps = deps
    this.peers = peers
    this.fleetId = deps.fleetId
    this.resolveToken = deps.resolveToken
    this.answerQuery = deps.answerQuery
    this.WebSocket = deps.WebSocket
    this.server = new deps.WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
    this.inbound = new Set()
    this.links = new Map() // peerId -> LinkState
    this.pending = new Map() // reqId -> { resolve, timer, socket }
    this.queryBudget = new WeakMap() // socket -> recent query timestamps
    this.reqIdCounter = 0
    this.pingTimer = undefined
    // 本实例当前正在应答的 `fleet` 查询深度。见 queryPeer：大于 0 时拒绝自己再发起
    // 一个。
    this.answeringFleet = 0
    for (const p of peers) this.links.set(p.id, new LinkState(p.id, p.wsUrl, this))
  }

  /** WebUpgradeRoute 处理器：先认证，再接入连接池。 */
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
    // 流上的异步 'error' 事件没有监听器会让进程退出。
    websocket.on('error', () => { this.inbound.delete(websocket) })
    websocket.on('close', () => { this.inbound.delete(websocket) })
    this.sendTo(websocket, { type: 'hello', sender: this.fleetId() })
  }

  /**
   * 处理任何 socket（服务端接入或客户端拨出）上的帧：
   *   hello          -> 忽略：链路身份来自配置的 peer id 与握手凭证
   *   query          -> 就地应答，按 reqId 关联
   *   query-result   -> 结算本机此前发出的查询
   */
  handleSocketFrame(peerId, websocket, text) {
    let frame
    try { frame = JSON.parse(text) } catch (e) { return }
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'hello') return
    if (frame.type === 'query-result' && frame.reqId) {
      const p = this.pending.get(frame.reqId)
      if (!p) return
      // 只有本机查询实际发出的那条 socket 能结算它。reqId 是计数器加时间戳
      // （`q1-<base36 now>`），若任何被接受的 socket 都能应答，已认证的对端猜中 id
      // 就能顶替别人的待决查询——绑定必须是连接本身。
      if (p.socket !== websocket) return
      clearTimeout(p.timer)
      this.pending.delete(frame.reqId)
      p.resolve(frame.result)
      return
    }
    if (frame.type === 'query' && frame.reqId) {
      if (!this.allowQuery(websocket)) {
        // 应答而不是丢弃：对端在等一个关联的回复，静默丢弃会让它一直等到自己的
        // 超时。
        this.sendTo(websocket, { type: 'query-result', reqId: frame.reqId, result: { ok: false, code: 'rate_limited' } })
        return
      }
      // 整个应答期间都计为“正在处理 fleet 查询”，因此该应答触发的嵌套出站 fleet
      // 查询会被拒绝（见 queryPeer）。
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

  /** 每条 socket 近期的 query 帧时间窗；额度用尽时返回 false。 */
  allowQuery(websocket) {
    const now = Date.now()
    const recent = (this.queryBudget.get(websocket) || []).filter((at) => now - at < QUERY_WINDOW_MS)
    if (recent.length >= QUERY_LIMIT) {
      this.queryBudget.set(websocket, recent)
      return false
    }
    recent.push(now)
    this.queryBudget.set(websocket, recent)
    return true
  }

  /** 向一个已配置的对端发出一条关联查询。 */
  queryPeer(peerId, query, timeoutMs = 3500) {
    // 循环守卫。互相 peer 的两个实例会永远应答彼此的 `fleet` 查询：A 问 B，B 的应答
    // 重新列出自己的整个 fleet（其中又去问 A），如此往复——一次面板刷新即可在
    // 70ms 内产生 5000 层嵌套列表，每一层都是全端口扫描。拒绝在应答 fleet 查询
    // 期间发起 fleet 查询，从传输层断开循环，与注入的列表器实现无关。
    if (query && query.kind === 'fleet' && this.answeringFleet > 0) {
      return Promise.resolve({ ok: false, code: 'fleet_query_nested' })
    }
    const link = this.links.get(peerId)
    if (!link) return Promise.resolve({ ok: false, code: 'unknown_peer' })
    const reqId = `q${++this.reqIdCounter}-${Date.now().toString(36)}`
    if (!link.send({ type: 'query', reqId, query })) {
      return Promise.resolve({ ok: false, code: 'unreachable' })
    }
    // 绑定到查询离开的那条 socket：只有它的 `query-result` 能结算（见
    // handleSocketFrame）。链路在应答到达前重连时，查询会超时，而不是接受替代连接
    // 上来的帧。
    const socket = link.socket
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        resolve({ ok: false, code: 'timeout' })
      }, timeoutMs)
      this.pending.set(reqId, { resolve, timer, socket })
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
