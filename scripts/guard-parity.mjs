// Cross-repo drift check for the shared loopback predicates.
//
// Why this exists: the three plugins ship their own copy of the loopback guard
// helpers because each package has to stand alone. That copy has now drifted
// twice, and both drifts were security-relevant:
//
//   1. all three rejected IPv6 loopback (`::1`) — a legitimate browser was
//      locked out of its own API;
//   2. the three disagreed on which Host spellings count as loopback. Ballast
//      and treekeeper rejected `[::ffff:127.0.0.1]` while instance-manager
//      accepted it, and the allowlists themselves differed. A per-repo test
//      suite cannot catch this — it only ever sees its own copy — so the
//      comparison has to happen from outside the repos.
//
// The copies are no longer hand-written: they are an embedded block generated
// from dsh-mini-utility-dock/dist/loopback.js by the dock CLI. So this checker
// asserts two things a generator alone cannot:
//
//   * the embedded block is byte-identical in all three repos (a hand edit to
//     one copy, or a repo that never re-ran `loopback:sync`, fails here);
//   * the three *behaviours* agree, including the IPv4-mapped IPv6 forms. Byte
//     equality of the block already implies this — that is the point of the
//     generator — but the behavioural pass is what proves each consumer routes
//     through the block instead of keeping a private copy beside it.
//
// Usage:  node scripts/guard-parity.mjs        (from a repo checkout, CI)
//         DSH_PLUGINS_ROOT=<dir with the three repos> node scripts/guard-parity.mjs
//
// `DSH_PLUGINS_ROOT` must point at a directory that contains
// `dsh-instance-manager/`, `dsh-treekeeper/` and `dsh-ballast/`; it also exists
// so the drift detection can be exercised against a deliberately-broken fixture
// — a checker that has never failed is unproven. `--self-test` exercises the
// extractor alone.
//
// Exit code 0 = the three copies are identical, every repo routes through them,
// and the three agree on every behavioural case.

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = process.env.DSH_PLUGINS_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const repos = [
  ['dsh-instance-manager', 'DIM'],
  ['dsh-treekeeper', 'DTK'],
  ['dsh-ballast', 'BAL']
]

const MARK_START = '// <dsh-loopback-helpers>'
const MARK_END = '// </dsh-loopback-helpers>'

// Pull the generated block out of a consumer's lib/shared.js. Everything between
// the markers is generator output, so it must match byte for byte; the consumer
// indents it, which is stripped before comparing.
const extractBlock = (src) => {
  const lines = src.split(/\r?\n/)
  const starts = lines.reduce((hits, line, i) => line.trim() === MARK_START ? [...hits, i] : hits, [])
  const ends = lines.reduce((hits, line, i) => line.trim() === MARK_END ? [...hits, i] : hits, [])
  if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) return null
  return lines.slice(starts[0] + 1, ends[0]).map((line) => line.replace(/^\s{2}/, '')).join('\n').trim()
}

const read = (repo) => readFileSync(join(root, repo, 'lib', 'shared.js'), 'utf8')

const dropBlock = (src) => {
  const lines = src.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === MARK_START)
  const end = lines.findIndex((line) => line.trim() === MARK_END)
  return (start >= 0 && end > start) ? [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n') : src
}

if (process.argv.includes('--self-test')) {
  const good = [MARK_START, 'const a = 1', 'const b = 2', MARK_END].join('\n')
  const cases = [
    ['block is extracted', good, 'const a = 1\nconst b = 2'],
    ['missing end marker returns null', [MARK_START, 'const a = 1'].join('\n'), null],
    ['duplicate start returns null', [MARK_START, MARK_START, MARK_END].join('\n'), null],
    ['indent is stripped', [MARK_START, '  const a = 1', MARK_END].join('\n'), 'const a = 1']
  ]
  let bad = 0
  for (const [label, src, expected] of cases) {
    const got = extractBlock(src)
    const ok = got === expected
    if (!ok) console.log(`self-test FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  got:      ${JSON.stringify(got)}`)
    else console.log(`self-test ok   ${label}`)
    if (!ok) bad++
  }
  process.exit(bad ? 1 : 0)
}

let failures = 0

