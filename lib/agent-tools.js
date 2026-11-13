// dsh-instance-manager 的 agent 工具。
//
// 把面板 HTTP 路由使用的宿主侧操作包装成模型可见的工具定义，交给 harness 的
// `tools` 服务。这里是以注入闭包（`api`）为参数的纯工厂，node:test 测试因此无需安装
// @deepseek-ai/dsh-tools 就能检查定义本身：测试传入恒等 `defineTool` 与假的 api 实现。
//
// 契约（来自 @deepseek-ai/dsh-tools 类型）：
//   - `parameters` 是扁平的逐属性表；`required: true` 写在属性定义上，隐式根保持开放。
//   - `output.schema` 是 ValueSchemaSpec：对象根必须声明 `additionalProperties: false`，
//     必填同样写在属性定义上。可空字段在构造上避免——调用方删除缺失的键，而不是写入
//     null。
//   - `execute(args, exec)` 返回的正是 `output.schema` 声明的规范值；`render(args, value)`
//     把它投影为文本块。

const text = (value) => [{ type: 'text', text: value }]

// 列表渲染中的单行 fleet 表格行。
const rowLine = (it) => [
  ':' + it.port,
  it.current ? 'current' : (it.managed ? 'running' : 'non-dsh'),
  typeof it.pid === 'number' ? 'pid ' + it.pid : '',
  it.version ? 'v' + it.version : '',
  // 任何界面都不会停止它：桌面应用自己的宿主。
  it.runtime === 'desktop' ? 'desktop' : '',
  typeof it.sessions === 'number' && it.sessions > 0 ? it.sessions + ' sess' : ''
].filter(Boolean).join(' | ')

