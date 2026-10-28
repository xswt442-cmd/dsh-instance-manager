// 通过最小 React 替身驱动面板行为。
//
// 宿主侧由 routes.test.js 覆盖，但决定“向宿主请求什么”的按钮在客户端，源码级断言
// 看不出一次点击实际产生了哪些参数。这些测试渲染面板、派发真实点击，并读取请求与
// 渲染结果。
//
// `useState` 按组件 hook 保存状态，每次 `setState` 都标记需要重渲染；驱动重复渲染
// 直到没有待处理项，因此一次点击走的是浏览器会走的同一条同步路径。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const makeElement = () => ({
  style: { setProperty() {} },
  dataset: {},
  attributes: {},
  listeners: {},
  children: [],
  setAttribute(name, value) { this.attributes[name] = String(value) },
  addEventListener(name, listener) { this.listeners[name] = listener },
  appendChild(value) { this.children.push(value) },
  replaceChildren() { this.children = [] },
  remove() {}
})

// 把元素树转成 React 会提交的树：每个函数组件按 React 的调用顺序执行，hook 才能
// 对齐。宿主元素（字符串标签）原样返回。
const resolve = (node) => {
  if (Array.isArray(node)) return node.map(resolve)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return resolve(node.type(node.props))
  if (typeof node.type === 'symbol') return resolve(node.children)
  return { type: node.type, props: node.props, children: (node.children || []).map(resolve) }
}

// 已解析树中的第一个宿主 `button`，驱动据此调用 React 会接到点击上的处理器。
const findButton = (node) => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child)
      if (hit) return hit
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (node.type === 'button') return node
  return findButton(node.children)
}

// 按大括号配平定位组件源码范围，驱动因此不依赖组件被导出（它没有导出：客户端只暴露
// Cordis 插件）。
const componentSource = (source, name) => {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0, name + ' not found in the client bundle')
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced braces for ' + name)
}

const mountPanel = ({ fetchImpl, location }) => {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // 在 launcher 自己的渲染过程中重新赋值：React 的 hook 按组件实例区分，而本驱动
  // 用一个计数器按调用序号索引它们。
  let hooks = []
  let cursor = 0
  let dirty = false
  const effectDeps = []
  let effectCursor = 0
  let pending = []
  const registrations = []
  let definition = null

  // hook 按调用序号索引。本 bundle 中每个组件都不带 props 和 children 调用，因此一个
  // 计数器足以忠实代替 React 渲染时安装的 dispatcher。
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: Symbol('Fragment'),
    useState: (initial) => {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      return [hooks[i], (next) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; dirty = true }]
    },
    useRef: (initial) => {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = { current: initial }
      return hooks[i]
    },
    useEffect: (fn, deps) => {
      // effect 必须真正执行：面板首次列表加载就是其中之一，只记录不执行的 mock 会让
      // 面板永远停在“加载中…”。
      const i = effectCursor++
      const previous = effectDeps[i]
      const changed = !previous || !deps || deps.length !== previous.length ||
        deps.some((d, k) => d !== previous[k])
      if (changed) pending.push({ i, fn, deps })
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn
  }

  const context = {
    console,
    React,
    fetch: fetchImpl,
    setTimeout: () => 0,
    clearTimeout: () => {},
    AbortController: class { constructor() { this.signal = {} } abort() {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: { language: 'en' },
    document: {
      body: { appendChild() {} },
      documentElement: { dataset: {}, style: { setProperty() {} } },
      head: { appendChild() {} },
      createElement: makeElement,
      querySelector: () => null,
      // 面板打开时会注册 document 级监听器；缺少这些方法会让安装监听器的 effect
      // 抛出，整轮渲染随之中止。
      addEventListener() {},
      removeEventListener() {}
    },
    window: {
      addEventListener() {},
      removeEventListener() {},
      // 交接成功后客户端整页跳转到替代实例；默认吞掉，需要断言的用例传入自己的
      // location.replace。
      location: location || { replace() {} },
      __ModuleLoader__: { load(value) { definition = value } }
    }
  }
  context.globalThis = context

  // 加载真实 bundle，并从它注册的工厂里取回组件，让组件闭包落在 bundle 自己的作用域
  // 上，而不是本测试不得不编造的名字上。
  vm.runInNewContext(source, context, { filename: 'lib/client.js' })
  const factory = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected module request: ' + name)
  })
  const slots = {
    inject(name, factory2) { factory2() },
    register(options, render) { registrations.push({ options, render }); return () => {} }
  }
  factory.apply({
    inject(names, mount) {
      if (Array.from(names).indexOf('settingsScope') !== -1) return
      mount({ slots, on() {} })
    },
    on() {}
  })
  const panel = registrations.find((r) => r.options.id === 'instance-manager-panel')
  assert.ok(panel, 'the panel must register itself on shell.overlay')

  // 面板打开前 overlay 不渲染任何内容，因此驱动走与用户相同的两步：从图标打开
  // launcher 菜单，再选择本插件的行。每次渲染都有自己的 hook 作用域，面板的 hook
  // 不会被覆盖。
  const withHooks = (fn) => {
    const previous = hooks
    hooks = []
    cursor = 0
    effectCursor = 0
    try {
      return fn()
    } finally {
      hooks = previous
    }
  }
  const launcher = registrations.find((r) => r.options.id === 'utility-launcher')
  assert.ok(launcher, 'the launcher must register itself on the shell overlay layer')
  const menuIcon = withHooks(() => findButton(resolve(launcher.render())))
  assert.ok(menuIcon, 'the launcher must render a button')
  menuIcon.props.onClick()
  const item = registrations.find((r) => r.options.id === 'instance-manager')
  assert.ok(item, 'this plugin must contribute a row to the launcher menu')
  const menuRow = withHooks(() => findButton(resolve(item.render())))
  assert.ok(menuRow, 'the row must render a button')
  menuRow.props.onClick()

  const flush = async () => {
    // 只排空微任务不够：点击处理器会 `await` 真实 fetch，因此驱动持续重渲染，直到
    // 树连续两轮安静。只跑一轮会在请求中途采样面板，把忙碌标签当成最终结果。
    let quiet = 0
    for (let round = 0; round < 200 && quiet < 2; round++) {
      cursor = 0
      effectCursor = 0
      dirty = false
      pending = []
      resolve(panel.render())
      const toRun = pending
      for (const { i, fn, deps } of toRun) {
        effectDeps[i] = deps
        fn()
      }
      quiet = (dirty || toRun.length > 0) ? 0 : quiet + 1
      await new Promise((r) => setImmediate(r))
    }
  }
  const renderTree = () => { cursor = 0; return resolve(panel.render()) }
  return { flush, panel, renderTree }
}

