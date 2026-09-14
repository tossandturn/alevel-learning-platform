import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { closeStemDatabaseForTests, createStemApi, nativePaperContext } from '../server/stemApi.js'
import {
  OBJECTIVE_RESULT_SCHEMA_VERSION,
  objectiveAnswerMetadata,
  projectNativeObjectivePracticeSet,
  scoreObjectiveQuestion,
} from '../server/objectiveAnswers.js'
import { studyQuestionBank, unifiedQuestionBank } from '../src/data/questionBank.js'
import { buildSourceRenderManifest } from '../src/lib/sourceRenderManifest.js'

const CHOICES = ['A', 'B', 'C', 'D']
const signingKey = 'objective-answer-test-signing-key'
const reviewedQuestion = unifiedQuestionBank.find((question) => (
  question.routeId === 'cie-9702-as-physics'
  && question.paperComponent === 1
  && question.parts?.length === 1
  && question.parts[0]?.answerArea?.type === 'multiple-choice'
  && /^[A-D]$/i.test(String(question.parts[0]?.answerKey || '').trim())
))
assert.ok(reviewedQuestion, 'the reviewed 9702 Paper 1 fixture must remain available')
const reviewedPart = reviewedQuestion.parts[0]
const reviewedRenderManifest = buildSourceRenderManifest(reviewedQuestion)
const correctOption = String(reviewedPart.answerKey).trim().toUpperCase()
const wrongOption = CHOICES.find((choice) => choice !== correctOption)

for (const [subjectCode, paperComponent] of [
  ['0610', 1], ['0610', 2], ['0625', 1], ['0625', 2],
  ['9700', 1], ['9701', 1], ['9702', 1], ['9708', 1], ['9708', 3],
]) {
  assert.deepEqual(objectiveAnswerMetadata({ subjectCode, paperComponent }), {
    answerFormat: 'single-choice',
    choiceLabels: CHOICES,
  })
}
assert.equal(objectiveAnswerMetadata({ subjectCode: '9709', paperComponent: 1 }), null, 'Mathematics Paper 1 is structured, not inferred MCQ')
assert.deepEqual(objectiveAnswerMetadata({ paperId: 'cie-9702-9702_m25_qp_12' }), { answerFormat: 'single-choice', choiceLabels: CHOICES })
assert.equal(objectiveAnswerMetadata({ paperId: 'cie-9709-9709_m25_qp_12' }), null, 'a source-only Mathematics Paper 1 remains structured')
assert.deepEqual(objectiveAnswerMetadata({
  subjectCode: '9999',
  paperComponent: 9,
  parts: [{ answerArea: { type: 'multiple-choice', input: 'choice' }, options: CHOICES, marks: 1 }],
}), { answerFormat: 'single-choice', choiceLabels: CHOICES }, 'explicit source MCQ metadata remains supported outside the component allowlist')
assert.equal(objectiveAnswerMetadata({
  subjectCode: '9999',
  paperComponent: 9,
  parts: [
    { answerArea: { type: 'multiple-choice', input: 'choice' }, options: CHOICES, marks: 1 },
    { answerArea: { type: 'written' }, marks: 1 },
  ],
}), null, 'one MCQ-looking part cannot relabel a mixed constructed-response group as single choice')

