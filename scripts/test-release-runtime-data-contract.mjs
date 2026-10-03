import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { validateReleaseManifest } from './release-manifest-contract.mjs'

const scriptsRoot = import.meta.dirname
const prepareScript = path.join(scriptsRoot, 'prepare-stem-release.mjs')
const writerScript = path.join(scriptsRoot, 'write-stem-release-manifest.mjs')
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-release-runtime-data-'))
const commit = 'a'.repeat(40)
const packageSha256 = 'b'.repeat(64)
const treeIdentity = Object.freeze({ files: 1, symlinks: 0, bytes: 1, sha256: 'c'.repeat(64) })

function output(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

function manifestFixture(overrides = {}) {
  return {
    schemaVersion: 'stem-release-manifest.v1',
    releaseId: `fixture-${commit.slice(0, 7)}`,
    commit,
    packageSha256,
    generatedAt: new Date().toISOString(),
    releaseTree: treeIdentity,
    immutableAssets: { identity: 'fixture-assets', ...treeIdentity },
    syllabusScope: {
      schemaVersion: 'stem-syllabus-release-scope.v1',
      routeIds: ['cie-9702-as-physics'],
    },
    ...overrides,
  }
}

function symlinkDirectory(target, link) {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

function createRelease(label, { dataTarget = '', physicalData = false, withImmutableAssets = true } = {}) {
  const releaseRoot = path.join(scratchRoot, `${label}-${commit.slice(0, 7)}`)
  const immutableAssetsRoot = path.join(releaseRoot, 'public', 'question-assets')
  fs.mkdirSync(path.join(releaseRoot, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(releaseRoot, 'scripts'), { recursive: true })
  if (withImmutableAssets) fs.mkdirSync(immutableAssetsRoot, { recursive: true })
  fs.writeFileSync(path.join(releaseRoot, 'dist', 'index.html'), '<!doctype html>\n', 'utf8')
  fs.writeFileSync(path.join(releaseRoot, 'dist', 'build-identity.json'), `${JSON.stringify({
    schemaVersion: 'stem-build-identity.v1', commit, sourceState: 'clean',
  })}\n`, 'utf8')
  fs.writeFileSync(path.join(releaseRoot, 'scripts', 'verify-stem-release.mjs'), 'process.exit(0)\n', 'utf8')
  if (physicalData) fs.mkdirSync(path.join(releaseRoot, 'data'))
  else if (dataTarget) symlinkDirectory(dataTarget, path.join(releaseRoot, 'data'))
  return { releaseRoot, immutableAssetsRoot }
}

function createContentSources(label) {
  const root = path.join(scratchRoot, `content-${label}`)
  const assetsRoot = path.join(root, 'question-assets')
  const catalogRoot = path.join(root, 'catalog')
  const subjectCatalogRoot = path.join(catalogRoot, 'papers')
  const pdfLibraryRoot = path.join(root, 'pdf-library')
  fs.mkdirSync(path.join(assetsRoot, 'paper-1'), { recursive: true })
  fs.mkdirSync(subjectCatalogRoot, { recursive: true })
  fs.mkdirSync(pdfLibraryRoot, { recursive: true })
  fs.writeFileSync(path.join(assetsRoot, 'paper-1', 'qp-01.jpg'), 'fixture', 'utf8')
  fs.writeFileSync(path.join(catalogRoot, 'papers.json'), '{"items":[]}\n', 'utf8')
  fs.writeFileSync(path.join(subjectCatalogRoot, '9702.json'), '{"items":[]}\n', 'utf8')
  return { assetsRoot, catalogPath: path.join(catalogRoot, 'papers.json'), pdfLibraryRoot }
}

function runPrepare(release, sources, runtimeDataRoot = '') {
  const args = [
    prepareScript,
    '--release-root', release.releaseRoot,
    '--assets-dir', sources.assetsRoot,
    '--catalog-file', sources.catalogPath,
    '--pdf-library-root', sources.pdfLibraryRoot,
  ]
  if (runtimeDataRoot) args.push('--runtime-data-root', runtimeDataRoot)
  return spawnSync(process.execPath, args, { encoding: 'utf8' })
}

function runWriter(release, { runtimeDataRoot = '', readinessMode } = {}) {
  const args = [
    writerScript,
    '--release-root', release.releaseRoot,
    '--immutable-assets-root', release.immutableAssetsRoot,
    '--commit', commit,
    '--release-id', path.basename(release.releaseRoot),
    '--package-sha256', packageSha256,
    '--route', 'cie-9702-as-physics',
  ]
  if (runtimeDataRoot) args.push('--runtime-data-root', runtimeDataRoot)
  if (readinessMode !== undefined) args.push('--readiness-mode', readinessMode)
  return spawnSync(process.execPath, args, { encoding: 'utf8' })
}

try {
  const externalDataRoot = path.join(scratchRoot, 'persistent-data')
  const wrongDataRoot = path.join(scratchRoot, 'wrong-data')
  fs.mkdirSync(externalDataRoot)
  fs.mkdirSync(wrongDataRoot)

  assert.equal(validateReleaseManifest(manifestFixture()).valid, true, 'legacy manifests must retain the safe formal default')
  assert.equal(validateReleaseManifest(manifestFixture({
    runtimeData: { schemaVersion: 'stem-runtime-data-binding.v1', relativePath: 'data', target: externalDataRoot },
    syllabusScope: {
      schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: ['cie-9702-as-physics'],
      readinessMode: 'student-study', aiStudyFormalProgressEligible: false,
    },
  })).valid, true)
  assert.equal(validateReleaseManifest(manifestFixture({
    runtimeData: { schemaVersion: 'stem-runtime-data-binding.v1', relativePath: 'data', target: '/home/ubuntu/alevel-physics/data' },
    syllabusScope: {
      schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: ['cie-9702-as-physics'],
      readinessMode: 'student-study', aiStudyFormalProgressEligible: false,
    },
  })).valid, true, 'a Linux deployment manifest must validate during read-only review on Windows')
  for (const invalid of [
    { syllabusScope: { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: ['cie-9702-as-physics'], readinessMode: 'study' } },
    { syllabusScope: { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: ['cie-9702-as-physics'], readinessMode: 'student-study' } },
    { syllabusScope: { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: ['cie-9702-as-physics'], readinessMode: 'formal' } },
    { syllabusScope: { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: ['cie-9702-as-physics'], readinessMode: 'student-study', aiStudyFormalProgressEligible: true } },
    { syllabusScope: { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: ['cie-9702-as-physics'], readinessMode: 'formal', aiStudyFormalProgressEligible: false, ambiguous: true } },
    { syllabusScope: { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: [' cie-9702-as-physics '] } },
    { syllabusScope: { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: [9702] } },
    { runtimeData: null },
    { runtimeData: { schemaVersion: 'stem-runtime-data-binding.v1', relativePath: 'storage', target: externalDataRoot } },
    { runtimeData: { schemaVersion: 'stem-runtime-data-binding.v1', relativePath: 'data', target: 'relative/data' } },
    { runtimeData: { schemaVersion: 'stem-runtime-data-binding.v1', relativePath: 'data', target: externalDataRoot, extra: true } },
  ]) assert.equal(validateReleaseManifest(manifestFixture(invalid)).valid, false, JSON.stringify(invalid))

  const undeclaredRelease = createRelease('prepare-undeclared', { dataTarget: externalDataRoot, withImmutableAssets: false })
  const undeclaredPrepare = runPrepare(undeclaredRelease, createContentSources('prepare-undeclared'))
  assert.notEqual(undeclaredPrepare.status, 0, 'prepare must reject an undeclared data link')

  const preparedRelease = createRelease('prepare-valid', { dataTarget: externalDataRoot, withImmutableAssets: false })
  const prepared = runPrepare(preparedRelease, createContentSources('prepare-valid'), externalDataRoot)
  assert.equal(prepared.status, 0, output(prepared))
  assert.deepEqual(fs.readdirSync(externalDataRoot), [], 'prepare must never traverse or populate persistent data')
  assert.equal(fs.realpathSync(path.join(preparedRelease.releaseRoot, 'data')), fs.realpathSync(externalDataRoot))

  const wrongRelease = createRelease('prepare-wrong-target', { dataTarget: externalDataRoot, withImmutableAssets: false })
  const wrongPrepare = runPrepare(wrongRelease, createContentSources('prepare-wrong-target'), wrongDataRoot)
  assert.notEqual(wrongPrepare.status, 0, 'prepare must reject a data link that resolves to another target')

  const physicalRelease = createRelease('prepare-physical-data', { physicalData: true, withImmutableAssets: false })
  const physicalPrepare = runPrepare(physicalRelease, createContentSources('prepare-physical-data'), externalDataRoot)
  assert.notEqual(physicalPrepare.status, 0, 'prepare must reject copied physical data')

  const internalRelease = createRelease('prepare-internal-target', { withImmutableAssets: false })
  const internalDataRoot = path.join(internalRelease.releaseRoot, 'persistent-inside-release')
  fs.mkdirSync(internalDataRoot)
  symlinkDirectory(internalDataRoot, path.join(internalRelease.releaseRoot, 'data'))
  const internalPrepare = runPrepare(internalRelease, createContentSources('prepare-internal-target'), internalDataRoot)
  assert.notEqual(internalPrepare.status, 0, 'prepare must reject persistent data located inside the release')

  const formalRelease = createRelease('writer-formal')
  const formalWrite = runWriter(formalRelease)
  assert.equal(formalWrite.status, 0, output(formalWrite))
  const formalManifest = JSON.parse(fs.readFileSync(path.join(formalRelease.releaseRoot, 'release-manifest.json'), 'utf8'))
  assert.equal(formalManifest.runtimeData, undefined)
  assert.equal(formalManifest.syllabusScope.readinessMode, 'formal')
  assert.equal(formalManifest.syllabusScope.aiStudyFormalProgressEligible, false)

  const studyRelease = createRelease('writer-study', { dataTarget: externalDataRoot })
  const studyWrite = runWriter(studyRelease, { runtimeDataRoot: externalDataRoot, readinessMode: 'student-study' })
  assert.equal(studyWrite.status, 0, output(studyWrite))
  const studyManifest = JSON.parse(fs.readFileSync(path.join(studyRelease.releaseRoot, 'release-manifest.json'), 'utf8'))
  assert.deepEqual(studyManifest.runtimeData, {
    schemaVersion: 'stem-runtime-data-binding.v1', relativePath: 'data', target: path.resolve(externalDataRoot),
  })
  assert.equal(studyManifest.syllabusScope.readinessMode, 'student-study')
  assert.equal(studyManifest.syllabusScope.aiStudyFormalProgressEligible, false)
  assert.equal(validateReleaseManifest(studyManifest).valid, true)
  assert.equal(studyManifest.releaseTree.symlinks, 1, 'the manifest must bind the data link without hashing its contents')

  for (const [label, release, options] of [
    ['undeclared', createRelease('writer-undeclared', { dataTarget: externalDataRoot }), {}],
    ['wrong-target', createRelease('writer-wrong-target', { dataTarget: externalDataRoot }), { runtimeDataRoot: wrongDataRoot }],
    ['physical', createRelease('writer-physical', { physicalData: true }), { runtimeDataRoot: externalDataRoot }],
    ['missing-link', createRelease('writer-missing-link'), { runtimeDataRoot: externalDataRoot }],
    ['relative-target', createRelease('writer-relative-target'), { runtimeDataRoot: 'relative/data' }],
    ['invalid-mode', createRelease('writer-invalid-mode'), { readinessMode: 'study' }],
  ]) {
    const result = runWriter(release, options)
    assert.notEqual(result.status, 0, `${label} must fail`)
    assert.equal(fs.existsSync(path.join(release.releaseRoot, 'release-manifest.json')), false, `${label} must not write a manifest`)
  }

  console.log(JSON.stringify({ ok: true, scope: 'release-runtime-data-contract' }))
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
}