// 已解析的树混合元素与数组（Fragment 解析为其 children 数组），遍历必须同时下降
// 两者。只走元素的遍历在顶层找不到任何东西，因为根本身是数组。
const findAll = (node, predicate, out = []) => {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  if (node.type && predicate(node)) out.push(node)
  for (const child of node.children || []) findAll(child, predicate, out)
  return out
}

const textOf = (node) => {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children || []).map(textOf).join('')
}
const LIST_ONE = {
  ok: true,
  selfVersion: '0.9.10',
  items: [{ port: 3080, managed: true, current: false, ui: true, rowKey: 'local:3080', pid: 1, startedAt: 0 }]
}

const panelWithFetch = (overrides = {}) => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' })
    const query = String(url).split('?')[1] || ''
    let payload = { ok: true }
    if (/action=list/.test(query)) payload = LIST_ONE
    else if (/action=start/.test(query)) payload = overrides.start || { ok: true, port: 3081, pid: 2 }
    return { json: async () => payload }
  }
  const panel = mountPanel({ fetchImpl })
  return { panel, calls }
}

const buttonByText = (tree, matcher) =>
  findAll(tree, (n) => n.type === 'button' && matcher.test(textOf(n)))[0]

test('the start button sends the typed port, and omits it when left empty', async () => {
  const { panel, calls } = panelWithFetch()
  await panel.flush()

  // 空字段：请求完全不能携带 port。空字符串会被客户端的查询构造器丢弃，但字面量
  // "0" 或 "undefined" 到达宿主正是这里要防的一类缺陷。
  let tree = panel.renderTree()
  buttonByText(tree, /New instance/).props.onClick()
  await panel.flush()
  const startCalls = calls.filter((c) => /action=start/.test(c.url))
  assert.equal(startCalls.length, 1)
  assert.equal(startCalls[0].method, 'POST')
  assert.doesNotMatch(startCalls[0].url, /port=/, 'an empty field must not send a port')

  // 输入的端口必须原样出现。
  const { panel: panel2, calls: calls2 } = panelWithFetch()
  await panel2.flush()
  tree = panel2.renderTree()
  const input = findAll(tree, (n) => n.type === 'input')[0]
  assert.ok(input, 'the port field must be rendered')
  input.props.onChange({ target: { value: '3333' } })
  await panel2.flush()
  tree = panel2.renderTree()
  buttonByText(tree, /New instance/).props.onClick()
  await panel2.flush()
  const typed = calls2.filter((c) => /action=start/.test(c.url))
  assert.equal(typed.length, 1)
  assert.match(typed[0].url, /port=3333/)
})

