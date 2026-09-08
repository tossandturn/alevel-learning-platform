// Pinned, receipt-scoped integration check. Source PDFs/artifacts/rasters are
// read-only; only exact-byte copies into the explicitly chosen cache are made.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { sourcePageCachePath } from '../server/nativeSourcePages.js'
import { createNativeQuestionImages } from '../server/nativeQuestionImages.js'
import { syllabusTopicsInventory, buildSyllabusPracticeSet } from '../src/lib/syllabusPractice.js'
import { createStemApi, closeStemDatabaseForTests } from '../server/stemApi.js'
import { canonicalHandwritingMarkingImages, canonicalHandwritingMarkingContext } from '../server/aiApi.js'
import { canonicalAiMarkingProvenance } from '../src/lib/sourceContentContract.js'

const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2], process.argv[3 + i * 2]]))
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
assert.ok(args['--manifest'] && /^[a-f0-9]{64}$/.test(args['--manifest-sha'] || '') && args['--cache-root'] && args['--mini-root'], 'explicit manifest/hash/cache/mini paths required')
const manifestBytes = await fs.readFile(args['--manifest']); assert.equal(sha(manifestBytes), args['--manifest-sha'])
const manifest = JSON.parse(manifestBytes)
assert.equal(manifest.schemaVersion, 'stem-space-source-raster-allowlist.v1')
assert.equal(manifest.scope.wholePaperReviewed, false)
const libraryRoot = path.dirname(path.dirname(manifest.paperRows[0].pdf.path)), cacheRoot = path.resolve(args['--cache-root'])
assert.notEqual(cacheRoot, libraryRoot); assert.ok(!path.relative(libraryRoot, cacheRoot).startsWith('..') || cacheRoot.includes('CodexWork'))
const artifacts = []
for (const row of manifest.paperRows) {
  const bytes = await fs.readFile(row.artifactPath); assert.equal(sha(bytes), row.artifactSha256)
  assert.equal(path.dirname(path.dirname(row.pdf.path)), libraryRoot)
  assert.equal(sha(await fs.readFile(row.pdf.path)), row.pdf.sha256)
  artifacts.push(JSON.parse(bytes))
}
const groups = questionGroupsFromAiArtifacts(artifacts, { libraryRoot })
assert.deepEqual(groups.map(q => q.sourceQuestionId).sort(), [...manifest.scope.approvedSourceQuestionIds].sort())
const routeId = groups[0].routeId
assert.ok(groups.every(q => q.routeId === routeId && q.sourceContent.complete && q.sourceContent.fileComplete))
let sourceBytes = 0
for (const row of manifest.pageRows) {
  const bytes = await fs.readFile(row.sourcePng.path); assert.equal(sha(bytes), row.sourcePng.fileBytesSha256)
  assert.equal(row.sourcePng.fileBytesSha256, row.sourcePng.expectedPageImageSha256)
  assert.equal(bytes.length, row.sourcePng.bytes); sourceBytes += bytes.length
  const spec = { libraryRoot, cacheRoot, subject: groups[0].subjectCode, fileName: path.basename(row.pdf.path), expectedPdfSha256: row.pdf.sha256,
    expectedPageImageSha256: row.sourcePng.fileBytesSha256, page: row.page, imageSize: [row.sourcePng.width, row.sourcePng.height], role: 'question-paper' }
  const target = sourcePageCachePath(spec)
  assert.ok(path.relative(cacheRoot, target) && !path.relative(cacheRoot, target).startsWith('..'))
  await fs.mkdir(path.dirname(target), { recursive: true })
  try { await fs.writeFile(target, bytes, { flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(sha(await fs.readFile(target)), row.sourcePng.fileBytesSha256, 'never overwrite a mismatched cache file') }
}
const service = createNativeQuestionImages({ getQuestionBank: () => groups, libraryRoot, env: { STEM_SOURCE_PAGE_CACHE_ROOT: cacheRoot } })
let canonicalHydrated = 0, markSchemePages = 0
if (args['--ms-manifest']) {
  const msBytes = await fs.readFile(args['--ms-manifest']); assert.equal(sha(msBytes), args['--ms-manifest-sha'])
  const ms = JSON.parse(msBytes)
  assert.equal(ms.summary.mismatches, 0)
  for (const row of ms.pageRows) {
    for (const id of row.sourceQuestionIds) {
      const question = groups.find(q => q.sourceQuestionId === id)
      assert.equal(question?.answerRef.sha256, row.markSchemePdf.sha256)
      assert.ok(question.parts.every(p => p.markSchemeEvidence.some(e => e.page === row.page && e.pageImageSha256 === row.sourcePng.fileBytesSha256)))
    }
    const pdf = await fs.readFile(row.markSchemePdf.path); assert.equal(sha(pdf), row.markSchemePdf.sha256)
    const bytes = await fs.readFile(row.sourcePng.path); assert.equal(sha(bytes), row.sourcePng.fileBytesSha256)
    const spec = { libraryRoot, cacheRoot, subject: groups[0].subjectCode, fileName: path.basename(row.markSchemePdf.path), expectedPdfSha256: row.markSchemePdf.sha256,
      expectedPageImageSha256: row.sourcePng.fileBytesSha256, page: row.page, imageSize: [row.sourcePng.width, row.sourcePng.height], role: 'mark-scheme', allowMarkScheme: true }
    const target = sourcePageCachePath(spec); await fs.mkdir(path.dirname(target), { recursive: true })
    try { await fs.writeFile(target, bytes, { flag: 'wx' }) }
    catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(sha(await fs.readFile(target)), row.sourcePng.fileBytesSha256) }
    markSchemePages++
  }
  for (const question of groups) for (const part of question.parts) {
    const canonical = canonicalHandwritingMarkingContext({ provenance: { routeId: question.routeId, ...canonicalAiMarkingProvenance(question, part) } }, { questionBank: groups })
    assert.equal(canonical.ok, true)
    const images = await canonicalHandwritingMarkingImages(canonical, { libraryRoot, env: { STEM_SOURCE_PAGE_CACHE_ROOT: cacheRoot }, deadlineAt: Date.now() + 15000 })
    assert.ok(images.questionImages.length && images.markSchemeImages.length)
    for (const image of images.questionImages) assert.ok(part.sourceEvidence.some(e => e.page === image.page && e.pageImageSha256 === image.sourcePageSha256))
    for (const image of images.markSchemeImages) assert.ok(part.markSchemeEvidence.some(e => e.page === image.page && e.pageImageSha256 === image.sourcePageSha256))
    canonicalHydrated++
  }
}
for (const question of groups) {
  const images = service.descriptors(routeId, question.sourceQuestionId)
  assert.ok(images.length, 'every approved source question has displayable regions: ' + question.sourceQuestionId)
  for (const image of images) {
    const result = await service.image(Object.fromEntries(new URL(image.url, 'https://example.test').searchParams))
    assert.equal(result.contentType, 'image/png')
    const row = manifest.pageRows.find(row => row.pdf.sha256 === question.sourceRef.sha256 && row.page === image.page)
    assert.equal(sha(result.bytes), row.sourcePng.fileBytesSha256)
  }
}
const inventory = syllabusTopicsInventory({ routeId, questionBank: groups, includeStudyOnly: false })
const topic = inventory.topics.find(topic => topic.apiStartable)
assert.ok(topic)
const spec = { routeId, stage: groups[0].stage, subjectCode: groups[0].subjectCode, components: [groups[0].paperComponent], syllabusTopicIds: [topic.id], questionCount: 6 }
const set = service.projectSet(buildSyllabusPracticeSet({ ...spec, questionBank: groups, includeStudyOnly: false }))
const { miniRuntime } = await import(pathToFileURL(path.join(args['--mini-root'], 'scripts/helpers/mini-runtime.mjs')).href)
const runtime = miniRuntime(), native = runtime.load('utils/nativePractice')
const clientInventory = runtime.load('utils/inventory').normalizeInventory(inventory, routeId)
assert.equal(native.selectionState(clientInventory, spec.syllabusTopicIds, spec.components, 6).canStart, true)
const session = native.createSession(set, spec)
for (let i = 0; i < session.questions.length; i++) assert.ok(native.questionView(session, i).question.images.every(image => image.cropped))
const handler = createStemApi({ env: { STEM_DB_PATH: ':memory:', NODE_ENV: 'production', STEM_SOURCE_PAGE_CACHE_ROOT: cacheRoot }, libraryRoot, topicQuestionBankProvider: () => groups })
const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end() }))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let httpAvailable = 0
try {
  const base = 'http://127.0.0.1:' + server.address().port
  const response = await fetch(base + '/api/stem/routes/' + routeId + '/syllabus-topics')
  assert.equal(response.status, 200)
  const body = await response.json(), mergedTopic = body.topics.find(t => t.id === topic.id)
  httpAvailable = mergedTopic.apiReadyQuestionCount
  assert.equal(httpAvailable, 17, 'five existing reviewed plus twelve newly released, not topic membership sums')
  const fullSpec = { ...spec, questionCount: 15 }
  const assembly = await fetch(base + '/api/stem/practice-sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fullSpec) })
  const assembled = await assembly.json(); assert.equal(assembly.status, 201)
  const combinedSession = native.createSession(assembled, fullSpec); assert.equal(combinedSession.questions.length, 15)
  assert.equal(combinedSession.practiceMode, 'study-only')
  for (const group of assembled.questionGroups.filter(q => q.nativeSourceImages?.length)) {
    const image = await fetch(base + group.nativeSourceImages[0].url)
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png')
    assert.ok((await image.arrayBuffer()).byteLength > 0)
  }
} finally { await new Promise(resolve => server.close(resolve)); closeStemDatabaseForTests() }
console.log(JSON.stringify({ status: 'PASS', sourceArtifacts: artifacts.length, uniqueQuestions: groups.length, sourcePages: manifest.pageRows.length,
  pngBytes: sourceBytes, assembledQuestions: session.questions.length, practiceMode: set.practiceMode, formalProgressEligible: set.formalProgressEligible,
  mergedHttpTopicAvailable: httpAvailable, mergedHttpAssembly: 15, aiMarkableParts: set.questionGroups.flatMap(q=>q.parts).filter(p=>p.aiAssistedMarkingAvailable===true).length,
  canonicalHydrated, markSchemePages, liveProviderCalls: 0, nativeMiniValidation: 'PASS', productionDeployed: false }))
