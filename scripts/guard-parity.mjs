// Cross-repo drift check for the shared HTTP guard helpers.
//
// Why this exists: the three plugins each carry their own copy of
// `isLoopbackAddress` / `portOf` in `lib/shared.js`. They started as one
// implementation and diverged once already (the P0 of the 2026-09-02 review:
// three copies, three different behaviours, IPv6 loopback rejected by all
// three). A per-repo test suite cannot catch drift — it only ever sees its own
// copy — so the comparison has to happen from outside the repos.
//
// Usage:  node scripts/guard-parity.mjs        (from a repo checkout, CI)
//         DSH_PLUGINS_ROOT=<dir with the three repos> node scripts/guard-parity.mjs
//
// The script lives in each of the three repos under scripts/ (byte-identical
// copies, each repo checks its peers in CI). `DSH_PLUGINS_ROOT` must point at
// a directory that contains `dsh-instance-manager/`, `dsh-treekeeper/` and
// `dsh-ballast/`; it also exists so the drift detection can be exercised
// against a deliberately-broken fixture — a checker that has never failed is
// unproven.
//
// Exit code 0 = the three copies are byte-identical and every repo uses the
// helpers; non-zero = drift, with a unified diff on stdout.

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = process.env.DSH_PLUGINS_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const repos = [
  ['dsh-instance-manager', 'DIM'],
  ['dsh-treekeeper', 'DTK'],
  ['dsh-ballast', 'BAL']
]

// Extract a `const` declaration by balancing braces. Arrow helpers come in two
// shapes and mixing them up silently compares the wrong text: `=> { ... }` is
// brace-balanced, while an expression body (`=> x || y`) has no braces at all,
// so the first `{` after the declaration belongs to some later function.
const balance = (src, start, open) => {
  let depth = 0
  let j = open
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') {
      depth--
      if (depth === 0) { j++; break }
    }
  }
  return src.slice(start, j).replace(/\s+$/, '')
}

const extract = (src, decl) => {
  const i = src.indexOf(decl)
  if (i < 0) return null
  const arrow = src.indexOf('=>', i)
  if (arrow < 0) {
    const brace = src.indexOf('{', i)
    return brace < 0 ? null : balance(src, i, brace)
  }
  let k = arrow + 2
  while (k < src.length && /\s/.test(src[k])) k++
  if (src[k] === '{') return balance(src, i, k)
  const end = src.indexOf('\n', i)
  return src.slice(i, end < 0 ? src.length : end).replace(/[\s;]+$/, '')
}

const read = (repo) => readFileSync(join(root, repo, 'lib', 'shared.js'), 'utf8')

const targets = [
  ['export const isLoopbackAddress =', 'isLoopbackAddress'],
  ['const portOf =', 'portOf']
]

// The whole check rests on `extract` pulling the right text, so it gets its
// own self-test: a brace-bodied arrow and an expression-bodied arrow, where
// the naive "first brace" reading would swallow the following function.
if (process.argv.includes('--self-test')) {
  const src = [
    "const braced = (x) => {",
    "  return x + 1",
    "}",
    "const expr = (u) => u.port || TABLE[u.protocol] || ''",
    "const later = () => { return 'noise' }",
    ""
  ].join('\n')
  const cases = [
    ['const braced =', "const braced = (x) => {\n  return x + 1\n}"],
    ['const expr =', "const expr = (u) => u.port || TABLE[u.protocol] || ''"]
  ]
  let bad = 0
  for (const [decl, expected] of cases) {
    const got = extract(src, decl)
    const ok = got === expected
    if (!ok) console.log(`self-test FAIL ${decl}\n  expected: ${JSON.stringify(expected)}\n  got:      ${JSON.stringify(got)}`)
    else console.log(`self-test ok   ${decl}`)
    if (!ok) bad++
  }
  process.exit(bad ? 1 : 0)
}

let failures = 0

for (const [decl, name] of targets) {
  const copies = repos.map(([repo, tag]) => {
    const src = read(repo)
    const body = extract(src, decl)
    return { repo, tag, body, src }
  })

  const missing = copies.filter((c) => c.body === null)
  if (missing.length) {
    console.log(`FAIL ${name}: missing in ${missing.map((m) => m.tag).join(', ')}`)
    failures++
    continue
  }

  const base = copies[0]
  const drifted = copies.slice(1).filter((c) => c.body !== base.body)
  if (drifted.length) {
    console.log(`FAIL ${name}: ${drifted.map((d) => d.tag).join(', ')} differ from ${base.tag}`)
    for (const d of drifted) {
      console.log(`\n--- ${base.tag} (${base.repo}/lib/shared.js) ---\n${base.body}`)
      console.log(`\n--- ${d.tag} (${d.repo}/lib/shared.js) ---\n${d.body}`)
    }
    failures++
  } else {
    console.log(`ok   ${name}: identical across DIM/DTK/BAL (${base.body.length} chars)`)
  }
}

// A byte-identical helper is worthless if one repo stopped calling it.
for (const [repo, tag] of repos) {
  const src = read(repo)
  const usesPeer = /remoteAddress/.test(src)
  const usesPort = /portOf\s*\(/.test(src)
  const problems = []
  if (!usesPeer) problems.push('no socket.remoteAddress check')
  if (!usesPort) problems.push('portOf() never called')
  if (problems.length) {
    console.log(`FAIL ${tag}: ${problems.join('; ')}`)
    failures++
  } else {
    console.log(`ok   ${tag}: guard reads the peer address and normalises ports`)
  }
}

// The loopback allowlist is the security boundary; assert its behaviour here
// rather than trusting each repo's own tests to stay honest.
const { isLoopbackAddress } = await import(pathToFileURL(join(root, 'dsh-treekeeper', 'lib', 'shared.js')).href)
const cases = [
  ['127.0.0.1', true],
  ['127.255.255.254', true],
  ['::1', true],
  ['::ffff:127.0.0.1', true],
  ['::FFFF:127.0.0.1', true],
  [' 127.0.0.1 ', true],
  ['203.0.113.5', false],
  ['::ffff:203.0.113.5', false],
  ['10.0.0.1', false],
  ['127.0.0.1.evil.example', false],
  ['', false],
  ['   ', false],
  [null, false],
  [undefined, false]
]
for (const [address, expected] of cases) {
  const actual = isLoopbackAddress(address)
  if (actual !== expected) {
    console.log(`FAIL isLoopbackAddress(${JSON.stringify(address)}) = ${actual}, expected ${expected}`)
    failures++
  }
}
if (!failures) console.log(`ok   isLoopbackAddress: ${cases.length} behavioural cases pass`)

console.log(failures ? `\n${failures} drift problem(s)` : '\nno drift')
process.exit(failures ? 1 : 0)