export const buildAgentTools = (defineTool, api) => [
  defineTool({
    name: 'instance_list',
    description:
      'List local dsh web instances: port, pid, plugin version, active sessions, resident memory, started-at epoch. ' +
      'Read-only sweep of the configured port spec (default 3080-3129,19387) plus any extra ports known to the shared heartbeat registry. ' +
      'Rows marked non-dsh are unrelated local services. ' +
      "runtime 'desktop' marks the desktop app's own host, which no surface may stop.",
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
                runtime: {
                  type: 'string',
                  enum: ['desktop', 'node'],
                  description: "'desktop' = the desktop app's own host (never a stop target); 'node' = a plain web instance."
                },
                sessions: { type: 'integer' },
                rss: { type: 'integer', description: 'Resident memory in bytes.' },
                startedAt: { type: 'integer', description: 'Epoch ms.' }
              }
            }
          }
        }
      },
      render: (_args, v) => text(v.instances.length
        ? ['port | state | pid | version | runtime | sessions', ...v.instances.map(rowLine)].join('\n')
        : 'no dsh instances found in the configured port spec')
    },
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    execute: async () => {
      const res = await api.listInstances()
      const instances = (res.items || []).map((it) => {
        // 删除而不置 null：输出 schema 没有可空节点。
        const row = {
          port: it.port,
          managed: !!it.managed,
          current: !!it.current,
          url: it.url || ('http://127.0.0.1:' + it.port + '/')
        }
        if (typeof it.pid === 'number') row.pid = it.pid
        if (it.source) row.source = it.source
        if (typeof it.version === 'string') row.version = it.version
        // 刻意不投影：列表器附带的 `name`（列出进程可执行文件的基本名）在每一行都
        // 相同，并不是被列实例的身份。
        if (it.runtime === 'desktop' || it.runtime === 'node') row.runtime = it.runtime
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
      'Launch one new dsh web instance on the first free port of the start range (default 3080-3129). ' +
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
          bin: { type: 'string', description: 'Absolute path of the dsh launcher this start actually used.' },
          binVersion: { type: 'string', description: 'Version of that launcher’s checkout; absent when it could not be read.' },
          code: { type: 'string' },
          error: { type: 'string' }
        }
      },
      render: (_args, v) => text(v.ok
        ? 'dsh instance started on port ' + v.port + ' (pid ' + v.pid + ')' +
          (v.bin ? ' with ' + v.bin + (v.binVersion ? ' (v' + v.binVersion + ')' : '') : '')
        : 'instance start failed: ' + (v.error || v.code || 'unknown reason'))
    },
    timeoutMs: 60000,
    execute: async () => projectLaunchResult(await api.start(), ['port', 'pid', 'bin', 'binVersion', 'code', 'error'])
  }),

  defineTool({
    name: 'instance_stop',
    description:
      'Gracefully stop ANOTHER local dsh web instance by port (its sessions persist via appExit). ' +
      'Refuses to stop the instance hosting this very conversation — use the sidebar panel for that. ' +
      "Refuses to stop the desktop app's own host (runtime 'desktop' in instance_list): stopping it would " +
      'leave the desktop window without a backend and in an error state. ' +
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
    name: 'instance_restart',
    description:
      'Gracefully restart ANOTHER local dsh web instance IN PLACE, on the same port: forward its stop, wait for the port to be released, ' +
      'then launch a fresh instance there and wait for it to answer its self report. ' +
      'The port is genuinely empty between the stop and the start — anything that grabs it in that window fails the restart with ' +
      'port_in_use, and this tool never moves to another port, because a different port is a different instance. ' +
      'Refuses the instance hosting this very conversation and the desktop app\'s own host.',
    parameters: {
      port: { type: 'integer', required: true, description: 'Target instance port, as reported by instance_list.' }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          restarted: { type: 'boolean', description: 'true only when a new instance answered on the same port.' },
          port: { type: 'integer' },
          pid: { type: 'integer' },
          code: { type: 'string' },
          error: { type: 'string' }
        }
      },
      render: (_args, v) => text(v.ok
        ? 'dsh instance restarted on port ' + v.port + ' (pid ' + v.pid + ')'
        : 'instance restart failed: ' + (v.error || v.code || 'unknown reason'))
    },
    timeoutMs: 60000,
    execute: async (args) => {
      if (!(typeof args.port === 'number' && Number.isInteger(args.port) && args.port >= 1 && args.port <= 65535)) {
        return { ok: false, code: 'bad_port', error: 'port must be an integer in [1, 65535]' }
      }
      return projectLaunchResult(await api.restart(args.port), ['restarted', 'port', 'pid', 'code', 'error'])
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
      // 宿主也会做归一化，但这个端口可能经由 fleet 链路转发给对端，因此在这里就
      // 拒绝，格式错误的值不会离开本机。规则与 instance_stop / instance_sessions
      // 相同。
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
      "Summarize an instance's live sessions: id, title, created-at epoch, working directory, subagent flag, lineage (agent preset, parent session, delegation depth) and event count — newest first, capped at 20 rows (total reflects the real live count). " +
      'The title and lineage fields come from optional host services: instances without them, and older remote instances, report rows that omit those keys. ' +
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
                title: { type: 'string', description: 'Folded session title; absent when the instance has no sessionTitle service or the session has no eligible input.' },
                cwd: { type: 'string' },
                subagent: { type: 'boolean' },
                agentPreset: { type: 'string', description: 'Preset the session’s agent was composed from; absent on older instances.' },
                parentSession: { type: 'string', description: 'Session this one was forked from; absent for a top-level session.' },
                delegationDepth: { type: 'integer', description: 'Present only when the session is a delegated child.' },
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
          (i + 1) + '. ' + (s.title || String(s.id).slice(0, 8)) +
          (s.cwd ? ' · ' + String(s.cwd).split(/[\\/]/).pop() : '') +
          (s.subagent ? ' · subagent' : '') +
          (s.agentPreset ? ' · ' + s.agentPreset : '') +
          (typeof s.delegationDepth === 'number' ? ' · depth ' + s.delegationDepth : '') +
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
 * 把启动/重启结果投影成工具声明返回的形状。
 *
 * 同一份宿主侧结果还要服务面板交接：`logSince` 用来只读取本次启动写下的 token 行，
 * `session` 记下持久化会话，`detail` 是找不到启动器时的候选路径。它们都不是模型的
 * 输出字段。输出根声明了 `additionalProperties: false`，混入任意一个都会让整个工具
 * 结果被宿主判为非法输出，因此只采纳声明过的键，缺失即省略而不是写 null。
 */
function projectLaunchResult(result, fields) {
  const r = result && typeof result === 'object' ? result : {}
  const out = { ok: r.ok === true }
  for (const key of fields) {
    const value = r[key]
    if (key === 'port' || key === 'pid') {
      if (Number.isInteger(value)) out[key] = value
    } else if (key === 'restarted') {
      if (value === true) out.restarted = true
    } else if (typeof value === 'string' && value !== '') {
      out[key] = value
    }
  }
  return out
}

/**
 * 把会话摘要投影成本工具声明返回的形状。
 *
 * 应答可能来自另一个实例——经由 fleet 链路的对端，或通过转发路由到达的旧版本本地
 * 面板——因此不能假定它的形状。这也是本工具做归一化、其余工具信任自己宿主侧的原因：
 *
 *   - 输出根声明了 `additionalProperties: false`，新旧版本新增的字段会变成
 *     ToolOutputError，而不是被当作值；
 *   - 应答中的 `sessions` 可选，而 `render()` 在成功路径上直接索引它，因此缺失或
 *     非数组时归一化为 `[]`，渲染为没有会话；
 *   - 缺少 schema 必填字段的行会让整个工具结果校验失败，因此直接丢弃，而不是填入
 *     编造的零值。
 *
 * 行数因此是存活行的数量，`total` 在上报方未提供时回退到该数量，绝不使用没有人
 * 测量过的数字。
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
        // 标题与谱系都是可选的：旧版本的本机实例与旧版本的远端实例都不返回它们，
        // 因此按类型逐个采纳，缺失即省略而不是写 null。
        if (typeof row.title === 'string' && row.title !== '') item.title = row.title
        if (typeof row.cwd === 'string' && row.cwd !== '') item.cwd = row.cwd
        if (row.subagent === true) item.subagent = true
        if (typeof row.agentPreset === 'string' && row.agentPreset !== '') item.agentPreset = row.agentPreset
        if (typeof row.parentSession === 'string' && row.parentSession !== '') item.parentSession = row.parentSession
        if (Number.isInteger(row.delegationDepth) && row.delegationDepth > 0) item.delegationDepth = row.delegationDepth
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
