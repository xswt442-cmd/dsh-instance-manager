// Auto-port selection regressions.
//
// The bug these cover, observed live: a start died on port P with EADDRINUSE
// (the port read as free while an earlier attempt's bind had not settled), the
// retry re-picked P, and that child died the same way. One failed attempt became
// a loop over the same port, each child writing a diagnostic report. Two things
// had to change: the picker must skip the port the attempt died on, and a pick
// must be confirmed by a real bind rather than by "nothing answered a connect".
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickStartPort, retryableStart, startOnceOrRetry } from '../lib/shared.js'

const range = { min: 3080, max: 3084 }

test('the picker skips the port the previous attempt died on', async () => {
  const asked = []
  const port = await pickStartPort({
    range,
    exclude: 3080,
    available: async (p) => { asked.push(p); return true }
  })
  assert.equal(port, 3081)
  assert.deepEqual(asked, [3081], 'the excluded port is never even probed')
})

test('the picker takes the first port whose availability check passes', async () => {
  const free = new Set([3082, 3083])
  const port = await pickStartPort({ range, available: async (p) => free.has(p) })
  assert.equal(port, 3082)
})

test('an unavailable every port answers 0, never a port that failed its check', async () => {
  const port = await pickStartPort({ range, available: async () => false })
  assert.equal(port, 0)
})

test('only the excluded port being free still answers 0 rather than reusing it', async () => {
  const port = await pickStartPort({ range, exclude: 3080, available: async (p) => p === 3080 })
  assert.equal(port, 0, 're-picking the port that just failed is the loop this guards')
})

// ---- how many times START may spawn --------------------------------------
//
// The retry protects one case (a child that DIED on an auto-picked port) and
// must never grow into the two failures that are worse than the one it fixes:
// spawning on a port the caller never named, and double-spawning a slow boot.
const launches = (results) => {
  const seen = []
  const launch = async (options) => {
    seen.push(options === undefined ? undefined : { ...options })
    return results[seen.length - 1]
  }
  return { launch, seen }
}

test('a dead child on an auto-picked port retries once, skipping that port', async () => {
  const { launch, seen } = launches([
    { ok: false, code: 'start_failed', port: 3081, error: 'child exited' },
    { ok: true, port: 3082, pid: 99 }
  ])
  const r = await startOnceOrRetry(launch, { browserHandoff: true })
  assert.equal(r.ok, true)
  assert.equal(r.port, 3082)
  assert.equal(seen.length, 2, 'exactly one retry')
  assert.equal(seen[1].excludePort, 3081, 'the second attempt must not re-pick the dead port')
  assert.equal(seen[1].browserHandoff, true, 'the caller options survive the retry')
})

test('a merely slow boot is never retried: the child may still be coming up', async () => {
  const { launch, seen } = launches([{ ok: false, code: 'start_unconfirmed', port: 3081, pid: 42 }])
  const r = await startOnceOrRetry(launch, undefined)
  assert.equal(r.code, 'start_unconfirmed', 'the verdict is reported as-is')
  assert.equal(seen.length, 1, 'a second spawn would leave two live instances')
})

test('a named port is never retried elsewhere', async () => {
  const { launch, seen } = launches([{ ok: false, code: 'start_failed', port: 4000, error: 'child exited' }])
  const r = await startOnceOrRetry(launch, { port: 4000 })
  assert.equal(r.code, 'start_failed')
  assert.equal(seen.length, 1, 'retrying would start an instance the caller did not ask for')
})

test('a second failure reports both attempts', async () => {
  const { launch, seen } = launches([
    { ok: false, code: 'start_failed', port: 3081, error: 'first died' },
    { ok: false, code: 'start_failed', port: 3082, error: 'second died' }
  ])
  const r = await startOnceOrRetry(launch, undefined)
  assert.equal(seen.length, 2)
  assert.equal(r.ok, false)
  assert.match(r.error, /first died/)
  assert.match(r.error, /重试仍失败/)
})