const nativeProjection = projectNativeObjectivePracticeSet({
  schemaVersion: 'server-syllabus-practice-v2',
  questionGroups: [{
    id: reviewedQuestion.sourceQuestionId,
    routeId: reviewedQuestion.routeId,
    subjectCode: reviewedQuestion.subjectCode,
    paperComponent: reviewedQuestion.paperComponent,
    sourceRef: reviewedQuestion.sourceRef,
    answerKey: correctOption,
    answerRef: { localUrl: '/must-remain-server-only.pdf' },
    parts: [{
      partId: reviewedPart.partId,
      answerArea: reviewedPart.answerArea,
      options: reviewedPart.options,
      sourceFocus: reviewedPart.sourceFocus,
      sourceEvidence: reviewedPart.sourceEvidence,
      marks: reviewedPart.marks,
      answerKey: correctOption,
      markSchemePoints: ['must remain server-only'],
      markSchemeEvidence: [{ text: 'Q1 = A must remain server-only' }],
      sourceBindingProvenance: { sourceQuestionId: reviewedQuestion.sourceQuestionId, questionPartId: reviewedPart.partId },
    }],
  }],
})
assert.equal(nativeProjection.questionGroups[0].answerFormat, 'single-choice')
assert.deepEqual(nativeProjection.questionGroups[0].choiceLabels, CHOICES)
const expectedChoiceOptions = [
  { label: 'A', text: 'force' },
  { label: 'B', text: 'momentum' },
  { label: 'C', text: 'velocity' },
  { label: 'D', text: 'work' },
]
assert.deepEqual(nativeProjection.questionGroups[0].choiceOptions, expectedChoiceOptions)
assert.deepEqual(nativeProjection.questionGroups[0].questionFocus, {
  schemaVersion: 'native-question-focus-v1',
  sourceQuestionId: reviewedQuestion.sourceQuestionId,
  paperId: reviewedQuestion.sourceRef.paperId,
  pages: reviewedRenderManifest.pages.map((page) => ({
    page: page.page,
    url: reviewedQuestion.sourceRef.assetUrls.find((url) => url.includes(`qp-${String(page.page).padStart(2, '0')}`)),
    region: [...page.normalizedRegion],
    imageSize: [...reviewedPart.sourceFocus.pages.find((focusPage) => focusPage.page === page.page).imageSize],
  })),
}, 'native practice must reuse the reviewed render manifest rather than guessing a crop')
assert.equal(nativeProjection.questionGroups[0].parts[0].answerFormat, 'single-choice')
assert.deepEqual(nativeProjection.questionGroups[0].parts[0].options, reviewedPart.options)
assert.deepEqual(nativeProjection.questionGroups[0].parts[0].provenance, nativeProjection.questionGroups[0].parts[0].sourceBindingProvenance)
assert.doesNotMatch(JSON.stringify(nativeProjection), /answerKey|answerRef|markSchemePoints|markSchemeEvidence|server-only/, 'native practice projection must not leak the official key or marking evidence')

const unsafeFocusProjection = projectNativeObjectivePracticeSet({
  questionGroups: [{
    ...nativeProjection.questionGroups[0],
    questionFocus: undefined,
    parts: nativeProjection.questionGroups[0].parts.map((part) => ({
      ...part,
      sourceEvidence: [],
      sourceFocus: {
        ...reviewedPart.sourceFocus,
        pages: reviewedPart.sourceFocus.pages.map((page) => ({ ...page, safetyStatus: 'unreviewed' })),
      },
    })),
  }],
})
assert.equal(unsafeFocusProjection.questionGroups[0].questionFocus, undefined, 'unreviewed display bounds must fall back to the original page')

const partialFocusProjection = projectNativeObjectivePracticeSet({
  questionGroups: [{
    ...nativeProjection.questionGroups[0],
    sourceRef: {
      ...nativeProjection.questionGroups[0].sourceRef,
      assetUrls: [...nativeProjection.questionGroups[0].sourceRef.assetUrls, `/question-assets/${reviewedQuestion.sourceRef.paperId}/qp-99.jpg`],
    },
    questionFocus: undefined,
  }],
})
assert.equal(partialFocusProjection.questionGroups[0].questionFocus, undefined, 'a partial focus must not hide another original question image')

const sameLengthOtherPaperId = reviewedQuestion.sourceRef.paperId.replace(/.$/, (value) => value === '9' ? '8' : '9')
assert.equal(sameLengthOtherPaperId.length, reviewedQuestion.sourceRef.paperId.length)
const misboundFocusProjection = projectNativeObjectivePracticeSet({
  questionGroups: [{ ...nativeProjection.questionGroups[0], id: `${sameLengthOtherPaperId}:q1`, questionFocus: undefined }],
})
assert.equal(misboundFocusProjection.questionGroups[0].questionFocus, undefined, 'focus metadata must stay bound to the source question paper')
const zeroQuestionFocusProjection = projectNativeObjectivePracticeSet({
  questionGroups: [{ ...nativeProjection.questionGroups[0], id: `${reviewedQuestion.sourceRef.paperId}:q0`, questionFocus: undefined }],
})
assert.equal(zeroQuestionFocusProjection.questionGroups[0].questionFocus, undefined, 'focus metadata requires a positive canonical question number')
const mismatchedQuestionNumberProjection = projectNativeObjectivePracticeSet({
  questionGroups: [{ ...nativeProjection.questionGroups[0], questionNumber: 2, questionFocus: undefined }],
})
assert.equal(mismatchedQuestionNumberProjection.questionGroups[0].questionFocus, undefined, 'focus metadata must agree with the projected question number')

