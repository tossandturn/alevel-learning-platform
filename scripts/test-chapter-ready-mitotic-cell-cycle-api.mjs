import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { canonicalAiMarkingProvenance } from '../src/lib/sourceContentContract.js'

const routeId = 'cie-9700-as-biology'
const stage = 'AS'
const topicId = '9700-as-topic-05'
const expectedQuestionCount = 6
const chapterStudyMode = true
const expectedStudyReady = true
const artifactRoot = path.resolve(process.env.STEM_CHAPTER_READY_PROMOTED_ROOT
  || process.env.STEM_CHAPTER_READY_MITOTIC_CELL_CYCLE_ROOT
  || 'data/ai-pdf-ingestion/chapter-ready-9700-as-mitotic-cell-cycle-qwen-20261005-v3')
const libraryRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const sourcePageCacheRoot = path.resolve(process.env.STEM_SOURCE_PAGE_CACHE_ROOT
  || '.candidate-evidence/9700-as-mitotic-cell-cycle-promotion-20261005-v3/page-cache')

function artifactFiles(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

const artifacts = artifactFiles(artifactRoot).map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
const groups = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })().groups
assert.equal(artifacts.length, expectedQuestionCount)
assert.equal(groups.length, expectedQuestionCount)
const answers = Object.fromEntries(artifacts.map((artifact) => {
  const question = artifact.candidate.questions[0]
  return [question.sourceQuestionId, { choice: question.parts[0].answerKey }]
}))

// Ephemeral credentials and an in-memory database are used only by this test.
const secret = crypto.randomBytes(32).toString('hex')
function bearer(subject) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: subject, iat: now, exp: now + 300 })).toString('base64url')
  return `${header}.${payload}.${crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`
}

