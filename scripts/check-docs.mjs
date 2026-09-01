import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

function markdownShape(file) {
  let fenced = false
  const headings = []
  const fences = []

  for (const line of read(file).split('\n')) {
    const fence = line.match(/^\s*```\s*(\S*)/)
    if (fence) {
      if (!fenced) fences.push(fence[1])
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const heading = line.match(/^(#{1,3})\s+/)
    if (heading) headings.push(heading[1].length)
  }

  if (fenced) throw new Error(`${file}: unclosed code fence`)
  return { headings, fences }
}

function changelogShape(file) {
  const releases = []
  let release
  let section

  for (const line of read(file).split('\n')) {
    const version = line.match(/^##\s+(\d+\.\d+\.\d+)(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/)
    if (version) {
      release = { version: version[1], date: version[2] ?? '', sections: [] }
      releases.push(release)
      section = undefined
      continue
    }
    if (!release) continue

    const heading = line.match(/^###\s+(.+?)\s*$/)
    if (heading) {
      section = { title: heading[1], items: 0 }
      release.sections.push(section)
      continue
    }
    if (section && /^\s*-\s+/.test(line)) section.items += 1
  }

  return releases
}

const category = new Map([
  ['新增', 'added'], ['Added', 'added'],
  ['修复', 'fixed'], ['Fixed', 'fixed'],
  ['变更', 'changed'], ['Changed', 'changed'],
  ['移除', 'removed'], ['Removed', 'removed'],
  ['安全', 'security'], ['Security', 'security'],
  ['性能', 'performance'], ['Performance', 'performance'],
  ['兼容性', 'compatibility'], ['Compatibility', 'compatibility'],
])

function assertEqual(left, right, message) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`${message}\nleft:  ${JSON.stringify(left)}\nright: ${JSON.stringify(right)}`)
  }
}

const zhReadme = markdownShape('README.md')
const enReadme = markdownShape('README.en.md')
assertEqual(zhReadme, enReadme, 'README structure differs between languages')

const normalizeLog = (file) => changelogShape(file).map((release) => ({
  version: release.version,
  date: release.date,
  sections: release.sections.map(({ title, items }) => ({
    title: category.get(title) ?? title.toLowerCase(),
    items,
  })),
}))
assertEqual(normalizeLog('CHANGELOG.md'), normalizeLog('CHANGELOG.en.md'), 'CHANGELOG structure differs between languages')

const baseIndex = process.argv.indexOf('--base')
if (baseIndex !== -1) {
  const base = process.argv[baseIndex + 1]
  if (!base) throw new Error('--base requires a Git revision')

  const changed = new Set(execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean))

  for (const [primary, translation] of [
    ['README.md', 'README.en.md'],
    ['CHANGELOG.md', 'CHANGELOG.en.md'],
  ]) {
    if (changed.has(primary) !== changed.has(translation)) {
      throw new Error(`${primary} and ${translation} must change together`)
    }
  }
}

console.log('bilingual docs are structurally aligned')

