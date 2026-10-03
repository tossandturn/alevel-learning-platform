import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { buildApIbRuntimeCandidate } from './build-apib-runtime-artifact.mjs'
import { validateApIbRuntimeRelease } from './validate-apib-runtime-release.mjs'
import { createCurriculumPracticeApi } from '../server/curriculumPracticeApi.js'

const workRoot = 'D:\\CodexWork\\ap-ib-ocr-delta-20261003'
const handoffPath = path.join(workRoot, 'reports', '2026-10-04', 'apib-question-review-handoff-v2.json')
const sourceAssetsPath = path.join(workRoot, 'runtime-candidate', '2026-10-04', 'source-assets.json')
const sourceAssetRoot = path.join(workRoot, 'runtime-candidate', '2026-10-04', 'assets')
const scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'curriculum-practice-api-'))
const database = new DatabaseSync(':memory:')
let databaseCalls = 0
let clock = 0
let uuidCounter = 0

function authenticateRequest(request) {
  const match = String(request.headers.authorization || '').match(/^Bearer (user-[ab])$/)
  return match ? { id: match[1], username: match[1] } : null
}

function headers(user = null) {
  return { ...(user ? { Authorization: `Bearer ${user}` } : {}), 'Content-Type': 'application/json' }
}

try {
  await buildApIbRuntimeCandidate({ handoffPath, sourceAssetsPath, outputRoot: scratchRoot, createdAt: '2026-10-04T00:00:00.000Z' })
  await validateApIbRuntimeRelease({ releaseRoot: scratchRoot, sourceAssetRoot, write: true, validatedAt: '2026-10-04T00:01:00.000Z' })
  const api = createCurriculumPracticeApi({
    releaseRoot: scratchRoot,
    sourceAssetRoot,
    authenticateRequest,
    databaseProvider: () => { databaseCalls += 1; return database },
    now: () => `2026-10-04T00:0${clock++}:00.000Z`,
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
  })
  const server = http.createServer(async (request, response) => {
    const handled = await api.handle(request, response, new URL(request.url, 'http://127.0.0.1'))
    if (!handled) { response.statusCode = 404; response.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  async function json(pathname, options = {}) {
    const response = await fetch(base + pathname, options)
    const text = await response.text()
    return { response, text, body: JSON.parse(text) }
  }

  try {
    const catalog = await json('/api/stem/curriculum-practice/catalog')
    assert.equal(catalog.response.status, 200)
    assert.deepEqual(Object.fromEntries(catalog.body.routes.map((route) => [route.id, route.questionCount])), {
      'ap-physics-1-mcq-study': 40,
      'ap-physics-c-em-mcq-study': 105,
    })
    assert.equal(databaseCalls, 0, 'public catalog must not open the student database')

    const release = api.loadRelease()
    const selectedQuestions = release.publicCatalog.questions.filter((question) => question.routeId === 'ap-physics-1-mcq-study').slice(0, 3)
    const question = await json(`/api/stem/curriculum-practice/questions/${selectedQuestions[0].id}`)
    assert.equal(question.response.status, 200)
    assert.ok(question.body.question.source.regions.every((region) => region.url.startsWith('/api/stem/curriculum-practice/source/') && /^[a-f0-9]{64}$/.test(region.sha256) && region.bytes > 0 && region.width > 0 && region.height > 0))
    assert.doesNotMatch(question.text, /correctOptions|answerHash|markScheme|gatewayEnvelope|qwenEnvelope|bindingHash/)
    assert.equal(databaseCalls, 0, 'public question must not open the student database')

    const sourceRegion = question.body.question.source.regions[0]
    assert.ok(sourceRegion.url.endsWith('/'+sourceRegion.sha256+'.png'), 'source URL must bind immutable cache bytes to the full content digest')
    const source = await fetch(base + sourceRegion.url)
    const sourceBytes = Buffer.from(await source.arrayBuffer())
    assert.equal(source.status, 200)
    assert.equal(source.headers.get('etag'), `"${sourceRegion.sha256}"`)
    assert.equal(sourceBytes.length, sourceRegion.bytes)
    assert.equal(crypto.createHash('sha256').update(sourceBytes).digest('hex'), sourceRegion.sha256)
    assert.equal((await fetch(base+sourceRegion.url.replace(sourceRegion.sha256,'0'.repeat(64)))).status,404,'a mismatched digest cannot serve current pixels under an old immutable URL')
    assert.equal((await fetch(base+sourceRegion.url.slice(0,sourceRegion.url.lastIndexOf('/')))).status,404,'unversioned source URLs must not be accepted')
    assert.equal(databaseCalls, 0, 'public source image must not open the student database')

    const zeroCount = await json('/api/stem/curriculum-practice/sessions', {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ routeId: 'ap-physics-1-mcq-study', count: 0 }),
    })
    assert.equal(zeroCount.response.status, 422)
    const stringCount = await json('/api/stem/curriculum-practice/sessions', {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ routeId: 'ap-physics-1-mcq-study', count: '10' }),
    })
    assert.equal(stringCount.response.status, 422)

    const created = await json('/api/stem/curriculum-practice/sessions', {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ routeId: 'ap-physics-1-mcq-study', questionIds: selectedQuestions.map((item) => item.id) }),
    })
    assert.equal(created.response.status, 201)
    assert.equal(created.body.session.status, 'draft')
    assert.ok(databaseCalls > 0)
    const sessionId = created.body.session.id

    const crossAccount = await json(`/api/stem/curriculum-practice/sessions/${sessionId}`, { headers: headers('user-b') })
    assert.equal(crossAccount.response.status, 404)
    assert.equal(crossAccount.body.error.code, 'curriculum_practice_session_not_found')

    const answers = selectedQuestions.map((item) => ({ questionId: item.id, selectedOptions: release.answerById.get(item.id).correctOptions }))
    const submitted = await json(`/api/stem/curriculum-practice/sessions/${sessionId}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: 'submission-1', answers }),
    })
    assert.equal(submitted.response.status, 200)
    assert.equal(submitted.body.session.status, 'submitted')
    assert.equal(submitted.body.session.result.score, 3)
    assert.equal(submitted.body.session.result.maxScore, 3)
    assert.equal(submitted.body.duplicate, false)
    assert.doesNotMatch(submitted.text, /correctOptions|answerHash|markScheme|gatewayEnvelope|qwenEnvelope|bindingHash/)

    const duplicate = await json(`/api/stem/curriculum-practice/sessions/${sessionId}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: 'submission-1', answers }),
    })
    assert.equal(duplicate.response.status, 200)
    assert.equal(duplicate.body.duplicate, true)

    const changedSameIdAnswers = structuredClone(answers)
    changedSameIdAnswers[0].selectedOptions = [selectedQuestions[0].options.find((option) => !changedSameIdAnswers[0].selectedOptions.includes(option))]
    const idempotencyMismatch = await json(`/api/stem/curriculum-practice/sessions/${sessionId}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: 'submission-1', answers: changedSameIdAnswers }),
    })
    assert.equal(idempotencyMismatch.response.status, 409)
    assert.equal(idempotencyMismatch.body.error.code, 'curriculum_practice_idempotency_mismatch')

    const changedRetry = await json(`/api/stem/curriculum-practice/sessions/${sessionId}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: 'submission-2', answers }),
    })
    assert.equal(changedRetry.response.status, 409)
    assert.equal(changedRetry.body.error.code, 'curriculum_practice_session_immutable')

    const history = await json('/api/stem/curriculum-practice/history', { headers: headers('user-a') })
    assert.equal(history.response.status, 200)
    assert.equal(history.body.sessions.length, 1)
    assert.equal(history.body.sessions[0].result.score, 3)

    const multiQuestion = release.publicCatalog.questions.find((item) => item.answerMode === 'multiple')
    assert.ok(multiQuestion)
    const multiCreated = await json('/api/stem/curriculum-practice/sessions', {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ routeId: multiQuestion.routeId, questionIds: [multiQuestion.id] }),
    })
    assert.equal(multiCreated.response.status, 201)
    const multiAnswer = release.answerById.get(multiQuestion.id).correctOptions
    assert.equal(multiAnswer.length, 2)
    const multiSubmitted = await json(`/api/stem/curriculum-practice/sessions/${multiCreated.body.session.id}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: 'submission-multi-1', answers: [{ questionId: multiQuestion.id, selectedOptions: [multiAnswer[0]] }] }),
    })
    assert.equal(multiSubmitted.response.status, 200)
    assert.equal(multiSubmitted.body.session.result.score, 0, 'a partial multi-select option set must not receive credit')
    assert.equal(multiSubmitted.body.session.result.items[0].correct, false)

    const partialCreated = await json('/api/stem/curriculum-practice/sessions', {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ routeId: selectedQuestions[0].routeId, questionIds: selectedQuestions.slice(0, 2).map((item) => item.id) }),
    })
    assert.equal(partialCreated.response.status, 201)
    const partialAnswer = [{ questionId: selectedQuestions[0].id, selectedOptions: release.answerById.get(selectedQuestions[0].id).correctOptions }]
    const overlongSubmission = await json(`/api/stem/curriculum-practice/sessions/${partialCreated.body.session.id}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: `s${'x'.repeat(128)}`, answers: selectedQuestions.slice(0, 2).map((item) => ({ questionId: item.id, selectedOptions: release.answerById.get(item.id).correctOptions })) }),
    })
    assert.equal(overlongSubmission.response.status, 400)
    assert.equal(overlongSubmission.body.error.code, 'curriculum_practice_submission_id_invalid')
    const explicitUnansweredRejected = await json(`/api/stem/curriculum-practice/sessions/${partialCreated.body.session.id}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: 'submission-explicit-unanswered', answers: [{ questionId: selectedQuestions[0].id, selectedOptions: [], unanswered: true }, { questionId: selectedQuestions[1].id, selectedOptions: release.answerById.get(selectedQuestions[1].id).correctOptions }] }),
    })
    assert.equal(explicitUnansweredRejected.response.status, 422)
    assert.equal(explicitUnansweredRejected.body.error.code, 'curriculum_practice_answers_incomplete')
    const partialRejected = await json(`/api/stem/curriculum-practice/sessions/${partialCreated.body.session.id}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: 'submission-partial-1', answers: partialAnswer }),
    })
    assert.equal(partialRejected.response.status, 422)
    assert.equal(partialRejected.body.error.code, 'curriculum_practice_answers_incomplete')
    const partialConfirmed = await json(`/api/stem/curriculum-practice/sessions/${partialCreated.body.session.id}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: 'submission-partial-1', answers: partialAnswer, confirmUnanswered: true }),
    })
    assert.equal(partialConfirmed.response.status, 200)
    assert.equal(partialConfirmed.body.session.result.score, 1)
    assert.equal(partialConfirmed.body.session.result.maxScore, 2)
    assert.equal(partialConfirmed.body.session.result.items.find((item) => item.questionId === selectedQuestions[1].id).unanswered, true)

    const tamperCreated = await json('/api/stem/curriculum-practice/sessions', {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ routeId: selectedQuestions[0].routeId, questionIds: [selectedQuestions[0].id] }),
    })
    assert.equal(tamperCreated.response.status, 201)
    database.prepare('UPDATE curriculum_practice_sessions SET question_set_hash = ? WHERE user_id = ? AND session_id = ?').run('0'.repeat(64), 'user-a', tamperCreated.body.session.id)
    const tamperedBinding = await json(`/api/stem/curriculum-practice/sessions/${tamperCreated.body.session.id}/submit`, {
      method: 'POST', headers: headers('user-a'), body: JSON.stringify({ submissionId: 'submission-tamper-1', answers: [{ questionId: selectedQuestions[0].id, selectedOptions: release.answerById.get(selectedQuestions[0].id).correctOptions }] }),
    })
    assert.equal(tamperedBinding.response.status, 409)
    assert.equal(tamperedBinding.body.error.code, 'curriculum_practice_session_binding_mismatch')

    const baseQuestion = selectedQuestions[0]
    const baseAssetId = baseQuestion.source.assetIds[0]
    const encodedQuestionId = 'ap:test:q1'
    const encodedAssetId = 'asset:test:1'
    const syntheticQuestion = { ...baseQuestion, id: encodedQuestionId, source: { ...baseQuestion.source, assetIds: [encodedAssetId] } }
    const syntheticAsset = { ...release.assetById.get(baseAssetId), id: encodedAssetId, questionId: encodedQuestionId }
    const syntheticRelease = {
      ...release,
      questionById: new Map([[encodedQuestionId, syntheticQuestion]]),
      assetById: new Map([[encodedAssetId, syntheticAsset]]),
      resolveSourceAsset: (questionId, assetId) => questionId === encodedQuestionId && assetId === encodedAssetId ? release.resolveSourceAsset(baseQuestion.id, baseAssetId) : null,
    }
    const encodedApi = createCurriculumPracticeApi({ releaseProvider: () => syntheticRelease })
    const encodedServer = http.createServer(async (request, response) => encodedApi.handle(request, response, new URL(request.url, 'http://127.0.0.1')))
    await new Promise((resolve) => encodedServer.listen(0, '127.0.0.1', resolve))
    const encodedBase = `http://127.0.0.1:${encodedServer.address().port}`
    try {
      const encodedQuestion = await fetch(`${encodedBase}/api/stem/curriculum-practice/questions/${encodeURIComponent(encodedQuestionId)}`)
      assert.equal(encodedQuestion.status, 200)
      const encodedRegion = (await encodedQuestion.json()).question.source.regions[0]
      const encodedSource = await fetch(`${encodedBase}/api/stem/curriculum-practice/source/${encodeURIComponent(encodedQuestionId)}/${encodeURIComponent(encodedAssetId)}/${encodedRegion.sha256}.png`)
      assert.equal(encodedSource.status, 200)
      const encodedSlash = await fetch(`${encodedBase}/api/stem/curriculum-practice/questions/${encodeURIComponent('ap/test')}`)
      assert.equal(encodedSlash.status, 400)
    } finally {
      await new Promise((resolve) => encodedServer.close(resolve))
    }

    const failingApi = createCurriculumPracticeApi({ releaseProvider: () => { throw new Error('D:\\private\\student.sqlite SQL failed') } })
    const failingServer = http.createServer(async (request, response) => failingApi.handle(request, response, new URL(request.url, 'http://127.0.0.1')))
    await new Promise((resolve) => failingServer.listen(0, '127.0.0.1', resolve))
    try {
      const failed = await fetch(`http://127.0.0.1:${failingServer.address().port}/api/stem/curriculum-practice/catalog`)
      const failedText = await failed.text()
      assert.equal(failed.status, 500)
      assert.match(failedText, /temporarily unavailable/)
      assert.doesNotMatch(failedText, /private|student\.sqlite|SQL failed/i)
    } finally {
      await new Promise((resolve) => failingServer.close(resolve))
    }

    console.log(JSON.stringify({ status: 'PASS', catalogQuestions: 145, sourceImageHashVerified: true, encodedPathIds: true, internalErrorsSanitized: true, explicitCountValidation: true, deterministicSingleScore: '3/3', deterministicMultiSelectExactSet: true, confirmedUnansweredScoresZero: true, ownershipIsolation: true, bindingTamperRejected: true, idempotencyPayloadBound: true, publicDatabaseCalls: 0 }))
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
} finally {
  database.close()
  await fs.rm(scratchRoot, { recursive: true, force: true })
}
