import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  artifactTreeIdentity,
  assertWithinLimit,
  findEscapingSymlinks,
  findForbiddenFiles,
  findForbiddenSensitiveFiles,
  findUnexpectedReleaseEntries,
  MAX_DIST_BYTES,
  MAX_RELEASE_BYTES,
  RELEASE_TOP_LEVEL_ALLOWLIST,
  pathsOverlap,
  physicalTreeBytes,
} from './release-content-policy.mjs'
import {
  releaseIdMatchesCommit,
  baselineSyllabusScopeMatches,
  validateBuildIdentity,
  validateReleaseManifest,
} from './release-manifest-contract.mjs'
import { assertRuntimeDataBinding } from './runtime-data-binding.mjs'
import { releaseAnchorPath, verifyReleaseAnchor } from '../server/aiStudyReleaseAnchor.js'

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function optionValues(name) {
  return process.argv.flatMap((value, index) => value === name ? [String(process.argv[index + 1] || '')] : [])
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
const expectedCommit = option('--commit').toLowerCase()
const expectedReleaseId = option('--release-id')
const expectedPackageSha256 = option('--package-sha256').toLowerCase()
const assetRoot = path.join(releaseRoot, 'public', 'question-assets')
const catalogPath = path.join(releaseRoot, 'public', 'data', 'papers.json')
const subjectCatalogRoot = path.join(releaseRoot, 'public', 'data', 'papers')
const distRoot = path.join(releaseRoot, 'dist')
const auditScript = path.join(releaseRoot, 'scripts', 'audit-question-bank.mjs')
const paperAuditScript = path.join(releaseRoot, 'scripts', 'audit-paper-catalog.mjs')
const syllabusCoverageScript = path.join(releaseRoot, 'scripts', 'verify-9702-syllabus-coverage.mjs')
const allSyllabusCoverageScript = path.join(releaseRoot, 'scripts', 'verify-all-syllabus-coverage.mjs')
const manifestPath = path.join(releaseRoot, 'src', 'data', 'sourceContentManifest.json')
const identityPath = path.join(releaseRoot, 'src', 'data', 'sourceContentIdentity.js')
const nodeModulesRoot = path.join(releaseRoot, 'node_modules')
const releaseManifestPath = path.join(releaseRoot, 'release-manifest.json')
const buildIdentityPath = path.join(distRoot, 'build-identity.json')

assert.match(expectedCommit, /^[a-f0-9]{40}$/, 'Pass --commit <full-git-sha>')
assert.ok(expectedReleaseId, 'Pass --release-id <id>')
assert.match(expectedPackageSha256, /^[a-f0-9]{64}$/, 'Pass --package-sha256 <sha256>')
assert.ok(releaseIdMatchesCommit(expectedReleaseId, expectedCommit), 'Release ID must end with the commit short SHA')
assert.equal(path.basename(releaseRoot), expectedReleaseId, 'Release root basename must match the release ID')
assert.ok(fs.existsSync(releaseManifestPath) && fs.statSync(releaseManifestPath).isFile(), 'Release is missing release-manifest.json')
const releaseManifestBytes = fs.readFileSync(releaseManifestPath)
const releaseManifest = JSON.parse(releaseManifestBytes.toString('utf8'))
assert.ok(validateReleaseManifest(releaseManifest, { releaseId: expectedReleaseId }).valid, 'Release manifest contract is invalid')
assert.equal(releaseManifest.commit, expectedCommit, 'Release manifest commit does not match the expected commit')
assert.equal(releaseManifest.releaseId, expectedReleaseId, 'Release manifest ID does not match the expected release')
assert.equal(releaseManifest.packageSha256, expectedPackageSha256, 'Release manifest package digest does not match the uploaded package')
// Check operational links and reject unexpected/sensitive physical entries
// before hashing the release tree. Never traverse persistent student data.
const runtimeDataEntries = assertRuntimeDataBinding(releaseRoot, releaseManifest.runtimeData, option('--runtime-data-root'))
const unexpectedReleaseEntries = findUnexpectedReleaseEntries(releaseRoot, [...RELEASE_TOP_LEVEL_ALLOWLIST, ...runtimeDataEntries])
assert.equal(unexpectedReleaseEntries.length, 0, `Release root contains files outside the runtime allowlist: ${unexpectedReleaseEntries.slice(0, 10).join(', ')}`)
const forbiddenSensitiveFiles = findForbiddenSensitiveFiles(releaseRoot)
assert.equal(forbiddenSensitiveFiles.length, 0, `Release contains nested secrets, keys, databases, dumps, caches or OCR staging files: ${forbiddenSensitiveFiles.slice(0, 10).join(', ')}`)
const escapingSymlinks = findEscapingSymlinks(releaseRoot, ['public/question-assets', 'dist/question-assets', ...runtimeDataEntries])
assert.equal(escapingSymlinks.length, 0, `Release contains external symlinks outside declared bindings: ${escapingSymlinks.slice(0, 10).join(', ')}`)
const releaseScope = releaseManifest.syllabusScope
const chapterScope = releaseScope?.schemaVersion === 'stem-syllabus-release-scope.v2' ? releaseScope.chapterStudy : null
const baselineScope = chapterScope ? releaseScope.baseline : releaseScope
if (chapterScope) {
  const expectedManifestHash = String(option('--trusted-release-manifest-sha256') || '').toLowerCase()
  assert.match(expectedManifestHash, /^[a-f0-9]{64}$/, 'Chapter-study requires an independently supplied release manifest SHA')
  assert.equal(crypto.createHash('sha256').update(releaseManifestBytes).digest('hex'), expectedManifestHash,
    'Release manifest differs from the independently supplied expected SHA')
  const baselinePath = option('--baseline-release-manifest')
  const trustedHash = String(option('--trusted-baseline-manifest-sha256') || '').toLowerCase()
  const trustedCommit = String(option('--trusted-baseline-commit') || '').toLowerCase()
  const trustedReleaseId = option('--trusted-baseline-release-id')
  assert.ok(baselinePath && /^[a-f0-9]{64}$/.test(trustedHash) && /^[a-f0-9]{40}$/.test(trustedCommit) && trustedReleaseId,
    'A separately trusted baseline manifest, hash, commit and release ID are required for chapter-study')
  const realBaseline = fs.realpathSync(baselinePath)
  assert.ok(!pathsOverlap(fs.realpathSync(releaseRoot), realBaseline), 'The trusted baseline manifest must be outside the new release')
  const baselineBytes = fs.readFileSync(realBaseline)
  const baselineHash = crypto.createHash('sha256').update(baselineBytes).digest('hex')
  const baselineManifest = JSON.parse(baselineBytes.toString('utf8'))
  assert.equal(baselineHash, trustedHash, 'Trusted baseline manifest bytes changed')
  assert.equal(baselineManifest.commit, trustedCommit, 'Trusted baseline commit changed')
  assert.equal(baselineManifest.releaseId, trustedReleaseId, 'Trusted baseline release ID changed')
  assert.ok(baselineSyllabusScopeMatches(releaseScope, baselineManifest, trustedHash), 'The complete baseline scope must be preserved')
}
const releaseRouteIds = Array.isArray(baselineScope?.routeIds)
  ? [...new Set(baselineScope.routeIds.map((routeId) => String(routeId).trim()).filter(Boolean))]
  : []
const releaseTopicScopes = baselineScope?.topicScopes || {}
assert.equal(baselineScope?.schemaVersion, 'stem-syllabus-release-scope.v1', 'Release must preserve its baseline syllabus scope')
assert.ok(releaseRouteIds.length > 0, 'Release syllabus scope must contain at least one route')
assert.equal(releaseRouteIds.length, baselineScope.routeIds.length, 'Release syllabus scope routes must be unique and non-empty')
assert.ok(fs.existsSync(buildIdentityPath) && fs.statSync(buildIdentityPath).isFile(), 'Release is missing dist/build-identity.json')
const buildIdentity = JSON.parse(fs.readFileSync(buildIdentityPath, 'utf8'))
assert.ok(
  validateBuildIdentity(buildIdentity, { commit: expectedCommit, requireClean: true }).valid,
  'Release build identity must match the expected commit and come from a clean source tree',
)
const actualReleaseTree = artifactTreeIdentity(releaseRoot, { exclude: ['release-manifest.json'] })
assert.equal(actualReleaseTree.sha256, releaseManifest.releaseTree?.sha256, 'Release file tree does not match its manifest')
assert.equal(actualReleaseTree.files, releaseManifest.releaseTree?.files, 'Release file count does not match its manifest')
assert.equal(actualReleaseTree.symlinks, releaseManifest.releaseTree?.symlinks, 'Release symlink count does not match its manifest')
assert.equal(actualReleaseTree.bytes, releaseManifest.releaseTree?.bytes, 'Release byte count does not match its manifest')

assert.ok(fs.existsSync(nodeModulesRoot), 'Release is missing node_modules; install dependencies inside this release')
assert.ok(!fs.lstatSync(nodeModulesRoot).isSymbolicLink() && fs.statSync(nodeModulesRoot).isDirectory(), 'Release node_modules must be a self-contained directory, not a cross-release symlink')
assert.ok(fs.existsSync(path.join(nodeModulesRoot, '.package-lock.json')), 'Release node_modules is missing its npm install lock record')

assert.ok(fs.existsSync(auditScript), `Release audit script is missing: ${auditScript}`)
assert.ok(fs.existsSync(paperAuditScript), `Release paper catalog audit script is missing: ${paperAuditScript}`)
assert.ok(fs.existsSync(syllabusCoverageScript), `Release 9702 syllabus coverage gate is missing: ${syllabusCoverageScript}`)
assert.ok(fs.existsSync(allSyllabusCoverageScript), `Release all-syllabus coverage gate is missing: ${allSyllabusCoverageScript}`)
assert.ok(fs.existsSync(assetRoot) && fs.statSync(assetRoot).isDirectory(), 'Release is missing public/question-assets')
if (fs.lstatSync(assetRoot).isSymbolicLink()) {
  assert.ok(immutableAssetsRoot, 'Pass --immutable-assets-root <path> when public/question-assets is externally linked')
  assert.ok(fs.existsSync(immutableAssetsRoot) && fs.statSync(immutableAssetsRoot).isDirectory(), `Immutable assets root is missing: ${immutableAssetsRoot}`)
  assert.equal(fs.realpathSync(assetRoot), fs.realpathSync(immutableAssetsRoot), 'Release public/question-assets must resolve to the declared immutable asset root')
}
const declaredAssetsRoot = immutableAssetsRoot || assetRoot
const actualImmutableAssets = artifactTreeIdentity(declaredAssetsRoot)
assert.equal(actualImmutableAssets.sha256, releaseManifest.immutableAssets?.sha256, 'Immutable question assets do not match the release manifest')
assert.equal(actualImmutableAssets.files, releaseManifest.immutableAssets?.files, 'Immutable question asset count does not match the release manifest')
assert.equal(actualImmutableAssets.bytes, releaseManifest.immutableAssets?.bytes, 'Immutable question asset bytes do not match the release manifest')
assert.ok(hasRenderedAsset(assetRoot), 'Release public/question-assets contains no rendered source pages')
assert.ok(fs.existsSync(catalogPath) && fs.statSync(catalogPath).size > 0, 'Release is missing public/data/papers.json')
assert.ok(fs.existsSync(subjectCatalogRoot) && fs.statSync(subjectCatalogRoot).isDirectory(), 'Release is missing public/data/papers')
for (const subject of ['0580', '0625', '9702', '9709']) {
  const subjectCatalogPath = path.join(subjectCatalogRoot, `${subject}.json`)
  assert.ok(fs.existsSync(subjectCatalogPath) && fs.statSync(subjectCatalogPath).size > 0, `Release is missing public/data/papers/${subject}.json`)
}
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
const readinessMode = baselineScope.readinessMode ?? 'formal'
assert.ok(['formal', 'student-study'].includes(readinessMode), 'Unknown baseline readiness mode')
if (readinessMode === 'student-study') {
  const artifactRoot = option('--ai-artifact-root')
  assert.ok(artifactRoot, 'AI study release requires --ai-artifact-root')
  const studyCoverage = spawnSync(process.execPath, [
    path.join(releaseRoot, 'scripts', 'verify-study-release-coverage.mjs'),
    '--artifact-root', artifactRoot, '--pdf-library-root', paperLibraryRoot,
    ...releaseRouteIds.flatMap((routeId) => ['--route', routeId]),
    ...Object.entries(releaseTopicScopes).flatMap(([routeId, topicIds]) => (
      topicIds.flatMap((topicId) => ['--topic', `${routeId}:${topicId}`])
    )),
  ], { cwd: releaseRoot, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  assert.equal(studyCoverage.status, 0, `Release student-study coverage failed:\n${studyCoverage.stdout}\n${studyCoverage.stderr}`)
} else {
const syllabusCoverage = spawnSync(process.execPath, [syllabusCoverageScript], {
  cwd: releaseRoot,
  env,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
assert.equal(syllabusCoverage.status, 0, `Release 9702 syllabus coverage gate failed:\n${syllabusCoverage.stdout}\n${syllabusCoverage.stderr}`)
const allSyllabusCoverage = spawnSync(process.execPath, [
  allSyllabusCoverageScript,
  ...releaseRouteIds.flatMap((routeId) => ['--route', routeId]),
], {
  cwd: releaseRoot,
  env,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
assert.equal(allSyllabusCoverage.status, 0, `Release all-syllabus coverage gate failed:\n${allSyllabusCoverage.stdout}\n${allSyllabusCoverage.stderr}`)
}

let chapterStudyReport = null
if (chapterScope) {
  const chapterRoots = optionValues('--chapter-ai-artifact-root')
  const pageCacheRoot = option('--chapter-source-page-cache-root')
  assert.ok(chapterRoots.length === 1 && pageCacheRoot, 'Chapter-study requires exactly one artifact root and a page-cache root')
  const expectedPackRoot = path.join(releaseRoot, ...chapterScope.packBinding.relativePath.split('/'))
  for (const directory of [path.dirname(expectedPackRoot), expectedPackRoot]) {
    const stat = fs.lstatSync(directory)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Chapter-study pack directories must not be symlinks')
  }
  assert.equal(fs.realpathSync(chapterRoots[0]), fs.realpathSync(expectedPackRoot), 'Chapter-study artifact root differs from the release binding')
  const marker = path.join(expectedPackRoot, 'candidate-manifest.json')
  const markerStat = fs.lstatSync(marker)
  assert.ok(markerStat.isFile() && !markerStat.isSymbolicLink(), 'Chapter-study pack marker must be a regular file')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(marker)).digest('hex'), chapterScope.packBinding.manifestSha256,
    'Chapter-study pack marker differs from the release binding')
  const chapterCoverage = spawnSync(process.execPath, [
    path.join(releaseRoot, 'scripts', 'verify-study-release-coverage.mjs'),
    ...chapterRoots.flatMap((artifactRoot) => ['--artifact-root', artifactRoot]),
    '--pdf-library-root', paperLibraryRoot, '--readiness-mode', 'chapter-study', '--source-page-cache-root', pageCacheRoot,
    '--pinned-manifest-sha256', chapterScope.packBinding.manifestSha256,
    ...chapterScope.routeIds.flatMap((routeId) => ['--route', routeId]),
    ...Object.entries(chapterScope.topicScopes).flatMap(([routeId, topicIds]) => topicIds.flatMap((topicId) => ['--topic', `${routeId}:${topicId}`])),
  ], { cwd: releaseRoot, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  assert.equal(chapterCoverage.status, 0, `Chapter-study source coverage failed:\n${chapterCoverage.stdout}\n${chapterCoverage.stderr}`)
  chapterStudyReport = JSON.parse(chapterCoverage.stdout.trim())
  assert.equal(chapterStudyReport.readinessMode, 'chapter-study')
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const identity = fs.readFileSync(identityPath, 'utf8')
assert.ok(identity.includes(`SOURCE_INDEX_SHA256 = '${manifest.sourceIndexSha256}'`), 'Release source identity does not match manifest source index')
assert.ok(identity.includes(`SOURCE_CONTENT_MANIFEST_CHECKSUM = '${manifest.checksum}'`), 'Release source identity does not match manifest checksum')

let runtimeAnchor = null
if (chapterScope && process.argv.includes('--write-runtime-anchor')) {
  assert.ok(fs.readFileSync(releaseManifestPath).equals(releaseManifestBytes), 'Release manifest changed during verification')
  const anchorPath = releaseAnchorPath(releaseRoot)
  const value = { schemaVersion: 'stem-verified-release-anchor.v1', releaseId: expectedReleaseId, commit: expectedCommit,
    manifestSha256: crypto.createHash('sha256').update(releaseManifestBytes).digest('hex'), routeIds: chapterScope.routeIds }
  fs.writeFileSync(anchorPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o444 })
  runtimeAnchor = verifyReleaseAnchor({ releaseRoot, manifest: releaseManifest, manifestBytes: releaseManifestBytes }).path
}

console.log(JSON.stringify({
  ok: true,
  releaseRoot,
  sourceIndexSha256: manifest.sourceIndexSha256,
  manifestChecksum: manifest.checksum,
  catalogBytes: fs.statSync(catalogPath).size,
  paperLibraryRoot,
  ...(runtimeAnchor ? { runtimeAnchor } : {}),
  ...(chapterStudyReport ? { chapterStudy: chapterStudyReport } : {}),
}, null, 2))