const mislabeledChoiceProjection = projectNativeObjectivePracticeSet({
  questionGroups: [{
    ...nativeProjection.questionGroups[0],
    choiceOptions: undefined,
    parts: nativeProjection.questionGroups[0].parts.map((part) => ({ ...part, options: ['(B) wrong', 'B ok', 'C ok', 'D ok'] })),
  }],
})
assert.equal(mislabeledChoiceProjection.questionGroups[0].choiceOptions, undefined, 'mislabeled source options must not be rebound by array position')

const labelOnlyChoiceProjection = projectNativeObjectivePracticeSet({
  questionGroups: [{
    ...nativeProjection.questionGroups[0],
    choiceOptions: undefined,
    parts: nativeProjection.questionGroups[0].parts.map((part) => ({ ...part, options: CHOICES })),
  }],
})
assert.deepEqual(labelOnlyChoiceProjection.questionGroups[0].choiceOptions, CHOICES.map((label) => ({ label, text: '' })), 'diagram-only A-D options remain selectable without invented text')

assert.deepEqual(scoreObjectiveQuestion({ question: reviewedQuestion, selectedOption: correctOption }), {
  questionPartId: reviewedPart.partId,
  available: true,
  source: 'mark-scheme',
  sourceStatus: 'reviewed-official-key',
  score: 1,
  maxScore: 1,
  correctOption,
})
const unreviewedQuestion = structuredClone(reviewedQuestion)
unreviewedQuestion.answerBinding.verificationStatus = 'machine-indexed'
assert.deepEqual(scoreObjectiveQuestion({ question: unreviewedQuestion, selectedOption: correctOption }), {
  questionPartId: reviewedPart.partId,
  available: false,
  source: 'unavailable',
  sourceStatus: 'official-key-unavailable',
  score: null,
  maxScore: 1,
  correctOption: null,
}, 'an unreviewed key must never score even when the option text is present')
const ambiguousKeyQuestion = structuredClone(reviewedQuestion)
ambiguousKeyQuestion.parts[0].answerKey = 'A or C'
assert.equal(scoreObjectiveQuestion({ question: ambiguousKeyQuestion, selectedOption: 'A' }).available, false, 'a multiple-option phrase must not be truncated into a canonical key')

function tokenFor(subject) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: subject,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-objective-answer-'))
const databasePath = path.join(temporaryDirectory, 'stem.sqlite')
const middleware = createStemApi({
  env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: databasePath, NODE_ENV: 'test' },
  questionBank: unifiedQuestionBank,
})
const server = http.createServer((request, response) => middleware(request, response, () => {
  response.statusCode = 404
  response.end(JSON.stringify({ error: 'Not found.' }))
}))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
const ownerHeaders = { Authorization: `Bearer ${tokenFor('ielts:4201')}`, 'Content-Type': 'application/json' }
const otherHeaders = { Authorization: `Bearer ${tokenFor('ielts:4202')}`, 'Content-Type': 'application/json' }
const routeId = reviewedQuestion.routeId
const stage = reviewedQuestion.stage
const paperId = reviewedQuestion.sourceRef.paperId
const sourceQuestionId = reviewedQuestion.sourceQuestionId
const paperContext = nativePaperContext(unifiedQuestionBank, { routeId, stage, paperId })
const contextQuestion = paperContext.questions.find((question) => question.sourceQuestionId === sourceQuestionId)
const contextPart = contextQuestion?.parts.find((part) => part.partId === reviewedPart.partId)
assert.equal(contextQuestion?.answerFormat, 'single-choice')
assert.deepEqual(contextQuestion?.choiceLabels, CHOICES)
assert.deepEqual(contextQuestion?.choiceOptions, expectedChoiceOptions)
assert.deepEqual(contextQuestion?.questionFocus, nativeProjection.questionGroups[0].questionFocus)
assert.deepEqual(contextQuestion?.questionFocus.pages.map((page) => page.url), contextQuestion?.images, 'authenticated focus must cover every original question image')
assert.equal(contextPart?.answerFormat, 'single-choice')
assert.doesNotMatch(JSON.stringify(contextQuestion), /answerKey|correctOption/)

