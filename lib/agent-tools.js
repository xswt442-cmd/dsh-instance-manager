// dsh-instance-manager agent tools.
//
// Wraps the same host-side operations the HTTP panel uses into model-visible
// tool definitions for the harness `tools` service. Everything here is a
// PURE factory over injected closures (`api`), so the node:test suite
// exercises the exact definitions without @deepseek-ai/dsh-tools installed:
// tests pass an identity `defineTool` plus fake api implementations.
//
// Contract notes (from @deepseek-ai/dsh-tools types):
//   - `parameters` is a flat per-property map; `required: true` lives ON the
//     property spec, and the implicit root stays open.
//   - `output.schema` is a ValueSchemaSpec: an object root MUST declare
//     `additionalProperties: false`, and requiredness again rides the
//     property spec. Nullable fields are avoided by construction — callers
//     prune absent keys instead of emitting null.
//   - `execute(args, exec)` returns exactly the canonical value declared by
//     `output.schema`; `render(args, value)` projects it to text blocks.

const text = (value) => [{ type: 'text', text: value }]

// One-line fleet table row for the list render.
const rowLine = (it) => [
  ':' + it.port,
  it.current ? 'current' : (it.managed ? 'running' : 'non-dsh'),
  typeof it.pid === 'number' ? 'pid ' + it.pid : '',
  it.version ? 'v' + it.version : '',
  typeof it.sessions === 'number' && it.sessions > 0 ? it.sessions + ' sess' : ''
].filter(Boolean).join(' | ')

