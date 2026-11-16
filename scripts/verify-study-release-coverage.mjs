import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { createStemApi, closeStemDatabaseForTests } from '../server/stemApi.js'
import { isStudentReleasedAiStudyItem } from '../src/data/questionBank.js'
import { readVerifiedSourcePage } from '../server/nativeSourcePages.js'
import { objectiveAnswerMetadata, scoreObjectiveQuestion } from '../server/objectiveAnswers.js'
import { assertStudyReleaseInventory, assertChapterStudyReleaseInventory, parseStudyTopicScopes } from './study-release-policy.mjs'
import { freeFetchPort } from './lib/fetch-safe-port.mjs'

const values = (name) => process.argv.flatMap((argument, index) => (
  argument === name ? [String(process.argv[index + 1] || '')] : []
))
const routes = values('--route')
const roots = values('--artifact-root')
const libraryRoot = values('--pdf-library-root')[0]
const pageCacheRoot = values('--source-page-cache-root')[0]
const pinnedManifestHashes = values('--pinned-manifest-sha256')
const modeValues = values('--readiness-mode')
assert.ok(modeValues.length <= 1, 'at most one readiness mode may be specified')
const readinessMode = modeValues[0] || 'student-study'
assert.ok(['student-study', 'chapter-study'].includes(readinessMode), 'unknown study readiness mode')
const topicScopeEntries = [...values('--topic-scope'), ...values('--topic')]

assert.ok(
  routes.length
  && routes.every((routeId) => /^[A-Za-z0-9-]+$/.test(routeId))
  && new Set(routes).size === routes.length,
  'explicit unique routes required',
)
assert.ok(roots.length && libraryRoot, 'explicit artifact and PDF roots required')
for (const sourcePath of [...roots, libraryRoot]) {
  assert.ok(fs.statSync(path.resolve(sourcePath)).isDirectory(), 'source directory required')
}
const topicScopes = parseStudyTopicScopes(topicScopeEntries, routes)
if (readinessMode === 'chapter-study') {
  assert.ok(pageCacheRoot && fs.statSync(path.resolve(pageCacheRoot)).isDirectory(), 'chapter-study requires an explicit source page cache')
  assert.ok(routes.every((routeId) => Array.isArray(topicScopes[routeId]) && topicScopes[routeId].length),
    'chapter-study requires explicit topic scope for every declared route')
}
if (pinnedManifestHashes.length) {
  assert.equal(readinessMode, 'chapter-study', 'pinned packs are chapter-study only')
  assert.ok(pinnedManifestHashes.length === 1 && /^[a-f0-9]{64}$/.test(pinnedManifestHashes[0]) && roots.length === 1,
    'one explicit pack and one expected manifest SHA are required')
}
const groups = roots.flatMap((artifactRoot) => createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot,
  ...(pinnedManifestHashes.length ? { promotionPolicy: { mode: 'release-pinned', trustedManifestSha256: pinnedManifestHashes[0],
    expectedRealRoot: fs.realpathSync(artifactRoot), expectedRouteIds: routes } } : {}) })().groups)
assert.ok(groups.length, 'AI study release requires approved runtime artifacts')
assert.equal(
  new Set(groups.map((question) => `${question.routeId}:${question.sourceQuestionId}`)).size,
  groups.length,
  'duplicate runtime identity',
)
assert.ok(
  groups.every((question) => isStudentReleasedAiStudyItem(question) && question.formalProgressEligible === false),
  'runtime AI must be released-study and excluded from formal progress',
)

