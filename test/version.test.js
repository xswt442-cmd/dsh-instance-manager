// Version bookkeeping.
//
// Three places carry the version and they are only useful in lockstep:
//   - package.json      what npm publishes
//   - lib/shared.js     what the running panel reports
//   - CHANGELOG.md      what publish.yml cuts the release notes from
// A drift between the first two fails CI at the tag; a drift in the third
// does not fail anything, it just silently ships notes that say
// "Release x.y.z" and nothing else. This test makes all three loud.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { VERSION } from '../lib/shared.js'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

test('VERSION stays in lockstep with package.json', () => {
  const pkg = JSON.parse(read('../package.json'))
  assert.equal(VERSION, pkg.version)
})

test('both CHANGELOGs contain the version being shipped', () => {
  // Existence, not position: publish.yml starts collecting at the heading that
  // matches PKG_VERSION, so an `## Unreleased` section above it is harmless.
  // What actually breaks releases is no matching section at all -> empty notes.
  const heading = new RegExp(`^## ${VERSION.replace(/\./g, '\\.')}(\\s|$)`)
  for (const file of ['../CHANGELOG.md', '../CHANGELOG.en.md']) {
    const sections = read(file).split('\n').filter((line) => line.startsWith('## '))
    assert.ok(
      sections.some((line) => heading.test(line)),
      `${file} has no ${VERSION} section; publish.yml would cut empty release notes`
    )
  }
})
