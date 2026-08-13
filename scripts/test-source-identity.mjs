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
const scratchParent = process.env.SOURCE_IDENTITY_TEST_ROOT
  || (process.platform === 'win32' && fs.existsSync('D:\\CodexWork') ? 'D:\\CodexWork' : os.tmpdir())
const scratchRoot = fs.mkdtempSync(path.join(scratchParent, 'stem-source-identity-'))

function archiveReleaseRoot(name) {
  const releaseRoot = path.join(scratchRoot, name)
  const archivePath = path.join(scratchRoot, `${name}.tar`)
  execFileSync('git', ['archive', '--format=tar', '--output', archivePath, archiveRef], {
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
  const result = spawnSync(process.execPath, [
    path.join(releaseRoot, 'scripts', 'verify-stem-release.mjs'),
    '--release-root',
    releaseRoot,
    '--pdf-library-root',
    process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf',
  ], {
    cwd: releaseRoot,
    env: { ...process.env, CIE_LIBRARY_ROOT: process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `git archive release verification must pass:\n${result.stdout}\n${result.stderr}`)
}

try {
  const archiveRoot = archiveReleaseRoot('archive-lf')
  materializePrivateContent(archiveRoot)
  const archiveRun = runDirectAudit('git archive with private content', archiveRoot)
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
