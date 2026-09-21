import fs from 'node:fs'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: node scripts/release-notes.mjs X.Y.Z')
  process.exit(2)
}

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const heading = new RegExp(`^## (?:\\[${escaped}\\]|${escaped}(?:\\s|$))`)
let active = false
const lines = []
for (const line of fs.readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/)) {
  if (line.startsWith('## ')) {
    if (active) break
    active = heading.test(line)
    continue
  }
  if (active) lines.push(line)
}

process.stdout.write(lines.join('\n').trim() || `Release ${version}`)
