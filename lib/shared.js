// dsh-instance-manager shared pure helpers.
//
// Everything here is dependency-free and side-effect-free so the node:test
// suite (test/) exercises the exact code the host half runs: request guards,
// loopback parsing, the dsh-bin resolution chain, and registry-entry
// validation for file-based discovery. Only the host half imports this
// module; the browser half talks to the API over plain HTTP.
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { timingSafeEqual } from 'node:crypto'

// Keep in lockstep with package.json "version": publish.yml and the compat
// static job both assert the equality, so a release cannot ship drifted.
export const VERSION = '0.9.4'

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
//
// `allowRemoteHost` (optional, sync) upgrades the guard to the F1 dual-mode:
// when it returns true, a NON-loopback Host no longer hard-rejects — the
// caller MUST then verify the fleet bearer itself before dispatching (the
// guard deliberately knows nothing about tokens). Events/SSE stays mounted on
// a separate strict guard instance: EventSource cannot send headers.
export const createGuard = ({ currentPort, respond, allowRemoteHost }) => (req, res) => {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') {
    respond(res, 403, { ok: false, code: 'cross_site', error: '已拒绝跨站请求' })
    return false
  }
  const host = req.headers.host || ''
  if (host && !isLoopbackName(hostHostname(host))) {
    if (!(typeof allowRemoteHost === 'function' && allowRemoteHost())) {
      respond(res, 403, { ok: false, code: 'bad_host', error: 'Host 不是回环地址' })
      return false
    }
    // Remote mode: fall through; the handler owns bearer verification.
  }
  const origin = req.headers.origin
  if (origin) {
    let same = false
    try {
      const o = new URL(origin)
      // Node's URL parser preserves brackets in IPv6 hostnames (for example,
      // `http://[::1]:3080` yields `"[::1]"`). Reuse the Host-header parser
      // so both request paths apply the exact same loopback allowlist.
      same = isLoopbackName(hostHostname(o.hostname)) && String(o.port || '') === String(currentPort() || '')
    } catch (e) { same = false }
    if (!same) {
      respond(res, 403, { ok: false, code: 'bad_origin', error: 'Origin 不同源' })
      return false
    }
  }
  return true
}

