// Cross-repo drift check for the shared host fragments.
//
// Why this exists: the three plugins ship their own copy of the loopback
// predicates and the request guard because each package has to stand alone. Those
// copies drifted three times, and every drift was security-relevant:
//
//   1. all three rejected IPv6 loopback (`::1`) — a legitimate browser was
//      locked out of its own API;
//   2. the three disagreed on which Host spellings count as loopback, and
//      dsh-instance-manager carried an allowlist entry its Origin path could
//      never reach;
//   3. a Host that parsed to no hostname silently skipped the allowlist in one
//      plugin and was denied in the others.
//
// The copies are no longer hand-written: they are two embedded blocks generated
// from dsh-mini-utility-dock by the dock CLI — `dist/loopback.js` (the predicates)
// and `dist/guard.js` (the enforcement policy). So this checker asserts three
// things a generator alone cannot:
//
//   * both embedded blocks are byte-identical in all three repos (a hand edit to
//     one copy, or a repo that never re-ran `loopback:sync` / `guard:sync`, fails
//     here), and they appear in dependency order — the guard uses the predicates
//     the loopback block declares in the same file;
//   * no repo keeps a private copy of an enforcement decision beside them — that
//     is how drifts 1-3 happened, and embedding the blocks is worthless if a repo
//     also branches on its own version;
//   * the three AGREE ON EVERY DECISION. Error codes and wording deliberately
//     differ (each plugin's published API vocabulary), so the comparison is on
//     the allow/deny outcome only. This is the assertion that survives a policy
//     change: byte equality implies it, but only this proves each consumer
//     actually routes through the blocks.
//
// Usage:  DSH_PLUGINS_ROOT=<dir with the three repos> node scripts/guard-parity.mjs
//
// `DSH_PLUGINS_ROOT` must point at a directory that contains
// `dsh-instance-manager/`, `dsh-treekeeper/` and `dsh-ballast/`. `--self-test`
// exercises the extractor alone.
//
// This is a LOCAL DIAGNOSTIC, deliberately not a CI gate. Per-repo CI already
// proves the stronger local property — `loopback:check` / `guard:check` compare
// each repo's embedded blocks against the `dist/` of the exact dock version it
// pins, and that version is immutable on npm. Three repos pinning one version
// therefore hold byte-identical blocks by construction, which is why this script
// is redundant as a gate and was removed from the compat workflow.
//
// The property it asserts is inherently cross-repository and cannot hold at an
// arbitrary moment: on a `dev` push the peer checkouts resolve to their default
// branch, so a difference reported here may mean only that the peers are on
// `main`. Run it when all three checkouts are on the same branch — before a
// release, or after one — and read a failure as a real signal then.
//
// Exit code 0 = identical blocks, one shared dock pin, no private copies, and
// every decision agrees.

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = process.env.DSH_PLUGINS_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const repos = [
  ['dsh-instance-manager', 'DIM', 'createGuard'],
  ['dsh-treekeeper', 'DTK', 'treekeeperGuard'],
  ['dsh-ballast', 'BAL', 'ballastGuard']
]

// Dependency order: the guard block uses the predicates the loopback block
// declares, so it must come second.
const BLOCKS = [
  { name: 'dsh-loopback-helpers', label: 'loopback predicates' },
  { name: 'dsh-host-guard', label: 'host guard' }
]

const marks = (name) => ({ start: `// <${name}>`, end: `// </${name}>` })

// Pull a generated block out of a consumer's lib/shared.js. Everything between
// the markers is generator output, so it must match byte for byte; the consumer
// indents it, which is stripped before comparing.
const extractBlock = (src, name) => {
  const { start, end } = marks(name)
  const lines = src.split(/\r?\n/)
  const starts = lines.reduce((hits, line, i) => line.trim() === start ? [...hits, i] : hits, [])
  const ends = lines.reduce((hits, line, i) => line.trim() === end ? [...hits, i] : hits, [])
  if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) return null
  return lines.slice(starts[0] + 1, ends[0]).map((line) => line.replace(/^\s{2}/, '')).join('\n').trim()
}

