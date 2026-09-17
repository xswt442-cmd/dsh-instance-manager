// Panel behaviour driven through a minimal React substitute.
//
// The host half is covered by routes.test.js, but the button that decides WHAT
// the host is asked for lives in the client, and a source-level assertion cannot
// see which parameters a click actually produces. These tests render the panel,
// dispatch a real click, and read both the request and the resulting render.
//
// `useState` keeps per-component-hook state and every `setState` marks a re-render;
// the driver re-renders until nothing is pending, so a click runs the same
// synchronous path the browser would.
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

// Turn a tree of elements into the tree React would commit: every function
// component is invoked, in the order React would call it, so hooks line up.
// A host element (a string tag) is returned as-is.
const resolve = (node) => {
  if (Array.isArray(node)) return node.map(resolve)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return resolve(node.type(node.props))
  if (typeof node.type === 'symbol') return resolve(node.children)
  return { type: node.type, props: node.props, children: (node.children || []).map(resolve) }
}

// Locate a component's source range by brace balance, so the driver does not
// depend on the component being exported (it is not: the client exposes the
// Cordis plugin only).
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

const mountPanel = ({ fetchImpl }) => {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const hooks = []
  let cursor = 0
  let dirty = false
  const effectDeps = []
  let effectCursor = 0
  let pending = []
  const registrations = []
  let definition = null
  let dockRoot = null

  // Hooks are keyed by call index. Every component in this bundle is called with
  // no props and no children, so a single counter is a faithful stand-in for the
  // dispatcher React installs while rendering.
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
      // Effects must actually run: the panel's initial list load is one of them,
      // and a mock that only records them leaves the panel on "Loading…" forever.
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
      body: { appendChild(value) { dockRoot = value } },
      documentElement: { dataset: {}, style: { setProperty() {} } },
      head: { appendChild() {} },
      createElement: makeElement,
      querySelector: () => null,
      // The panel registers document-level listeners while open; without these
      // the effect that installs them throws and the whole render pass aborts.
      addEventListener() {},
      removeEventListener() {}
    },
    window: { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load(value) { definition = value } } }
  }
  context.globalThis = context

  // Load the real bundle and take the component back out of the factory it
  // registers, so the component closes over the bundle's own scope rather than
  // over names this test would have to invent.
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

  // The overlay renders nothing until its dock entry is activated, so the driver
  // opens the panel the same way a user does: click the dock button.
  const entry = (dockRoot.children || []).find((child) => child.title === 'DSH Instance')
  assert.ok(entry, 'the dock entry must exist')
  entry.listeners.click()

  const flush = async () => {
    // Draining only microtasks is not enough: the click handlers `await` a real
    // fetch, so the driver keeps re-rendering until the tree is quiet across two
    // consecutive rounds. One round alone would sample the panel mid-request and
    // read the busy label as if it were final.
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

// The resolved tree mixes elements and arrays (a Fragment resolves to its
// children array), so traversal has to descend both. An element-only walk finds
// nothing at the top level, because the root itself is an array.
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

  // Empty field: the request must carry no port at all. An empty string would be
  // dropped by the client's own query builder, but a literal "0" or "undefined"
  // reaching the host is exactly the class of bug this asserts against.
  let tree = panel.renderTree()
  buttonByText(tree, /New instance/).props.onClick()
  await panel.flush()
  const startCalls = calls.filter((c) => /action=start/.test(c.url))
  assert.equal(startCalls.length, 1)
  assert.equal(startCalls[0].method, 'POST')
  assert.doesNotMatch(startCalls[0].url, /port=/, 'an empty field must not send a port')

  // Typed port: it must appear verbatim.
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
  // A button still labelled "Starting…" after the request settled is the panel
  // locking itself out of every later action.
  const after = buttonByText(panel.renderTree(), /New instance/)
  assert.ok(after, 'the start button must return to its idle label')
  assert.equal(after.props.disabled, false, 'the start button must be usable again')
})

test('a failed follow-up refresh still releases the busy state', async () => {
  // The clearing of `starting` used to sit AFTER the post-action refresh, so a
  // throw out of that refresh left the disabled "Starting…" button on screen —
  // the panel locked out of every later action, with the host perfectly healthy.
  let listCalls = 0
  const panel = mountPanel({
    fetchImpl: async (url) => {
      const query = String(url).split('?')[1] || ''
      if (/action=start/.test(query)) return { json: async () => ({ ok: true, port: 3081, pid: 2 }) }
      if (/action=list/.test(query)) {
        listCalls += 1
        // The first list load (the mount effect) succeeds; the refresh that
        // follows the start does not.
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