// Constant-time bearer comparison for the fleet trust boundary. Length
// mismatches burn a dummy comparison so failure timing does not leak token
// length; empty inputs never match (an unconfigured token fails closed).
export const safeTokenEqual = (received, expectedBearer) => {
  const a = Buffer.from(String(received || ''), 'utf8')
  const b = Buffer.from(String(expectedBearer || ''), 'utf8')
  if (a.length === 0 || b.length === 0) return false
  if (a.length !== b.length) {
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
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

// Resolve the harness home with the same precedence as
// @deepseek-ai/dsh-home-paths: a non-blank $DSH_HOME, otherwise ~/.dsh.
// Existence is deliberately NOT a criterion — the harness itself accepts a
// home that does not exist yet and creates it on demand, so requiring the
// directory here made this plugin fall back to ~/.dsh on a first run with a
// fresh $DSH_HOME, splitting its registry and launcher logs away from the
// very instance it was managing. A blank override counts as unset, so a stray
// DSH_HOME=" " can never collapse the home onto the current directory.
export const resolveDshHome = (env = process.env, homeDir = os.homedir()) => {
  const raw = env.DSH_HOME
  const selected = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
  const value = selected === null ? path.join(homeDir, '.dsh') : selected
  // resolve() last, exactly like dshHomePath: the result is absolute on every
  // platform whether it came from the environment, the OS home, or a tilde.
  if (value === '~') return path.resolve(homeDir)
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.resolve(path.join(homeDir, value.slice(2)))
  return path.resolve(value)
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

// Coerce a caller-supplied port (query string, agent-tool arg, or a value
// that arrived over a fleet link) to an integer in [1, 65535], or null.
//
// This is the ONLY accepted way to turn untrusted input into a port: the
// value ends up interpolated into the launcher log filename
// (`server-<port>.<stream>.log`), so anything that survives as a non-integer
// (or a string like "../../..") is a path-traversal waiting to happen.
// Accepts integers and whitespace-padded digit strings only — never `1e3`,
// `0x10`, `+80` or `80.5`, all of which would widen the accepted set for no
// gain.
export const normalizePort = (raw) => {
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null
  return n
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

// Wait for a just-spawned launcher child: resolve to {ready:true} once
// `probe()` says it answers, {died:true, code} if it exits, or {} when the
// confirm window closes with it still silent (a slow boot — never a reason to
// spawn a second one).
//
// The child's 'error' event is ALWAYS consumed. A ChildProcess that fails to
// spawn (ENOENT, EACCES, EMFILE) emits 'error' and NO 'exit', and an unlistened
// 'error' event is process-fatal — one click on "start new instance" in such a
// window used to take the whole instance down through the crash handler. Here
// it is reported as just another failed launch, so the caller can retry once.
export const awaitChild = ({ child, confirmMs, probe, sleep }) => {
  const spawnFailed = new Promise((resolve) => child.once('error', (e) =>
    resolve({ died: true, code: 'spawn:' + ((e && e.code) || 'error') })))
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve({ died: true, code })))
  // The probe loop must stop once the race has a verdict: without the flag a
  // dead child still gets probed every 500ms until the full confirm window
  // expires, and a retry launch races the zombie loop's probes.
  let settled = false
  const readyOrSlow = (async () => {
    const deadline = Date.now() + confirmMs
    while (Date.now() < deadline) {
      await sleep(500)
      if (settled) return {}
      if (await probe()) return { ready: true }
    }
    return {}
  })()
  return Promise.race([spawnFailed, exited, readyOrSlow]).finally(() => { settled = true })
}

// The port set the SSE up/down push tracks: managed rows from THIS machine.
// Remote rows carry other machines' port numbers — they share the local
// number space but never the local lifecycle, so their flapping must not
// toast as instance up/down here.
//
// Shared deliberately: the baseline frame a new subscriber is seeded with and
// the diff ticker must agree port-for-port. When the baseline inlined a wider
// filter (`i.managed`, remote rows included), the first tick read every peer
// port as "removed" and toasted a fleet-wide instance-down for machines that
// had been up the entire time.
export const managedLocalPorts = (items) =>
  (Array.isArray(items) ? items : []).filter((i) => i.managed && !i.remote).map((i) => i.port)

// Fleet membership diff for the SSE up/down push: which managed ports
// appeared and which disappeared between two ticks.
export const diffManagedPorts = (prev, next) => {
  const added = []
  const removed = []
  for (const p of next) if (!prev.has(p)) added.push(p)
  for (const p of prev) if (!next.has(p)) removed.push(p)
  return { added, removed }
}

// Parse the DSHIM_PORT_RANGE env override ("min-max"). The 3080-3129 band is
// a dsh-side DOCUMENTATION convention, not a compiled contract — the
// webserver takes its port from composition config and even accepts 0 (OS-
// assigned). Discovery is already heartbeat-driven and port-agnostic; this
// only scopes where START may spawn. Invalid input falls back silently.
// ---- user settings namespace (DIM-M1 1a) -------------------------------
//
// The harness owns preference storage: `ctx.settings.register(ns, schema,
// { base })` resolves schema defaults, then the registrant's composition
// `base`, then the user's stored section, and the browser half reads the very
// same namespace through `ctx.settingsScope.bind()` — persistence, revision
// fencing, redaction, and the schema-driven form all come for free.
//
// `applies` is NAMESPACE-level, not per field, and a `restart` namespace's
// owner never watches its value. The hot-applicable fields (dock placement,
// poll interval, peer list, fleet token) live in the LIVE namespace; the
// load-time constants (port range) live in the STARTUP namespace.
//
// NOTE on the startup name: the design doc sketched `dsh-instance-manager.startup`,
// but the settings service validates namespaces against /^[a-z][a-z0-9-]*$/
// (packages/settings/settings/src/index.ts) — a dot throws a TypeError at
// register(). A pure kebab suffix is used instead.
//
// Peer and token fields deliberately keep the ENV STRING format ("id@origin,..."
// and the raw token): parsePeers owns validation/dedupe/cap and is already
// tested, and a flat string avoids a nested schema for M1's form.
//
// Nothing below is required for the panel to work. Every accessor degrades to
// the constants, and `register()` itself is wrapped so a corrupt stored
// section can never stop the plugin from mounting.
export const SETTINGS_NAMESPACE = 'dsh-instance-manager'
export const SETTINGS_NAMESPACE_STARTUP = 'dsh-instance-manager-startup'
export const DOCK_PLACEMENT_FIELD = 'dockPlacement'
export const REFRESH_INTERVAL_FIELD = 'refreshIntervalMs'
export const FLEET_TOKEN_FIELD = 'fleetToken'
export const PEERS_FIELD = 'peers'
export const PORT_RANGE_FIELD = 'portRange'
// Cross-plugin contract: dsh-treekeeper's panel positions itself off
// `--createhelper-utility-dock-left` and
// `html[data-createhelper-utility-dock-placement]`, which are driven by these
// three values. Renaming or adding a fourth breaks that panel.
export const DOCK_PLACEMENTS = ['main-bottom-left', 'main-bottom-right', 'hidden']
export const DEFAULT_DOCK_PLACEMENT = 'main-bottom-left'
export const DEFAULT_REFRESH_INTERVAL_MS = 4000
export const REFRESH_INTERVAL_MIN_MS = 1000
export const REFRESH_INTERVAL_MAX_MS = 60000
// Environment overrides, kept as the composition `base` layer so an operator
// who set them keeps working (see the doc note: `base` is frozen at
// registration, which is exactly right for process environment).
export const ENV_DOCK_PLACEMENT = 'DSHIM_DOCK_PLACEMENT'
export const ENV_REFRESH_INTERVAL_MS = 'DSHIM_REFRESH_INTERVAL_MS'
export const ENV_FLEET_TOKEN = 'DSHIM_FLEET_TOKEN'
export const ENV_FLEET_TOKEN_REF = 'DSHIM_FLEET_TOKEN_REF'
export const ENV_PORT_RANGE = 'DSHIM_PORT_RANGE'
export const ENV_PEERS = 'DSHIM_PEERS'

const coerceIntervalMs = (raw) => {
  const n = typeof raw === 'number'
    ? raw
    : (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN)
  if (!Number.isFinite(n)) return null
  return Math.min(REFRESH_INTERVAL_MAX_MS, Math.max(REFRESH_INTERVAL_MIN_MS, Math.round(n)))
}

/** Narrow one stored or composed value to a dock placement. */
export const normalizeDockPlacement = (raw, fallback = DEFAULT_DOCK_PLACEMENT) =>
  DOCK_PLACEMENTS.indexOf(raw) === -1 ? fallback : raw

/** Narrow one stored, composed, or env value to a poll interval in ms. */
export const normalizeRefreshIntervalMs = (raw, fallback = DEFAULT_REFRESH_INTERVAL_MS) => {
  const value = coerceIntervalMs(raw)
  return value === null ? fallback : value
}

/** The registered namespace's schema. `z` is @deepseek-ai/schemastery. */
export const buildLiveSchema = (z) => z.object({
  [DOCK_PLACEMENT_FIELD]: z.union(DOCK_PLACEMENTS).default(DEFAULT_DOCK_PLACEMENT),
  [REFRESH_INTERVAL_FIELD]: z.number().step(1).min(REFRESH_INTERVAL_MIN_MS)
    .max(REFRESH_INTERVAL_MAX_MS).default(DEFAULT_REFRESH_INTERVAL_MS),
  // Write-only in every UI: describe({redactSecrets:true}) strips it from
  // value/base/user and enumerates {path, set}, so no API response or log
  // ever carries the token (packages/settings/settings/src/redact.ts).
  [FLEET_TOKEN_FIELD]: z.string().role('secret'),
  // Same string format as DSHIM_PEERS; parsePeers owns validation.
  [PEERS_FIELD]: z.string().default('')
})

const nonEmptyString = (raw) =>
  typeof raw === 'string' && raw.length > 0 ? raw : undefined

// Env overrides become the composition `base` — user edits land in the layer
// ABOVE it and win. Only well-formed values are carried: `base` is merged
// before the schema runs, so a garbage env value here would fail the whole
// section and take the registration down with it.
export const buildLiveBase = (env = process.env) => {
  const base = {}
  const placement = env && env[ENV_DOCK_PLACEMENT]
  if (typeof placement === 'string' && DOCK_PLACEMENTS.indexOf(placement.trim()) !== -1) {
    base[DOCK_PLACEMENT_FIELD] = placement.trim()
  }
  const interval = env ? coerceIntervalMs(env[ENV_REFRESH_INTERVAL_MS]) : null
  if (interval !== null) base[REFRESH_INTERVAL_FIELD] = interval
  const token = env ? nonEmptyString(env[ENV_FLEET_TOKEN]) : undefined
  if (token !== undefined) base[FLEET_TOKEN_FIELD] = token
  const peers = env ? nonEmptyString(env[ENV_PEERS]) : undefined
  if (peers !== undefined && peers.trim().length > 0) base[PEERS_FIELD] = peers
  return base
}

/** Resolve a live section (or pure env/default fallback when `value` is absent). */
export const resolveLiveSection = (value, env = process.env) => {
  const stored = value && typeof value === 'object' ? value : {}
  const base = buildLiveBase(env)
  const fallbackPeers = env && typeof env[ENV_PEERS] === 'string' ? env[ENV_PEERS] : ''
  return {
    [DOCK_PLACEMENT_FIELD]: normalizeDockPlacement(
      stored[DOCK_PLACEMENT_FIELD] === undefined ? base[DOCK_PLACEMENT_FIELD] : stored[DOCK_PLACEMENT_FIELD]),
    [REFRESH_INTERVAL_FIELD]: normalizeRefreshIntervalMs(
      stored[REFRESH_INTERVAL_FIELD] === undefined ? base[REFRESH_INTERVAL_FIELD] : stored[REFRESH_INTERVAL_FIELD]),
    // The token survives only under its schema-declared secret field. A
    // resolved section carries the schema/base/user layering already, so a
    // STRING here (including '' — an explicit user clear) is authoritative;
    // undefined only means the degraded/no-section path, which falls back to
    // the raw env.
    [FLEET_TOKEN_FIELD]: typeof stored[FLEET_TOKEN_FIELD] === 'string'
      ? (stored[FLEET_TOKEN_FIELD].length > 0 ? stored[FLEET_TOKEN_FIELD] : undefined)
      : nonEmptyString(base[FLEET_TOKEN_FIELD]) ?? nonEmptyString(env && env[ENV_FLEET_TOKEN]),
    [PEERS_FIELD]: typeof stored[PEERS_FIELD] === 'string'
      ? stored[PEERS_FIELD]
      : nonEmptyString(base[PEERS_FIELD]) ?? fallbackPeers
  }
}

/**
 * Register the LIVE namespace on an already-injected settings context.
 *
 * `register()` is the one call here that can throw: stored sections are
 * judged at registration, where no last-good value exists yet, so a section
 * that already fails the schema rejects the registration itself. A corrupt
 * settings document must therefore degrade to in-memory defaults and warn —
 * never keep the panel from mounting.
 * @param options - injected `ctx` carrying `settings`, the schemastery `z`,
 * the process env, and an optional warn sink.
 * @returns `{ registered, degraded, scope?, get() }`; `get()` always answers
 * a usable section.
 */
export const registerLiveSettings = ({ ctx, z, env = process.env, warn } = {}) => {
  const report = (message) => {
    try { (warn || ((m) => console.warn(m)))('dsh-instance-manager: ' + message) } catch (e) { }
  }
  const idle = (extra) => Object.assign({
    registered: false,
    degraded: false,
    get: () => resolveLiveSection(undefined, env)
  }, extra)
  try {
    if (!z || typeof z.object !== 'function') return idle({ reason: 'schema-unavailable' })
    const settings = ctx && ctx.settings
    if (!settings || typeof settings.register !== 'function') return idle({ reason: 'settings-unavailable' })
    const scope = settings.register(SETTINGS_NAMESPACE, buildLiveSchema(z), {
      base: buildLiveBase(env),
      applies: 'live'
    })
    return {
      registered: true,
      degraded: false,
      scope,
      get: () => resolveLiveSection(scope.get && scope.get(), env)
    }
  } catch (error) {
    report('用户设置分节无效，已降级为默认值（' +
      ((error && error.message) ? error.message : String(error)) + '）')
    return idle({ degraded: true, error })
  }
}

// ---- startup namespace (DIM-M1 1b) ---------------------------------------
// applies:'restart': the owner reads the value ONCE at construction and never
// watches, so the settings UI marks pending edits as 待生效. Only the port
// range qualifies — findFreePort and the discovery sweep must not change
// under a running instance.

export const buildStartupSchema = (z) => z.object({
  [PORT_RANGE_FIELD]: z.string().default('3080-3129')
})

export const buildStartupBase = (env = process.env) => {
  const base = {}
  const raw = env ? env[ENV_PORT_RANGE] : undefined
  // parsePortRange-shaped input only, for the same "garbage base fails the
  // whole section" reason as buildLiveBase.
  if (typeof raw === 'string' && /^\d{1,5}\s*-\s*\d{1,5}$/.test(raw.trim())) {
    base[PORT_RANGE_FIELD] = raw.trim()
  }
  return base
}

/** Resolve a startup section (or pure env/default fallback when absent). */
export const resolveStartupSection = (value, env = process.env) => {
  const stored = value && typeof value === 'object' ? value : {}
  const base = buildStartupBase(env)
  const fallback = env && typeof env[ENV_PORT_RANGE] === 'string' && env[ENV_PORT_RANGE].trim().length > 0
    ? env[ENV_PORT_RANGE].trim()
    : '3080-3129'
  return {
    [PORT_RANGE_FIELD]: nonEmptyString(stored[PORT_RANGE_FIELD]) ??
      nonEmptyString(base[PORT_RANGE_FIELD]) ?? fallback
  }
}

/**
 * Register the STARTUP namespace. Same degradation contract as
 * {@link registerLiveSettings}: a corrupt stored section rejects register()
 * itself, so it is caught here and the caller falls back to env/defaults.
 */
export const registerStartupSettings = ({ ctx, z, env = process.env, warn } = {}) => {
  const report = (message) => {
    try { (warn || ((m) => console.warn(m)))('dsh-instance-manager: ' + message) } catch (e) { }
  }
  const idle = (extra) => Object.assign({
    registered: false,
    degraded: false,
    get: () => resolveStartupSection(undefined, env)
  }, extra)
  try {
    if (!z || typeof z.object !== 'function') return idle({ reason: 'schema-unavailable' })
    const settings = ctx && ctx.settings
    if (!settings || typeof settings.register !== 'function') return idle({ reason: 'settings-unavailable' })
    const scope = settings.register(SETTINGS_NAMESPACE_STARTUP, buildStartupSchema(z), {
      base: buildStartupBase(env),
      applies: 'restart'
    })
    return {
      registered: true,
      degraded: false,
      scope,
      get: () => resolveStartupSection(scope.get && scope.get(), env)
    }
  } catch (error) {
    report('实例启动设置分节无效，已降级为默认值（' +
      ((error && error.message) ? error.message : String(error)) + '）')
    return idle({ degraded: true, error })
  }
}

export const parsePortRange = (raw, fallbackMin = 3080, fallbackMax = 3129) => {
  const m = /^(\d{1,5})\s*-\s*(\d{1,5})$/.exec(String(raw || '').trim())
  if (!m) return { min: fallbackMin, max: fallbackMax }
  const min = Number(m[1])
  const max = Number(m[2])
  if (!(min >= 1 && max >= min && max <= 65535)) return { min: fallbackMin, max: fallbackMax }
  return { min, max }
}
