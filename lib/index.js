// dsh-easy-port-manager host half.
//
// JSON endpoint on the webserver (all actions same-origin):
//
//   GET /dsh-easy-port-manager/api?action=list
//   GET /dsh-easy-port-manager/api?action=self
//   GET /dsh-easy-port-manager/api?action=start
//   GET /dsh-easy-port-manager/api?action=stop&port=<port>
//   GET /dsh-easy-port-manager/api?action=stop-all
//   GET /dsh-easy-port-manager/api?action=stop-self
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

    // JSON fetch against another local instance. Resolves null on any failure
    // (closed port, non-JSON response, timeout).
    const fetchJson = (port, query, timeoutMs) => new Promise((resolve) => {
      let settled = false
      const done = (v) => { if (!settled) { settled = true; resolve(v) } }
      const req = http.get({ host: '127.0.0.1', port, path: '/dsh-easy-port-manager/api?' + query, timeout: timeoutMs }, (res) => {
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
        if (exit) exit(0)
        else process.exit(0)
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
            const r = await fetchJson(port, 'action=stop-self', 5000)
            if (r && r.ok) {
              sendJson(res, 200, { ok: true })
              return
            }
            sendJson(res, 200, { ok: false, error: '目标实例没有确认停止（未挂载本管理面板或不可达）' })
            return
          }
          if (action === 'stop-all') {
            const { items } = await listInstances()
            const targets = items.filter((i) => i.managed && i.port !== currentPort())
            const acked = []
            for (const t of targets) {
              const r = await fetchJson(t.port, 'action=stop-self', 5000)
              if (r && r.ok) acked.push(t.port)
            }
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
          sendJson(res, 400, { error: 'unknown action' })
        } catch (err) {
          console.error('dsh-easy-port-manager: api error', err && err.message ? err.message : err)
          sendJson(res, 500, { error: String(err && err.message ? err.message : err) })
        }
      }
    }), 'dsh-easy-port-manager: api route')
  },
}