// 1. The generated block must be present and byte-identical everywhere.
const blocks = repos.map(([repo, tag]) => ({ repo, tag, block: extractBlock(read(repo)) }))
const missing = blocks.filter((b) => b.block === null)
if (missing.length) {
  console.log(`FAIL loopback block: missing or malformed markers in ${missing.map((m) => m.tag).join(', ')}`)
  failures++
} else {
  const base = blocks[0]
  const drifted = blocks.slice(1).filter((b) => b.block !== base.block)
  if (drifted.length) {
    console.log(`FAIL loopback block: ${drifted.map((d) => d.tag).join(', ')} differ from ${base.tag}`)
    for (const d of drifted) {
      console.log(`\n--- ${base.tag} (${base.repo}/lib/shared.js) ---\n${base.block}`)
      console.log(`\n--- ${d.tag} (${d.repo}/lib/shared.js) ---\n${d.block}`)
    }
    failures++
  } else {
    console.log(`ok   loopback block: identical across DIM/DTK/BAL (${base.block.length} chars)`)
  }
}

// 2. A byte-identical block is worthless if a repo stopped calling it, or kept a
//    private copy beside it. The guard implementations differ per plugin by
//    design, so look for the tell-tale of a second copy rather than one shape.
for (const [repo, tag] of repos) {
  const outside = dropBlock(read(repo))
  const problems = []
  if (!/remoteAddress/.test(outside)) problems.push('no socket.remoteAddress check')
  if (/LOOPBACK_HOSTNAMES\s*=/.test(outside)) problems.push('redefines LOOPBACK_HOSTNAMES outside the generated block')
  if (/(?:const|function|let)\s+isLoopbackName\b/.test(outside)) problems.push('defines a private isLoopbackName')
  if (/(?:const|function|let)\s+isLoopbackAddress\b/.test(outside)) problems.push('defines a private isLoopbackAddress')
  if (/isLoopbackName\s*=\s*\(name\)\s*=>/.test(outside)) problems.push('shadows isLoopbackName inside createGuard')
  if (problems.length) {
    console.log(`FAIL ${tag}: ${problems.join('; ')}`)
    failures++
  } else {
    console.log(`ok   ${tag}: guard routes through the generated block, no private copy`)
  }
}

// 3. The three implementations must agree on behaviour end to end, including the
//    IPv4-mapped IPv6 forms that caused the second drift.
const makeRes = () => ({
  statusCode: null,
  body: null,
  writeHead(code) { this.statusCode = code; return this },
  setHeader() {},
  end() {}
})

const drive = (mod, repo, { host, origin }) => {
  const req = {
    method: 'GET',
    headers: { host, 'sec-fetch-site': 'same-origin', ...(origin ? { origin } : {}) },
    socket: { remoteAddress: '127.0.0.1' }
  }
  const res = makeRes()
  const ok = repo === 'dsh-instance-manager'
    ? mod.createGuard({ currentPort: () => 3080, respond: (t, code, body) => { t.statusCode = code; t.body = body } })(req, res)
    : mod.createGuard({ currentPort: () => 3080 })(req, res)
  // Only the allow/deny verdict is compared. The error *codes* legitimately
  // differ per plugin (`bad_host` vs `non_loopback`, `bad_origin` vs
  // `foreign_origin`), and they are part of each plugin's own API contract; the
  // drift that matters is which requests are admitted, not what they are called.
  return ok ? 'allow' : 'deny'
}

const mods = {}
for (const [repo] of repos) {
  mods[repo] = await import(pathToFileURL(join(root, repo, 'lib', 'shared.js')).href)
}

const hostCases = [
  ['127.0.0.1:3080', true],
  ['localhost:3080', true],
  ['[::1]:3080', true],
  // Both spellings of the v4-mapped v6 loopback are loopback (see the fragment).
  ['[::ffff:127.0.0.1]:3080', true],
  ['[::ffff:7f00:1]:3080', true],
  // A Host that parses to no hostname must fail closed rather than skip the
  // allowlist. RFC 7230 requires IPv6 literals to be bracketed, but a client can
  // still send the unbracketed form; `hostHostname` splits it at the first colon
  // and yields ''. Ballast and instance-manager used to deny this while
  // treekeeper admitted it — the third drift, found by this checker.
  ['::ffff:127.0.0.1:3080', false],
  ['::1:3080', false],
  ['203.0.113.5:3080', false],
  ['127.0.0.1.evil.example:3080', false],
  ['api.localhost:3080', false],
  ['evil.localhost:3080', false]
]
let hostBad = 0
for (const [host, expectAllow] of hostCases) {
  const verdicts = repos.map(([repo]) => drive(mods[repo], repo, { host }))
  const agrees = new Set(verdicts).size === 1
  if (!agrees) {
    console.log(`FAIL Host ${JSON.stringify(host)}: ${repos.map(([, tag], i) => `${tag}=${verdicts[i]}`).join(' ')}`)
    hostBad++
  } else if (verdicts[0].startsWith('allow') !== expectAllow) {
    console.log(`FAIL Host ${JSON.stringify(host)}: all three answered ${verdicts[0]}, expected ${expectAllow ? 'allow' : 'deny'}`)
    hostBad++
  }
}
if (hostBad) failures += hostBad
else console.log(`ok   Host path: ${hostCases.length} cases agree across DIM/DTK/BAL`)

