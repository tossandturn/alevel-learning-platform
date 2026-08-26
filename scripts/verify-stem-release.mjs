import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  assertWithinLimit,
  findEscapingSymlinks,
  findForbiddenFiles,
  findUnexpectedReleaseEntries,
  MAX_DIST_BYTES,
  MAX_RELEASE_BYTES,
  pathsOverlap,
  physicalTreeBytes,
} from './release-content-policy.mjs'

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasRenderedAsset(assetRoot) {
  const pending = [assetRoot]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) pending.push(entryPath)
      else if (/\.(?:jpe?g|png|webp)$/i.test(entry.name) && fs.statSync(entryPath).size > 0) return true
    }
  }
  return false
}

const releaseRoot = path.resolve(option('--release-root') || process.env.STEM_RELEASE_ROOT || process.cwd())
const paperLibraryRoot = option('--pdf-library-root') || process.env.CIE_LIBRARY_ROOT || ''
const immutableAssetsRoot = option('--immutable-assets-root') || ''
const assetRoot = path.join(releaseRoot, 'public', 'question-assets')
const catalogPath = path.join(releaseRoot, 'public', 'data', 'papers.json')
const distRoot = path.join(releaseRoot, 'dist')
const auditScript = path.join(releaseRoot, 'scripts', 'audit-question-bank.mjs')
const paperAuditScript = path.join(releaseRoot, 'scripts', 'audit-paper-catalog.mjs')
const syllabusCoverageScript = path.join(releaseRoot, 'scripts', 'verify-9702-syllabus-coverage.mjs')
const manifestPath = path.join(releaseRoot, 'src', 'data', 'sourceContentManifest.json')
const identityPath = path.join(releaseRoot, 'src', 'data', 'sourceContentIdentity.js')
const nodeModulesRoot = path.join(releaseRoot, 'node_modules')

const unexpectedReleaseEntries = findUnexpectedReleaseEntries(releaseRoot)
assert.equal(unexpectedReleaseEntries.length, 0, `Release root contains files outside the runtime allowlist: ${unexpectedReleaseEntries.slice(0, 10).join(', ')}`)
const escapingSymlinks = findEscapingSymlinks(releaseRoot, ['public/question-assets', 'dist/question-assets'])
assert.equal(escapingSymlinks.length, 0, `Release contains external symlinks outside the immutable asset exception: ${escapingSymlinks.slice(0, 10).join(', ')}`)
assert.ok(fs.existsSync(nodeModulesRoot), 'Release is missing node_modules; install dependencies inside this release')
assert.ok(!fs.lstatSync(nodeModulesRoot).isSymbolicLink() && fs.statSync(nodeModulesRoot).isDirectory(), 'Release node_modules must be a self-contained directory, not a cross-release symlink')
assert.ok(fs.existsSync(path.join(nodeModulesRoot, '.package-lock.json')), 'Release node_modules is missing its npm install lock record')

