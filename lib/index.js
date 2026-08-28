// dsh-instance-manager host half.
//
// JSON endpoint on the webserver (all actions same-origin):
//
//   GET  /dsh-instance-manager/api?action=list
//   GET  /dsh-instance-manager/api?action=self
//   GET  /dsh-instance-manager/api?action=logs&port=<port>&stream=out|err
//   POST /dsh-instance-manager/api?action=start
//   POST /dsh-instance-manager/api?action=stop&port=<port>
//   POST /dsh-instance-manager/api?action=stop-all
//      /dsh-instance-manager/api?action=stop-self   (POST; GET tolerated for
//                                                     peers running <=0.4.1)
//
// The legacy /dsh-easy-port-manager/api path is also registered as an alias,
// answering identically, so peers still running the pre-rename <=0.4.1
// release can discover and stop this instance (see the register block below).
//
// Security model (README "安全模型"): every action runs through a guard that
// rejects browser-initiated cross-site traffic — Fetch Metadata
// (sec-fetch-site not same-origin/none), a foreign Origin, and a non-loopback
// Host header (also closes DNS rebinding). Mutating actions additionally
// require POST. Peer instances talk plain node:http and carry none of the
// browser headers, so host-to-host forwarding keeps working across versions.
//
// Instance discovery is registry-first: every mounted instance heartbeats
// $DSH_HOME/run/instances/<port>.json, and `action=list` trusts fresh
// entries after a cheap action=self re-confirmation, sweeping only the ports
// no heartbeat covers (legacy peers, unmanaged dsh builds, non-dsh
// listeners). Stopping a remote instance forwards `stop-self` so the TARGET
// exits through the harness's graceful `appExit` shutdown (sessions flushed).
// Starting a new instance spawns one detached, hidden-background node child
// (windowsHide) writing logs under $DSH_HOME/launcher/logs. Nothing here
// flashes console windows, independent of the mounted shell executor.
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  VERSION,
  createGuard,
  resolveDshBin,
  resolveDshHome,
  registryDir,
  isValidRegistryEntry,
  firstNonNull,
  tailFile,
  unionPorts,
  summarizeSessions,
  diffManagedPorts,
  parsePortRange,
  safeTokenEqual,
  isLoopbackName,
  hostHostname
} from './shared.js'
import { parsePeers, FleetLinks, LINK_PATH } from './fleet.js'
import { buildAgentTools } from './agent-tools.js'