const originCases = [
  ['http://127.0.0.1:3080', true],
  ['http://[::1]:3080', true],
  ['http://[::ffff:7f00:1]:3080', true],
  ['http://localhost:3080', true],
  ['http://evil.example', false],
  ['http://127.0.0.1.evil.example:3080', false]
]
let originBad = 0
for (const [origin, expectAllow] of originCases) {
  const verdicts = repos.map(([repo]) => drive(mods[repo], repo, { host: '127.0.0.1:3080', origin }))
  const agrees = new Set(verdicts).size === 1
  if (!agrees || verdicts[0].startsWith('allow') !== expectAllow) {
    console.log(`FAIL Origin ${JSON.stringify(origin)}: ${repos.map(([, tag], i) => `${tag}=${verdicts[i]}`).join(' ')} (expected ${expectAllow ? 'allow' : 'deny'})`)
    originBad++
  }
}
if (originBad) failures += originBad
else console.log(`ok   Origin path: ${originCases.length} cases agree across DIM/DTK/BAL`)

// 4. The predicates called directly, in every repo.
const predicateCases = [
  // `isLoopbackName` is deliberately narrower than `isLoopbackAddress`: it takes
  // a Host header, so it accepts only the exact documented spellings — plus the
  // mapped form of 127.0.0.1 — while the peer predicate covers the whole 127/8.
  ['isLoopbackName', ['127.0.0.1', true], ['localhost', true], ['::1', true],
    ['LOCALHOST', true], ['[::1]', false], ['::ffff:127.0.0.1', true],
    ['::ffff:7f00:1', true], ['::ffff:8.8.8.8', false], ['::ffff:127.0.0.2', false],
    ['127.0.0.2', false], ['127.0.0.1.evil.example', false], ['api.localhost', false],
    ['', false], [null, false]],
  ['isLoopbackAddress', ['127.0.0.1', true], ['127.255.0.1', true], ['::1', true],
    ['::ffff:127.0.0.1', true], ['::ffff:7f00:1', true], ['::ffff:127.0.0.2', true],
    ['::ffff:8.8.8.8', false], ['10.0.0.1', false], ['::2', false], ['localhost', false],
    ['127.0.0.1.evil.example', false], ['::ffff:999.1.1.1', false], ['', false],
    [null, false], ['  ', false]]
]
for (const [fn, ...cases] of predicateCases) {
  let bad = 0
  for (const [input, expected] of cases) {
    const answers = repos.map(([repo]) => mods[repo][fn](input))
    if (new Set(answers).size !== 1) {
      console.log(`FAIL ${fn}(${JSON.stringify(input)}): ${repos.map(([, tag], i) => `${tag}=${answers[i]}`).join(' ')}`)
      bad++
    } else if (answers[0] !== expected) {
      console.log(`FAIL ${fn}(${JSON.stringify(input)}): all three answered ${answers[0]}, expected ${expected}`)
      bad++
    }
  }
  if (bad) failures += bad
  else console.log(`ok   ${fn}: ${cases.length} behavioural cases agree across DIM/DTK/BAL`)
}

// 5. hostHostname parsing, which the Origin path relies on.
const hostParseCases = [
  ['127.0.0.1:3080', '127.0.0.1'],
  ['[::1]:3080', '::1'],
  ['[::ffff:127.0.0.1]:80', '::ffff:127.0.0.1'],
  ['REBOUND.EXAMPLE', 'rebound.example'],
  [undefined, ''],
  ['localhost', 'localhost']
]
let parseBad = 0
for (const [input, expected] of hostParseCases) {
  const answers = repos.map(([repo]) => mods[repo].hostHostname(input))
  if (new Set(answers).size !== 1 || answers[0] !== expected) {
    console.log(`FAIL hostHostname(${JSON.stringify(input)}): ${repos.map(([, tag], i) => `${tag}=${JSON.stringify(answers[i])}`).join(' ')} (expected ${JSON.stringify(expected)})`)
    parseBad++
  }
}
if (parseBad) failures += parseBad
else console.log(`ok   hostHostname: ${hostParseCases.length} cases agree across DIM/DTK/BAL`)

console.log(failures ? `\n${failures} drift problem(s)` : '\nno drift')
process.exit(failures ? 1 : 0)
