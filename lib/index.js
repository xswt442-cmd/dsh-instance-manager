// dsh-easy-port-manager host half.
//
// JSON endpoint on the webserver (all actions same-origin):
//
//   GET  /dsh-easy-port-manager/api?action=list
//   GET  /dsh-easy-port-manager/api?action=self
//   POST /dsh-easy-port-manager/api?action=start
//   POST /dsh-easy-port-manager/api?action=stop&port=<port>
//   POST /dsh-easy-port-manager/api?action=stop-all
//      /dsh-easy-port-manager/api?action=stop-self   (POST; GET tolerated for
//                                                     peers running <=0.4.1)
//
// Security model (README "安全模型"): every action runs through a guard that
// rejects browser-initiated cross-site traffic — Fetch Metadata
// (sec-fetch-site not same-origin/none), a foreign Origin, and a non-loopback
// Host header (also closes DNS rebinding). Mutating actions additionally
// require POST. Peer instances talk plain node:http and carry none of the
// browser headers, so host-to-host forwarding keeps working across versions.
//
// Instance discovery is peer-to-peer: every instance mounting this bundle
// answers `action=self`; unknown ports are probed with node:http for the DSH
// UI marker. Stopping a remote instance forwards `stop-self` so the TARGET
// exits through the harness's graceful `appExit` shutdown (sessions flushed).
// Starting a new instance spawns one detached, hidden-background node child
// (windowsHide) writing logs under $DSH_HOME/launcher/logs. Nothing here
// flashes console windows, independent of the mounted shell executor.
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

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

    const dshHome = () => {
      const h = process.env.DSH_HOME
      if (h && fs.existsSync(h)) return h
      return path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
    }

    const findNode = () => {
      const candidates = process.platform === 'win32'
        ? [
            'C:\\nvm4w\\nodejs\\node.exe',
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')
          ]
        : ['/usr/bin/node', '/usr/local/bin/node']
      for (const c of candidates) if (fs.existsSync(c)) return c
      const pathEnv = process.env.PATH || ''
      const sep = process.platform === 'win32' ? ';' : ':'
      const exe = process.platform === 'win32' ? 'node.exe' : 'node'
      for (const dir of pathEnv.split(sep)) {
        if (!dir) continue
        const cand = path.join(dir.replace(/^\"|\"$/g, ''), exe)
        if (fs.existsSync(cand)) return cand
      }
      return ''
    }

    const dshBin = () => {
      const p = path.join(dshHome(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      return fs.existsSync(p) ? p : ''
    }

    const activeSessionCount = () => {
      try {
        const sessions = ctx.get('sessions')
        return sessions ? sessions.list().length : null
      } catch (e) {
        return null
      }
    }

    const sendJson = (res, code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(obj))
    }

    // ---- request guards (see README "安全模型") -------------------------
    // The API only ever means to serve the panel served from THIS origin on
    // the loopback. A public https page can still reach http://127.0.0.1 from
    // the visitor's browser (loopback counts as a potentially trustworthy
    // origin, so mixed-content blocking does not help), and missing CORS only
    // hides the response — the request itself still fires. So:
    //   1. Fetch Metadata: browsers attach sec-fetch-site on every request;
    //      anything claiming cross-site is rejected outright.
    //   2. Origin: when present it must name this instance's loopback origin.
    //   3. Host: must be a loopback name, which also defeats DNS rebinding.
    // Peer instances talk plain node:http (no sec-fetch-*/origin, loopback
    // Host), so version-skewed forwarding keeps working.
    const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']
    const isLoopbackName = (name) => LOOPBACK_HOSTNAMES.indexOf(String(name || '').toLowerCase()) !== -1
    const hostHostname = (host) => {
      const m = /^\[([^\]]+)\]/.exec(host)
      return (m ? m[1] : host.split(':')[0]).toLowerCase()
    }
    const guard = (req, res) => {
      const site = req.headers['sec-fetch-site']
      if (site && site !== 'same-origin' && site !== 'none') {
        sendJson(res, 403, { ok: false, error: '已拒绝跨站请求' })
        return false
      }
      const host = req.headers.host || ''
      if (host && !isLoopbackName(hostHostname(host))) {
        sendJson(res, 403, { ok: false, error: 'Host 不是回环地址' })
        return false
      }
      const origin = req.headers.origin
      if (origin) {
        let same = false
        try {
          const o = new URL(origin)
          same = isLoopbackName(o.hostname) && String(o.port || '') === String(currentPort() || '')
        } catch (e) { same = false }
        if (!same) {
          sendJson(res, 403, { ok: false, error: 'Origin 不同源' })
          return false
        }
      }
      return true
    }
    // Mutating actions are POST-only. stop-self stays reachable via GET so an
    // older peer (<=0.4.1, which forwards stop over node:http GET) can still
    // shut this instance down during a mixed-version window.
    const requirePost = (req, res, action) => {
      if (req.method === 'POST') return true
      sendJson(res, 405, { ok: false, error: action + ' 需要 POST 请求' })
      return false
    }

    // JSON request against another local instance. Resolves null on any
    // failure (closed port, non-JSON response, timeout). `method` lets the
    // forwarding path speak POST to peers whose guards demand it.
    const fetchJson = (port, query, timeoutMs, method) => new Promise((resolve) => {
      let settled = false
      const done = (v) => { if (!settled) { settled = true; resolve(v) } }
      const req = http.get({ host: '127.0.0.1', port, path: '/dsh-easy-port-manager/api?' + query, timeout: timeoutMs, method: method || 'GET' }, (res) => {
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

    const scheduleSelfExit = () => {
      const fire = () => {
        const exit = ctx.get('appExit')
        if (exit) {
          // Graceful: dispose the whole tree (sessions flushed). The harness
          // shutdown only sets process.exitCode afterwards and relies on the
          // event loop draining — a lingering handle can hold the process
          // alive forever, so force-exit as a backstop.
          exit(0)
          const t2 = ctx.get('timer')
          const hard = () => process.exit(0)
          if (t2) t2.timeout(hard, 3000)
          else setTimeout(hard, 3000)
        } else {
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

    const findFreePort = async () => {
      for (let p = 3080; p <= 3129; p++) {
        if (!(await tryConnect(p, 600))) return p
      }
      return 0
    }

    const startInstance = () => {
      const node = findNode()
      const bin = dshBin()
      if (!node) return { ok: false, error: '未找到 node.exe' }
      if (!bin) return { ok: false, error: '未找到 dsh 启动器：' + path.join(dshHome(), 'profiles\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js') }
      const port = 0
      return { ok: true, node, bin, port }
    }

    const listInstances = async () => {
      const selfPort = currentPort()
      const ports = []
      for (let p = 3080; p <= 3129; p++) ports.push(p)
      const results = await Promise.all(ports.map(async (port) => {
        const self = await fetchJson(port, 'action=self', 2500)
        if (self && typeof self.pid === 'number' && typeof self.port === 'number') {
          return {
            port,
            pid: self.pid,
            name: 'node.exe',
            ui: true,
            managed: true,
            current: port === selfPort,
            startedAt: typeof self.startedAt === 'number' ? self.startedAt : null,
            sessions: typeof self.sessions === 'number' ? self.sessions : null,
            url: 'http://127.0.0.1:' + port + '/'
          }
        }
        const body = await probeBody(port)
        if (body.indexOf('DeepSeek Harness') !== -1) {
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
      return { items, currentPort: selfPort, error: null }
    }

    ctx.effect(() => ws.register({
      kind: 'exact',
      path: '/dsh-easy-port-manager/api',
      handler: async (req, res) => {
        try {
          if (!guard(req, res)) return
          const u = new URL(req.url || '/', 'http://x')
          const action = u.searchParams.get('action') || 'list'
          if (action === 'self') {
            sendJson(res, 200, {
              pid: process.pid,
              port: currentPort(),
              startedAt,
              sessions: activeSessionCount()
            })
            return
          }
          if (action === 'list') {
            sendJson(res, 200, await listInstances())
            return
          }
          if (action === 'start') {
            if (!requirePost(req, res, 'start')) return
            // Pick the first port with no listener, then spawn one detached,
            // hidden-background server child. Logs land beside the launcher's.
            let port = 0
            for (let p = 3080; p <= 3129; p++) {
              if (!(await tryConnect(p, 600))) { port = p; break }
            }
            if (!port) {
              sendJson(res, 200, { ok: false, error: '3080–3129 端口全部被占用' })
              return
            }
            const picked = startInstance()
            if (!picked.ok) {
              sendJson(res, 200, { ok: false, error: picked.error })
              return
            }
            const logDir = path.join(dshHome(), 'launcher', 'logs')
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
            const out = fs.openSync(path.join(logDir, 'server-' + port + '.out.log'), 'a')
            const errF = fs.openSync(path.join(logDir, 'server-' + port + '.err.log'), 'a')
            const child = spawn(picked.node, [picked.bin, 'web', '--port', String(port)], {
              cwd: dshHome(),
              detached: true,
              stdio: ['ignore', out, errF],
              windowsHide: true
            })
            child.unref()
            fs.closeSync(out)
            fs.closeSync(errF)
            sendJson(res, 200, { ok: true, port })
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
              sendJson(res, 400, { ok: false, error: 'no port' })
              return
            }
            // Forward as POST: peers on this version reject GET mutations.
            // Peers on <=0.4.1 never checked the method, so POST stays
            // compatible in both directions.
            const r = await fetchJson(port, 'action=stop-self', 5000, 'POST')
            if (r && r.ok) {
              sendJson(res, 200, { ok: true })
              return
            }
            sendJson(res, 200, { ok: false, error: '目标实例没有确认停止（未挂载本管理面板或不可达）' })
            return
          }
          if (action === 'stop-all') {
            if (!requirePost(req, res, 'stop-all')) return
            const { items } = await listInstances()
            const targets = items.filter((i) => i.managed && i.port !== currentPort())
            const acked = []
            await Promise.allSettled(targets.map(async (t) => {
              const r = await fetchJson(t.port, 'action=stop-self', 5000, 'POST')
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
          sendJson(res, 400, { ok: false, error: 'unknown action' })
        } catch (err) {
          console.error('dsh-easy-port-manager: api error', err && err.message ? err.message : err)
          sendJson(res, 500, { error: String(err && err.message ? err.message : err) })
        }
      }
    }), 'dsh-easy-port-manager: api route')
  },
}
