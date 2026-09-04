import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

test('client contributes both DIM surfaces without occupying the sidebar footer', () => {
  let definition = null
  let styleElement = null
  let dockRoot = null
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
      body: { appendChild(value) { dockRoot = value } },
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
      assert.equal(name, 'shell.overlay')
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
        // Benign binder: an unavailable namespace keeps the localStorage value.
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

  assert.deepEqual(registered.map(entry => entry.options.id), [
    'instance-manager-panel',
    'instance-manager-fleet-toasts'
  ])
  assert.equal(registered.every(entry => entry.options.name === 'shell.overlay'), true)
  assert.equal(registered.every(entry => typeof entry.render === 'function'), true)
  const dock = context.window.__CREATEHELPER_DSH_UTILITY_DOCK_V1__
  assert.equal(dock.protocol, 'createhelper.dsh.utility-dock')
  assert.equal(dock.version, 1)
  assert.equal(dockRoot.children[0].title, 'DSH Instance')
  assert.equal((source.match(/appTitle: 'DSH Instance'/g) || []).length, 2,
    'both panel languages use the same product title')

  dockRoot.children[0].listeners.click()
  assert.equal(dockRoot.children[0].attributes['aria-pressed'], 'true')
  const other = dock.register({ id: 'other-panel', label: 'other', icon: '', onActivate() {} })
  dockRoot.children.find(child => child.title === 'other').listeners.click()
  assert.equal(dockRoot.children.find(child => child.title === 'DSH Instance').attributes['aria-pressed'], 'false',
    'opening another dock item deactivates the active panel')
  other.dispose()

  const first = dock.register({ id: 'reload-probe', label: 'old', icon: '', onActivate() {} })
  const second = dock.register({ id: 'reload-probe', label: 'new', icon: '', onActivate() {} })
  first.dispose()
  assert.equal(dockRoot.children.some(child => child.title === 'new'), true,
    'an obsolete registration must not remove its HMR replacement')
  second.dispose()
})

test('dock placement migrates from localStorage and then follows settings snapshots', () => {
  let definition = null
  let styleElement = null
  let dockRoot = null
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
  const storage = { 'createhelper.utilityDock.placement': 'main-bottom-right' }
  const context = {
    localStorage: {
      getItem: (key) => (key in storage ? storage[key] : null),
      setItem: (key, value) => { storage[key] = String(value) }
    },
    document: {
      body: { appendChild(value) { dockRoot = value } },
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
  const plugin = definition.factory(() => ({ createElement() {} }))

  // The dock must exist so placement changes flow through the shared
  // protocol (localStorage mirror + geometry), exactly like production.
  const slots = {
    inject(name, factory) { factory() },
    register() { return () => {} }
  }
  let snapshot = { status: 'loading', value: undefined, user: undefined }
  const listeners = new Set()
  const sets = []
  const scope = {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(field, value) { sets.push([field, value]); return Promise.resolve() }
  }
  plugin.apply({
    inject(names, mount) {
      if (Array.from(names).indexOf('settingsScope') !== -1) mount({ bind: () => scope })
      else mount({ slots, on() {} })
    },
    on() {}
  })

  // While loading, nothing is applied and nothing is migrated yet.
  assert.deepEqual(sets, [])
  const placementAttr = () => context.document.documentElement.dataset.createhelperUtilityDockPlacement

  // First ready snapshot: the legacy localStorage value migrates ONCE into
  // the user layer, and stays effective until the host commit round-trips.
  snapshot = {
    status: 'ready',
    value: { dockPlacement: 'main-bottom-left', refreshIntervalMs: 4000 },
    user: {}
  }
  for (const fn of Array.from(listeners)) fn()
  assert.deepEqual(sets, [['dockPlacement', 'main-bottom-right']])
  assert.equal(placementAttr(), 'main-bottom-right',
    'the migrated value wins over the (default) snapshot until the commit lands')
  assert.equal(storage['createhelper.utilityDock.placement'], 'main-bottom-right')

  // Host commit: the user layer now carries the field; settings is
  // authoritative and the pending legacy value is dropped.
  snapshot = {
    status: 'ready',
    value: { dockPlacement: 'main-bottom-right', refreshIntervalMs: 4000 },
    user: { dockPlacement: 'main-bottom-right' }
  }
  for (const fn of Array.from(listeners)) fn()
  assert.deepEqual(sets, [['dockPlacement', 'main-bottom-right']], 'migration never writes twice')
  assert.equal(placementAttr(), 'main-bottom-right')

  // A settings edit repositions the dock and keeps the localStorage mirror.
  snapshot = {
    status: 'ready',
    value: { dockPlacement: 'hidden', refreshIntervalMs: 8000 },
    user: { dockPlacement: 'hidden' }
  }
  for (const fn of Array.from(listeners)) fn()
  assert.equal(placementAttr(), 'hidden')
  assert.equal(storage['createhelper.utilityDock.placement'], 'hidden')
})

test('unavailable settings keep the localStorage placement instead of defaults', () => {
  let definition = null
  let styleElement = null
  let dockRoot = null
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
  const storage = { 'createhelper.utilityDock.placement': 'hidden' }
  const context = {
    localStorage: {
      getItem: (key) => (key in storage ? storage[key] : null),
      setItem: (key, value) => { storage[key] = String(value) }
    },
    document: {
      body: { appendChild(value) { dockRoot = value } },
      documentElement: { dataset: {}, style: { setProperty() {} } },
      head: { appendChild(value) { styleElement = value } },
      createElement: makeElement,
      querySelector() { return null }
    },
    window: {
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: { load(value) { definition = value } }
    }
  }
  vm.runInNewContext(source, context, { filename: 'lib/client.js' })
  const plugin = definition.factory(() => ({ createElement() {} }))
  plugin.apply({
    inject(names, mount) {
      if (Array.from(names).indexOf('settingsScope') !== -1) {
        mount({
          bind: () => ({
            getSnapshot: () => ({ status: 'unavailable' }),
            subscribe() { return () => { } }
          })
        })
        return
      }
      mount({ slots: { inject(name, factory) { factory() }, register() { return () => {} } }, on() {} })
    },
    on() {}
  })
  assert.equal(context.document.documentElement.dataset.createhelperUtilityDockPlacement, 'hidden',
    'memory mode / unexposed namespace falls back to the localStorage value')
})
