import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// The browser half owns no dock of its own any more: the launcher is one entry
// in the host's `conversation.composer.dock` seat, and the panel plus the fleet
// toasts stay on `shell.overlay`. Both halves of that split are asserted here,
// because a registration that silently never happens leaves the UI with nothing
// to click and no error anywhere.
test('the client registers a composer-dock launcher and two overlay surfaces', () => {
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
      // This plugin's row joins the family menu; its panel and toasts ride the
      // frame-wide overlay layer.
      assert.ok(name === 'createhelper.utility.item' || name === 'shell.overlay', name)
      mount()
    },
    register(options, render) {
      registered.push({ options, render })
    }
  }
  let injected = null
  plugin.apply({
    // The plugin must not probe `slots` with a one-shot get: a miss used to
    // leave the panel silently absent. It waits through ctx.inject instead.
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
  // Compared element-wise: `injected` is created inside the vm sandbox, so its
  // Array prototype is not reference-equal to this realm's.
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
  // The launcher declares the menu's child seat, which is what authorizes every
  // family member to contribute a row to it. JSON round-tripped: the options come
  // from the vm sandbox, so their prototypes are not this realm's.
  assert.deepEqual(JSON.parse(JSON.stringify(registered[1].options.children)), {
    'createhelper.utility.item': { kind: 'list', scope: 'root' }
  })
  assert.equal(typeof registered[0].options.order, 'number',
    'the seat orders entries; a launcher without an order lands wherever')
  assert.equal(registered.every((entry) => typeof entry.render === 'function'), true)
  assert.equal((source.match(/appTitle: 'DSH Instance'/g) || []).length, 2,
    'both panel languages use the same product title')

  // Nothing may go back to floating a container over the page: that container is
  // what covered the composer's own controls, and the host seat replaces it.
  assert.equal(bodyChild, null, 'the client must not append a floating container to body')
  assert.equal(context.window.__CREATEHELPER_DSH_UTILITY_DOCK_V1__, undefined,
    'the retired page-local dock protocol stays out of the bundle')
  assert.doesNotMatch(source, /getUtilityDock|CREATEHELPER_DSH_UTILITY_DOCK/)
})

test('0.1.7 serves preferences through configForms, which wins over a concurrent settingsScope', () => {
  // The service was renamed: `settingsScope.bind()` up to 0.1.5,
  // `configForms.get(ns)` from 0.1.7-rc.1. Both are injected at runtime, so
  // whichever exists binds — and when both are somehow present the newer one
  // must be the only binder, or preferences would be applied twice.
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
