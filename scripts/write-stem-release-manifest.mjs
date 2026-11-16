import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { artifactTreeIdentity, pathsOverlap } from './release-content-policy.mjs'
import { baselineSyllabusScopeMatches, releaseIdMatchesCommit, validChapterStudyPackBinding, validateBuildIdentity, validateReleaseManifest } from './release-manifest-contract.mjs'
import { verifiedRuntimeDataBinding } from './runtime-data-binding.mjs'
import { parseStudyTopicScopes } from './study-release-policy.mjs'

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function optionValues(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue
    const value = String(process.argv[index + 1] || '').trim()
    if (value) values.push(...value.split(',').map((item) => item.trim()).filter(Boolean))
  }
  return [...new Set(values)]
}

function rawOptionValues(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(String(process.argv[index + 1] || ''))
  }
  return values
}

function requiredOption(name) {
  const value = String(option(name) || '').trim()
  assert.ok(value, `Pass ${name} <value>`)
  return value
}

const releaseRoot = path.resolve(requiredOption('--release-root'))
const immutableAssetsRoot = path.resolve(requiredOption('--immutable-assets-root'))
const commit = requiredOption('--commit').toLowerCase()
const releaseId = requiredOption('--release-id')
const packageSha256 = requiredOption('--package-sha256').toLowerCase()
const runtimeDataRoot = option('--runtime-data-root')
let readinessMode = String(option('--readiness-mode') || 'formal').trim()
const requestedSyllabusRouteIds = optionValues('--route')
const requestedTopicScopeEntries = [
  ...rawOptionValues('--topic-scope'),
  ...rawOptionValues('--topic'),
]
let syllabusRouteIds = requestedSyllabusRouteIds.length
  ? requestedSyllabusRouteIds
  : String(process.env.STEM_RELEASE_ROUTES || 'cie-9702-as-physics')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
const manifestPath = path.join(releaseRoot, 'release-manifest.json')
const buildIdentityPath = path.join(releaseRoot, 'dist', 'build-identity.json')

assert.match(commit, /^[a-f0-9]{40}$/, 'Release commit must be a full Git SHA')
assert.match(packageSha256, /^[a-f0-9]{64}$/, 'Package SHA-256 must be a full lowercase digest')
assert.ok(releaseIdMatchesCommit(releaseId, commit), 'Release ID must end with the commit short SHA')
assert.equal(path.basename(releaseRoot), releaseId, 'Release root basename must match the release ID')
assert.ok(!fs.existsSync(manifestPath), `Release manifest already exists: ${manifestPath}`)
assert.ok(fs.existsSync(immutableAssetsRoot) && fs.statSync(immutableAssetsRoot).isDirectory(), `Immutable assets root is missing: ${immutableAssetsRoot}`)
assert.ok(fs.existsSync(buildIdentityPath) && fs.statSync(buildIdentityPath).isFile(), 'Release is missing dist/build-identity.json')
assert.ok(syllabusRouteIds.length > 0, 'Release must declare at least one syllabus route')
assert.ok(syllabusRouteIds.every((routeId) => /^[A-Za-z0-9._:-]{1,120}$/.test(routeId)), 'Release syllabus routes must use safe route IDs')
assert.equal(new Set(syllabusRouteIds).size, syllabusRouteIds.length, 'Release syllabus routes must be unique')
const chapterRoutes = rawOptionValues('--chapter-route')
const chapterTopicEntries = rawOptionValues('--chapter-topic')
const wantsChapterStudy = chapterRoutes.length > 0 || chapterTopicEntries.length > 0 || Boolean(option('--baseline-release-manifest'))
let baselineScope = null, baselineIdentity = null, chapterStudy = null
if (wantsChapterStudy) {
  assert.ok(chapterRoutes.length && chapterTopicEntries.length, 'Chapter-study requires explicit routes and topic scopes')
  assert.ok(!requestedSyllabusRouteIds.length && !requestedTopicScopeEntries.length && !option('--readiness-mode'),
    'Baseline routes, topics and mode must come only from the trusted baseline manifest')
  assert.ok(chapterRoutes.every((routeId) => routeId === routeId.trim() && /^[A-Za-z0-9._:-]{1,120}$/.test(routeId)))
  assert.equal(new Set(chapterRoutes).size, chapterRoutes.length, 'Chapter-study routes must be unique')
  const baselinePath = fs.realpathSync(requiredOption('--baseline-release-manifest'))
  const trustedHash = requiredOption('--trusted-baseline-manifest-sha256').toLowerCase()
  const trustedCommit = requiredOption('--trusted-baseline-commit').toLowerCase()
  const trustedReleaseId = requiredOption('--trusted-baseline-release-id')
  assert.match(trustedHash, /^[a-f0-9]{64}$/); assert.match(trustedCommit, /^[a-f0-9]{40}$/)
  assert.ok(!pathsOverlap(fs.realpathSync(releaseRoot), baselinePath), 'Trusted baseline must be outside the new release')
  const baselineBytes = fs.readFileSync(baselinePath)
  const actualHash = crypto.createHash('sha256').update(baselineBytes).digest('hex')
  const baselineManifest = JSON.parse(baselineBytes.toString('utf8'))
  assert.equal(actualHash, trustedHash, 'Trusted baseline manifest bytes changed')
  assert.equal(baselineManifest.commit, trustedCommit); assert.equal(baselineManifest.releaseId, trustedReleaseId)
  assert.ok(validateReleaseManifest(baselineManifest).valid && baselineManifest.syllabusScope?.schemaVersion === 'stem-syllabus-release-scope.v1',
    'A valid v1 baseline release manifest is required')
  baselineScope = baselineManifest.syllabusScope
  baselineIdentity = { releaseId: trustedReleaseId, commit: trustedCommit, manifestSha256: trustedHash }
  const chapterTopicScopes = parseStudyTopicScopes(chapterTopicEntries, chapterRoutes)
  assert.ok(chapterRoutes.every((routeId) => chapterTopicScopes[routeId]?.length), 'Every chapter route needs an explicit topic scope')
  const packBinding = { schemaVersion: 'stem-release-study-pack-binding.v1',
    relativePath: requiredOption('--chapter-pack-relative-path'), manifestSha256: requiredOption('--chapter-pack-manifest-sha256').toLowerCase() }
  assert.ok(validChapterStudyPackBinding(packBinding), 'An explicitly pinned chapter-study pack is required')
  chapterStudy = { schemaVersion: 'stem-chapter-study-release-scope.v1', routeIds: chapterRoutes,
    topicScopes: chapterTopicScopes, formalProgressEligible: false, packBinding }
  syllabusRouteIds = baselineScope.routeIds
  readinessMode = baselineScope.readinessMode ?? 'formal'
  assert.ok(baselineSyllabusScopeMatches({ schemaVersion: 'stem-syllabus-release-scope.v2', baseline: baselineScope,
    baselineIdentity, chapterStudy }, baselineManifest, trustedHash), 'Complete baseline scope must remain unchanged')
}
assert.ok(['formal', 'student-study'].includes(readinessMode), 'readiness mode must be formal or student-study')
assert.ok(wantsChapterStudy || readinessMode === 'student-study' || requestedTopicScopeEntries.length === 0, 'Topic scoping is allowed only in student-study mode')
const topicScopes = wantsChapterStudy ? (baselineScope.topicScopes || {}) : parseStudyTopicScopes(requestedTopicScopeEntries, syllabusRouteIds)
const buildIdentity = JSON.parse(fs.readFileSync(buildIdentityPath, 'utf8'))
assert.ok(
  validateBuildIdentity(buildIdentity, { commit, requireClean: true }).valid,
  'Release build identity must match the release commit and come from a clean source tree',
)

