import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

test('client contributes both DIM surfaces without occupying the sidebar footer', () => {
  let definition = null
  let styleElement = null
  let dockRoot = null
  const registered = []
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
      mount({ slots, on() {} })
    },
    on() {}
  })
  // Compared element-wise: `injected` is created inside the vm sandbox, so its
  // Array prototype is not reference-equal to this realm's.
  assert.equal(Array.isArray(injected), true)
  assert.deepEqual(Array.from(injected), ['slots'])

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