const read = (repo) => readFileSync(join(root, repo, 'lib', 'shared.js'), 'utf8')

const spanOf = (src, name) => {
  const { start, end } = marks(name)
  const lines = src.split(/\r?\n/)
  const from = lines.findIndex((line) => line.trim() === start)
  const to = lines.findIndex((line) => line.trim() === end)
  return from >= 0 && to > from ? { from, to } : null
}

// Everything that is neither block: the plugin's own code, which is where a
// private copy of an enforcement decision would hide.
const dropBlocks = (src) => {
  const spans = BLOCKS.map((b) => spanOf(src, b.name)).filter(Boolean).sort((a, b) => b.from - a.from)
  const lines = src.split(/\r?\n/)
  for (const { from, to } of spans) lines.splice(from, to - from + 1)
  return lines.join('\n')
}

// The dock version a repo embeds its blocks from. This is the one fact that is
// genuinely cross-repository: the blocks themselves are proven locally against
// whatever version is pinned here, and a version is immutable on npm, so equal
// pins are what make the blocks equal — not the other way round.
const dockPinOf = (repo) => {
  const pkg = JSON.parse(readFileSync(join(root, repo, 'package.json'), 'utf8'))
  const dev = (pkg.devDependencies || {})['dsh-mini-utility-dock']
  const any = (pkg.dependencies || {})['dsh-mini-utility-dock']
  return dev || any || null
}

if (process.argv.includes('--self-test')) {
  const good = [
    marks('dsh-loopback-helpers').start, 'const a = 1', marks('dsh-loopback-helpers').end,
    marks('dsh-host-guard').start, 'const b = 2', marks('dsh-host-guard').end
  ].join('\n')
  const cases = [
    ['first block extracted', 'dsh-loopback-helpers', good, 'const a = 1'],
    ['second block extracted', 'dsh-host-guard', good, 'const b = 2'],
    ['indent is stripped', 'dsh-loopback-helpers', [marks('dsh-loopback-helpers').start, '  const a = 1', marks('dsh-loopback-helpers').end].join('\n'), 'const a = 1'],
    ['missing end marker returns null', 'dsh-loopback-helpers', [marks('dsh-loopback-helpers').start, 'const a = 1'].join('\n'), null],
    ['absent block returns null', 'dsh-host-guard', good.replace(/dsh-host-guard/g, 'other'), null]
  ]
  let bad = 0
  for (const [label, name, src, expected] of cases) {
    const got = extractBlock(src, name)
    const ok = got === expected
    if (!ok) console.log(`self-test FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  got:      ${JSON.stringify(got)}`)
    else console.log(`self-test ok   ${label}`)
    if (!ok) bad++
  }
  // Dropping both blocks must leave only the plugin's own code.
  const residual = dropBlocks(good)
  const dropOk = !/const a = 1|const b = 2/.test(residual)
  console.log(dropOk ? 'self-test ok   both blocks dropped' : `self-test FAIL both blocks dropped: ${JSON.stringify(residual)}`)
  if (!dropOk) bad++
  process.exit(bad ? 1 : 0)
}

let failures = 0

// 1. Both generated blocks must be present, byte-identical everywhere, and in
//    dependency order.
for (const block of BLOCKS) {
  const copies = repos.map(([repo, tag]) => ({ repo, tag, body: extractBlock(read(repo), block.name) }))
  const missing = copies.filter((c) => c.body === null)
  if (missing.length) {
    console.log(`FAIL ${block.label}: missing or malformed markers in ${missing.map((m) => m.tag).join(', ')}`)
    failures++
    continue
  }
  const base = copies[0]
  const drifted = copies.slice(1).filter((c) => c.body !== base.body)
  if (drifted.length) {
    console.log(`FAIL ${block.label}: ${drifted.map((d) => d.tag).join(', ')} differ from ${base.tag}`)
    for (const d of drifted) {
      console.log(`\n--- ${base.tag} (${base.repo}/lib/shared.js) ---\n${base.body}`)
      console.log(`\n--- ${d.tag} (${d.repo}/lib/shared.js) ---\n${d.body}`)
    }
    failures++
  } else {
    console.log(`ok   ${block.label}: identical across DIM/DTK/BAL (${base.body.length} chars)`)
  }
}

