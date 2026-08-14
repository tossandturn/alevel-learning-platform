import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

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
const assetRoot = path.join(releaseRoot, 'public', 'question-assets')
const catalogPath = path.join(releaseRoot, 'public', 'data', 'papers.json')
const auditScript = path.join(releaseRoot, 'scripts', 'audit-question-bank.mjs')
const paperAuditScript = path.join(releaseRoot, 'scripts', 'audit-paper-catalog.mjs')
const syllabusCoverageScript = path.join(releaseRoot, 'scripts', 'verify-9702-syllabus-coverage.mjs')
const manifestPath = path.join(releaseRoot, 'src', 'data', 'sourceContentManifest.json')
const identityPath = path.join(releaseRoot, 'src', 'data', 'sourceContentIdentity.js')

assert.ok(fs.existsSync(auditScript), `Release audit script is missing: ${auditScript}`)
assert.ok(fs.existsSync(paperAuditScript), `Release paper catalog audit script is missing: ${paperAuditScript}`)
assert.ok(fs.existsSync(syllabusCoverageScript), `Release 9702 syllabus coverage gate is missing: ${syllabusCoverageScript}`)
assert.ok(fs.existsSync(assetRoot) && fs.statSync(assetRoot).isDirectory(), 'Release is missing public/question-assets')
assert.ok(hasRenderedAsset(assetRoot), 'Release public/question-assets contains no rendered source pages')
assert.ok(fs.existsSync(catalogPath) && fs.statSync(catalogPath).size > 0, 'Release is missing public/data/papers.json')
JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
assert.ok(paperLibraryRoot, 'Pass --pdf-library-root <path> for the governed local PDF library')
assert.ok(fs.existsSync(paperLibraryRoot) && fs.statSync(paperLibraryRoot).isDirectory(), `Governed PDF library is missing: ${paperLibraryRoot}`)

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
