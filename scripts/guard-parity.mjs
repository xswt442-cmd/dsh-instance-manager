// Cross-repo drift check for the shared host guard.
//
// Why this exists: the three plugins ship their own copy of the request guard
// because each package has to stand alone. That copy drifted three times, and
// every drift was security-relevant:
//
//   1. all three rejected IPv6 loopback (`::1`) — a legitimate browser was
//      locked out of its own API;
//   2. the three disagreed on which Host spellings count as loopback, and
//      dsh-instance-manager carried an allowlist entry its Origin path could
//      never reach;
//   3. a Host that parsed to no hostname silently skipped the allowlist in one
//      plugin and was denied in the others.
//
// The copies are no longer hand-written: they are an embedded block generated
// from dsh-mini-utility-dock/dist/guard.js by the dock CLI. So this checker
// asserts three things a generator alone cannot:
//
//   * the embedded block is byte-identical in all three repos (a hand edit to
//     one copy, or a repo that never re-ran `guard:sync`, fails here);
//   * no repo keeps a private copy of an enforcement decision beside the block —
//     that is how drifts 1-3 happened, and embedding the block is worthless if a
//     repo also branches on its own version;
//   * the three AGREE ON EVERY DECISION. Error codes and wording deliberately
//     differ (each plugin's published API vocabulary), so the comparison is on
//     the allow/deny outcome only. This is the assertion that survives a policy
//     change: byte equality implies it, but only this proves each consumer
//     actually routes through the block.
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
// Exit code 0 = identical blocks, no private copies, and every decision agrees.

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = process.env.DSH_PLUGINS_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const repos = [
  ['dsh-instance-manager', 'DIM', 'createGuard'],
  ['dsh-treekeeper', 'DTK', 'treekeeperGuard'],
  ['dsh-ballast', 'BAL', 'ballastGuard']
]

const MARK_START = '// <dsh-host-guard>'
const MARK_END = '// </dsh-host-guard>'

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
    ['indent is stripped', [MARK_START, '  const a = 1', MARK_END].join('\n'), 'const a = 1'],
    ['wrong fragment marker returns null', ['// <dsh-mini-utility-dock>', 'x', MARK_END].join('\n'), null]
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
  console.log(`FAIL guard block: missing or malformed markers in ${missing.map((m) => m.tag).join(', ')}`)
  failures++
} else {
  const base = blocks[0]
  const drifted = blocks.slice(1).filter((b) => b.block !== base.block)
  if (drifted.length) {
    console.log(`FAIL guard block: ${drifted.map((d) => d.tag).join(', ')} differ from ${base.tag}`)
    for (const d of drifted) {
      console.log(`\n--- ${base.tag} (${base.repo}/lib/shared.js) ---\n${base.block}`)
      console.log(`\n--- ${d.tag} (${d.repo}/lib/shared.js) ---\n${d.block}`)
    }
    failures++
  } else {
    console.log(`ok   guard block: identical across DIM/DTK/BAL (${base.block.length} chars)`)
  }
}

// 2. Embedding the block is worthless if a repo also keeps its own enforcement
//    beside it. Policy is expected outside the block; decisions are not.
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
  [/sec-fetch-site/, 'branches on Fetch Metadata outside the block']
]
for (const [repo, tag] of repos) {
  const outside = dropBlock(read(repo))
  const problems = ENFORCEMENT.filter(([re]) => re.test(outside)).map(([, why]) => why)
  // A private guard factory would have to read the peer address; catching that
  // combination keeps this list honest without flagging a shared-criterion helper.
  if (/remoteAddress/.test(outside) && /function\s+guard\s*\(|=>\s*\{\s*$/.test(outside)) {
    problems.push('looks like a private guard reading the socket peer')
  }
  if (problems.length) {
    console.log(`FAIL ${tag}: ${problems.join('; ')}`)
    failures++
  } else {
    console.log(`ok   ${tag}: no enforcement outside the generated block`)
  }
}

// 3. Every decision must agree across the three. Codes differ by design, so only
//    the verdict is compared.
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

// 4. Fleet mode is the one place the guard deliberately relaxes, and only DIM
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

// 5. The predicates themselves, called directly, across every repo.
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

// 6. portOf normalises the default ports, which is what stopped a same-origin
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

// 7. An unknown policy key is a typo, and a typo would silently leave the default
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
