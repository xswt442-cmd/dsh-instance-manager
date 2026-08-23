// dsh-easy-port-manager host half.
//
// Enumerates dsh web instances listening on 127.0.0.1 ports 3080..3129 and
// stops them, exposed as a JSON endpoint on the webserver:
//
//   GET /dsh-easy-port-manager/api?action=list
//   GET /dsh-easy-port-manager/api?action=self
//   GET /dsh-easy-port-manager/api?action=stop&port=<port>[&pid=<pid>]
//   GET /dsh-easy-port-manager/api?action=stop-self
//
// Zero external processes: instance discovery is peer-to-peer (every instance
// mounting this bundle answers `action=self` with its own pid; unknown ports
// are probed with node:http for the DSH UI marker), and stopping a remote
// instance forwards `stop-self` so the TARGET exits through the harness's own
// graceful `appExit` shutdown (sessions flushed properly). This keeps the host
// free of spawned consoles regardless of which shell executor is mounted.
import http from 'node:http'

export default {
  // Hard dependency: loader entries mount concurrently, so the webserver
  // service may not be provided yet when apply runs. Cordis waits for it.
  inject: ['webServer'],
  apply(ctx) {
    const ws = ctx.webServer
    if (ws === undefined) return

    const currentPort = () => {
      const server = ctx.get('webServer')
      return server ? server.port : undefined
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

    const listInstances = async () => {
      const selfPort = currentPort()
      const ports = []
      for (let p = 3080; p <= 3129; p++) ports.push(p)
      const results = await Promise.all(ports.map(async (port) => {
        const self = await fetchJson(port, 'action=self', 1200)
        if (self && typeof self.pid === 'number' && typeof self.port === 'number') {
          return {
            port,
            pid: self.pid,
            name: 'node.exe',
            ui: true,
            managed: true,
            current: port === selfPort,
            url: 'http://127.0.0.1:' + port + '/'
          }
        }
        const body = await probeBody(port)
        if (body.indexOf('DeepSeek Harness') !== -1) {
          // A dsh instance without this bundle (started before install): visible
          // and openable, but it cannot be asked to stop itself.
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
          // Something else is listening on this port.
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
            sendJson(res, 200, { pid: process.pid, port: currentPort() })
            return
          }
          if (action === 'list') {
            sendJson(res, 200, await listInstances())
            return
          }
          if (action === 'stop') {
            const port = Number(u.searchParams.get('port') || 0)
            if (port === currentPort()) {
              // Self-stop (like Task Manager End Task): reply first so the
              // client receives ok, then exit through the graceful shutdown.
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