const token = bearer('ielts:9700008')
const otherToken = bearer('ielts:9700009')
const api = createStemApi({
  env: {
    NODE_ENV: 'production',
    STEM_DB_PATH: ':memory:',
    STEM_DATABASE_PATH: ':memory:',
    STEM_INTERNAL_AUTH_KEY: secret,
    STEM_SOURCE_PAGE_CACHE_ROOT: sourcePageCacheRoot,
  },
  questionBank: Object.freeze([]),
  topicQuestionBankProvider: () => groups,
  libraryRoot,
})
const server = http.createServer((request, response) => api(request, response, () => {
  response.statusCode = 404
  response.end()
}))

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  async function request(url, { method = 'GET', body = null, auth = token } = {}) {
    const response = await fetch(`${origin}${url}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        'x-stemist-source-images': 'region-v2',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: await response.json() }
  }

  const inventory = await request(`/api/stem/routes/${routeId}/syllabus-topics`)
  assert.equal(inventory.status, 200)
  const chapter = inventory.body.topics.find((topic) => topic.id === topicId)
  assert.ok(chapter)
  assert.equal(chapter.verifiedQuestionCount, 0)
  assert.equal(chapter.studyQuestionCount, expectedQuestionCount)
  assert.equal(chapter.availableQuestionCount, expectedQuestionCount)
  assert.equal(chapter.studyReady, expectedStudyReady)
  assert.equal(chapter.ready, false)
  if (chapterStudyMode) {
    assert.ok(chapter.chapterStudy.available >= expectedQuestionCount)
    assert.equal(chapter.chapterStudy.startable, true)
  }

  const practice = await request('/api/stem/practice-sets', {
    method: 'POST',
    body: {
      routeId,
      syllabusTopicIds: [topicId],
      components: [1],
      questionCount: expectedQuestionCount,
      sourceQuestionIds: groups.map((group) => group.sourceQuestionId),
      excludeAttempted: false,
      ...(chapterStudyMode ? {
        studyMode: 'chapter-study',
        sourcePreference: 'official-first',
        foundationCatalog: 'v2',
      } : {}),
    },
  })
  assert.equal(practice.status, 201, JSON.stringify(practice.body))
  assert.equal(practice.body.practiceMode, 'study-only')
  assert.equal(practice.body.formalProgressEligible, false)
  assert.equal(practice.body.questionGroups.length, expectedQuestionCount)
  assert.deepEqual(practice.body.sourceMix, { official: expectedQuestionCount, originalFoundation: 0 })
  assert.deepEqual(practice.body.coveredSyllabusTopicIds, [topicId])
  assert.ok(practice.body.questionGroups.every((group) => group.syllabusMapping?.topicIds?.includes(topicId)), 'The Chapter 5 start must not borrow another chapter question.')
  if (chapterStudyMode) {
    assert.ok(practice.body.available >= expectedQuestionCount)
    assert.equal(practice.body.count, expectedQuestionCount)
    assert.equal(practice.body.limited, false)
  }
  const projectedGroups = practice.body.questionGroups.map((group) => ({
    sourceQuestionId: group.sourceQuestionId,
    answerFormat: group.answerFormat,
    qualityFlag: group.qualityFlag,
    reviewLabel: group.reviewLabel,
    formalProgressEligible: group.formalProgressEligible,
    partAnswerKeys: group.parts.map((part) => part.answerKey),
    partAnswerTexts: group.parts.map((part) => part.answerText),
  }))
  assert.ok(practice.body.questionGroups.every((group) => (
    group.answerFormat === 'single-choice'
    && group.qualityFlag === 'aicheck'
    && group.reviewLabel === 'AI 审核'
    && group.formalProgressEligible === false
    && group.parts.every((part) => part.answerKey == null && !part.answerText)
  )), JSON.stringify(projectedGroups))
  const nativeSourceImages = practice.body.questionGroups.flatMap((group) => group.nativeSourceImages || [])
  assert.ok(practice.body.questionGroups.every((group) => group.nativeSourceImages?.length >= 1), 'Every promoted question must expose an approved source-image region.')
  for (const descriptor of nativeSourceImages) {
    assert.equal(descriptor.schemaVersion, 'native-source-region-v2')
    assert.ok(Array.isArray(descriptor.renderedImageSize) && descriptor.renderedImageSize.every((value) => Number.isInteger(value) && value > 0))
    assert.ok(!/correct|answer/i.test(descriptor.url), 'Source-image URLs must not leak answer data.')
    const imageResponse = await fetch(`${origin}${descriptor.url}`)
    assert.equal(imageResponse.status, 200)
    assert.equal(imageResponse.headers.get('content-type'), 'image/png')
    assert.match(imageResponse.headers.get('etag') || '', /^"[a-f0-9]{64}"$/)
    assert.ok((await imageResponse.arrayBuffer()).byteLength > 100)
  }

  const attemptId = 'chapter-ready-mcq-api-regression'
  const attemptPayload = {
    attemptId,
    mode: 'topic',
    routeId,
    stage,
    submittedAt: new Date().toISOString(),
    markingParts: groups.flatMap((group) => group.parts.map((part) => ({
      unitPartId: part.partId,
      provenance: { routeId, ...canonicalAiMarkingProvenance(group, part) },
    }))),
    attempt: {
      id: attemptId,
      mode: 'topic',
      routeId,
      stage,
      answers,
    },
  }
  assert.equal((await request('/api/stem/attempts', { method: 'POST', body: attemptPayload })).status, 201)

  for (const group of groups) {
    const selectedOption = answers[group.sourceQuestionId].choice
    const scored = await request('/api/stem/objective-answers', {
      method: 'POST',
      body: {
        attemptId,
        mode: 'topic',
        routeId,
        stage,
        paperId: group.sourceRef.paperId,
        sourceQuestionId: group.sourceQuestionId,
        selectedOption,
      },
    })
    assert.equal(scored.status, 200, JSON.stringify(scored.body))
    assert.equal(scored.body.available, true)
    assert.equal(scored.body.score, 1)
    assert.equal(scored.body.correctOption, selectedOption)
    assert.equal(scored.body.qualityFlag, 'aicheck')
    assert.equal(scored.body.reviewLabel, 'AI 审核')
    assert.equal(scored.body.formalProgressEligible, false)
  }

  const wrongAttemptId = 'chapter-ready-mitotic-cell-cycle-wrong-api-regression'
  const wrongAnswers = Object.fromEntries(artifacts.map((artifact) => {
    const question = artifact.candidate.questions[0]
    const answer = question.parts[0].answerKey
    return [question.sourceQuestionId, { choice: answer === 'A' ? 'B' : 'A' }]
  }))
  const wrongAttemptPayload = {
    ...attemptPayload,
    attemptId: wrongAttemptId,
    attempt: { ...attemptPayload.attempt, id: wrongAttemptId, answers: wrongAnswers },
  }
  assert.equal((await request('/api/stem/attempts', { method: 'POST', body: wrongAttemptPayload })).status, 201)
  for (const group of groups) {
    const selectedOption = wrongAnswers[group.sourceQuestionId].choice
    const scored = await request('/api/stem/objective-answers', {
      method: 'POST',
      body: {
        attemptId: wrongAttemptId,
        mode: 'topic',
        routeId,
        stage,
        paperId: group.sourceRef.paperId,
        sourceQuestionId: group.sourceQuestionId,
        selectedOption,
      },
    })
    assert.equal(scored.status, 200, JSON.stringify(scored.body))
    assert.equal(scored.body.score, 0)
    assert.equal(scored.body.correctOption, answers[group.sourceQuestionId].choice)
    assert.equal(scored.body.formalProgressEligible, false)
  }

  const wrongOwner = await request('/api/stem/objective-answers', {
    method: 'POST',
    auth: otherToken,
    body: {
      attemptId,
      mode: 'topic',
      routeId,
      stage,
      paperId: groups[0].sourceRef.paperId,
      sourceQuestionId: groups[0].sourceQuestionId,
      selectedOption: answers[groups[0].sourceQuestionId].choice,
    },
  })
  assert.equal(wrongOwner.status, 404)
  assert.equal(wrongOwner.body.code, 'attempt_not_found')

  const unauthorized = await request('/api/stem/objective-answers', {
    method: 'POST',
    auth: null,
    body: {
      attemptId,
      mode: 'topic',
      routeId,
      stage,
      paperId: groups[0].sourceRef.paperId,
      sourceQuestionId: groups[0].sourceQuestionId,
      selectedOption: answers[groups[0].sourceQuestionId].choice,
    },
  })
  assert.equal(unauthorized.status, 401)

  console.log(JSON.stringify({
    status: 'PASS_CHAPTER_READY_MCQ_API',
    questions: groups.length,
    scored: groups.length,
    wrongScored: groups.length,
    sourceImages: nativeSourceImages.length,
    preSubmitAnswerLeak: false,
    unauthorizedRejected: true,
    ownerIsolation: true,
    formalProgressEligible: false,
  }))
} finally {
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
  closeStemDatabaseForTests()
}
