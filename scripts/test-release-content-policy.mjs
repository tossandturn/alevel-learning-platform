import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  MAX_RELEASE_BYTES,
  artifactTreeIdentity,
  assertWithinLimit,
  findEscapingSymlinks,
  findForbiddenFiles,
  findUnexpectedReleaseEntries,
  physicalTreeBytes,
  pathsOverlap,
} from './release-content-policy.mjs'

const prepareScript = path.resolve(import.meta.dirname, 'prepare-stem-release.mjs')
const packageManifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8'))

assert.match(
  packageManifest.scripts?.preview || '',
  /(?:^|\s)--configLoader\s+native(?:\s|$)/,
  'production preview must load the Vite config without writing temporary files into an immutable release',
)
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-release-policy-'))

function runPrepare(releaseRoot, assetsRoot, catalogPath, pdfLibraryRoot) {
  return spawnSync(process.execPath, [
    prepareScript,
    '--release-root',
    releaseRoot,
    '--assets-dir',
    assetsRoot,
    '--catalog-file',
    catalogPath,
    '--pdf-library-root',
    pdfLibraryRoot,
  ], { encoding: 'utf8' })
}

try {
  const pdfLibraryRoot = path.join(scratchRoot, 'library')
  const sourceAssetsRoot = path.join(scratchRoot, 'question-assets')
  const releaseRoot = path.join(scratchRoot, 'release')
  fs.mkdirSync(path.join(pdfLibraryRoot, '9702'), { recursive: true })
  fs.mkdirSync(path.join(sourceAssetsRoot, 'paper-1'), { recursive: true })
  fs.mkdirSync(path.join(releaseRoot, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(releaseRoot, 'scripts'), { recursive: true })
  const sourceCatalogPath = path.join(scratchRoot, 'papers.json')
  fs.writeFileSync(sourceCatalogPath, '{}')
  fs.writeFileSync(path.join(releaseRoot, 'scripts', 'verify-stem-release.mjs'), 'process.exit(0)')

  assert.equal(pathsOverlap(sourceAssetsRoot, pdfLibraryRoot), false, 'independent content roots must not overlap')
  assert.equal(pathsOverlap(sourceAssetsRoot, path.join(sourceAssetsRoot, 'paper-1')), true, 'nested content roots must overlap')

  const overlapRun = runPrepare(releaseRoot, pdfLibraryRoot, sourceCatalogPath, pdfLibraryRoot)
  assert.notEqual(overlapRun.status, 0, 'prepare must reject an assets directory that is the PDF library')
  assert.match(`${overlapRun.stdout}\n${overlapRun.stderr}`, /separate from the PDF library/)

  fs.writeFileSync(path.join(sourceAssetsRoot, 'paper-1', 'qp-01.jpg'), 'fixture')
  fs.writeFileSync(path.join(sourceAssetsRoot, 'paper-1', 'qp.pdf'), 'forbidden')
  assert.deepEqual(
    findForbiddenFiles(sourceAssetsRoot, ['.pdf']),
    [path.join('paper-1', 'qp.pdf')],
    'content assets must reject physical PDF files',
  )

  const pdfReleaseRoot = path.join(scratchRoot, 'release-with-pdf')
  fs.mkdirSync(path.join(pdfReleaseRoot, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(pdfReleaseRoot, 'scripts', 'verify-stem-release.mjs'), 'process.exit(0)')
  const pdfRun = runPrepare(pdfReleaseRoot, sourceAssetsRoot, sourceCatalogPath, pdfLibraryRoot)
  assert.notEqual(pdfRun.status, 0, 'prepare must reject PDF files in the rendered asset tree')
  assert.match(`${pdfRun.stdout}\n${pdfRun.stderr}`, /non-rendered archive\/PDF files/)

  fs.writeFileSync(path.join(releaseRoot, 'dist', 'index.html'), 'ok')
  assert.equal(physicalTreeBytes(releaseRoot) > 0, true, 'physical release size must include regular files')
  assert.throws(
    () => assertWithinLimit(MAX_RELEASE_BYTES + 1, MAX_RELEASE_BYTES, 'release'),
    /exceeding the .* release policy limit/,
    'oversized physical releases must be rejected',
  )

  fs.writeFileSync(path.join(releaseRoot, 'AGENTS.md'), 'not runtime content')
  fs.mkdirSync(path.join(releaseRoot, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(releaseRoot, '.env.example'), 'must not be packaged')
  assert.deepEqual(
    findUnexpectedReleaseEntries(releaseRoot),
    ['.env.example', 'AGENTS.md', 'docs'],
    'the release allowlist must reject policy, documentation, and environment files',
  )

  const externalDependencies = path.join(scratchRoot, 'external-node-modules')
  fs.mkdirSync(externalDependencies, { recursive: true })
  fs.symlinkSync(externalDependencies, path.join(releaseRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.symlinkSync(path.join(releaseRoot, 'scripts'), path.join(releaseRoot, 'internal-scripts-link'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.deepEqual(
    findEscapingSymlinks(releaseRoot),
    ['node_modules'],
    'a release must reject cross-release dependencies while allowing links that resolve inside itself',
  )

  const firstIdentity = artifactTreeIdentity(releaseRoot)
  fs.appendFileSync(path.join(releaseRoot, 'dist', 'index.html'), '-tampered')
  const changedIdentity = artifactTreeIdentity(releaseRoot)
  assert.notEqual(changedIdentity.sha256, firstIdentity.sha256, 'the release tree digest must detect a changed runtime file')
  assert.ok(firstIdentity.entries.some((entry) => entry.path === 'dist/index.html'), 'the release manifest identity must enumerate runtime files')

  console.log(JSON.stringify({ ok: true, maxReleaseBytes: MAX_RELEASE_BYTES }, null, 2))
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
}