const attemptId = 'objective-attempt-0001'
const attemptBody = {
  attemptId,
  mode: 'full-paper',
  routeId,
  stage,
  paperId,
  paperStudyMode: 'past-paper-practice',
  submittedAt: new Date().toISOString(),
  attempt: {
    id: attemptId,
    mode: 'full-paper',
    routeId,
    stage,
    paperId,
    paperStudyMode: 'past-paper-practice',
    answers: { [sourceQuestionId]: correctOption },
  },
}

async function post(url, body, headers = ownerHeaders) {
  const response = await fetch(baseUrl + url, { method: 'POST', headers, body: JSON.stringify(body) })
  return { response, body: await response.json() }
}

try {
  const practiceResponse = await fetch(`${baseUrl}/api/stem/practice-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-STEMist-Source-Images': 'region-v2' },
    body: JSON.stringify({
      routeId: 'cie-0625-igcse-physics',
      syllabusTopicIds: ['0625-igcse-topic-01'],
      questionCount: 6,
      components: [2],
      excludeAttempted: false,
      seed: 7,
    }),
  })
  const practiceBody = await practiceResponse.json()
  assert.equal(practiceResponse.status, 201, JSON.stringify(practiceBody))
  assert.equal(practiceBody.questionGroups.length, 6)
  assert.ok(practiceBody.questionGroups.every((group) => group.answerFormat === 'single-choice'))
  assert.ok(practiceBody.questionGroups.flatMap((group) => group.parts).every((part) => (
    part.answerFormat === 'single-choice'
    && part.provenance?.sourceQuestionId
    && part.provenance?.questionPartId
  )), 'native MCQ parts expose canonical source provenance without depending on AI marking flags')
  assert.doesNotMatch(JSON.stringify(practiceBody), /"(?:answerKey|answerRef|markSchemePoints|markSchemeEvidence)"\s*:/)

  const crossTopicP1Response = await fetch(`${baseUrl}/api/stem/practice-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-STEMist-Source-Images': 'region-v2' },
    body: JSON.stringify({
      routeId,
      syllabusTopicIds: ['physics-9702-topic-01', 'physics-9702-topic-02'],
      questionCount: 6,
      components: [1],
      excludeAttempted: false,
      seed: 9702,
    }),
  })
  const crossTopicP1Body = await crossTopicP1Response.json()
  assert.equal(crossTopicP1Response.status, 201, JSON.stringify(crossTopicP1Body))
  assert.equal(crossTopicP1Body.practiceMode, 'study-only')
  assert.equal(crossTopicP1Body.formalProgressEligible, false)
  assert.ok(crossTopicP1Body.questionGroups.every((group) => (
    group.paperComponent === 1
    && group.answerFormat === 'single-choice'
    && group.choiceOptions?.map((option) => option.label).join('') === 'ABCD'
    && group.questionFocus?.schemaVersion === 'native-question-focus-v1'
    && JSON.stringify(group.questionFocus.pages.map((page) => page.url)) === JSON.stringify(group.sourceContent.assetUrls)
  )), 'real cross-topic P1 practice must expose complete reviewed focus and ordered source options')
  assert.doesNotMatch(JSON.stringify(crossTopicP1Body), /"(?:answerKey|answerRef|markSchemePoints|markSchemeEvidence|correctOption)"\s*:/)

  const sourceResponse = await fetch(`${baseUrl}/api/stem/papers/${paperId}/source-context?routeId=${routeId}&stage=${stage}`)
  const sourceBody = await sourceResponse.json()
  const sourceQuestion = sourceBody.questions.find((question) => question.sourceQuestionId === sourceQuestionId)
  assert.equal(sourceResponse.status, 200)
  assert.equal(sourceQuestion.answerFormat, 'single-choice')
  assert.deepEqual(sourceQuestion.choiceLabels, CHOICES)
  assert.deepEqual(sourceQuestion.choiceOptions, expectedChoiceOptions)
  assert.deepEqual(sourceQuestion.questionFocus, contextQuestion.questionFocus)
  assert.deepEqual(sourceQuestion.questionFocus.pages.map((page) => page.url), sourceQuestion.images, 'public focus must cover every original question image')
  assert.doesNotMatch(JSON.stringify(sourceBody), /answerKey|correctOption/)

  const createdAttempt = await post('/api/stem/attempts', attemptBody)
  assert.equal(createdAttempt.response.status, 201, JSON.stringify(createdAttempt.body))

  const requestBody = { attemptId, mode: 'full-paper', routeId, stage, paperId, sourceQuestionId, selectedOption: correctOption }
  const anonymous = await post('/api/stem/objective-answers', requestBody, { 'Content-Type': 'application/json' })
  assert.equal(anonymous.response.status, 401)

  const correct = await post('/api/stem/objective-answers', requestBody)
  assert.equal(correct.response.status, 200, JSON.stringify(correct.body))
  assert.deepEqual(correct.body, {
    schemaVersion: OBJECTIVE_RESULT_SCHEMA_VERSION,
    attemptId,
    mode: 'full-paper',
    routeId,
    stage,
    paperId,
    sourceQuestionId,
    questionPartId: reviewedPart.partId,
    answerFormat: 'single-choice',
    choiceLabels: CHOICES,
    selectedOption: correctOption,
    available: true,
    source: 'mark-scheme',
    sourceStatus: 'reviewed-official-key',
    score: 1,
    maxScore: 1,
    correctOption,
  })

  const incorrect = await post('/api/stem/objective-answers', { ...requestBody, selectedOption: wrongOption })
  assert.equal(incorrect.response.status, 409)
  assert.equal(incorrect.body.code, 'objective_answer_revision_mismatch')

  const wrongAttemptId = 'objective-attempt-wrong-0001'
  const wrongAttempt = await post('/api/stem/attempts', {
    ...attemptBody,
    attemptId: wrongAttemptId,
    attempt: { ...attemptBody.attempt, id: wrongAttemptId, answers: { [sourceQuestionId]: wrongOption } },
  })
  assert.equal(wrongAttempt.response.status, 201, JSON.stringify(wrongAttempt.body))
  const wrongResult = await post('/api/stem/objective-answers', {
    ...requestBody,
    attemptId: wrongAttemptId,
    selectedOption: wrongOption,
  })
  assert.equal(wrongResult.response.status, 200)
  assert.equal(wrongResult.body.score, 0)
  assert.equal(wrongResult.body.correctOption, correctOption)

  const invalidOption = await post('/api/stem/objective-answers', { ...requestBody, selectedOption: 'E' })
  assert.equal(invalidOption.response.status, 400)
  assert.equal(invalidOption.body.code, 'objective_option_invalid')

  const otherPaperId = paperId.replace(/.$/, (digit) => digit === '1' ? '2' : '1')
  const mismatchedPaper = await post('/api/stem/objective-answers', {
    ...requestBody,
    paperId: otherPaperId,
    sourceQuestionId: sourceQuestionId.replace(paperId, otherPaperId),
  })
  assert.equal(mismatchedPaper.response.status, 409)
  assert.equal(mismatchedPaper.body.code, 'objective_attempt_binding_mismatch')

  const wrongOwner = await post('/api/stem/objective-answers', requestBody, otherHeaders)
  assert.equal(wrongOwner.response.status, 404)
  assert.equal(wrongOwner.body.code, 'attempt_not_found')

  const unknownSourceQuestionId = `${paperId}:q999`
  const unknownAttemptId = 'objective-unknown-source-0001'
  const unknownAttempt = await post('/api/stem/attempts', {
    ...attemptBody,
    attemptId: unknownAttemptId,
    attempt: { ...attemptBody.attempt, id: unknownAttemptId, answers: { [unknownSourceQuestionId]: 'B' } },
  })
  assert.equal(unknownAttempt.response.status, 201, JSON.stringify(unknownAttempt.body))
  const unknownResult = await post('/api/stem/objective-answers', {
    ...requestBody,
    attemptId: unknownAttemptId,
    sourceQuestionId: unknownSourceQuestionId,
    selectedOption: 'B',
  })
  assert.equal(unknownResult.response.status, 200, JSON.stringify(unknownResult.body))
  assert.equal(unknownResult.body.available, false)
  assert.equal(unknownResult.body.maxScore, 1)
  assert.equal(unknownResult.body.correctOption, null)

  const topicAttemptId = 'objective-topic-attempt-0001'
  const topicAttempt = await post('/api/stem/attempts', {
    attemptId: topicAttemptId,
    mode: 'topic',
    routeId,
    stage,
    submittedAt: new Date().toISOString(),
    markingParts: [{ unitPartId: `${sourceQuestionId}:${reviewedPart.partId}`, provenance: contextPart.provenance }],
    attempt: { id: topicAttemptId, mode: 'topic', routeId, stage, answers: { [sourceQuestionId]: correctOption } },
  })
  assert.equal(topicAttempt.response.status, 201, JSON.stringify(topicAttempt.body))
  const topicObjective = await post('/api/stem/objective-answers', {
    ...requestBody,
    attemptId: topicAttemptId,
    mode: 'topic',
  })
  assert.equal(topicObjective.response.status, 200, JSON.stringify(topicObjective.body))
  assert.equal(topicObjective.body.score, 1)

  const draftAttemptId = 'objective-draft-attempt-0001'
  const draftAttempt = await post('/api/stem/attempts', {
    ...attemptBody,
    attemptId: draftAttemptId,
    submittedAt: undefined,
    attempt: { ...attemptBody.attempt, id: draftAttemptId },
  })
  assert.equal(draftAttempt.response.status, 201, JSON.stringify(draftAttempt.body))
  const draftObjective = await post('/api/stem/objective-answers', { ...requestBody, attemptId: draftAttemptId })
  assert.equal(draftObjective.response.status, 409)
  assert.equal(draftObjective.body.code, 'objective_attempt_not_submitted')

  const unreviewed = studyQuestionBank.find((question) => (
    question.routeId === 'cie-9700-as-biology'
    && question.paperComponent === 1
    && question.parts?.length === 1
    && question.parts[0]?.answerArea?.type === 'multiple-choice'
    && /^[A-D]$/i.test(String(question.parts[0]?.answerKey || '').trim())
  ))
  assert.ok(unreviewed, 'an indexed 9700 Paper 1 fixture must remain available for fail-closed scoring')
  assert.notEqual(unreviewed.answerBinding?.verificationStatus, 'reviewed')
  const unavailableAttemptId = 'objective-unavailable-0001'
  const unavailableAttempt = await post('/api/stem/attempts', {
    attemptId: unavailableAttemptId,
    mode: 'full-paper',
    routeId: unreviewed.routeId,
    stage: unreviewed.stage,
    paperId: unreviewed.sourceRef.paperId,
    paperStudyMode: 'past-paper-practice',
    submittedAt: new Date().toISOString(),
    attempt: {
      id: unavailableAttemptId,
      mode: 'full-paper',
      routeId: unreviewed.routeId,
      stage: unreviewed.stage,
      paperId: unreviewed.sourceRef.paperId,
      paperStudyMode: 'past-paper-practice',
      answers: { [unreviewed.sourceQuestionId]: 'A' },
    },
  })
  assert.equal(unavailableAttempt.response.status, 201, JSON.stringify(unavailableAttempt.body))
  const unavailable = await post('/api/stem/objective-answers', {
    attemptId: unavailableAttemptId,
    mode: 'full-paper',
    routeId: unreviewed.routeId,
    stage: unreviewed.stage,
    paperId: unreviewed.sourceRef.paperId,
    sourceQuestionId: unreviewed.sourceQuestionId,
    selectedOption: 'A',
  })
  assert.equal(unavailable.response.status, 200, JSON.stringify(unavailable.body))
  assert.equal(unavailable.body.available, false)
  assert.equal(unavailable.body.score, null)
  assert.equal(unavailable.body.correctOption, null)

  console.log('STEM objective answers: official MCQ metadata, native redaction, owned attempt binding and reviewed-key scoring passed.')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeStemDatabaseForTests()
  assert.equal(path.dirname(path.resolve(temporaryDirectory)), path.resolve(os.tmpdir()))
  assert.ok(path.basename(temporaryDirectory).startsWith('stem-objective-answer-'))
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
