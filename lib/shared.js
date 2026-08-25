// dsh-instance-manager shared pure helpers.
//
// Everything here is dependency-free and side-effect-free so the node:test
// suite (test/) exercises the exact code the host half runs: request guards,
// loopback parsing, the dsh-bin resolution chain, and registry-entry
// validation for file-based discovery. Only the host half imports this
// module; the browser half talks to the API over plain HTTP.
import path from 'node:path'

// Keep in lockstep with package.json "version": publish.yml and the compat
// static job both assert the equality, so a release cannot ship drifted.
export const VERSION = '0.6.0'

// Hostnames a request to the loopback API may legitimately arrive with.
// Any other Host value is rejected — which also defeats DNS rebinding.
export const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']

export const isLoopbackName = (name) =>
  LOOPBACK_HOSTNAMES.indexOf(String(name || '').toLowerCase()) !== -1

// "127.0.0.1:3080" -> "127.0.0.1"; "[::1]:3080" -> "::1".
export const hostHostname = (host) => {
  const m = /^\[([^\]]+)\]/.exec(String(host || ''))
  return (m ? m[1] : String(host || '').split(':')[0]).toLowerCase()
}

// Unified request-guard factory (README "安全模型"). `respond(res, code, obj)`
// is injected so tests capture rejections without a real ServerResponse.
// Peer instances talk plain node:http and carry none of the browser headers,
// so host-to-host forwarding keeps passing.
export const createGuard = ({ currentPort, respond }) => (req, res) => {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') {
    respond(res, 403, { ok: false, code: 'cross_site', error: '已拒绝跨站请求' })
    return false
  }
  const host = req.headers.host || ''
  if (host && !isLoopbackName(hostHostname(host))) {
    respond(res, 403, { ok: false, code: 'bad_host', error: 'Host 不是回环地址' })
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
      respond(res, 403, { ok: false, code: 'bad_origin', error: 'Origin 不同源' })
      return false
    }
  }
  return true
}

// Prefer the exact entry script this instance was started with, falling back
// to the canonical profile location (fresh CI-like environments lack the
// profile copy of @deepseek-ai/dsh). `exists` is injected for tests; every
// segment goes through path.join so the fallback resolves beyond Windows.
export const resolveDshBin = ({ argv1 = '', home, exists }) => {
  if (argv1 && /bin\.js$/.test(argv1) && exists(argv1)) return argv1
  const profileBin = path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  return exists(profileBin) ? profileBin : ''
}

// ---- file-based instance registry (discovery heartbeat) -----------------
//
// Every mounted instance heartbeats <home>/run/instances/<port>.json so the
// fleet can be listed without sweeping all 50 ports. Readers trust an entry
// only while it is structurally complete AND fresh; a hard-killed process
// leaves at most a REGISTRY_FRESH_MS ghost, and graceful exits delete the
// file through the plugin disposer.

export const REGISTRY_FRESH_MS = 30000

export const registryDir = (home) => path.join(home, 'run', 'instances')

export const isValidRegistryEntry = (e, now = Date.now(), freshMs = REGISTRY_FRESH_MS) => {
  if (!e || typeof e !== 'object') return false
  if (typeof e.pid !== 'number' || typeof e.port !== 'number') return false
  if (!(e.port >= 1 && e.port <= 65535)) return false
  if (typeof e.startedAt !== 'number' || typeof e.ts !== 'number') return false
  const age = now - e.ts
  return age >= 0 && age <= freshMs
}

// Run promise factories concurrently and resolve with the first fulfilled
// non-null value (null when everything misses). Used to race the current and
// pre-rename legacy self-report routes instead of paying both timeouts
// serially on live ports that will never answer either.
export const firstNonNull = async (factories) => {
  const results = await Promise.allSettled(factories.map((f) => f()))
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value
  }
  return null
}
