import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { canonicalTextSha256, canonicalUtf8LfText } from './canonical-text.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const indexRelativePath = path.join('src', 'data', 'importedQuestionIndex.json')
const sourceAssetRoot = path.join(repoRoot, 'public', 'question-assets')
const sourceCatalogPath = path.join(repoRoot, 'public', 'data', 'papers.json')
const archiveRef = String(process.env.SOURCE_IDENTITY_ARCHIVE_REF || 'HEAD').trim()
const archiveCommit = execFileSync('git', ['rev-parse', archiveRef], { cwd: repoRoot, encoding: 'utf8' }).trim()
const scratchParent = process.env.SOURCE_IDENTITY_TEST_ROOT
  || (process.platform === 'win32' && fs.existsSync('D:\\CodexWork') ? 'D:\\CodexWork' : os.tmpdir())
const scratchRoot = fs.mkdtempSync(path.join(scratchParent, 'stem-source-identity-'))

function archiveReleaseRoot(name) {
  const releaseRoot = path.join(scratchRoot, name)
  const archivePath = path.join(scratchRoot, `${name}.tar`)
  const runtimePaths = ['index.html', 'package-lock.json', 'package.json', 'public', 'scripts', 'server', 'src', 'vite.config.js']
  execFileSync('git', ['archive', '--format=tar', '--output', archivePath, archiveRef, '--', ...runtimePaths], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
  fs.mkdirSync(releaseRoot, { recursive: true })
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archivePath, '-C', releaseRoot], { stdio: 'ignore' })
  fs.rmSync(archivePath, { force: true })
  return releaseRoot
}

function materializePrivateContent(releaseRoot) {
  assert.ok(fs.existsSync(sourceAssetRoot), 'source question-assets must exist for a release-artifact audit')
  assert.ok(fs.existsSync(sourceCatalogPath), 'source papers.json must exist for a release-artifact audit')
  const targetAssets = path.join(releaseRoot, 'public', 'question-assets')
  const targetCatalog = path.join(releaseRoot, 'public', 'data', 'papers.json')
  fs.mkdirSync(path.dirname(targetAssets), { recursive: true })
  fs.mkdirSync(path.dirname(targetCatalog), { recursive: true })
  fs.cpSync(sourceAssetRoot, targetAssets, { recursive: true, dereference: true, force: false, errorOnExist: true })
  fs.copyFileSync(sourceCatalogPath, targetCatalog, fs.constants.COPYFILE_EXCL)
}