export const buildAgentTools = (defineTool, api) => [
  defineTool({
    name: 'instance_list',
    description:
      'List local dsh web instances: port, pid, plugin version, active sessions, resident memory, started-at epoch. ' +
      'Read-only sweep of the managed port band (default 3080-3129) plus any extra ports known to the shared heartbeat registry. ' +
      'Rows marked non-dsh are unrelated local services.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          currentPort: { type: 'integer', required: true, description: 'Port serving this tool (-1 when unknown).' },
          instances: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                port: { type: 'integer', required: true },
                managed: { type: 'boolean', required: true, description: 'false = dsh page detected but the manager bundle is not mounted there.' },
                current: { type: 'boolean', required: true },
                url: { type: 'string', required: true },
                source: { type: 'string', description: 'Peer id for remote rows; absent = this machine.' },
                pid: { type: 'integer' },
                version: { type: 'string' },
                sessions: { type: 'integer' },
                rss: { type: 'integer', description: 'Resident memory in bytes.' },
                startedAt: { type: 'integer', description: 'Epoch ms.' }
              }
            }
          }
        }
      },
      render: (_args, v) => text(v.instances.length
        ? ['port | state | pid | version | sessions', ...v.instances.map(rowLine)].join('\n')
        : 'no dsh instances found in the managed port band')
    },
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    execute: async () => {
      const res = await api.listInstances()
      const instances = (res.items || []).map((it) => {
        // Prune instead of null-ing: the output schema has no nullable nodes.
        const row = {
          port: it.port,
          managed: !!it.managed,
          current: !!it.current,
          url: it.url || ('http://127.0.0.1:' + it.port + '/')
        }
        if (typeof it.pid === 'number') row.pid = it.pid
        if (it.source) row.source = it.source
        if (typeof it.version === 'string') row.version = it.version
        if (typeof it.sessions === 'number') row.sessions = it.sessions
        if (typeof it.rss === 'number') row.rss = it.rss
        if (typeof it.startedAt === 'number') row.startedAt = it.startedAt
        return row
      })
      return { currentPort: typeof res.currentPort === 'number' ? res.currentPort : -1, instances }
    }
  }),

  defineTool({
    name: 'instance_start',
    description:
      'Launch one new dsh web instance on the first free port of the managed band (default 3080-3129). ' +
      'The call waits until the fresh instance answers its self report and returns its real pid; ' +
      'a child that exits immediately (lost the port race) retries once on the next free port. ' +
      'Logs land under the shared launcher log directory (readable via instance_logs).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          port: { type: 'integer' },
          pid: { type: 'integer' },
          code: { type: 'string' },
          error: { type: 'string' }
        }
      },
      render: (_args, v) => text(v.ok
        ? 'dsh instance started on port ' + v.port + ' (pid ' + v.pid + ')'
        : 'instance start failed: ' + (v.error || v.code || 'unknown reason'))
    },
    timeoutMs: 60000,
    execute: async () => api.start()
  }),

  defineTool({
    name: 'instance_stop',
    description:
      'Gracefully stop ANOTHER local dsh web instance by port (its sessions persist via appExit). ' +
      'Refuses to stop the instance hosting this very conversation — use the sidebar panel for that. ' +
      'Targets without the manager bundle mounted cannot acknowledge and will report stop_unconfirmed.',
    parameters: {
      port: { type: 'integer', required: true, description: 'Target instance port, as reported by instance_list.' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          note: { type: 'string' },
          code: { type: 'string' },
          error: { type: 'string' }
        }
      },
      render: (_args, v) => text(v.ok
        ? (v.note || 'instance stopped')
        : 'instance stop failed: ' + (v.error || v.code || 'unknown reason'))
    },
    timeoutMs: 30000,
    execute: async (args) => {
      if (!(typeof args.port === 'number' && Number.isInteger(args.port) && args.port >= 1 && args.port <= 65535)) {
        return { ok: false, code: 'bad_port', error: 'port must be an integer in [1, 65535]' }
      }
      return api.stop(args.port)
    }
  }),

  defineTool({
    name: 'instance_logs',
    description:
      "Tail an instance's captured launcher logs (stdout or stderr; at most 64KB / 200 whole lines). " +
      'Only instances launched through instance_start or the sidebar panel write these shared log files; ' +
      'manually started instances report exists:false. Add peer=<id> to read logs on a remote instance ' +
      "that this panel peers with (source from instance_list).",
    parameters: {
      port: { type: 'integer', required: true, description: 'Instance port.' },
      stream: { type: 'string', enum: ['out', 'err'], description: 'Which stream to tail (default "out").' },
      peer: { type: 'string', description: 'Peer id to read through instead of the local port (optional).' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exists: { type: 'boolean', required: true },
          truncated: { type: 'boolean', required: true },
          lines: { type: 'array', required: true, items: { type: 'string' } },
          stream: { type: 'string', required: true },
          peer: { type: 'string' },
          ok: { type: 'boolean', description: 'false only when the request was rejected before any read.' },
          code: { type: 'string' },
          error: { type: 'string' }
        }
      },
      render: (_args, v) => text(v.ok === false
        ? 'logs failed: ' + (v.error || v.code || 'unknown reason')
        : !v.exists
          ? 'no log file for :' + _args.port + ' (not launched from the panel/agent?)'
          : (v.truncated ? '[truncated] ' : '') + v.lines.join('\n'))
    },
    timeoutMs: 15000,
    isConcurrencySafe: () => true,
    execute: async (args) => {
      const stream = args.stream === 'err' ? 'err' : 'out'
      // The host normalizes too, but this port can be forwarded to a peer
      // over the fleet link — reject it here so a malformed value never
      // leaves this machine. Mirrors instance_stop / instance_sessions.
      if (!(typeof args.port === 'number' && Number.isInteger(args.port) && args.port >= 1 && args.port <= 65535)) {
        return {
          ok: false,
          code: 'bad_port',
          error: 'port must be an integer in [1, 65535]',
          exists: false,
          truncated: false,
          lines: [],
          stream
        }
      }
      const r = await api.logs(args.port, stream, args.peer)
      return {
        exists: !!r.exists,
        truncated: !!r.truncated,
        lines: Array.isArray(r.lines) ? r.lines : [],
        stream,
        ...(r.peer ? { peer: r.peer } : {})
      }
    }
  }),

  defineTool({
    name: 'instance_sessions',
    description:
      "Summarize an instance's live sessions: id, created-at epoch, working directory, subagent flag and event count — newest first, capped at 20 rows (total reflects the real live count). " +
      'Reads the target through its manager API; instances running pre-0.7 bundles report sessions_unavailable. ' +
      'Add peer=<id> to summarize sessions on a remote instance this panel peers with (source from instance_list).',
    parameters: {
      port: { type: 'integer', required: true, description: 'Instance port, as reported by instance_list.' },
      peer: { type: 'string', description: 'Peer id to query through instead of the local port (optional).' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          port: { type: 'integer' },
          total: { type: 'integer' },
          code: { type: 'string' },
          error: { type: 'string' },
          peer: { type: 'string' },
          sessions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                createdAt: { type: 'integer', required: true },
                cwd: { type: 'string' },
                subagent: { type: 'boolean' },
                events: { type: 'integer' }
              }
            }
          }
        }
      },
      render: (_args, v) => {
        if (!v.ok) return text('session summary failed: ' + (v.error || v.code || 'unknown reason'))
        if (!v.sessions.length) return text(':' + v.port + ' has no active sessions')
        const lines = v.sessions.slice(0, 8).map((s, i) =>
          (i + 1) + '. ' + String(s.id).slice(0, 8) +
          (s.cwd ? ' · ' + String(s.cwd).split(/[\\/]/).pop() : '') +
          (s.subagent ? ' · subagent' : '') +
          (typeof s.events === 'number' ? ' · ' + s.events + ' ev' : ''))
        if (v.sessions.length > 8) lines.push('… +' + (v.sessions.length - 8) + ' more')
        return text(':' + v.port + ' — ' + v.total + ' live session(s)\n' + lines.join('\n'))
      }
    },
    timeoutMs: 15000,
    isConcurrencySafe: () => true,
    execute: async (args) => {
      if (!(typeof args.port === 'number' && Number.isInteger(args.port) && args.port >= 1 && args.port <= 65535)) {
        return { ok: false, code: 'bad_port', error: 'port must be an integer in [1, 65535]' }
      }
      return projectSessions(await api.sessions(args.port, args.peer))
    }
  })
]

