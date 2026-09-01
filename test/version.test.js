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

test('both CHANGELOGs open with the version being shipped', () => {
  const heading = new RegExp(`^## ${VERSION.replace(/\./g, '\\.')}(\\s|$)`)
  for (const file of ['../CHANGELOG.md', '../CHANGELOG.en.md']) {
    const first = read(file).split('\n').find((line) => line.startsWith('## '))
    assert.ok(first, `${file} has no version section`)
    assert.match(first, heading, `${file} should open with ${VERSION}, got "${first}"`)
  }
})