test('the start button leaves the busy state after the host answers', async () => {
  const { panel } = panelWithFetch()
  await panel.flush()
  buttonByText(panel.renderTree(), /New instance/).props.onClick()
  await panel.flush()
  // 请求结束后按钮仍标着“启动中…”，等于面板把自己锁在所有后续操作之外。
  const after = buttonByText(panel.renderTree(), /New instance/)
  assert.ok(after, 'the start button must return to its idle label')
  assert.equal(after.props.disabled, false, 'the start button must be usable again')
})

test('a failed follow-up refresh still releases the busy state', async () => {
  // `starting` 在运行操作后刷新的同一个 finally 中复位，且早于刷新：刷新抛出异常
  // 时，屏幕上绝不能留下被禁用的“启动中…”按钮——那会让面板锁在所有后续操作之外。
  let listCalls = 0
  const panel = mountPanel({
    fetchImpl: async (url) => {
      const query = String(url).split('?')[1] || ''
      if (/action=start/.test(query)) return { json: async () => ({ ok: true, port: 3081, pid: 2 }) }
      if (/action=list/.test(query)) {
        listCalls += 1
        // 首次列表加载（挂载 effect）成功；start 之后的刷新失败。
        if (listCalls > 1) throw new Error('list read failed')
        return { json: async () => LIST_ONE }
      }
      return { json: async () => ({ ok: true }) }
    }
  })
  await panel.flush()
  buttonByText(panel.renderTree(), /New instance/).props.onClick()
  await panel.flush()
  const after = buttonByText(panel.renderTree(), /New instance/)
  assert.ok(after, 'a failed refresh must not leave the button on its busy label')
  assert.equal(after.props.disabled, false, 'the start button must be usable again')
})

test('the start button reports a refused port instead of staying busy', async () => {
  const { panel } = panelWithFetch({
    start: { ok: false, code: 'port_in_use', port: 3333, error: 'port 3333 is already in use' }
  })
  await panel.flush()
  const input = findAll(panel.renderTree(), (n) => n.type === 'input')[0]
  input.props.onChange({ target: { value: '3333' } })
  await panel.flush()
  buttonByText(panel.renderTree(), /New instance/).props.onClick()
  await panel.flush()
  const tree = panel.renderTree()
  assert.ok(buttonByText(tree, /New instance/), 'the button must return to idle after a refusal')
  assert.match(textOf(tree), /already in use/, 'the host error must reach the panel')
})

test('the stop button arms in a warning state and only stops on the second click', async () => {
  const { panel, calls } = panelWithFetch()
  await panel.flush()
  const stop = buttonByText(panel.renderTree(), /Stop/)
  assert.ok(stop, 'a stoppable row must render a stop button')
  assert.equal(stop.props.className, 'dshim-btn-danger', 'idle state keeps the error outline')

  stop.props.onClick({ stopPropagation() {} })
  await panel.flush()
  const armed = buttonByText(panel.renderTree(), /Confirm/)
  assert.ok(armed, 'the first click must arm rather than stop')
  assert.equal(armed.props.className, 'dshim-btn-warn', 'the armed state uses the warning style')
  assert.equal(calls.filter((c) => /action=stop/.test(c.url)).length, 0, 'arming must not stop anything')

  armed.props.onClick({ stopPropagation() {} })
  await panel.flush()
  assert.equal(calls.filter((c) => /action=stop/.test(c.url)).length, 1, 'the second click performs the stop')
})

// 诊断面是抽屉里的第三个标签。它读的是本机共享文件，因此必须带上该实例的 pid——
// 崩溃记录用它区分本机的多个实例，而 pid 只有实例列表里有。
const DIAGNOSTICS_REPLY = {
  ok: true,
  port: 3080,
  pid: 1,
  crash: { exists: true, truncated: false, lines: ['[t] uncaughtException pid=1 port=3080', 'Error: boom'] },
  selfExit: { exists: true, truncated: false, lines: ['[t] self-exit trigger=stop-self pid=1 port=3080'] },
  requests: { exists: true, truncated: false, lines: ['[t] action=stop instance=3080 peer=127.0.0.1 ua=browser'] }
}

const panelWithDiagnostics = () => {
  const calls = []
  const panel = mountPanel({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: (init && init.method) || 'GET' })
      const query = String(url).split('?')[1] || ''
      if (/action=diagnostics/.test(query)) return { json: async () => DIAGNOSTICS_REPLY }
      if (/action=list/.test(query)) return { json: async () => LIST_ONE }
      return { json: async () => ({ ok: true }) }
    }
  })
  return { panel, calls }
}