export default {
  // Hard dependency: loader entries mount concurrently, so the webserver
  // service may not be provided yet when apply runs. Cordis waits for it.
  inject: ['webServer'],
  apply(ctx) {
    const ws = ctx.webServer
    if (ws === undefined) return

    const startedAt = Date.now()

    const currentPort = () => {
      const server = ctx.get('webServer')
      return server ? server.port : undefined
    }

    // Same precedence as @deepseek-ai/dsh-home-paths, so a configured home is
    // used even before the harness has created it (see shared.resolveDshHome).
    const dshHome = () => resolveDshHome(process.env)

    // The host process itself is node — spawning children with its own
    // executable needs no machine-specific install paths at all.
    const findNode = () => process.execPath

    const dshBin = () => resolveDshBin({
      argv1: process.argv[1] || '',
      home: dshHome(),
      exists: (file) => fs.existsSync(file)
    })

    const activeSessionCount = () => {
      try {
        const sessions = ctx.get('sessions')
        return sessions ? sessions.list().length : null
      } catch (e) {
        return null
      }
    }

    // Stable cross-restart identity for the fleet protocol (F2 links address
    // peers by it). Generated once per DSH_HOME, persisted next to run/.
    let fleetIdCache
    const fleetId = () => {
      if (fleetIdCache) return fleetIdCache
      const file = path.join(dshHome(), 'fleet-id')
      try {
        const existing = fs.readFileSync(file, 'utf8').trim()
        if (existing) { fleetIdCache = existing; return fleetIdCache }
      } catch (e) { }
      try {
        fleetIdCache = crypto.randomUUID()
        fs.mkdirSync(dshHome(), { recursive: true })
        fs.writeFileSync(file, fleetIdCache + '\n')
      } catch (e) {
        // Read-only home: degrade to a per-process identity rather than fail.
        fleetIdCache = 'dim-' + process.pid.toString(36) + '-' + Date.now().toString(36)
      }
      return fleetIdCache
    }

    // ---- F1 fleet trust boundary ------------------------------------------
    // The token is addressed by the NAME of an environment variable
    // (DSHIM_FLEET_TOKEN_REF, default DSHIM_FLEET_TOKEN) and resolved through
    // the credentials service when mounted — settings carry the reference,
    // providers own the value, and resolution happens PER REQUEST so rotated
    // tokens take effect without restarts (the dsh-credentials contract says
    // consumers must not cache across operations). No resolvable token
    // anywhere = the entire remote surface fails closed.
    let credentialRefFn
    const resolveFleetToken = async () => {
      const refName = process.env.DSHIM_FLEET_TOKEN_REF || 'DSHIM_FLEET_TOKEN'
      try {
        const creds = ctx.get('credentials')
        if (creds && typeof creds.resolve === 'function') {
          if (!credentialRefFn) {
            try { credentialRefFn = (await import('@deepseek-ai/dsh-credentials')).credentialRef } catch (e) { }
          }
          if (credentialRefFn) {
            const r = await creds.resolve(credentialRefFn(refName))
            if (r && typeof r.value === 'string' && r.value.length > 0) return r.value
          }
        }
      } catch (e) { /* fall through to the plain env read */ }
      const direct = process.env[refName]
      return direct && direct.length > 0 ? direct : undefined
    }
    // Per-request bearer verification for NON-loopback dispatch. Loopback
    // traffic never reaches this (and never needs a token).
    const authorizeRemote = async (req) => {
      const expected = await resolveFleetToken()
      if (!expected) return false
      return safeTokenEqual(String(req.headers.authorization || ''), 'Bearer ' + expected)
    }

    const sendJson = (res, code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(obj))
    }

    // ---- crash black-box ---------------------------------------------------
    // A local server dying with zero diagnostics is unforgivable. When stderr
    // lands in a rotated file nobody reads (or the process was started by a
    // peer's spawn), node's default fatal paths vanish silently. Append every
    // fatal path to ONE shared breadcrumb log FIRST. Instances share the file;
    // pid+port disambiguate. Never swallow: if this plugin is not the cause,
    // the evidence still says exactly who is.
    //
    // Then HAND THE EXIT BACK. The harness installs its own unhandledRejection
    // handler (installFailLoud) before any plugin mounts, and that handler
    // awaits a release — disposing the tree, flushing sessions, restoring the
    // terminal — under a 2s cap before exiting. Node calls listeners in
    // registration order, so an unconditional process.exit() here ran second
    // and cut that release short, discarding the very graceful teardown this
    // plugin asks for elsewhere in the same file. Owning the exit only when no
    // other listener exists keeps a bare launch failing fast while letting the
    // harness own the death it already knows how to die.
    const crashLog = (kind, detail) => {
      try {
        const dir = path.join(dshHome(), 'launcher', 'logs')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.appendFileSync(path.join(dir, 'dshim-crash.log'),
          '[' + new Date().toISOString() + '] ' + kind + ' pid=' + process.pid +
          ' port=' + currentPort() + '\n' + String(detail || '') + '\n')
      } catch (e) { /* never recurse out of the black box */ }
    }
    const ownsFatalExit = (event) => process.listenerCount(event) <= 1
    const onUncaught = (err) => {
      crashLog('uncaughtException', err && err.stack ? err.stack : String(err))
      if (ownsFatalExit('uncaughtException')) process.exit(1)
    }
    const onRejection = (reason) => {
      crashLog('unhandledRejection', reason && reason.stack ? reason.stack : String(reason))
      if (ownsFatalExit('unhandledRejection')) process.exit(1)
    }
    process.on('uncaughtException', onUncaught)
    process.on('unhandledRejection', onRejection)

    // ---- request guards (see README "安全模型") -------------------------
    // Strict instance: SSE/events only — EventSource cannot send headers, so
    // that surface stays loopback-only even in remote mode.
    const guard = createGuard({ currentPort, respond: sendJson })
    // Fleet instance: tolerates a non-loopback Host so the API handler can
    // enforce the bearer gate itself (F1 dual-mode; see createGuard docs).
    const fleetGuard = createGuard({ currentPort, respond: sendJson, allowRemoteHost: () => true })
    // Mutating actions are POST-only. stop-self stays reachable via GET so an
    // older peer (<=0.4.1, which forwards stop over node:http GET) can still
    // shut this instance down during a mixed-version window.
    const requirePost = (req, res, action) => {
      if (req.method === 'POST') return true
      sendJson(res, 405, { ok: false, code: 'need_post', action, error: action + ' 需要 POST 请求' })
      return false
    }

    // JSON request against another local instance. Resolves null on any
    // failure (closed port, non-JSON response, timeout). `method` lets the
    // forwarding path speak POST to peers whose guards demand it; `basePath`
    // targets pre-rename peers still serving /dsh-easy-port-manager/api.
    const fetchJson = (port, query, timeoutMs, method, basePath) => new Promise((resolve) => {
      let settled = false
      const done = (v) => { if (!settled) { settled = true; resolve(v) } }
      const req = http.get({ host: '127.0.0.1', port, path: (basePath || '/dsh-instance-manager/api') + '?' + query, timeout: timeoutMs, method: method || 'GET' }, (res) => {
        let body = ''
        res.on('data', (d) => {
          body += d
          if (body.length > 65536) req.destroy()
        })
        res.on('end', () => {
          try { done(JSON.parse(body)) } catch (e) { done(null) }
        })
        res.on('error', () => done(null))
      })
      req.on('timeout', () => { req.destroy(); done(null) })
      req.on('error', () => done(null))
    })

    // Raw body probe for ports that do not answer the manager API (legacy or
    // non-dsh listeners). Resolves '' when nothing answers.
    const probeBody = (port) => new Promise((resolve) => {
      let settled = false
      const done = (v) => { if (!settled) { settled = true; resolve(v) } }
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
        let body = ''
        res.on('data', (d) => {
          body += d
          if (body.length > 16384) req.destroy()
        })
        res.on('end', () => done(body))
        res.on('error', () => done(''))
      })
      req.on('timeout', () => { req.destroy(); done('') })
      req.on('error', () => done(''))
    })

    // ---- file-based instance registry ------------------------------------
    // Best-effort by design: readers fall back to the port sweep whenever a
    // heartbeat is missing, stale, or unreadable.
    const HEARTBEAT_MS = 10000
    const registryFile = () => {
      const port = currentPort()
      return port ? path.join(registryDir(dshHome()), port + '.json') : null
    }
    const writeHeartbeat = () => {
      const file = registryFile()
      if (!file) return
      try {
        const dir = registryDir(dshHome())
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(file, JSON.stringify({
          pid: process.pid,
          port: currentPort(),
          startedAt,
          version: VERSION,
          sessions: activeSessionCount(),
          rss: process.memoryUsage().rss,
          ts: Date.now()
        }))
      } catch (e) { /* sweep still covers discovery */ }
    }
    const removeHeartbeat = () => {
      const file = registryFile()
      if (!file) return
      try { fs.rmSync(file, { force: true }) } catch (e) { }
    }
    writeHeartbeat()
    const heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_MS)
    if (heartbeatTimer.unref) heartbeatTimer.unref()

    const scheduleSelfExit = () => {
      const fire = () => {
        const exit = ctx.get('appExit')
        if (exit) {
          // Graceful: dispose the whole tree (sessions flushed, and this
          // plugin's disposer removes our registry file). The harness
          // shutdown only sets process.exitCode afterwards and relies on the
          // event loop draining — a lingering handle can hold the process
          // alive forever, so force-exit as a backstop.
          exit(0)
          const t2 = ctx.get('timer')
          const hard = () => process.exit(0)
          if (t2) t2.timeout(hard, 3000)
          else setTimeout(hard, 3000)
        } else {
          removeHeartbeat()
          process.exit(0)
        }
      }
      const t = ctx.get('timer')
      if (t) t.timeout(fire, 300)
      else fire()
    }

    const tryConnect = (port, timeoutMs) => new Promise((resolve) => {
      const socket = new net.Socket()
      let settled = false
      const done = (v) => { if (!settled) { settled = true; socket.destroy(); resolve(v) } }
      socket.setTimeout(timeoutMs)
      socket.once('connect', () => done(true))
      socket.once('timeout', () => done(false))
      socket.once('error', () => done(false))
      socket.connect(port, '127.0.0.1')
    })

    // Where START may spawn. The 3080-3129 band mirrors dsh's documented
    // convention, but nothing in the runtime hard-codes it (the webserver
    // takes its port from composition config and even accepts 0 = OS-
    // assigned) — so the range is overridable per deployment via
    // DSHIM_PORT_RANGE="min-max", while DISCOVERY stays heartbeat-driven and
    // picks up ports far outside any range.
    const PORT_RANGE = parsePortRange(process.env.DSHIM_PORT_RANGE)

    const findFreePort = async () => {
      for (let p = PORT_RANGE.min; p <= PORT_RANGE.max; p++) {
        if (!(await tryConnect(p, 600))) return p
      }
      return 0
    }

    const startInstance = () => {
      const node = findNode()
      const bin = dshBin()
      if (!node) return { ok: false, code: 'no_node', error: '未找到 node 可执行文件' }
      if (!bin) {
        const detail = path.join(dshHome(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        return { ok: false, code: 'no_dsh_bin', detail, error: '未找到 dsh 启动器：' + detail }
      }
      return { ok: true, node, bin }
    }

    // ---- shared operation surfaces (HTTP panel + agent tools) ------------
    // Spawn one detached hidden-background server child and HOLD until it
    // answers action=self: the caller learns the real pid and sees failures
    // instead of a silent no-op. An early exit (lost the scan/bind race)
    // costs exactly one retry on the next free port; a merely slow boot is
    // reported start_unconfirmed and left alone — never double-spawned.
    //
    // The window is generous on purpose: a FIRST sibling-instance boot does
    // one-time heavy work (session-log backfills in profile plugins easily
    // run past ten seconds), and reporting that as a failure is exactly the
    // "start crashed, retry works" trap. Children spawn with --no-open: the
    // panel already shows state; a half-booted auto-opened tab reads as a
    // crash to nobody's benefit.
    const START_CONFIRM_MS = 25000
    const launchOnce = async () => {
      const port = await findFreePort()
      if (!port) return { ok: false, code: 'no_free_port', error: PORT_RANGE.min + '–' + PORT_RANGE.max + ' 端口全部被占用' }
      const picked = startInstance()
      if (!picked.ok) return { ok: false, code: picked.code, detail: picked.detail, error: picked.error }
      const logDir = path.join(dshHome(), 'launcher', 'logs')
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
      const out = fs.openSync(path.join(logDir, 'server-' + port + '.out.log'), 'a')
      const errF = fs.openSync(path.join(logDir, 'server-' + port + '.err.log'), 'a')
      // Diagnostic node flags on every panel-spawned child: --trace-exit
      // prints a stack for ANY process.exit() (the silent-death hypothesis),
      // --report-uncaught-exception drops a full diagnostic report beside
      // the crash black-box, and strict rejections make the default explicit.
      // NOTE: the flag is --report-uncaught-exception (no "on"); the legacy
      // --report-on-uncaught-exception is a "bad option" on Node >= 20 and
      // makes the child die instantly with code 9.
      const child = spawn(picked.node,
        ['--trace-exit', '--unhandled-rejections=strict', '--report-uncaught-exception', picked.bin, 'web', '--no-open', '--port', String(port)], {
        cwd: dshHome(),
        detached: true,
        stdio: ['ignore', out, errF],
        windowsHide: true
      })
      child.unref()
      fs.closeSync(out)
      fs.closeSync(errF)
      const pid = child.pid
      const exited = new Promise((resolve) => child.once('exit', (code) => resolve({ died: true, code })))
      const readyOrSlow = (async () => {
        const deadline = Date.now() + START_CONFIRM_MS
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 500))
          const self = await fetchJson(port, 'action=self', 1500)
          if (self && typeof self.pid === 'number') return { ready: true }
        }
        return {}
      })()
      const verdict = await Promise.race([exited, readyOrSlow])
      if (verdict && verdict.ready) return { ok: true, port, pid }
      if (verdict && verdict.died) {
        // Breadcrumb for post-mortem: the child's own stderr was empty, so
        // record WHO noticed the death and with what exit code.
        try {
          fs.appendFileSync(path.join(logDir, 'server-' + port + '.out.log'),
            '[dsh-instance-manager] child exited during confirm window (code ' + verdict.code + ')\n')
        } catch (e) { }
        return { ok: false, code: 'start_failed', port, error: '新实例进程已退出（端口可能被抢占或启动失败）' }
      }
      return { ok: false, code: 'start_unconfirmed', port, pid, error: '实例仍在启动中、未能在窗口内应答，请稍后刷新列表确认' }
    }
    const startWithRetry = async () => {
      let r = await launchOnce()
      if (!r.ok && r.code === 'start_failed') {
        // One retry on the next free port — the usual cause is having lost
        // the scan/bind race for the first pick.
        const second = await launchOnce()
        if (second.ok) r = second
        else r = { ok: false, code: second.code, port: second.port !== undefined ? second.port : null, pid: second.pid, error: r.error + '；自动换口重试仍失败' }
      }
      return r
    }

    // Remote half of `stop`: POST stop-self with the pre-rename GET path as
    // a <=0.4.0 fallback. Self-stops stay caller-specific (the HTTP action
    // schedules appExit; the agent tool refuses).
    const forwardStopRemote = async (port) => {
      let r = await fetchJson(port, 'action=stop-self', 8000, 'POST')
      if (!(r && r.ok)) r = await fetchJson(port, 'action=stop-self', 8000, 'GET', LEGACY_BASE)
      return r
    }

    // Bounded tail of one port's shared launcher log (panel + agent tool).
    const readLogsFor = (port, stream) => {
      try {
        return tailFile(path.join(dshHome(), 'launcher', 'logs', 'server-' + port + '.' + stream + '.log'))
      } catch (e) {
        return { exists: false, truncated: false, lines: [] }
      }
    }

    // ---- cross-instance session summaries ---------------------------------
    // Scalar-only projection of THIS instance's live sessions (see
    // shared.summarizeSessions — never serialize live store objects whole).
    // Peers reach it via action=sessions&port=<p>, mirroring the stop-self
    // forwarding shape.
    const describeSessions = () => {
      let list = []
      try {
        const store = ctx.get('sessions')
        list = store ? store.list() : []
      } catch (e) { list = [] }
      return {
        ok: true,
        port: currentPort(),
        total: Array.isArray(list) ? list.length : 0,
        sessions: summarizeSessions(list)
      }
    }
    // Self or forwarded: the panel drawer and the agent tool share one path.
    // Sessions exist only on the canonical route — no legacy fallback here;
    // pre-0.7 peers simply report sessions_unavailable.
    const sessionsFor = async (port) => {
      if (!port || port === currentPort()) return describeSessions()
      const r = await fetchJson(port, 'action=sessions', 5000)
      if (r && r.ok) return Object.assign({}, r, { port })
      return { ok: false, code: 'sessions_unavailable', error: '目标实例未提供会话概要（旧版面板或不可达）' }
    }

    const LEGACY_BASE = '/dsh-easy-port-manager/api'

    // Fresh heartbeat claims under $DSH_HOME/run/instances. Torn writes and
    // junk files fail validation and are ignored — the sweep re-covers them.
    const readFreshRegistry = () => {
      const dir = registryDir(dshHome())
      let names
      try { names = fs.readdirSync(dir) } catch (e) { return [] }
      const now = Date.now()
      const entries = []
      for (const name of names) {
        if (!/^\d+\.json$/.test(name)) continue
        try {
          const entry = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
          if (isValidRegistryEntry(entry, now)) entries.push(entry)
        } catch (e) { }
      }
      return entries
    }

    // Trust-but-verify: a registry claim becomes a row only after the target
    // answers action=self on the CURRENT route (a fresh entry promises ≥ this
    // version, so the pre-rename fallback never applies here).
    const verifyRegistryEntry = async (entry) => {
      const self = await fetchJson(entry.port, 'action=self', 1500)
      if (self && typeof self.pid === 'number' && typeof self.port === 'number') return self
      return null
    }

    const describeSelf = (self, port, selfPort) => ({
      port,
      pid: self.pid,
      // Real executable basename — 'node.exe' hardcoded here read wrong on
      // Linux/macOS ('node').
      name: path.basename(process.execPath),
      ui: true,
      managed: true,
      current: port === selfPort,
      startedAt: typeof self.startedAt === 'number' ? self.startedAt : null,
      sessions: typeof self.sessions === 'number' ? self.sessions : null,
      rss: typeof self.rss === 'number' ? self.rss : null,
      version: typeof self.version === 'string' ? self.version : null,
      url: 'http://127.0.0.1:' + port + '/'
    })

    const listInstances = async () => {
      const selfPort = currentPort()
      // Registry-first: each fresh heartbeat covers its port without any
      // blind probing; uncovered ports go through full discovery below.
      // Heartbeats known for ports OUTSIDE the fixed sweep (an instance
      // hand-started with --port 4000) join the sweep instead of being
      // dropped — the registry validates 1-65535 for exactly this reason.
      const covered = new Map(readFreshRegistry().map((e) => [e.port, e]))
      const ports = unionPorts(PORT_RANGE.min, PORT_RANGE.max, covered.keys())
      const results = await Promise.all(ports.map(async (port) => {
        if (covered.has(port)) {
          const verified = await verifyRegistryEntry(covered.get(port))
          if (verified) return describeSelf(verified, port, selfPort)
          // Stale lie (hard-killed between beats): fall through to probing.
        }
        // Current and pre-rename self-report routes race concurrently — the
        // serial fallback used to cost two full timeouts per live port that
        // answers neither.
        const self = await firstNonNull([
          () => fetchJson(port, 'action=self', 2500),
          () => fetchJson(port, 'action=self', 2500, 'GET', LEGACY_BASE)
        ])
        if (self && typeof self.pid === 'number' && typeof self.port === 'number') {
          return describeSelf(self, port, selfPort)
        }
        const body = await probeBody(port)
        // Every dsh web index page carries the injected boot manifest — a far
        // more stable marker than the visible brand string, which is kept as
        // a fallback for very old builds.
        if (body.indexOf('__DSH_BOOT__') !== -1 || body.indexOf('DeepSeek Harness') !== -1) {
          return {
            port,
            pid: null,
            name: '',
            ui: true,
            managed: false,
            current: false,
            url: 'http://127.0.0.1:' + port + '/'
          }
        }
        if (body.length > 0) {
          return {
            port,
            pid: null,
            name: '',
            ui: false,
            managed: false,
            current: false,
            url: 'http://127.0.0.1:' + port + '/'
          }
        }
        return null
      }))
      const items = results.filter(Boolean).sort((a, b) => a.port - b.port)
      // F2: merge peer fleets (cached >= 2 s; per-peer 3.5 s budget). Remote
      // rows keep their own port for display but are stamped with the peer id
      // and rewritten to peer-origin URLs; control actions stay local-only
      // until F4.
      const peerFleets = await collectPeerFleets()
      return {
        items: items.concat(peerFleets.rows),
        currentPort: selfPort,
        selfVersion: VERSION,
        peers: peerFleets.status,
        error: null
      }
    }

    // ---- fleet peer links (remote-fleet F2) --------------------------------
    // Peers are explicit: DSHIM_PEERS="id@origin,id2@origin". The link
    // channel (/dsh-instance-manager/link) always requires the fleet bearer
    // — fail-closed when no token is configured — and `ws` resolves through
    // the same dual-path loader as dsh-tools (package first, then the running
    // dsh checkout's own dependency tree).
    const peers = parsePeers(process.env.DSHIM_PEERS)
    let wsLib
    const resolveWsLib = async () => {
      if (wsLib) return wsLib
      try {
        const m = await import('ws')
        wsLib = m.WebSocketServer ? m : (m.default || null)
        if (wsLib) return wsLib
      } catch (e) { }
      const bin = dshBin()
      if (bin) {
        try {
          wsLib = createRequire(bin)('ws')
          if (wsLib && !wsLib.WebSocketServer && wsLib.default) wsLib = wsLib.default
        } catch (e) { }
      }
      return wsLib
    }
    // Disposal races the async `ws` load below: the module can resolve AFTER
    // this plugin was torn down (a fast shutdown, or an instance stopping
    // before the import settles), and a hub created in that window would
    // outlive the plugin with nobody left to dispose it.
    let fleet = null
    let fleetDisposed = false
    const peerCache = { ts: 0, rows: [], status: {} }
    const collectPeerFleets = async () => {
      if (!peers.length) return { rows: [], status: {} }
      if (Date.now() - peerCache.ts < 2000) return peerCache
      if (!fleet) return { rows: [], status: Object.fromEntries(peers.map((p) => [p.id, 'offline'])) }
      const settled = await Promise.allSettled(peers.map((p) =>
        fleet.queryPeer(p.id, { kind: 'fleet' }, 3500).then((r) => ({ p, r }))))
      const rows = []
      const status = {}
      for (const s of settled) {
        if (!s || s.status !== 'fulfilled') continue
        const { p, r } = s.value
        if (r && r.ok && Array.isArray(r.items)) {
          status[p.id] = 'online'
          let host = p.origin
          try { host = new URL(p.origin).host } catch (e) { }
          for (const it of r.items) {
            rows.push({
              port: it.port,
              managed: it.managed !== false,
              current: false,
              url: 'http://' + host + ':' + it.port + '/',
              source: p.id,
              remote: true,
              version: typeof it.version === 'string' ? it.version : undefined,
              sessions: typeof it.sessions === 'number' ? it.sessions : undefined,
              rss: typeof it.rss === 'number' ? it.rss : undefined,
              startedAt: typeof it.startedAt === 'number' ? it.startedAt : undefined,
              pid: typeof it.pid === 'number' ? it.pid : undefined
            })
          }
        } else {
          status[p.id] = (r && r.code) || 'unreachable'
        }
      }
      peerCache.ts = Date.now()
      peerCache.rows = rows
      peerCache.status = status
      return peerCache
    }
    const fleetUpgrade = {
      path: LINK_PATH,
      handler: (req, socket, head) => {
        if (!fleet) {
          try { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 9\r\n\r\nforbidden') } catch (e) { }
          return
        }
        fleet.handleUpgrade(req, socket, head).catch(() => {
          try { socket.end() } catch (e) { }
        })
      }
    }
    resolveWsLib().then((WS) => {
      if (!WS) {
        if (peers.length) console.error('dsh-instance-manager: ws module unavailable — fleet peering disabled')
        return
      }
      if (fleetDisposed) return
      fleet = new FleetLinks({
        WebSocket: WS.WebSocket ? WS.WebSocket : WS,
        WebSocketServer: WS.WebSocketServer,
        safeTokenEqual,
        fleetId,
        resolveFleetToken,
        answerQuery: async (q) => {
          if (!q || q.kind === 'ping') return { ok: true, fleetId: fleetId(), version: VERSION }
          if (q.kind === 'fleet') {
            const local = await listInstances()
            return { ok: true, fleetId: fleetId(), currentPort: local.currentPort, items: local.items.filter((i) => !i.remote) }
          }
          return { ok: false, code: 'unknown_query' }
        }
      }, peers)
      fleet.startLiveness()
    }).catch(() => { })

    // ---- fleet up/down push (SSE) -----------------------------------------
    // One lazy diff-ticker per process regardless of subscriber count: every
    // FLEET_TICK_MS it re-lists the fleet and broadcasts managed-port joins
    // and leaves to all text/event-stream subscribers. Subscribers get a
    // baseline frame on connect (seeded WITHOUT toasting client-side); idle
    // ticks cost nothing on the wire — the tick itself is registry-first.
    const FLEET_TICK_MS = 10000
    const sseClients = new Set()
    let fleetTimer = null
    let prevManaged = null
    const broadcastFleet = (obj) => {
      const frame = 'event: fleet\ndata: ' + JSON.stringify(obj) + '\n\n'
      for (const res of sseClients) {
        if (res.destroyed || res.writableEnded) { sseClients.delete(res); continue }
        try { res.write(frame) } catch (e) { sseClients.delete(res) }
      }
    }
    const fleetTick = async () => {
      try {
        const { items } = await listInstances()
        // Local ports only: remote rows share the number space of OTHER
        // machines, and their flapping would spam toasts (peer up/down gets
        // its own notification path in F3).
        const next = new Set(items.filter((i) => i.managed && !i.remote).map((i) => i.port))
        if (prevManaged === null) { prevManaged = next; return }
        const diff = diffManagedPorts(prevManaged, next)
        prevManaged = next
        if (diff.added.length || diff.removed.length) broadcastFleet(diff)
      } catch (e) { /* transient sweep failure keeps the last baseline */ }
    }
    const ensureFleetTicker = () => {
      if (fleetTimer !== null || sseClients.size === 0) return
      fleetTimer = setInterval(fleetTick, FLEET_TICK_MS)
      if (fleetTimer.unref) fleetTimer.unref()
    }
    const stopFleetTickerIfIdle = () => {
      if (fleetTimer !== null && sseClients.size === 0) {
        clearInterval(fleetTimer)
        fleetTimer = null
        prevManaged = null
      }
    }

    // Canonical route for this package, plus a legacy alias at the old
    // dsh-easy-port-manager path so <=0.4.x peers can still discover (self)
    // and stop (stop-self) this instance during a mixed-version window.
    // Remove the alias once the fleet-wide version badge shows no drift.
    const apiRoute = {
      kind: 'exact',
      path: '/dsh-instance-manager/api',
      handler: async (req, res) => {
        try {
          if (!fleetGuard(req, res)) return
          // Dual-mode gate: non-loopback dispatch requires the fleet bearer.
          // Unconfigured token = fail closed (interconnect's rule).
          if (!isLoopbackName(hostHostname(req.headers.host || ''))) {
            if (!(await authorizeRemote(req))) {
              sendJson(res, 403, { ok: false, code: 'fleet_auth', error: 'remote access requires a valid fleet token' })
              return
            }
          }
          const u = new URL(req.url || '/', 'http://x')
          const action = u.searchParams.get('action') || 'list'
          if (action === 'self') {
            sendJson(res, 200, {
              pid: process.pid,
              port: currentPort(),
              startedAt,
              sessions: activeSessionCount(),
              rss: process.memoryUsage().rss,
              version: VERSION,
              fleetId: fleetId()
            })
            return
          }
          if (action === 'list') {
            sendJson(res, 200, await listInstances())
            return
          }
          if (action === 'logs') {
            // Launcher logs live in the SHARED $DSH_HOME/launcher/logs dir,
            // so any local instance can read them without peer forwarding.
            // The port only ever becomes part of a fixed filename pattern —
            // no path-traversal surface.
            const port = Number(u.searchParams.get('port') || 0)
            if (!(port >= 1 && port <= 65535)) {
              sendJson(res, 400, { ok: false, code: 'no_port', error: 'invalid port' })
              return
            }
            const stream = u.searchParams.get('stream') === 'err' ? 'err' : 'out'
            sendJson(res, 200, Object.assign({ ok: true, port, stream }, readLogsFor(port, stream)))
            return
          }
          if (action === 'sessions') {
            const qp = Number(u.searchParams.get('port') || 0)
            if (qp && !(qp >= 1 && qp <= 65535)) {
              sendJson(res, 400, { ok: false, code: 'no_port', error: 'invalid port' })
              return
            }
            sendJson(res, 200, await sessionsFor(qp))
            return
          }
          if (action === 'start') {
            if (!requirePost(req, res, 'start')) return
            // Shared surface with the agent tool: spawn detached + hold until
            // the fresh child answers action=self (pid included), retry once
            // on a lost port race, never double-spawn a slow boot.
            sendJson(res, 200, await startWithRetry())
            return
          }
          if (action === 'stop') {
            if (!requirePost(req, res, 'stop')) return
            const port = Number(u.searchParams.get('port') || 0)
            if (port === currentPort()) {
              scheduleSelfExit()
              sendJson(res, 200, { ok: true, note: 'stopping this instance' })
              return
            }
            if (!port) {
              sendJson(res, 400, { ok: false, code: 'no_port', error: 'no port' })
              return
            }
            // Forward as POST: peers on this version reject GET mutations.
            // Legacy GET fallback covers <=0.4.0 peers; 8s per attempt lets a
            // freshly launched target finish initializing.
            const r = await forwardStopRemote(port)
            if (r && r.ok) {
              sendJson(res, 200, { ok: true })
              return
            }
            sendJson(res, 200, { ok: false, code: 'stop_unconfirmed', error: '目标实例没有确认停止（未挂载本管理面板或不可达）' })
            return
          }
          if (action === 'stop-all') {
            if (!requirePost(req, res, 'stop-all')) return
            const { items } = await listInstances()
            // stop-all is LOCAL-only by construction: remote rows carry other
            // machines' port numbers, and forwarding stop-self by number would
            // hit whatever happens to listen on that port HERE.
            const targets = items.filter((i) => i.managed && !i.remote && i.port !== currentPort())
            const acked = []
            await Promise.allSettled(targets.map(async (t) => {
              let r = await fetchJson(t.port, 'action=stop-self', 8000, 'POST')
              if (!(r && r.ok)) r = await fetchJson(t.port, 'action=stop-self', 8000, 'GET', LEGACY_BASE)
              if (r && r.ok) acked.push(t.port)
            }))
            const skippedUnmanaged = items.filter((i) => !i.managed).length
            scheduleSelfExit()
            sendJson(res, 200, {
              ok: true,
              stoppedRemote: acked.length,
              stoppedSelf: true,
              skippedUnmanaged
            })
            return
          }
          if (action === 'stop-self') {
            scheduleSelfExit()
            sendJson(res, 200, { ok: true })
            return
          }
          sendJson(res, 400, { ok: false, code: 'unknown_action', error: 'unknown action' })
        } catch (err) {
          console.error('dsh-instance-manager: api error', err && err.message ? err.message : err)
          sendJson(res, 500, { ok: false, code: 'internal', error: String(err && err.message ? err.message : err) })
        }
      }
    }
    // ---- agent tools -------------------------------------------------------
    // Expose the same operations to the in-session agent through the harness
    // `tools` service. @deepseek-ai/dsh-tools resolves from THIS package
    // first and, failing that, from the RUNNING dsh checkout's own dependency
    // tree (createRequire against the resolved bin) — so the tools light up
    // wherever dsh ships them, and degrade silently (panel unaffected) where
    // neither path exists.
    //
    // The service itself is OPTIONAL and read PER USE, never once at apply:
    // loader rows activate on service availability, not on row order, so a
    // single ctx.get('tools') here lost the race whenever the tools service
    // mounted after this row — silently, with no panel error. Declaring it in
    // `inject` is not an option either: a composition without a tools service
    // would park this row in PENDING, which the host boot audit counts as a
    // failure, taking the panel down with it. So: try now, then retry on the
    // cordis 'internal/service' signal (emitted with the service name on
    // every provision), and latch once mounted or disposed.
    const loadDefineTool = async () => {
      try { return await import('@deepseek-ai/dsh-tools') } catch (e) { }
      const bin = dshBin()
      if (!bin) return null
      try { return createRequire(bin)('@deepseek-ai/dsh-tools') } catch (e) { return null }
    }
    const stopForAgent = async (port) => {
      if (!(typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535)) {
        return { ok: false, code: 'bad_port', error: 'port must be an integer in [1, 65535]' }
      }
      if (port === currentPort()) {
        return { ok: false, code: 'stop_current_refused', error: 'refusing to stop THIS instance from a tool (it hosts the conversation); use the sidebar panel instead' }
      }
      const r = await forwardStopRemote(port)
      if (r && r.ok) return { ok: true, note: 'graceful stop acknowledged by :' + port }
      return { ok: false, code: 'stop_unconfirmed', error: 'target did not acknowledge the stop (not managed here, or unreachable)' }
    }

    const toolDisposers = []
    let toolsMounting = false
    let toolsMounted = false
    let toolsDisposed = false
    const mountAgentTools = async () => {
      if (toolsDisposed || toolsMounted || toolsMounting) return
      const toolsService = ctx.get('tools')
      if (!toolsService || typeof toolsService.register !== 'function') return
      toolsMounting = true
      try {
        const mod = await loadDefineTool()
        // Re-check after the await: the plugin, or the service, may have gone
        // away while the module was resolving.
        if (toolsDisposed || toolsMounted || !mod || typeof mod.defineTool !== 'function') return
        const api = {
          listInstances,
          start: startWithRetry,
          stop: stopForAgent,
          logs: readLogsFor,
          sessions: sessionsFor
        }
        for (const def of buildAgentTools(mod.defineTool, api)) {
          const release = toolsService.register(def)
          if (typeof release === 'function') toolDisposers.push(release)
        }
        toolsMounted = true
      } catch (e) {
        // A rejected registration must cost the tools, never the panel.
        console.error('dsh-instance-manager: agent tools registration failed', e && e.message ? e.message : e)
      } finally {
        toolsMounting = false
      }
    }
    ctx.effect(() => {
      void mountAgentTools()
      const off = ctx.on('internal/service', (name) => {
        if (name === 'tools') void mountAgentTools()
      })
      return () => {
        toolsDisposed = true
        toolsMounted = false
        if (typeof off === 'function') off()
        toolDisposers.splice(0).forEach((d) => { try { d() } catch (e) { } })
      }
    }, 'dsh-instance-manager: agent tools')

    // Fleet up/down stream: same-origin only (guard applies like every other
    // action). The response never "completes" — the client's EventSource owns
    // the lifecycle and req close tears the subscription down.
    const eventsRoute = {
      kind: 'exact',
      path: '/dsh-instance-manager/events',
      handler: async (req, res) => {
        try {
          if (!guard(req, res)) return
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive'
          })
          res.write(': connected\n\n')
          sseClients.add(res)
          ensureFleetTicker()
          // Baseline snapshot for THIS subscriber; its ports also fold into
          // the shared baseline so a concurrent first tick cannot re-announce
          // them as joins.
          ;(async () => {
            try {
              const { items } = await listInstances()
              const ports = items.filter((i) => i.managed).map((i) => i.port)
              if (prevManaged === null) prevManaged = new Set(ports)
              else for (const p of ports) prevManaged.add(p)
              res.write('event: fleet\ndata: ' + JSON.stringify({ baseline: true, ports }) + '\n\n')
            } catch (e) { /* next tick covers */ }
          })()
          // Abrupt disconnects surface as ASYNC 'error' events on the
          // request/response streams; an unhandled 'error' event would take
          // down the whole process, so every stream gets listeners and one
          // idempotent drop path ('close' may follow 'error' — both no-op).
          const drop = () => {
            sseClients.delete(res)
            stopFleetTickerIfIdle()
          }
          res.on('error', drop)
          req.on('error', drop)
          req.on('close', drop)
        } catch (err) {
          console.error('dsh-instance-manager: events error', err && err.message ? err.message : err)
          try { res.end() } catch (e) { }
        }
      }
    }

    ctx.effect(() => [
      ws.register(apiRoute),
      ws.register(eventsRoute),
      ws.register({ ...apiRoute, path: LEGACY_BASE }),
      // F2 inbound half: without this the fleet link is dial-out only — every
      // peer's `fleet` query times out, because no instance accepts a socket.
      // Guarded: a webserver build without upgrade support must not take the
      // panel down with it; peering then degrades to dial-out only, as before.
      typeof ws.registerUpgrade === 'function' ? ws.registerUpgrade(fleetUpgrade) : () => { },
      // Fleet teardown: close the hub's server, liveness timer, outbound
      // links and pending queries, and latch the async `ws` load above so a
      // late resolution cannot resurrect the hub after unload.
      () => {
        fleetDisposed = true
        if (fleet) {
          try { fleet.dispose() } catch (e) { }
          fleet = null
        }
      },
      // Plugin teardown (graceful exit included): stop heartbeating and take
      // our registry file with us so peers never see a ghost port.
      () => {
        clearInterval(heartbeatTimer)
        removeHeartbeat()
      },
      // SSE teardown: stop the diff ticker and end every open stream.
      () => {
        if (fleetTimer !== null) clearInterval(fleetTimer)
        fleetTimer = null
        for (const res of sseClients) { try { res.end() } catch (e) { } }
        sseClients.clear()
      },
      // Crash black-box teardown: release the process hooks with the plugin.
      () => {
        process.off('uncaughtException', onUncaught)
        process.off('unhandledRejection', onRejection)
      }
    ], 'dsh-instance-manager: api routes')
  },
}
