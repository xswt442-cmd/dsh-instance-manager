// dsh-instance-manager shared pure helpers.
//
// Everything here is dependency-free and side-effect-free so the node:test
// suite (test/) exercises the exact code the host half runs: request guards,
// loopback parsing, the dsh-bin resolution chain, and registry-entry
// validation for file-based discovery. Only the host half imports this
// module; the browser half talks to the API over plain HTTP.
import path from 'node:path'
import fs from 'node:fs'

// Keep in lockstep with package.json "version": publish.yml and the compat
// static job both assert the equality, so a release cannot ship drifted.
export const VERSION = '0.6.2'

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

// Tail the last maxBytes of a text file, keeping at most maxLines whole
// lines. A missing file resolves to exists:false instead of throwing; a
// mid-file start drops the cut leading fragment so only complete lines are
// ever returned. Bounded reads keep huge launcher logs harmless.
export const tailFile = (file, maxBytes = 65536, maxLines = 200) => {
  let fd
  try {
    const size = fs.statSync(file).size
    const start = size > maxBytes ? size - maxBytes : 0
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    let text = buf.toString('utf8')
    if (start > 0) {
      const nl = text.indexOf('\n')
      if (nl < 0) return { exists: true, truncated: true, lines: [] }
      text = text.slice(nl + 1)
    }
    const lines = text.split(/\r?\n/)
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    return {
      exists: true,
      truncated: start > 0 || lines.length > maxLines,
      lines: lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines
    }
  } catch (e) {
    if (e && e.code === 'ENOENT') return { exists: false, truncated: false, lines: [] }
    throw e
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch (e) { } }
  }
}

// Sweep range ∪ heartbeat-known ports, deduped, ascending. Registry entries
// validate 1-65535 precisely so an instance hand-started OUTSIDE the fixed
// sweep range still reaches the fleet list through its own heartbeat.
export const unionPorts = (min, max, extra = []) => {
  const seen = new Set()
  const out = []
  const push = (p) => { if (!seen.has(p)) { seen.add(p); out.push(p) } }
  for (let p = min; p <= max; p++) push(p)
  for (const p of extra) {
    if (Number.isInteger(p) && p >= 1 && p <= 65535) push(p)
  }
  return out.sort((a, b) => a - b)
}

// Scalar-only projection of live Session objects. DSH session/store objects
// are internal live data — never serialized wholesale — so exactly the
// display fields are extracted (id, createdAt, cwd, subagent origin, event
// count), sorted newest-first and capped.
export const summarizeSessions = (list, cap = 20) => {
  const rows = []
  for (const s of Array.isArray(list) ? list : []) {
    try {
      const id = String(s.id || '')
      const h = s.header
      if (!id || !h || typeof h.createdAt !== 'number') continue
      const row = { id, createdAt: h.createdAt }
      if (typeof h.cwd === 'string' && h.cwd) row.cwd = h.cwd
      if (h.origin === 'subagent') row.subagent = true
      if (typeof s.seq === 'number') row.events = s.seq
      rows.push(row)
    } catch (e) { /* one bad entry never sinks the summary */ }
  }
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows.length > cap ? rows.slice(0, cap) : rows
}

// Fleet membership diff for the SSE up/down push: which managed ports
// appeared and which disappeared between two ticks.
export const diffManagedPorts = (prev, next) => {
  const added = []
  const removed = []
  for (const p of next) if (!prev.has(p)) added.push(p)
  for (const p of prev) if (!next.has(p)) removed.push(p)
  return { added, removed }
}