test('the diagnostics tab asks the host for that instance and shows what the request log records', async () => {
  const { panel, calls } = panelWithDiagnostics()
  await panel.flush()

  // 先展开该行。
  const row = findAll(panel.renderTree(), (n) => n.type === 'div' && /dshim-row/.test(n.props.className))[0]
  assert.ok(row, 'the panel must render an instance row')
  row.props.onClick()
  await panel.flush()

  const diagTab = buttonByText(panel.renderTree(), /Diagnostics/)
  assert.ok(diagTab, 'the drawer must offer a diagnostics tab')
  diagTab.props.onClick()
  await panel.flush()

  const diagCalls = calls.filter((c) => /action=diagnostics/.test(c.url))
  assert.equal(diagCalls.length, 1, '点击标签只读取一次诊断面')
  assert.match(diagCalls[0].url, /port=3080/, '请求必须带上该行的端口')
  assert.match(diagCalls[0].url, /pid=1/, '崩溃记录按 pid 归属，因此 pid 必须一起发出')
  assert.doesNotMatch(diagCalls[0].url, /peer=/, '诊断面不走 fleet，因此不得发 peer')

  const text = textOf(panel.renderTree())
  assert.match(text, /uncaughtException pid=1/, '崩溃记录出现在抽屉里')
  // 写操作追踪含有对端地址与 User-Agent，读者必须先看到这份说明。
  assert.match(text, /peer address/)
  assert.match(text, /peer=127\.0\.0\.1/)
})

test('a remote row offers no diagnostics tab, since the files are local', async () => {
  const remote = {
    ok: true,
    selfVersion: '0.9.10',
    items: [{ port: 3080, managed: true, current: false, ui: true, remote: true, source: 'lab', pid: 9, rowKey: 'lab:3080' }]
  }
  const panel = mountPanel({
    fetchImpl: async (url) => {
      const query = String(url).split('?')[1] || ''
      return { json: async () => (/action=list/.test(query) ? remote : { ok: true }) }
    }
  })
  await panel.flush()
  const row = findAll(panel.renderTree(), (n) => n.type === 'div' && /dshim-row/.test(n.props.className))[0]
  row.props.onClick()
  await panel.flush()
  const tabs = findAll(panel.renderTree(), (n) => n.type === 'button')
  const labels = tabs.map(textOf)
  assert.ok(labels.includes('stdout') && labels.includes('stderr'))
  assert.equal(labels.includes('Diagnostics'), false, '远端行挂上它只会读到本机同号端口的记录')
})

// 重启与停止一样是破坏性操作，因此同样两步确认。两者共用一个按行索引的确认状态，
// 不记动作就无法分辨待确认的是哪一个按钮——这是共用状态机必须守住的那条性质。
test('the restart button arms before restarting, on its own port', async () => {
  const { panel, calls } = panelWithFetch()
  await panel.flush()
  const restart = buttonByText(panel.renderTree(), /^Restart$/)
  assert.ok(restart, 'a stoppable non-current row must render a restart button')
  assert.equal(restart.props.disabled, false)

  restart.props.onClick({ stopPropagation() {} })
  await panel.flush()
  assert.equal(calls.filter((c) => /action=restart/.test(c.url)).length, 0, 'arming must not restart anything')
  const armed = buttonByText(panel.renderTree(), /Confirm restart/)
  assert.ok(armed, 'the first click must arm rather than restart')
  assert.equal(armed.props.className, 'dshim-btn-warn')
  // 待确认的只有一个动作：停止按钮不得同时进入待确认状态。
  assert.equal(buttonByText(panel.renderTree(), /^Confirm\?$/), undefined,
    '两个按钮共用一个确认键时，待确认的必须是被点击的那一个')

  armed.props.onClick({ stopPropagation() {} })
  await panel.flush()
  const restartCalls = calls.filter((c) => /action=restart/.test(c.url))
  assert.equal(restartCalls.length, 1, 'the second click performs the restart')
  assert.equal(restartCalls[0].method, 'POST', '重启是写操作，必须 POST')
  assert.match(restartCalls[0].url, /port=3080/, '重启的是这一行的原端口')
})