// 2. Every repo must embed from the same dock version. A skew here is the one
//    cross-repo cause of divergence that per-repo checks cannot see: each repo's
//    own `guard:check` passes against whatever it pins, so a repo left on an older
//    dock stays green while its blocks differ from its siblings'.
{
  const pins = repos.map(([repo, tag]) => ({ tag, pin: dockPinOf(repo) }))
  const unset = pins.filter((p) => p.pin === null)
  const distinct = [...new Set(pins.map((p) => p.pin).filter((p) => p !== null))]
  if (unset.length) {
    console.log(`FAIL dock pin: not declared by ${unset.map((u) => u.tag).join(', ')}`)
    failures++
  } else if (distinct.length !== 1) {
    console.log(`FAIL dock pin: versions differ — ${pins.map((p) => `${p.tag}=${p.pin}`).join(' ')}`)
    failures++
  } else {
    // An exact pin is what makes the sibling repos hold identical blocks: a range
    // could resolve to different builds under one declared value.
    const exact = /^\d+\.\d+\.\d+$/.test(distinct[0])
    if (!exact) {
      console.log(`FAIL dock pin: ${JSON.stringify(distinct[0])} is not an exact version, so one declared value can resolve to different blocks`)
      failures++
    } else {
      console.log(`ok   dock pin: all three embed dsh-mini-utility-dock ${distinct[0]}`)
    }
  }
}

// The guard block reads what the loopback block declares in the same file, so the
// order is load-bearing, not cosmetic.
{
  let orderBad = 0
  for (const [repo, tag] of repos) {
    const src = read(repo)
    const loop = spanOf(src, 'dsh-loopback-helpers')
    const guard = spanOf(src, 'dsh-host-guard')
    if (!loop || !guard) continue
    if (loop.from > guard.from) {
      console.log(`FAIL ${tag}: the host guard block precedes the loopback predicates`)
      orderBad++
    }
  }
  if (orderBad) failures += orderBad
  else console.log('ok   block order: the loopback predicates precede the host guard everywhere')
}

