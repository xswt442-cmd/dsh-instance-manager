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
      'Read-only sweep of ports 3080-3129 plus any extra ports known to the shared heartbeat registry. ' +
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
        : 'no dsh instances found on ports 3080-3129')
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
      'Launch one new dsh web instance on the first free port in 3080-3129. ' +
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
      'manually started instances report exists:false.',
    parameters: {
      port: { type: 'integer', required: true, description: 'Instance port.' },
      stream: { type: 'string', enum: ['out', 'err'], description: 'Which stream to tail (default "out").' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exists: { type: 'boolean', required: true },
          truncated: { type: 'boolean', required: true },
          lines: { type: 'array', required: true, items: { type: 'string' } },
          stream: { type: 'string', required: true }
        }
      },
      render: (_args, v) => text(!v.exists
        ? 'no log file for :' + _args.port + ' (not launched from the panel/agent?)'
        : (v.truncated ? '[truncated] ' : '') + v.lines.join('\n'))
    },
    timeoutMs: 10000,
    isConcurrencySafe: () => true,
    execute: async (args) => {
      const stream = args.stream === 'err' ? 'err' : 'out'
      const r = await api.logs(args.port, stream)
      return {
        exists: !!r.exists,
        truncated: !!r.truncated,
        lines: Array.isArray(r.lines) ? r.lines : [],
        stream
      }
    }
  })
]
