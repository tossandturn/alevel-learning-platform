import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const pruneScript = path.resolve(import.meta.dirname, 'prune-stem-releases.mjs')
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-release-prune-'))

function createRelease(releasesRoot, name, timestamp, generatedAt = '') {
  const commit = crypto.createHash('sha1').update(name).digest('hex')
  const releaseName = generatedAt ? `${name}-${commit.slice(0, 7)}` : name
  const releasePath = path.join(releasesRoot, releaseName)
  fs.mkdirSync(releasePath, { recursive: true })
  fs.writeFileSync(path.join(releasePath, 'release.txt'), releaseName)
  if (generatedAt) {
    const releaseSha256 = crypto.createHash('sha256').update(releaseName).digest('hex')
    fs.writeFileSync(path.join(releasePath, 'release-manifest.json'), `${JSON.stringify({
      schemaVersion: 'stem-release-manifest.v1',
      releaseId: releaseName,
      commit,
      packageSha256: releaseSha256,
      generatedAt,
      releaseTree: { files: 1, symlinks: 0, bytes: Buffer.byteLength(releaseName), sha256: releaseSha256 },
      immutableAssets: { identity: `${releaseName}-assets`, files: 0, symlinks: 0, bytes: 0, sha256: crypto.createHash('sha256').update('').digest('hex') },
    }, null, 2)}\n`)
  }
  fs.utimesSync(releasePath, timestamp, timestamp)
  return releasePath
}

function runPrune(args) {
  return spawnSync(process.execPath, [pruneScript, ...args], { encoding: 'utf8' })
}