/**
 * Project a session summary onto what this tool declares it returns.
 *
 * The answer may come from another instance — either a peer over a fleet link
 * or an older local build reached through the forwarded route — so nothing
 * about its shape is ours to assume, which is why this tool normalizes while
 * every other one trusts its own host half:
 *
 *   - the output root declares `additionalProperties: false`, so an extra field
 *     a newer or older build added becomes a ToolOutputError instead of a value;
 *   - `sessions` is optional in a reply but `render()` indexes it on the
 *     success path, so an absent one was a TypeError inside the projection;
 *   - rows missing a field the schema marks required would fail validation for
 *     the whole tool result, so they are dropped rather than filled with a
 *     fabricated zero.
 *
 * Rows therefore count what survives, and `total` falls back to that count when
 * the reporter did not send one — never to a figure nobody measured.
 */
function projectSessions(result) {
  const r = result && typeof result === 'object' ? result : {}
  const rows = Array.isArray(r.sessions)
    ? r.sessions
      .filter((row) => row && typeof row === 'object' &&
        typeof row.id === 'string' && row.id !== '' &&
        Number.isInteger(row.createdAt))
      .map((row) => {
        const item = { id: row.id, createdAt: row.createdAt }
        if (typeof row.cwd === 'string' && row.cwd !== '') item.cwd = row.cwd
        if (row.subagent === true) item.subagent = true
        if (Number.isInteger(row.events)) item.events = row.events
        return item
      })
    : []
  const out = { ok: r.ok === true, sessions: rows }
  if (Number.isInteger(r.port)) out.port = r.port
  if (typeof r.code === 'string') out.code = r.code
  if (typeof r.error === 'string') out.error = r.error
  if (typeof r.peer === 'string') out.peer = r.peer
  out.total = Number.isInteger(r.total) ? r.total : rows.length
  return out
}
