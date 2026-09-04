import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const writer = path.resolve(import.meta.dirname, 'write-stem-release-manifest.mjs')
const verifier = path.resolve(import.meta.dirname, 'verify-stem-release.mjs')
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-release-build-identity-'))
const pdfLibraryRoot = path.join(scratchRoot, 'pdf-library')
const commit = 'a'.repeat(40)
const otherCommit = 'b'.repeat(40)
const packageSha256 = 'c'.repeat(64)
fs.mkdirSync(pdfLibraryRoot, { recursive: true })

function createRelease(name, buildIdentity) {
  const releaseRoot = path.join(scratchRoot, name)
  const immutableAssetsRoot = path.join(releaseRoot, 'public', 'question-assets')
  fs.mkdirSync(path.join(releaseRoot, 'dist'), { recursive: true })
  fs.mkdirSync(immutableAssetsRoot, { recursive: true })
  fs.writeFileSync(path.join(releaseRoot, 'dist', 'index.html'), '<!doctype html>\n', 'utf8')
  if (buildIdentity !== undefined) {
    fs.writeFileSync(
      path.join(releaseRoot, 'dist', 'build-identity.json'),
      `${JSON.stringify(buildIdentity, null, 2)}\n`,
      'utf8',
    )
  }
  return { releaseRoot, immutableAssetsRoot }
}

function runWriter(fixture, releaseId) {
  return spawnSync(process.execPath, [
    writer,
    '--release-root', fixture.releaseRoot,
    '--immutable-assets-root', fixture.immutableAssetsRoot,
    '--commit', commit,
    '--release-id', releaseId,
    '--package-sha256', packageSha256,
  ], { encoding: 'utf8' })
}

function output(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

try {
  const missing = createRelease(`missing-${commit.slice(0, 7)}`)
  const missingResult = runWriter(missing, path.basename(missing.releaseRoot))
  assert.notEqual(missingResult.status, 0, 'manifest generation must reject a missing build identity')
  assert.match(output(missingResult), /build[- ]identity/i)

  const mismatched = createRelease(`mismatch-${commit.slice(0, 7)}`, {
    schemaVersion: 'stem-build-identity.v1',
    commit: otherCommit,
    sourceState: 'clean',
  })
  const mismatchResult = runWriter(mismatched, path.basename(mismatched.releaseRoot))
  assert.notEqual(mismatchResult.status, 0, 'manifest generation must reject a build from another commit')
  assert.match(output(mismatchResult), /build[- ]identity.*commit|commit.*build[- ]identity/i)

  const dirty = createRelease(`dirty-${commit.slice(0, 7)}`, {
    schemaVersion: 'stem-build-identity.v1',
    commit,
    sourceState: 'dirty',
  })
  const dirtyResult = runWriter(dirty, path.basename(dirty.releaseRoot))
  assert.notEqual(dirtyResult.status, 0, 'manifest generation must reject a build produced from a dirty source tree')
  assert.match(output(dirtyResult), /clean source tree|source state/i)

  const wrongReleaseId = createRelease('release-without-short-sha', {
    schemaVersion: 'stem-build-identity.v1',
    commit,
    sourceState: 'clean',
  })
  const wrongReleaseIdResult = runWriter(wrongReleaseId, path.basename(wrongReleaseId.releaseRoot))
  assert.notEqual(wrongReleaseIdResult.status, 0, 'manifest generation must bind the release ID to the commit short SHA')
  assert.match(output(wrongReleaseIdResult), /release id.*short sha|short sha.*release id/i)

  const wrongRootName = createRelease(`manifest-id-${commit.slice(0, 7)}`, {
    schemaVersion: 'stem-build-identity.v1',
    commit,
    sourceState: 'clean',
  })
  const wrongRootNameResult = spawnSync(process.execPath, [
    writer,
    '--release-root', wrongRootName.releaseRoot,
    '--immutable-assets-root', wrongRootName.immutableAssetsRoot,
    '--commit', commit,
    '--release-id', `different-${commit.slice(0, 7)}`,
    '--package-sha256', packageSha256,
  ], { encoding: 'utf8' })
  assert.notEqual(wrongRootNameResult.status, 0, 'manifest generation must bind the release ID to the release root name')
  assert.match(output(wrongRootNameResult), /root basename.*release id|release id.*root basename/i)

  const valid = createRelease(`valid-${commit.slice(0, 7)}`, {
    schemaVersion: 'stem-build-identity.v1',
    commit,
    sourceState: 'clean',
  })
  const validResult = runWriter(valid, path.basename(valid.releaseRoot))
  assert.equal(validResult.status, 0, `matching build identity must generate a manifest:\n${output(validResult)}`)

  fs.writeFileSync(
    path.join(valid.releaseRoot, 'dist', 'build-identity.json'),
    `${JSON.stringify({ schemaVersion: 'stem-build-identity.v1', commit: otherCommit, sourceState: 'clean' }, null, 2)}\n`,
    'utf8',
  )
  const verifyResult = spawnSync(process.execPath, [
    verifier,
    '--release-root', valid.releaseRoot,
    '--pdf-library-root', pdfLibraryRoot,
    '--immutable-assets-root', valid.immutableAssetsRoot,
    '--commit', commit,
    '--release-id', path.basename(valid.releaseRoot),
    '--package-sha256', packageSha256,
  ], { encoding: 'utf8' })
  assert.notEqual(verifyResult.status, 0, 'release verification must reject a tampered embedded build identity')
  assert.match(output(verifyResult), /build[- ]identity.*commit|commit.*build[- ]identity/i)

  console.log(JSON.stringify({ ok: true }, null, 2))
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
}
