import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

test('client contributes both DIM surfaces without occupying the sidebar footer', () => {
  let definition = null
  let styleElement = null
  const registered = []
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const makeElement = () => ({
    style: { setProperty() {} },
    dataset: {},
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
})
