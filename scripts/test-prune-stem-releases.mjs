import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const pruneScript = path.resolve(import.meta.dirname, 'prune-stem-releases.mjs')
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-release-prune-'))

function createRelease(releasesRoot, name, timestamp) {
  const releasePath = path.join(releasesRoot, name)
  fs.mkdirSync(releasePath, { recursive: true })
  fs.writeFileSync(path.join(releasePath, 'release.txt'), name)
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

  const active = createRelease(releasesRoot, 'active', new Date('2026-08-27T00:00:00Z'))
  const rollback = createRelease(releasesRoot, 'rollback', new Date('2026-08-26T00:00:00Z'))
  const oldest = createRelease(releasesRoot, 'oldest', new Date('2026-08-23T00:00:00Z'))
  const stale = createRelease(releasesRoot, 'stale', new Date('2026-08-24T00:00:00Z'))
  const newest = createRelease(releasesRoot, 'newest', new Date('2026-08-25T00:00:00Z'))
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
  assert.deepEqual(new Set(dryPlan.delete), new Set([oldest, stale]), 'only unprotected releases beyond the retention count may be selected')
  for (const releasePath of [active, rollback, oldest, stale, newest]) {
    assert.ok(fs.existsSync(releasePath), 'dry run must not delete a release')
  }

  const applyRun = runPrune([...baseArgs, '--apply'])
  assert.equal(applyRun.status, 0, `explicit apply must remove only the dry-run candidates:\n${applyRun.stdout}\n${applyRun.stderr}`)
  const applyPlan = JSON.parse(applyRun.stdout)
  assert.equal(applyPlan.mode, 'apply')
  assert.deepEqual(new Set(applyPlan.deleted), new Set([oldest, stale]), 'apply must remove exactly the planned stale releases')
  for (const releasePath of [active, rollback, newest]) {
    assert.ok(fs.existsSync(releasePath), 'active, retained, and newest kept releases must survive')
  }
  for (const releasePath of [oldest, stale]) {
    assert.equal(fs.existsSync(releasePath), false, 'explicit apply must remove stale release directories')
  }

  const outsideRelease = path.join(scratchRoot, 'outside-release')
  fs.mkdirSync(outsideRelease)
  const outsideRetain = runPrune([
    '--releases-root', releasesRoot,
    '--current', currentLink,
    '--retain', outsideRelease,
  ])
  assert.notEqual(outsideRetain.status, 0, 'an out-of-tree retained path must fail closed')
  assert.match(`${outsideRetain.stdout}\n${outsideRetain.stderr}`, /must resolve inside releases root/)

  console.log(JSON.stringify({ ok: true }, null, 2))
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
}