const api = createStemApi({
  env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:', ...(pageCacheRoot ? { STEM_SOURCE_PAGE_CACHE_ROOT: pageCacheRoot } : {}) },
  topicQuestionBankProvider: () => groups,
  libraryRoot,
})
const server = http.createServer((request, response) => api(request, response, () => {
  response.statusCode = 404
  response.end()
}))
const reports = []
let checkedQuestionGroups = 0, checkedImages = 0, checkedMarkSchemePages = 0, checkedTopicBindings = 0
try {
  const port = await freeFetchPort()
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const routeId of routes) {
    const response = await fetch(`${origin}/api/stem/routes/${routeId}/syllabus-topics`)
    assert.equal(response.status, 200)
    const inventory = await response.json()
    reports.push(readinessMode === 'chapter-study'
      ? assertChapterStudyReleaseInventory(inventory, routeId, topicScopes[routeId])
      : assertStudyReleaseInventory(inventory, routeId, topicScopes[routeId]))
    if (readinessMode !== 'chapter-study') continue
    const selected = groups.filter((question) => question.routeId === routeId
      && (question.topicTags || []).some((id) => topicScopes[routeId].includes(id)))
    assert.ok(selected.length, `${routeId}: no source-backed chapter questions`)
    const checkedMs = new Set()
    for (const question of selected) {
      const topicIds = (question.topicTags || []).filter((id) => topicScopes[routeId].includes(id))
      let set = null
      for (const topicId of topicIds) {
        const start = await fetch(`${origin}/api/stem/practice-sets`, { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-stemist-source-images': 'region-v2' },
          body: JSON.stringify({ routeId, syllabusTopicIds: [topicId], components: [question.paperComponent], questionCount: 1,
            studyMode: 'chapter-study', sourcePreference: 'official-first', foundationCatalog: 'v2',
            sourceQuestionIds: [question.sourceQuestionId], excludeAttempted: false }) })
        assert.equal(start.status, 201, `${question.sourceQuestionId}: chapter ${topicId} start failed`)
        const current = await start.json()
        assert.equal(current.questionGroups?.[0]?.id, question.sourceQuestionId)
        assert.equal(current.formalProgressEligible, false)
        checkedTopicBindings += 1
        if (!set) set = current
      }
      const publicGroup = set.questionGroups?.[0]
      assert.equal(set.formalProgressEligible, false)
      assert.equal(publicGroup?.id, question.sourceQuestionId)
      assert.equal(publicGroup?.sourceRef?.sha256, question.sourceRef.sha256)
      const provenance = publicGroup?.parts?.[0]?.sourceBindingProvenance || publicGroup?.parts?.[0]?.markingProvenance
        || publicGroup?.parts?.[0]?.provenance
      assert.equal(provenance?.sourceDocumentSha256, question.sourceRef.sha256)
      assert.equal(provenance?.answerDocumentSha256, question.answerRef.sha256)
      assert.ok(Array.isArray(publicGroup.nativeSourceImages) && publicGroup.nativeSourceImages.length > 0,
        `${question.sourceQuestionId}: reviewed source image is missing`)
      for (const image of publicGroup.nativeSourceImages) {
        assert.ok(String(image.url || '').startsWith('/api/stem/practice-source-image?'))
        const result = await fetch(new URL(image.url, origin))
        assert.equal(result.status, 200, `${question.sourceQuestionId}: reviewed source image is unavailable`)
        assert.match(result.headers.get('content-type') || '', /^image\/png/i)
        assert.ok((await result.arrayBuffer()).byteLength > 0)
        checkedImages += 1
      }
      for (const part of question.parts || []) {
        assert.ok(part.markSchemeEvidence?.length, `${question.sourceQuestionId}: mark-scheme page evidence missing`)
        for (const evidence of part.markSchemeEvidence) {
          const key = `${question.answerRef.sha256}:${evidence.page}:${evidence.pageImageSha256}`
          if (checkedMs.has(key)) continue
          const spec = { libraryRoot, cacheRoot: pageCacheRoot, subject: question.subjectCode, fileName: question.answerRef.file,
            expectedPdfSha256: question.answerRef.sha256, page: evidence.page, expectedPageImageSha256: evidence.pageImageSha256,
            role: 'mark-scheme', allowMarkScheme: true,
            ...(Array.isArray(evidence.imageSize) ? { imageSize: evidence.imageSize } : { allowUnknownSize: true }) }
          await readVerifiedSourcePage(spec); checkedMs.add(key); checkedMarkSchemePages += 1
        }
      }
      if (objectiveAnswerMetadata(question)) {
        const scores = ['A', 'B', 'C', 'D'].map((selectedOption) => scoreObjectiveQuestion({ question, selectedOption, mode: 'topic' }))
        assert.ok(scores.every((item) => item.available === true && item.formalProgressEligible === false),
          `${question.sourceQuestionId}: reviewed objective score is unavailable`)
        assert.equal(scores.filter((item) => item.score === 1).length, 1)
        assert.equal(scores.filter((item) => item.score === 0).length, 3)
      }
      checkedQuestionGroups += 1
    }
  }
  console.log(JSON.stringify({
    status: 'PASS',
    readinessMode,
    runtimeGroups: groups.length,
    aiStudyFormalProgressEligible: false,
    ...(readinessMode === 'chapter-study' ? { checkedQuestionGroups, checkedTopicBindings, checkedImages, checkedMarkSchemePages,
      clientAndProductionAcceptance: 'NOT_EVALUATED_BY_THIS_VERIFIER', releaseAuthority: 'NOT_EVALUATED_BY_THIS_VERIFIER' } : {}),
    ...(topicScopeEntries.length ? { topicScopes } : {}),
    routes: reports,
  }))
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeStemDatabaseForTests()
}