test('the session row shows the folded title and lineage instead of a bare short id', async () => {
  const withSession = (sessions) => {
    const panel = mountPanel({
      fetchImpl: async (url) => {
        const query = String(url).split('?')[1] || ''
        if (/action=list/.test(query)) return { json: async () => LIST_ONE }
        if (/action=sessions/.test(query)) return { json: async () => ({ ok: true, port: 3080, total: sessions.length, sessions }) }
        return { json: async () => ({ ok: true }) }
      }
    })
    return panel
  }

  const panel = withSession([
    {
      id: 'abcdef0123456789',
      createdAt: 1,
      title: 'fix login redirect',
      cwd: '/w/myproject',
      agentPreset: 'reviewer',
      parentSession: 'aaa',
      delegationDepth: 2,
      events: 47
    }
  ])
  await panel.flush()
  const row = findAll(panel.renderTree(), (n) => n.type === 'div' && /dshim-row/.test(n.props.className))[0]
  row.props.onClick()
  await panel.flush()
  const text = textOf(panel.renderTree())
  assert.match(text, /fix login redirect/, '折叠标题替代没有辨识度的短 id')
  assert.doesNotMatch(text, /abcdef01/, '有标题时不再显示短 id')
  assert.match(text, /myproject/)
  assert.match(text, /\[reviewer\]/, '预设说明这个会话由哪个预设组装')
  assert.match(text, /↧2/, '委派深度把它与顶层会话区分开')
  assert.match(text, /47 ev/)

  // 旧实例的应答只有 id：短 id 必须原样保留，而不是渲染成空。
  const legacy = withSession([{ id: 'abcdef0123456789', createdAt: 1, cwd: '/w/myproject', events: 47 }])
  await legacy.flush()
  const legacyRow = findAll(legacy.renderTree(), (n) => n.type === 'div' && /dshim-row/.test(n.props.className))[0]
  legacyRow.props.onClick()
  await legacy.flush()
  assert.match(textOf(legacy.renderTree()), /abcdef01/)
})

test('the restart button stays disabled on the current instance when no session tool is available', async () => {
  const current = {
    ok: true,
    selfVersion: '0.9.10',
    items: [{ port: 3080, managed: true, current: true, ui: true, pid: 1, startedAt: 0 }]
  }
  const panel = mountPanel({
    fetchImpl: async (url) => {
      const query = String(url).split('?')[1] || ''
      return { json: async () => (/action=list/.test(query) ? current : { ok: true }) }
    }
  })
  await panel.flush()
  const restart = buttonByText(panel.renderTree(), /^Restart$/)
  assert.ok(restart)
  assert.equal(restart.props.disabled, true, '没有可托管的会话时，重启仍会带走正在服务面板的进程')
  assert.match(restart.props.title, /no tmux or screen/)
  // 停止仍然可用：这两道关卡各自拒绝各自的动作。
  assert.equal(buttonByText(panel.renderTree(), /Stop current/).props.disabled, false)
})

test('the current instance restarts by handing off to a session and navigating to the replacement', async () => {
  const current = {
    ok: true,
    selfVersion: '0.9.10',
    selfSession: 'tmux',
    items: [{ port: 3080, managed: true, current: true, ui: true, pid: 1, startedAt: 0 }]
  }
  const calls = []
  const navigations = []
  const panel = mountPanel({
    location: { replace: (url) => navigations.push(url) },
    fetchImpl: async (url) => {
      calls.push(String(url))
      const query = String(url).split('?')[1] || ''
      if (/action=list/.test(query)) return { json: async () => current }
      return {
        json: async () => ({
          ok: true,
          code: 'handoff',
          port: 3081,
          session: { tool: 'tmux', name: 'dshim-3081' },
          url: 'http://127.0.0.1:3081/?token=TESTTOKEN'
        })
      }
    }
  })
  await panel.flush()
  const restart = buttonByText(panel.renderTree(), /^Restart$/)
  assert.ok(restart, 'a detected session tool makes the current instance restartable')
  assert.equal(restart.props.disabled, false)
  assert.match(restart.props.title, /tmux\/screen/)

  restart.props.onClick({ stopPropagation() {} })
  await panel.flush()
  const armed = buttonByText(panel.renderTree(), /Confirm restart/)
  assert.ok(armed, 'handoff still asks for confirmation first')
  armed.props.onClick({ stopPropagation() {} })
  await panel.flush()

  const restartCalls = calls.filter((u) => /action=restart/.test(u))
  assert.equal(restartCalls.length, 1)
  assert.match(restartCalls[0], /port=3080/)
  // 交接成功不是"刷新当前页面"：旧进程即将退出，页面必须直接落到替代实例上。
  assert.deepEqual(navigations, ['http://127.0.0.1:3081/?token=TESTTOKEN'])
  assert.equal(calls.filter((u) => /action=list/.test(u)).length, 1,
    '跳转后不再刷新旧实例的列表')
})