try {
  const releasesRoot = path.join(scratchRoot, 'releases')
  const currentLink = path.join(scratchRoot, 'current')
  fs.mkdirSync(releasesRoot, { recursive: true })

  const active = createRelease(releasesRoot, '20260827-active', new Date('2026-08-21T00:00:00Z'))
  const rollback = createRelease(releasesRoot, '20260826-rollback', new Date('2026-08-27T00:00:00Z'))
  const oldest = createRelease(releasesRoot, '20260823-oldest', new Date('2026-08-27T00:00:00Z'))
  const stale = createRelease(releasesRoot, '20260824-stale', new Date('2026-08-27T00:00:00Z'))
  const sameDayOlder = createRelease(
    releasesRoot,
    '20260825-earlier',
    new Date('2026-08-27T00:00:00Z'),
    '2026-08-25T08:00:00.000Z',
  )
  const newest = createRelease(
    releasesRoot,
    '20260825-newest',
    new Date('2026-08-20T00:00:00Z'),
    '2026-08-25T12:00:00.000Z',
  )
  const sharedDependencies = createRelease(releasesRoot, '20260822-dependencies', new Date('2026-08-27T00:00:00Z'))
  fs.rmSync(sharedDependencies, { recursive: true, force: true })
  fs.mkdirSync(sharedDependencies, { recursive: true })
  fs.writeFileSync(path.join(sharedDependencies, 'dependency.txt'), 'shared')
  fs.symlinkSync(sharedDependencies, path.join(newest, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.symlinkSync(active, currentLink, process.platform === 'win32' ? 'junction' : 'dir')

  const baseArgs = [
    '--releases-root', releasesRoot,
    '--current', currentLink,
    '--retain', rollback,
    '--keep', '1',
  ]

  const dryRun = runPrune(baseArgs)
  assert.equal(dryRun.status, 0, `dry run must succeed before any deletion:\n${dryRun.stdout}\n${dryRun.stderr}`)
  const dryPlan = JSON.parse(dryRun.stdout)
  assert.equal(dryPlan.mode, 'dry-run', 'pruning must be dry-run by default')
  assert.deepEqual(new Set(dryPlan.delete), new Set([oldest, stale, sameDayOlder]), 'only unprotected releases beyond the retention count may be selected')
  assert.ok(!dryPlan.delete.includes(sharedDependencies), 'a dependency target referenced by a retained release must not be deleted')
  assert.equal(dryPlan.ordering.find((release) => release.path === newest)?.source, 'manifest', 'a valid release manifest must provide the primary release order')
  assert.equal(dryPlan.ordering.find((release) => release.path === stale)?.source, 'release-id', 'production release IDs must order legacy releases before mutable directory timestamps')
  for (const releasePath of [active, rollback, oldest, stale, sameDayOlder, newest]) {
    assert.ok(fs.existsSync(releasePath), 'dry run must not delete a release')
  }

  const applyRun = runPrune([...baseArgs, '--apply'])
  assert.equal(applyRun.status, 0, `explicit apply must remove only the dry-run candidates:\n${applyRun.stdout}\n${applyRun.stderr}`)
  const applyPlan = JSON.parse(applyRun.stdout)
  assert.equal(applyPlan.mode, 'apply')
  assert.deepEqual(new Set(applyPlan.deleted), new Set([oldest, stale, sameDayOlder]), 'apply must remove exactly the planned stale releases')
  for (const releasePath of [active, rollback, newest]) {
    assert.ok(fs.existsSync(releasePath), 'active, retained, and newest kept releases must survive')
  }
  for (const releasePath of [oldest, stale, sameDayOlder]) {
    assert.equal(fs.existsSync(releasePath), false, 'explicit apply must remove stale release directories')
  }
  assert.ok(fs.existsSync(sharedDependencies), 'a shared dependency target referenced by a kept release must survive apply')

  const outsideRelease = path.join(scratchRoot, 'outside-release')
  fs.mkdirSync(outsideRelease)
  const outsideRetain = runPrune([
    '--releases-root', releasesRoot,
    '--current', currentLink,
    '--retain', outsideRelease,
  ])
  assert.notEqual(outsideRetain.status, 0, 'an out-of-tree retained path must fail closed')
  assert.match(`${outsideRetain.stdout}\n${outsideRetain.stderr}`, /must resolve inside releases root/)

  const futureRoot = path.join(scratchRoot, 'future-releases')
  const futureCurrentLink = path.join(scratchRoot, 'future-current')
  fs.mkdirSync(futureRoot)
  const futureCurrent = createRelease(futureRoot, '20260827-current', new Date('2026-08-27T00:00:00Z'))
  const genuinelyNewer = createRelease(futureRoot, '20260826-newer', new Date('2026-08-26T00:00:00Z'))
  const forgedFuture = createRelease(futureRoot, '20260820-forged-future', new Date('2026-08-20T00:00:00Z'), '2099-01-01T00:00:00.000Z')
  fs.symlinkSync(futureCurrent, futureCurrentLink, process.platform === 'win32' ? 'junction' : 'dir')
  const futureRun = runPrune([
    '--releases-root', futureRoot,
    '--current', futureCurrentLink,
    '--keep', '1',
  ])
  assert.equal(futureRun.status, 0, `future-manifest dry run must complete safely:\n${futureRun.stdout}\n${futureRun.stderr}`)
  const futurePlan = JSON.parse(futureRun.stdout)
  assert.ok(futurePlan.keep.includes(genuinelyNewer), 'a forged future manifest must not displace a genuinely newer release')
  assert.ok(futurePlan.delete.includes(forgedFuture), 'an old release with a future manifest timestamp must remain pruneable')
  assert.equal(futurePlan.ordering.find((release) => release.path === forgedFuture)?.source, 'release-id', 'an incomplete or future manifest must not control release ordering')

  const unsafeRoot = path.join(scratchRoot, 'unsafe-releases')
  const unsafeCurrentLink = path.join(scratchRoot, 'unsafe-current')
  fs.mkdirSync(unsafeRoot)
  const unsafeCurrent = createRelease(unsafeRoot, '20260827-current', new Date('2026-08-27T00:00:00Z'))
  const unsafeCandidate = createRelease(unsafeRoot, '20260820-candidate', new Date('2026-08-20T00:00:00Z'))
  fs.symlinkSync(unsafeCurrent, unsafeCurrentLink, process.platform === 'win32' ? 'junction' : 'dir')
  fs.symlinkSync(path.join(unsafeRoot, 'missing-release'), path.join(unsafeCurrent, 'unresolved-dependency'), process.platform === 'win32' ? 'junction' : 'dir')
  const unsafeApply = runPrune([
    '--releases-root', unsafeRoot,
    '--current', unsafeCurrentLink,
    '--keep', '0',
    '--apply',
  ])
  assert.notEqual(unsafeApply.status, 0, 'apply must fail closed when retained-release dependency scanning is incomplete')
  assert.ok(fs.existsSync(unsafeCandidate), 'a scan failure must prevent every planned release deletion')

  console.log(JSON.stringify({ ok: true }, null, 2))
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
}
