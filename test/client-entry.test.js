import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// 浏览器侧的注册面：launcher 菜单一行、launcher 自身、面板与 fleet 提示。注册静静
// 地没有发生，界面就没有可点的入口，也不会在任何地方报错，因此这里逐项断言。
test('the client registers the utility launcher and two overlay surfaces', () => {
  let definition = null
  let styleElement = null
  let bodyChild = null
  const registered = []
  let localeNamespace = null
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
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
  const context = {
    document: {
      body: { appendChild(value) { bodyChild = value } },
      documentElement: { dataset: {}, style: { setProperty() {} } },
      head: { appendChild(value) { styleElement = value } },
      createElement: makeElement,
      querySelector(selector) {
        return selector.startsWith('style[') ? styleElement : null
      }
    },
    window: {
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: { load(value) { definition = value } }
    }
  }

  vm.runInNewContext(source, context, { filename: 'lib/client.js' })
  assert.equal(definition.id, 'dsh-instance-manager')
  const plugin = definition.factory((name) => {
    assert.equal(name, 'react')
    return { createElement() {} }
  })

  const slots = {
    inject(name, mount) {
      // 本插件的行加入 launcher 菜单；面板与提示挂在整帧的 overlay 层。
      assert.ok(name === 'createhelper.utility.item' || name === 'shell.overlay', name)
      mount()
    },
    register(options, render) {
      registered.push({ options, render })
    }
  }
  let injected = null
  plugin.apply({
    // 插件不得只探测一次 `slots`：错过会让面板消失且没有任何报告。它通过
    // ctx.inject 等待。
    inject(names, mount) {
      injected = names
      if (Array.from(names).indexOf('locale') !== -1) {
        mount({
          locale: {
            register(namespace, dictionaries) {
              localeNamespace = namespace
              assert.equal(typeof dictionaries.zh.appTitle, 'string')
              return () => {}
            },
            getSnapshot: () => ({ active: 'zh' }),
            subscribe: () => () => {}
          },
          on() {}
        })
        return
      }
      if (Array.from(names).indexOf('settingsScope') !== -1) {
        mount({
          bind: () => ({
            getSnapshot: () => ({ status: 'unavailable' }),
            subscribe() { return () => { } }
          })
        })
        return
      }
      mount({ slots, on() {} })
    },
    on() {}
  })
  // 逐元素比较：`injected` 在 vm 沙箱里创建，其 Array 原型与本 realm 不是同一引用。
  assert.equal(Array.isArray(injected), true)
  assert.deepEqual(Array.from(injected), ['settingsScope'],
    'the settings binding is injected last; the slots injection above already ran')
  assert.equal(localeNamespace, 'dsh-instance-manager')
  assert.doesNotMatch(source, /dshim-lang/, 'language persistence belongs to DSH locale')

  assert.deepEqual(registered.map((entry) => entry.options.id), [
    'instance-manager',
    'utility-launcher',
    'instance-manager-panel',
    'instance-manager-fleet-toasts'
  ])
  assert.deepEqual(registered.map((entry) => entry.options.name), [
    'createhelper.utility.item',
    'shell.overlay',
    'shell.overlay',
    'shell.overlay'
  ])
  // launcher 声明菜单的子座位，其他插件因此有权向其中贡献一行。用 JSON 往返转换：
  // 选项来自 vm 沙箱，原型不属于本 realm。
  assert.deepEqual(JSON.parse(JSON.stringify(registered[1].options.children)), {
    'createhelper.utility.item': { kind: 'list', scope: 'root' }
  })
  assert.equal(typeof registered[0].options.order, 'number',
    'the seat orders entries; a launcher without an order lands wherever')
  assert.equal(registered.every((entry) => typeof entry.render === 'function'), true)
  assert.equal((source.match(/appTitle: 'DSH Instance'/g) || []).length, 2,
    'both panel languages use the same product title')

  // 客户端不得在 body 上挂浮层容器：那种容器会遮住输入区自己的控件，宿主座位取代了
  // 它的位置。
  assert.equal(bodyChild, null, 'the client must not append a floating container to body')
  assert.equal(context.window.__CREATEHELPER_DSH_UTILITY_DOCK_V1__, undefined,
    'the bundle registers through slots and carries no page-local dock protocol')
  assert.doesNotMatch(source, /getUtilityDock|CREATEHELPER_DSH_UTILITY_DOCK/)

  // 抽屉的内存走势头部依赖这个类名，样式表必须声明同一拼写。
  assert.match(styleElement.textContent, /\.dshim-sparhead\{/)
  assert.match(source, /className: 'dshim-sparhead'/)
})

test('0.1.7 serves preferences through configForms, which wins over a concurrent settingsScope', () => {
  // 该服务有两个名字：0.1.5 及以前是 `settingsScope.bind()`，0.1.7-rc.1 起是
  // `configForms.get(ns)`。两者都是运行时注入，存在哪个就用哪个绑定——两者同时存在
  // 时只有较新的那个可以绑定，否则偏好会被应用两次。
  let definition = null
  let styleElement = null
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const makeElement = () => ({
    style: { setProperty() {} },
    dataset: {},
    attributes: {},
    listeners: {},
    children: [],
    setAttribute() {},
    addEventListener() {},
    appendChild(value) { this.children.push(value) },
    replaceChildren() { this.children = [] },
    remove() {}
  })
  const context = {
    document: {
      body: { appendChild() {} },
      documentElement: { dataset: {}, style: { setProperty() {} } },
      head: { appendChild(value) { styleElement = value } },
      createElement: makeElement,
      querySelector: (selector) => (selector.startsWith('style[') ? styleElement : null)
    },
    window: {
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: { load(value) { definition = value } }
    }
  }
  vm.runInNewContext(source, context, { filename: 'lib/client.js' })
  const plugin = definition.factory(() => ({ createElement() {} }))

  const slots = { inject(name, factory) { factory() }, register() { return () => {} } }
  let bindCalls = 0
  let servedNamespace = null
  const scope = {
    getSnapshot: () => ({
      status: 'ready',
      value: { refreshIntervalMs: 8000 },
      user: {}
    }),
    subscribe() { return () => {} },
    set() { return Promise.resolve() }
  }
  plugin.apply({
    inject(names, mount) {
      const list = Array.from(names)
      if (list.indexOf('configForms') !== -1) {
        mount({ configForms: { get(ns) { servedNamespace = ns; return scope } } })
        return
      }
      if (list.indexOf('settingsScope') !== -1) {
        mount({ bind() { bindCalls++; return scope } })
        return
      }
      mount({ slots, on() {} })
    },
    on() {}
  })

  assert.equal(servedNamespace, 'dsh-instance-manager', 'the namespace is the same on both services')
  assert.equal(bindCalls, 0, 'configForms binds first; the older service must not bind a second time')
})
