// The dock renders whatever markup a registrant hands over, and the dock DOM
// belongs to whichever plugin created it — so the icon gate is the only thing
// between another plugin's `icon` string and this plugin's page. `safeDockIcon`
// lives inside the client bundle's closure, so it can only be observed through
// what actually reaches the button. These tests assert on the DOM, not on the
// predicate, and reuse dsh-ballast's icon table so the three docks agree on
// what an icon is.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const SOURCE = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const DOCK_KEY = '__CREATEHELPER_DSH_UTILITY_DOCK_V1__'

/** Boot the client bundle in a reduced DOM and return the live dock. */
function bootDock() {
  let definition = null
  let dockRoot = null
  const makeElement = () => ({
    style: { setProperty() { } },
    dataset: { },
    attributes: { },
    listeners: { },
    children: [],
    innerHTML: '',
    textContent: '',
    setAttribute(name, value) { this.attributes[name] = String(value) },
    getAttribute(name) { return this.attributes[name] },
    addEventListener(name, listener) { this.listeners[name] = listener },
    appendChild(value) { this.children.push(value) },
    replaceChildren() { this.children = [] },
    remove() { }
  })
  const context = {
    document: {
      body: { appendChild(value) { dockRoot = value } },
      documentElement: { dataset: { }, style: { setProperty() { } } },
      head: { appendChild() { } },
      createElement: makeElement,
      querySelector() { return null }
    },
    window: {
      addEventListener() { },
      removeEventListener() { },
      __ModuleLoader__: { load(value) { definition = value } }
    }
  }

  vm.runInNewContext(SOURCE, context, { filename: 'lib/client.js' })
  const plugin = definition.factory((name) => {
    if (name !== 'react') throw new Error('unexpected import: ' + name)
    return { createElement() { } }
  })
  plugin.apply({
    get() { },
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
      mount({ slots: { register() { }, inject(name, mountSlot) { mountSlot() } }, on() { } })
    },
    on() { }
  })

  return {
    dock: context.window[DOCK_KEY],
    /** The dock button rendered for one registered id. */
    button(id) {
      const found = (dockRoot?.children || []).find((el) => el.dataset.createhelperDockItem === id)
      assert.ok(found, 'no dock button registered for ' + id)
      return found
    }
  }
}

const item = (id, label, extra) => ({ id, label, onActivate() { }, ...extra })

test('a presentational svg reaches the button; anything else falls back to the label', () => {
  const { dock, button } = bootDock()
  const admitted = [
    '<svg></svg>',
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 5h16M6 12h12M9 19h6"></path></svg>',
    '<svg><g transform="translate(1 1)"><circle cx="4" cy="4" r="2"></circle></g></svg>',
    '  <svg><rect x="1" y="2" width="3" height="4"></rect></svg>  ',
    '<svg fill="url(#grad)"><path d="M0 0"></path></svg>'
  ]
  admitted.forEach((icon, index) => {
    const id = 'admitted-' + index
    dock.register(item(id, id, { order: 100 + index, icon }))
    assert.equal(button(id).innerHTML, icon, `${icon} is a glyph, not a script`)
  })

  const rejected = [
    '<svg onload="alert(1)"></svg>',
    '<svg onload=alert(1)></svg>',
    '<svg/onclick=alert(1)></svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject></svg>',
    '<svg><use href="#elsewhere"></use></svg>',
    '<svg><image href="https://evil/x.png"></image></svg>',
    '<svg style="background:url(https://evil)"></svg>',
    '<svg fill="url(https://evil/x.svg#p)"></svg>',
    '<svg><animate attributeName="onclick" values="alert(1)"></animate></svg>',
    '<img src="x" onerror="alert(1)">',
    '<svg><a href="javascript:alert(1)">x</a></svg>',
    // A quoted value that carries a tag boundary moves `>` past the scanner.
    '<svg viewBox="0 0 24 24" fill="none"><path d="M4 onload=alert(1)>5"></path></svg>',
    '<svg><!--<script>--></script></svg>',
    '<svg><![CDATA[</svg><script>alert(1)</script>]]></svg>',
    '<svg width="16></svg>',
    undefined,
    null,
    42,
    { toString() { return '<svg></svg>' } }
  ]
  rejected.forEach((icon, index) => {
    const id = 'rejected-' + index
    dock.register(item(id, id, { order: 200 + index, icon }))
    const rendered = button(id)
    assert.equal(rendered.innerHTML, '', `${String(icon)} must not reach innerHTML`)
    assert.equal(rendered.textContent, id.slice(0, 2), 'the label stands in for the icon')
  })
})

test('a rejected icon still leaves the item identifiable and clickable', () => {
  const { dock, button } = bootDock()
  let activated = 0
  dock.register(item('poisoned', 'DSH Instance', {
    order: 500,
    icon: '<svg onload="alert(1)"></svg>',
    onActivate() { activated += 1 }
  }))
  const rendered = button('poisoned')
  // The label still identifies the item whatever the icon turned into.
  assert.equal(rendered.innerHTML, '', 'the poisoned markup must not reach the page')
  assert.equal(rendered.textContent, 'DS', 'the label stands in for the icon')
  assert.equal(rendered.getAttribute('aria-label'), 'DSH Instance')
  assert.equal(rendered.title, 'DSH Instance')
  rendered.listeners.click()
  assert.equal(activated, 1, 'a fallback icon must not make the entry dead')
})

test('update() cannot walk a poisoned icon past the gate', () => {
  const { dock, button } = bootDock()
  const handle = dock.register(item('swapped', 'ballast', { order: 600, icon: '<svg></svg>' }))
  assert.equal(button('swapped').innerHTML, '<svg></svg>')
  handle.update({ icon: '<svg><script>alert(1)</script></svg>' })
  assert.equal(button('swapped').innerHTML, '', 'a re-render must not assign the new markup')
  assert.equal(button('swapped').textContent, 'ba')
})