function generateArchiveCatalog(releaseRoot) {
  const result = spawnSync(process.execPath, [path.join(releaseRoot, 'scripts', 'generate-paper-catalog.mjs')], {
    cwd: releaseRoot,
    env: { ...process.env, CIE_SOURCE_ROOT: process.env.CIE_SOURCE_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `git archive paper catalog generation must pass:\n${result.stdout}\n${result.stderr}`)
}

function buildArchiveDist(releaseRoot) {
  const workspaceNodeModules = path.join(repoRoot, 'node_modules')
  const archiveNodeModules = path.join(releaseRoot, 'node_modules')
  const viteBin = path.join(workspaceNodeModules, 'vite', 'bin', 'vite.js')
  assert.ok(fs.existsSync(viteBin), 'Workspace Vite runtime is required for the archive build check')
  if (!fs.existsSync(archiveNodeModules)) {
    fs.symlinkSync(workspaceNodeModules, archiveNodeModules, process.platform === 'win32' ? 'junction' : 'dir')
  }
  const result = spawnSync(process.execPath, [viteBin, 'build', '--config', path.join(releaseRoot, 'vite.config.js')], {
    cwd: releaseRoot,
    env: { ...process.env, STEM_BUILD_COMMIT: archiveCommit },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `git archive production build must pass:\n${result.stdout}\n${result.stderr}`)
  const buildIdentityPath = path.join(releaseRoot, 'dist', 'build-identity.json')
  const expectedBuildIdentity = { schemaVersion: 'stem-build-identity.v1', commit: archiveCommit, sourceState: 'clean' }
  assert.ok(fs.existsSync(buildIdentityPath), 'the Vite build identity plugin must emit dist/build-identity.json')
  assert.deepEqual(
    JSON.parse(fs.readFileSync(buildIdentityPath, 'utf8')),
    expectedBuildIdentity,
    'git archive build identity must bind the dist output to the archived commit',
  )
  if (fs.lstatSync(archiveNodeModules).isSymbolicLink()) {
    fs.unlinkSync(archiveNodeModules)
    fs.mkdirSync(archiveNodeModules, { recursive: true })
    fs.copyFileSync(
      path.join(workspaceNodeModules, '.package-lock.json'),
      path.join(archiveNodeModules, '.package-lock.json'),
    )
  }
}

function runDirectAudit(label, releaseRoot, args = []) {
  const env = { ...process.env }
  delete env.SOURCE_AUDIT_ROOT
  delete env.SOURCE_AUDIT_ASSET_ROOT
  const result = spawnSync(process.execPath, [path.join(releaseRoot, 'scripts', 'audit-question-bank.mjs'), ...args], {
    cwd: releaseRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `${label} audit must pass:\n${result.stdout}\n${result.stderr}`)
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'src', 'data', 'sourceContentManifest.json'), 'utf8'))
  const identity = fs.readFileSync(path.join(releaseRoot, 'src', 'data', 'sourceContentIdentity.js'), 'utf8')
  return { manifest, identity }
}

function runReleaseVerification(releaseRoot) {
  const releaseId = path.basename(releaseRoot)
  const packageSha256 = '0'.repeat(64)
  const assetRoot = path.join(releaseRoot, 'public', 'question-assets')
  const manifest = spawnSync(process.execPath, [
    path.join(releaseRoot, 'scripts', 'write-stem-release-manifest.mjs'),
    '--release-root', releaseRoot,
    '--immutable-assets-root', assetRoot,
    '--commit', archiveCommit,
    '--release-id', releaseId,
    '--package-sha256', packageSha256,
  ], {
    cwd: releaseRoot,
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(manifest.status, 0, `git archive release manifest must generate:\n${manifest.stdout}\n${manifest.stderr}`)
  const result = spawnSync(process.execPath, [
    path.join(releaseRoot, 'scripts', 'verify-stem-release.mjs'),
    '--release-root',
    releaseRoot,
    '--pdf-library-root',
    process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf',
    '--immutable-assets-root', assetRoot,
    '--commit', archiveCommit,
    '--release-id', releaseId,
    '--package-sha256', packageSha256,
  ], {
    cwd: releaseRoot,
    env: { ...process.env, CIE_LIBRARY_ROOT: process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `git archive release verification must pass:\n${result.stdout}\n${result.stderr}`)
}

try {
  const archiveRoot = archiveReleaseRoot(`archive-lf-${archiveCommit.slice(0, 7)}`)
  materializePrivateContent(archiveRoot)
  generateArchiveCatalog(archiveRoot)
  const archiveRun = runDirectAudit('git archive with private content', archiveRoot)
  buildArchiveDist(archiveRoot)
  runReleaseVerification(archiveRoot)
  const archiveIndexPath = path.join(archiveRoot, indexRelativePath)
  const archiveIndexText = fs.readFileSync(archiveIndexPath, 'utf8')
  const crlfIndexText = canonicalUtf8LfText(archiveIndexText).replace(/\n/g, '\r\n')

  assert.equal(
    canonicalTextSha256(archiveIndexText),
    canonicalTextSha256(crlfIndexText),
    'git archive LF content and a CRLF checkout must have the same canonical digest',
  )

  fs.writeFileSync(archiveIndexPath, crlfIndexText, 'utf8')
  const crlfWriteRun = runDirectAudit('git archive CRLF manifest generation', archiveRoot, ['--write-manifest'])
  const crlfRun = runDirectAudit('git archive CRLF with private content', archiveRoot)
  assert.deepEqual(crlfWriteRun.manifest, archiveRun.manifest, 'CRLF regeneration must not alter the audited runtime manifest')
  assert.deepEqual(crlfRun.manifest, archiveRun.manifest, 'CRLF archive audit must match the original LF archive manifest')
  assert.equal(
    canonicalUtf8LfText(crlfRun.identity),
    canonicalUtf8LfText(archiveRun.identity),
    'CRLF archive audit must retain the original source identity values regardless of checkout line endings',
  )

  const runtimeCatalogPath = path.join(archiveRoot, 'src', 'data', 'verifiedPracticeCatalog.json')
  const runtimeCatalogText = fs.readFileSync(runtimeCatalogPath, 'utf8')
  const runtimeCatalogCrlf = `\uFEFF${canonicalUtf8LfText(runtimeCatalogText).replace(/\n/g, '\r\n')}`
  fs.writeFileSync(runtimeCatalogPath, runtimeCatalogCrlf, 'utf8')
  generateArchiveCatalog(archiveRoot)
  const runtimeCatalogCheck = spawnSync(process.execPath, [
    path.join(archiveRoot, 'scripts', 'generate-verified-practice-catalog.mjs'),
  ], {
    cwd: archiveRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(
    runtimeCatalogCheck.status,
    0,
    `CRLF/BOM runtime catalog must pass stale validation:\n${runtimeCatalogCheck.stdout}\n${runtimeCatalogCheck.stderr}`,
  )

  console.log(JSON.stringify({
    ok: true,
    archiveRef,
    sourceIndexSha256: archiveRun.manifest.sourceIndexSha256,
    manifestChecksum: archiveRun.manifest.checksum,
    variants: ['git-archive-with-private-content', 'git-archive-crlf-with-private-content'],
  }, null, 2))
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
}