assert.ok(fs.existsSync(auditScript), `Release audit script is missing: ${auditScript}`)
assert.ok(fs.existsSync(paperAuditScript), `Release paper catalog audit script is missing: ${paperAuditScript}`)
assert.ok(fs.existsSync(syllabusCoverageScript), `Release 9702 syllabus coverage gate is missing: ${syllabusCoverageScript}`)
assert.ok(fs.existsSync(assetRoot) && fs.statSync(assetRoot).isDirectory(), 'Release is missing public/question-assets')
if (fs.lstatSync(assetRoot).isSymbolicLink()) {
  assert.ok(immutableAssetsRoot, 'Pass --immutable-assets-root <path> when public/question-assets is externally linked')
  assert.ok(fs.existsSync(immutableAssetsRoot) && fs.statSync(immutableAssetsRoot).isDirectory(), `Immutable assets root is missing: ${immutableAssetsRoot}`)
  assert.equal(fs.realpathSync(assetRoot), fs.realpathSync(immutableAssetsRoot), 'Release public/question-assets must resolve to the declared immutable asset root')
}
assert.ok(hasRenderedAsset(assetRoot), 'Release public/question-assets contains no rendered source pages')
assert.ok(fs.existsSync(catalogPath) && fs.statSync(catalogPath).size > 0, 'Release is missing public/data/papers.json')
for (const fileName of ['index.html', 'robots.txt', 'sitemap.xml']) {
  const filePath = path.join(distRoot, fileName)
  assert.ok(fs.existsSync(filePath) && fs.statSync(filePath).size > 0, `Release dist is missing ${fileName}`)
}
assert.ok(fs.existsSync(path.join(distRoot, 'assets')) && fs.statSync(path.join(distRoot, 'assets')).isDirectory(), 'Release dist is missing assets')
JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
assert.ok(paperLibraryRoot, 'Pass --pdf-library-root <path> for the governed local PDF library')
assert.ok(fs.existsSync(paperLibraryRoot) && fs.statSync(paperLibraryRoot).isDirectory(), `Governed PDF library is missing: ${paperLibraryRoot}`)
const resolvedRelease = fs.realpathSync(releaseRoot)
const resolvedPdfLibrary = fs.realpathSync(paperLibraryRoot)
assert.ok(!pathsOverlap(resolvedRelease, resolvedPdfLibrary), `Release root must be separate from the PDF library: ${resolvedRelease}`)
const forbiddenReleaseFiles = findForbiddenFiles(releaseRoot, ['.pdf', '.tgz', '.tar.gz', '.zip'])
assert.equal(forbiddenReleaseFiles.length, 0, `Release contains physical PDF/archive files; true-paper PDFs must stay outside release: ${forbiddenReleaseFiles.slice(0, 10).join(', ')}`)
assertWithinLimit(physicalTreeBytes(releaseRoot), MAX_RELEASE_BYTES, 'Release')
assertWithinLimit(physicalTreeBytes(distRoot), MAX_DIST_BYTES, 'Release dist')
const distQuestionAssets = path.join(distRoot, 'question-assets')
if (fs.existsSync(distQuestionAssets)) {
  assert.ok(fs.lstatSync(distQuestionAssets).isSymbolicLink(), 'Release dist/question-assets must be a symlink to shared rendered assets, never a copied directory')
  assert.equal(fs.realpathSync(distQuestionAssets), fs.realpathSync(assetRoot), 'Release public and dist question-assets must resolve to the same reviewed asset tree')
}

const env = { ...process.env }
delete env.SOURCE_AUDIT_ROOT
delete env.SOURCE_AUDIT_ASSET_ROOT
const result = spawnSync(process.execPath, [auditScript], {
  cwd: releaseRoot,
  env,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
assert.equal(result.status, 0, `Release source audit failed:\n${result.stdout}\n${result.stderr}`)
const paperAudit = spawnSync(process.execPath, [paperAuditScript], {
  cwd: releaseRoot,
  env: { ...env, CIE_LIBRARY_ROOT: paperLibraryRoot },
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
assert.equal(paperAudit.status, 0, `Release paper catalog audit failed:\n${paperAudit.stdout}\n${paperAudit.stderr}`)
const syllabusCoverage = spawnSync(process.execPath, [syllabusCoverageScript], {
  cwd: releaseRoot,
  env,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
assert.equal(syllabusCoverage.status, 0, `Release 9702 syllabus coverage gate failed:\n${syllabusCoverage.stdout}\n${syllabusCoverage.stderr}`)

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const identity = fs.readFileSync(identityPath, 'utf8')
assert.ok(identity.includes(`SOURCE_INDEX_SHA256 = '${manifest.sourceIndexSha256}'`), 'Release source identity does not match manifest source index')
assert.ok(identity.includes(`SOURCE_CONTENT_MANIFEST_CHECKSUM = '${manifest.checksum}'`), 'Release source identity does not match manifest checksum')

console.log(JSON.stringify({
  ok: true,
  releaseRoot,
  sourceIndexSha256: manifest.sourceIndexSha256,
  manifestChecksum: manifest.checksum,
  catalogBytes: fs.statSync(catalogPath).size,
  paperLibraryRoot,
}, null, 2))