// 3. Embedding the blocks is worthless if a repo also keeps its own enforcement
//    beside them. Policy is expected outside the blocks; decisions are not.
//
//    `remoteAddress` is deliberately NOT listed on its own: a plugin may keep a
//    second helper that applies the same criterion for a different gate
//    (dsh-instance-manager's `requestNeedsBearer` does exactly that, so the API
//    route and the guard cannot drift apart). A private criterion only matters
//    when the repo also owns a private guard, which the factory check catches.
const ENFORCEMENT = [
  [/LOOPBACK_HOSTNAMES\s*=/, 'redefines LOOPBACK_HOSTNAMES'],
  [/(?:const|function|let)\s+isLoopbackName\b/, 'defines a private isLoopbackName'],
  [/(?:const|function|let)\s+isLoopbackAddress\b/, 'defines a private isLoopbackAddress'],
  [/(?:const|function|let)\s+hostHostname\b/, 'defines a private hostHostname'],
  [/(?:const|function|let)\s+bindGuard\b/, 'defines a private guard factory'],
  [/sec-fetch-site/, 'branches on Fetch Metadata outside the blocks']
]
for (const [repo, tag] of repos) {
  const outside = dropBlocks(read(repo))
  const problems = ENFORCEMENT.filter(([re]) => re.test(outside)).map(([, why]) => why)
  if (/remoteAddress/.test(outside) && /function\s+guard\s*\(|=>\s*\{\s*$/.test(outside)) {
    problems.push('looks like a private guard reading the socket peer')
  }
  if (problems.length) {
    console.log(`FAIL ${tag}: ${problems.join('; ')}`)
    failures++
  } else {
    console.log(`ok   ${tag}: no enforcement outside the generated blocks`)
  }
}

// 4. Every decision must agree across the three. Codes differ by design, so only
//    the verdict is compared.
//
//    First confirm each repo exports the guard it is expected to. A repo whose
//    blocks failed to parse is already reported above; without this check the
//    decision cases below would throw `mods[repo][factory] is not a function` and
//    bury the real diagnosis under a stack trace.
const makeRes = () => ({
  statusCode: null,
  body: null,
  writeHead(code) { this.statusCode = code; return this },
  setHeader() {},
  end() {}
})

const mods = {}
for (const [repo] of repos) {
  mods[repo] = await import(pathToFileURL(join(root, repo, 'lib', 'shared.js')).href)
}

const unusable = repos.filter(([repo, , factory]) => typeof mods[repo][factory] !== 'function')
if (unusable.length) {
  for (const [repo, tag, factory] of unusable) {
    console.log(`FAIL ${tag}: lib/shared.js does not export a usable ${factory}() — the embedded blocks are stale or absent`)
  }
  failures += unusable.length
  console.log('\ncannot compare decisions while a repo exports no guard')
  console.log(failures ? `\n${failures} drift problem(s)` : '\nno drift')
  process.exit(1)
}

// Each plugin names its own guard, so resolve it per repo. The guard is built
// with `allowRemoteHost` only when the case asks for fleet mode, because a plugin
// that never opts in must behave strictly.
const verdict = (repo, factory, { host, origin, peer = '127.0.0.1', site = 'same-origin', fleet = false }) => {
  const req = {
    method: 'GET',
    headers: { ...(host === undefined ? {} : { host }), ...(origin ? { origin } : {}), ...(site === null ? {} : { 'sec-fetch-site': site }) },
    socket: peer === null ? {} : { remoteAddress: peer }
  }
  const res = makeRes()
  const guard = mods[repo][factory]({
    currentPort: () => 3080,
    // Every plugin routes rejections through its own sink; a fake one keeps the
    // comparison independent of each plugin's response shape.
    respond: (target, code, body) => { target.statusCode = code; target.body = body },
    ...(fleet ? { allowRemoteHost: () => true } : {})
  })
  return guard(req, res) ? 'allow' : 'deny'
}

const cases = [
  // Host allowlist, including both spellings of the mapped IPv6 loopback.
  ['loopback ipv4 host', { host: '127.0.0.1:3080' }, 'allow'],
  ['loopback name host', { host: 'localhost:3080' }, 'allow'],
  ['loopback ipv6 host', { host: '[::1]:3080' }, 'allow'],
  ['mapped loopback host (dotted)', { host: '[::ffff:127.0.0.1]:3080' }, 'allow'],
  ['mapped loopback host (hex)', { host: '[::ffff:7f00:1]:3080' }, 'allow'],
  ['case-insensitive name', { host: 'LOCALHOST:3080' }, 'allow'],
  ['absent host (host-side caller)', { host: undefined }, 'allow'],
  ['foreign host', { host: 'rebound.example' }, 'deny'],
  ['localhost subdomain', { host: 'api.localhost' }, 'deny'],
  ['evil localhost subdomain', { host: 'evil.localhost:3080' }, 'deny'],
  ['rebinding suffix', { host: '127.0.0.1.evil.example:3080' }, 'deny'],
  ['public ip host', { host: '203.0.113.5:3080' }, 'deny'],
  // An unparseable Host must fail closed rather than skip the allowlist.
  ['unbracketed ipv6 host', { host: '::1:3080' }, 'deny'],
  ['unbracketed mapped host', { host: '::ffff:127.0.0.1:3080' }, 'deny'],
  // Fetch Metadata.
  ['cross-site metadata', { host: '127.0.0.1:3080', site: 'cross-site' }, 'deny'],
  ['same-origin metadata', { host: '127.0.0.1:3080', site: 'same-origin' }, 'allow'],
  ['no metadata (non-browser)', { host: '127.0.0.1:3080', site: null }, 'allow'],
  // Origin.
  ['matching origin', { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, 'allow'],
  ['ipv6 origin', { host: '[::1]:3080', origin: 'http://[::1]:3080' }, 'allow'],
  ['mapped origin (hex, as URL normalises)', { host: '127.0.0.1:3080', origin: 'http://[::ffff:7f00:1]:3080' }, 'allow'],
  ['origin on another port', { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3081' }, 'deny'],
  ['foreign origin', { host: '127.0.0.1:3080', origin: 'https://evil.example' }, 'deny'],
  ['rebinding origin', { host: '127.0.0.1:3080', origin: 'http://127.0.0.1.evil.example:3080' }, 'deny'],
  // Peer address.
  ['ipv6 loopback peer', { host: '127.0.0.1:3080', peer: '::1' }, 'allow'],
  ['mapped loopback peer', { host: '127.0.0.1:3080', peer: '::ffff:127.0.0.1' }, 'allow'],
  ['remote peer', { host: '127.0.0.1:3080', peer: '203.0.113.7' }, 'deny'],
  ['private-range peer', { host: '127.0.0.1:3080', peer: '10.0.0.5' }, 'deny'],
  ['missing peer', { host: '127.0.0.1:3080', peer: null }, 'deny'],
  ['blank peer', { host: '127.0.0.1:3080', peer: '' }, 'deny'],
  // A remote caller that also spoofs a loopback Host is still remote.
  ['remote peer, loopback host', { host: '127.0.0.1:3080', peer: '203.0.113.7' }, 'deny']
]

let bad = 0
for (const [label, req, expected] of cases) {
  const verdicts = repos.map(([repo, , factory]) => verdict(repo, factory, req))
  const agrees = new Set(verdicts).size === 1
  const got = verdicts[0]
  if (!agrees) {
    console.log(`FAIL ${label}: ${repos.map(([, tag], i) => `${tag}=${verdicts[i]}`).join(' ')}`)
    bad++
  } else if (got !== expected) {
    console.log(`FAIL ${label}: all three answered ${got}, expected ${expected}`)
    bad++
  }
}
if (bad) failures += bad
else console.log(`ok   decisions: ${cases.length} cases agree across DIM/DTK/BAL`)

// 5. Fleet mode is the one place the guard deliberately relaxes, and only DIM
//    opts in. Assert the relaxation stays bounded: a fleet guard still rejects a
//    cross-site request, a foreign Origin, and a missing peer.
const dimFleet = (req) => verdict('dsh-instance-manager', 'createGuard', { ...req, fleet: true })
const fleetCases = [
  ['fleet admits a peer host', { host: 'box.lan:3080' }, 'allow'],
  ['fleet admits a remote peer', { host: '127.0.0.1:3080', peer: '203.0.113.7' }, 'allow'],
  ['fleet still rejects cross-site', { host: 'box.lan:3080', site: 'cross-site' }, 'deny'],
  ['fleet still rejects foreign Origin', { host: 'box.lan:3080', origin: 'https://evil.example' }, 'deny'],
  ['fleet still rejects a missing peer', { host: 'box.lan:3080', peer: null }, 'deny']
]
let fleetBad = 0
for (const [label, req, expected] of fleetCases) {
  const got = dimFleet(req)
  if (got !== expected) {
    console.log(`FAIL ${label}: fleet guard answered ${got}, expected ${expected}`)
    fleetBad++
  }
}
if (fleetBad) failures += fleetBad
else console.log(`ok   fleet bounds: ${fleetCases.length} cases hold`)

// 6. The predicates themselves, called directly, across every repo.
const predicateCases = [
  ['isLoopbackName', ['127.0.0.1', true], ['localhost', true], ['::1', true],
    ['LOCALHOST', true], ['[::1]', false], ['::ffff:127.0.0.1', true],
    ['::ffff:7f00:1', true], ['::ffff:8.8.8.8', false], ['::ffff:127.0.0.2', false],
    ['127.0.0.2', false], ['127.0.0.1.evil.example', false], ['api.localhost', false],
    ['', false], [null, false]],
  ['isLoopbackAddress', ['127.0.0.1', true], ['127.255.0.1', true], ['::1', true],
    ['::ffff:127.0.0.1', true], ['::ffff:7f00:1', true], ['::ffff:127.0.0.2', true],
    ['::ffff:8.8.8.8', false], ['10.0.0.1', false], ['::2', false], ['localhost', false],
    ['127.0.0.1.evil.example', false], ['::ffff:999.1.1.1', false], ['', false],
    [null, false], ['  ', false]],
  ['hostHostname', ['127.0.0.1:3080', '127.0.0.1'], ['[::1]:3080', '::1'],
    ['[::ffff:127.0.0.1]:80', '::ffff:127.0.0.1'], ['REBOUND.EXAMPLE', 'rebound.example'],
    [undefined, ''], ['localhost', 'localhost']]
]
for (const [fn, ...fnCases] of predicateCases) {
  let fnBad = 0
  for (const [input, expected] of fnCases) {
    const answers = repos.map(([repo]) => mods[repo][fn](input))
    if (new Set(answers).size !== 1) {
      console.log(`FAIL ${fn}(${JSON.stringify(input)}): ${repos.map(([, tag], i) => `${tag}=${JSON.stringify(answers[i])}`).join(' ')}`)
      fnBad++
    } else if (answers[0] !== expected) {
      console.log(`FAIL ${fn}(${JSON.stringify(input)}): all three answered ${JSON.stringify(answers[0])}, expected ${JSON.stringify(expected)}`)
      fnBad++
    }
  }
  if (fnBad) failures += fnBad
  else console.log(`ok   ${fn}: ${fnCases.length} cases agree across DIM/DTK/BAL`)
}

// 7. portOf normalises the default ports, which is what stopped a same-origin
//    request on 80/443 from reading as a foreign Origin.
{
  let portBad = 0
  const portCases = [
    ['http://127.0.0.1', '80'], ['https://127.0.0.1', '443'],
    ['http://127.0.0.1:3080', '3080'], ['https://[::1]:443', '443']
  ]
  for (const [url, expected] of portCases) {
    const answers = repos.map(([repo]) => mods[repo].portOf(new URL(url)))
    if (new Set(answers).size !== 1 || answers[0] !== expected) {
      console.log(`FAIL portOf(${url}): ${repos.map(([, tag], i) => `${tag}=${JSON.stringify(answers[i])}`).join(' ')} (expected ${expected})`)
      portBad++
    }
  }
  if (portBad) failures += portBad
  else console.log(`ok   portOf: ${portCases.length} cases agree across DIM/DTK/BAL`)
}

// 8. An unknown policy key is a typo, and a typo would silently leave the default
//    in place, so the shared factory throws. A plugin that names its own policy
//    must not swallow that — it should reach the caller.
{
  let policyBad = 0
  for (const [repo, tag, factory] of repos) {
    let threw = false
    try {
      mods[repo][factory]({ currentPort: () => 3080, respond: () => {}, policy: { not_a_reason: { code: 'x' } } })
    } catch {
      threw = true
    }
    if (!threw) {
      console.log(`FAIL ${tag}: an unknown policy key was accepted instead of throwing`)
      policyBad++
    }
  }
  if (policyBad) failures += policyBad
  else console.log('ok   policy validation: an unknown key is rejected by every plugin')
}

console.log(failures ? `\n${failures} drift problem(s)` : '\nno drift')
process.exit(failures ? 1 : 0)
