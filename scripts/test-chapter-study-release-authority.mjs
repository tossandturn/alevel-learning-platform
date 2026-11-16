import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { artifactTreeIdentity } from './release-content-policy.mjs'
import { MAX_RELEASE_MANIFEST_BYTES, readReleaseManifestBytes } from '../server/aiStudyReleaseAnchor.js'
import { releaseBuildIdentity } from '../vite.config.js'

// This fixture is deliberately synthetic; it is not a release approval.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-release-authority-'))
const commit = 'a'.repeat(40)
const releaseId = `fixture-${commit.slice(0, 7)}`
const releaseRoot = path.join(scratch, 'releases', releaseId)
const assets = path.join(releaseRoot, 'public', 'question-assets')
const runtimeData = path.join(scratch, 'runtime-data')
const manifestPath = path.join(releaseRoot, 'release-manifest.json')
const anchorPath = path.join(scratch, 'shared', 'verified-release-anchors', `${releaseId}.json`)
const routeId = 'cie-9708-as-economics'

try {
  fs.mkdirSync(path.join(releaseRoot, 'dist'), { recursive: true })
  fs.mkdirSync(assets, { recursive: true })
  fs.mkdirSync(runtimeData, { recursive: true })
  fs.writeFileSync(path.join(releaseRoot, 'dist', 'build-identity.json'), JSON.stringify({
    schemaVersion: 'stem-build-identity.v1', commit, sourceState: 'clean',
  }))
  fs.writeFileSync(path.join(assets, 'fixture.txt'), 'synthetic asset')
  fs.symlinkSync(runtimeData, path.join(releaseRoot, 'data'), process.platform === 'win32' ? 'junction' : 'dir')
  const baseline = { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: ['cie-9702-as-physics'],
    readinessMode: 'student-study', aiStudyFormalProgressEligible: false }
  const chapterStudy = { schemaVersion: 'stem-chapter-study-release-scope.v1', routeIds: [routeId],
    topicScopes: { [routeId]: ['9708-as-topic-1-5'] }, formalProgressEligible: false }
  const manifest = { schemaVersion: 'stem-release-manifest.v1', releaseId, commit, packageSha256: 'b'.repeat(64),
    generatedAt: new Date().toISOString(), releaseTree: artifactTreeIdentity(releaseRoot),
    immutableAssets: { identity: path.basename(assets), ...artifactTreeIdentity(assets) },
    runtimeData: { schemaVersion: 'stem-runtime-data-binding.v1', relativePath: 'data', target: fs.realpathSync(runtimeData) },
    syllabusScope: { schemaVersion: 'stem-syllabus-release-scope.v2', baseline,
      baselineIdentity: { releaseId, commit, manifestSha256: 'c'.repeat(64) }, chapterStudy } }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))
  assert.equal(releaseBuildIdentity({}, releaseRoot).status, 'unavailable',
    'an unsigned self-consistent chapter release is not an authorized release')

  manifest.syllabusScope.chapterStudy.packBinding = { schemaVersion: 'stem-release-study-pack-binding.v1',
    relativePath: 'data/ai-study-packs/fixture-pack', manifestSha256: 'd'.repeat(64) }
  const bytes = Buffer.from(JSON.stringify(manifest))
  fs.writeFileSync(manifestPath, bytes)
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  assert.equal(releaseBuildIdentity({ STEM_RELEASE_MANIFEST_SHA256: sha256 }, releaseRoot).status, 'unavailable',
    'an environment value cannot authorize a release')
  fs.mkdirSync(path.dirname(anchorPath), { recursive: true })
  fs.writeFileSync(anchorPath, JSON.stringify({ schemaVersion: 'stem-verified-release-anchor.v1', releaseId, commit,
    manifestSha256: sha256, routeIds: [routeId] }))
  assert.equal(releaseBuildIdentity({}, releaseRoot).status, 'verified', 'an independently pinned fixture release should verify')
  const downgraded = { ...manifest, syllabusScope: baseline }
  fs.writeFileSync(manifestPath, JSON.stringify(downgraded))
  assert.equal(releaseBuildIdentity({}, releaseRoot).status, 'unavailable', 'a pinned chapter release cannot be downgraded to v1')
  fs.writeFileSync(manifestPath, bytes)
  const altered = Buffer.from(bytes)
  const originalStat = fs.statSync(manifestPath)
  const offset = altered.indexOf(Buffer.from('d'.repeat(64)))
  assert.ok(offset >= 0)
  altered[offset] = 'e'.charCodeAt(0)
  fs.writeFileSync(manifestPath, altered); fs.utimesSync(manifestPath, originalStat.atime, originalStat.mtime)
  assert.equal(releaseBuildIdentity({}, releaseRoot).status, 'unavailable',
    'a same-length manifest substitution must fail even when the release tree is unchanged')
  fs.writeFileSync(manifestPath, bytes)
  const anchorBytes = fs.readFileSync(anchorPath), alteredAnchor = JSON.parse(anchorBytes)
  alteredAnchor.commit = 'f'.repeat(40)
  fs.writeFileSync(anchorPath, JSON.stringify(alteredAnchor))
  assert.equal(releaseBuildIdentity({}, releaseRoot).status, 'unavailable', 'a changed release anchor must fail closed')
  fs.writeFileSync(anchorPath, anchorBytes)
  fs.writeFileSync(manifestPath, '{"truncated":')
  assert.equal(releaseBuildIdentity({}, releaseRoot).status, 'unavailable', 'a truncated manifest must fail closed')
  const largeManifest = { ...manifest, fixturePadding: 'x'.repeat(3 * 1024 * 1024) }
  const largeBytes = Buffer.from(JSON.stringify(largeManifest))
  fs.writeFileSync(manifestPath, largeBytes)
  fs.writeFileSync(anchorPath, JSON.stringify({ schemaVersion: 'stem-verified-release-anchor.v1', releaseId, commit,
    manifestSha256: crypto.createHash('sha256').update(largeBytes).digest('hex'), routeIds: [routeId] }))
  assert.equal(releaseBuildIdentity({}, releaseRoot).status, 'verified', 'a realistic manifest larger than 2 MiB must verify')
  const atLimit = Buffer.alloc(MAX_RELEASE_MANIFEST_BYTES, 0x20)
  Buffer.from('{}').copy(atLimit)
  fs.writeFileSync(manifestPath, atLimit)
  assert.equal(readReleaseManifestBytes(releaseRoot).length, MAX_RELEASE_MANIFEST_BYTES, 'the exact bound must be accepted')
  fs.appendFileSync(manifestPath, ' ')
  assert.throws(() => readReleaseManifestBytes(releaseRoot), (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID',
    'one byte over the bound must be rejected')
  fs.writeFileSync(manifestPath, bytes)
  fs.writeFileSync(anchorPath, anchorBytes)
  fs.unlinkSync(anchorPath)
  assert.equal(releaseBuildIdentity({}, releaseRoot).status, 'unavailable', 'missing external pin must fail closed')
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'chapter-study-release-authority', fixtureAnchor: true }))
} finally {
  const real = fs.realpathSync(scratch)
  assert.equal(path.dirname(real), fs.realpathSync(os.tmpdir()))
  assert.ok(path.basename(real).startsWith('chapter-release-authority-'))
  fs.rmSync(real, { recursive: true, force: true })
}