const runtimeData = verifiedRuntimeDataBinding(releaseRoot, runtimeDataRoot)
if (wantsChapterStudy) {
  assert.ok(runtimeData, 'Chapter-study requires an explicitly bound runtime data root')
  const packRoot = path.join(releaseRoot, ...chapterStudy.packBinding.relativePath.split('/'))
  for (const directory of [path.dirname(packRoot), packRoot, path.join(packRoot, 'source-pages')]) {
    const stat = fs.lstatSync(directory)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Chapter-study pack directories must not be symlinks')
  }
  const marker = path.join(packRoot, 'candidate-manifest.json')
  assert.ok(fs.lstatSync(marker).isFile() && !fs.lstatSync(marker).isSymbolicLink(), 'Chapter-study pack marker must be a regular file')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(marker)).digest('hex'), chapterStudy.packBinding.manifestSha256,
    'Chapter-study pack differs from its explicit expected SHA')
}
const releaseTree = artifactTreeIdentity(releaseRoot, { exclude: ['release-manifest.json'] })
const immutableAssets = artifactTreeIdentity(immutableAssetsRoot)
// Runtime verification resolves the question-assets link before checking its
// identity. Store the same canonical target name so an external immutable
// asset binding can be verified instead of appearing unavailable.
const immutableAssetsIdentity = path.basename(fs.realpathSync(immutableAssetsRoot))
const manifest = {
  schemaVersion: 'stem-release-manifest.v1',
  releaseId,
  commit,
  packageSha256,
  ...(runtimeData ? { runtimeData } : {}),
  syllabusScope: wantsChapterStudy ? { schemaVersion: 'stem-syllabus-release-scope.v2', baseline: baselineScope,
    baselineIdentity, chapterStudy } : {
    schemaVersion: 'stem-syllabus-release-scope.v1',
    routeIds: syllabusRouteIds,
    readinessMode,
    aiStudyFormalProgressEligible: false,
    ...(requestedTopicScopeEntries.length ? { topicScopes } : {}),
  },
  generatedAt: new Date().toISOString(),
  releaseTree,
  immutableAssets: {
    identity: immutableAssetsIdentity,
    ...immutableAssets,
  },
}
assert.ok(validateReleaseManifest(manifest, { releaseId }).valid, 'Generated release manifest contract is invalid')
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o444 })
const manifestSha256 = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex')
console.log(JSON.stringify({
  ok: true,
  releaseId,
  commit,
  packageSha256,
  runtimeData,
  readinessMode,
  topicScopes,
  manifestSha256,
  releaseFiles: releaseTree.files,
  releaseBytes: releaseTree.bytes,
  immutableAssetFiles: immutableAssets.files,
  immutableAssetBytes: immutableAssets.bytes,
  immutableAssetsSha256: immutableAssets.sha256,
}, null, 2))
