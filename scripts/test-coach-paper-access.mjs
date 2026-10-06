import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'

import { createAiApi } from '../server/aiApi.js'
import { closeStemDatabaseForTests, createCoachAttemptAuthorizer, createStemApi } from '../server/stemApi.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { canonicalSourcePracticeProvenance } from '../src/lib/sourceContentContract.js'

const signingKey = 'coach-paper-access-signing-key'
const env = {
  STEM_INTERNAL_AUTH_KEY: signingKey,
  STEM_DB_PATH: ':memory:',
}
const providerBodies = []
const paperQuestions = unifiedQuestionBank.filter((question) => question?.sourceRef?.paperId === 'cie-9702-9702_m25_qp_22')
const markingParts = paperQuestions.flatMap((question) => (question.parts || []).flatMap((part) => {
  const provenance = canonicalSourcePracticeProvenance(question, part)
  return provenance ? [{ provenance: { routeId: question.routeId, ...provenance } }] : []
}))
const firstQuestion = paperQuestions.find((question) => question.sourceQuestionId === 'cie-9702-9702_m25_qp_22:q1')
const firstQuestionPart = firstQuestion?.parts?.[0]
assert.equal(paperQuestions.length, 7, 'the paper Coach regression needs the complete seven-question reviewed paper fixture')
assert.equal(markingParts.length, 29, 'the paper Coach regression needs every reviewed QP/MS part binding')
assert.ok(firstQuestionPart?.partId, 'the paper Coach regression needs an authoritative first question part')

function identityToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    iat: now,
    exp: now + 3600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

function compose(...middlewares) {
  return http.createServer((request, response) => {
    let index = 0
    const next = () => {
      const middleware = middlewares[index++]
      if (!middleware) {
        response.statusCode = 404
        response.end()
        return
      }
      Promise.resolve(middleware(request, response, next)).catch((error) => {
        response.statusCode = 500
        response.end(JSON.stringify({ error: error.message }))
      })
    }
    next()
  })
}

function providerCoachContext(body) {
  const contentItems = [
    ...(Array.isArray(body?.messages) ? body.messages : []).flatMap((message) => (
      Array.isArray(message?.content)
        ? message.content
        : [{ type: 'text', text: message?.content }]
    )),
    ...(Array.isArray(body?.input) ? body.input : []).flatMap((message) => (
      Array.isArray(message?.content)
        ? message.content
        : [{ type: 'input_text', text: message?.content }]
    )),
  ]
  for (const item of contentItems) {
    const text = typeof item === 'string' ? item : item?.text
    if (!text) continue
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && (parsed.attemptId || parsed.paper || parsed.question || parsed.part)) return parsed
    } catch {
      // System prompts and ordinary history are not JSON context.
    }
  }
  const metadataContext = body?.metadata?.stemCoachContext
  if (metadataContext && typeof metadataContext === 'object') return metadataContext
  if (typeof metadataContext === 'string') {
    try { return JSON.parse(metadataContext) } catch { return null }
  }
  return null
}

async function request(baseUrl, pathname, { token, body }) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch { payload = null }
  return { response, text, payload }
}

function attemptBody({ attemptId, studyMode, submittedAt = null, includeMarkingParts = true }) {
  return {
    attemptId,
    mode: 'full-paper',
    routeId: 'cie-9702-as-physics',
    stage: 'AS',
    paperId: 'cie-9702-9702_m25_qp_22',
    ...(includeMarkingParts ? { markingParts } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    attempt: {
      id: attemptId,
      mode: 'full-paper',
      routeId: 'cie-9702-as-physics',
      stage: 'AS',
      paperId: 'cie-9702-9702_m25_qp_22',
      paperStudyMode: studyMode,
      questionCount: 7,
      answeredCount: 0,
      answers: {},
      ...(submittedAt ? { submittedAt } : {}),
    },
  }
}

function topicAttemptBody(attemptId) {
  return {
    attemptId,
    mode: 'topic',
    routeId: 'cie-9702-as-physics',
    stage: 'AS',
    paperId: 'cie-9702-9702_m25_qp_22',
    unitId: 'coach-topic-source-unit',
    markingParts: [{ provenance: markingParts[0].provenance }],
    attempt: {
      id: attemptId,
      mode: 'topic',
      routeId: 'cie-9702-as-physics',
      stage: 'AS',
      unitId: 'coach-topic-source-unit',
      answers: {},
    },
  }
}

function coachBody(attemptId, overrides = {}) {
  return {
    message: 'Explain what this question asks and give the first step.',
    hintLevel: 3,
    context: {
      view: 'full-paper',
      attemptId,
      routeId: 'cie-9702-as-physics',
      stage: 'AS',
      paperStudyMode: 'past-paper-practice',
      paper: { id: 'cie-9702-9702_m25_qp_22' },
      question: { id: firstQuestion.sourceQuestionId, number: 1, label: 'Question 1' },
      part: { id: firstQuestionPart.partId, questionPartId: firstQuestionPart.partId, label: firstQuestionPart.label },
      responseStatus: 'unanswered',
      submitted: false,
      ...overrides,
    },
  }
}

const providerServer = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  providerBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream')
  response.end('data: {"choices":[{"delta":{"content":"Bound Coach response"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
})

const providerBase = await listen(providerServer)
const stemApi = createStemApi({ env })
const coachAuthorizer = createCoachAttemptAuthorizer({ env })
const aiApi = createAiApi({
  env: {
    ...env,
    COACH_AI_API_KEY: 'test-paper-coach-key',
    COACH_AI_BASE_URL: providerBase,
    COACH_AI_MODEL: 'qwen-test-paper-coach',
  },
  libraryRoot: process.cwd(),
  allowedSubjects: new Set(['9702']),
  authorizeCoachRequest: coachAuthorizer,
})
const appServer = compose(stemApi, aiApi)
const appBase = await listen(appServer)
const ownerToken = identityToken(1001)
const otherToken = identityToken(2002)
const practiceAttemptId = 'paper-coach-practice-0001'
const simulationAttemptId = 'paper-coach-simulation-0001'
const unboundAttemptId = 'paper-coach-unbound-0001'
const topicAttemptId = 'paper-coach-topic-0001'

try {
  const practiceDraft = await request(appBase, '/api/stem/attempts', {
    token: ownerToken,
    body: attemptBody({ attemptId: practiceAttemptId, studyMode: 'past-paper-practice' }),
  })
  assert.equal(practiceDraft.response.status, 201, practiceDraft.text)

  const unansweredPractice = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: coachBody(practiceAttemptId),
  })
  assert.equal(unansweredPractice.response.status, 200, unansweredPractice.text)
  assert.match(unansweredPractice.text, /Bound Coach response/)
  const practiceProviderContext = providerCoachContext(providerBodies.at(-1))
  assert.equal(practiceProviderContext?.responseStatus, 'unanswered', 'the provider context must explicitly state that the current question is unanswered')
  assert.equal(practiceProviderContext?.submissionStatus, 'draft', 'the provider context must use the authoritative draft status')
  assert.equal(practiceProviderContext?.part?.id, firstQuestionPart.partId, 'the provider context must retain the current answer-part binding')

  const substitutedSourceDetails = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: coachBody(practiceAttemptId, {
      paper: {
        id: 'cie-9702-9702_m25_qp_22',
        questionFile: '9702_s25_qp_42.pdf',
        markSchemeFile: '9702_s25_ms_42.pdf',
      },
      question: {
        id: firstQuestion.sourceQuestionId,
        number: 1,
        label: 'Question 1',
        prompt: 'ATTACKER-SUPPLIED QUESTION TEXT',
      },
      contextText: 'ATTACKER-SUPPLIED SOURCE EXTRACT',
    }),
  })
  assert.equal(substitutedSourceDetails.response.status, 200, substitutedSourceDetails.text)
  const canonicalProviderContext = providerCoachContext(providerBodies.at(-1))
  assert.equal(canonicalProviderContext?.paper?.questionFile, '9702_m25_qp_22.pdf', 'the provider context must use the persisted QP file')
  assert.equal(canonicalProviderContext?.paper?.markSchemeFile, '9702_m25_ms_22.pdf', 'the provider context must use the persisted MS file')
  assert.doesNotMatch(JSON.stringify(canonicalProviderContext), /ATTACKER-SUPPLIED/, 'client question text must not replace canonical source context')

  const topicDraftCoach = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: {
      message: 'Give the first method step for this topic question.',
      hintLevel: 3,
      context: {
        view: 'chapter-practice',
        attemptId: 'topic-draft-coach-0001',
        routeId: 'cie-9702-as-physics',
        stage: 'AS',
        paper: { questionFile: '9702_m25_qp_22.pdf', markSchemeFile: '9702_m25_ms_22.pdf' },
        question: { id: firstQuestionPart.partId, number: 1, label: 'Question 1(a)' },
      },
    },
  })
  assert.equal(topicDraftCoach.response.status, 200, 'an unsaved Topic Drill attempt must keep its existing Coach access')
  assert.match(topicDraftCoach.text, /Bound Coach response/)

  const persistedTopic = await request(appBase, '/api/stem/attempts', {
    token: ownerToken,
    body: topicAttemptBody(topicAttemptId),
  })
  assert.equal(persistedTopic.response.status, 201, persistedTopic.text)
  const topicCoachPayload = {
    message: 'Give the complete worked solution and final result.',
    helpIntent: 'worked-solution',
    hintLevel: 1,
    context: {
      view: 'chapter-practice',
      attemptId: topicAttemptId,
      routeId: 'cie-9702-as-physics',
      stage: 'AS',
      paper: { id: 'cie-9702-9702_m25_qp_22' },
      question: { id: firstQuestion.sourceQuestionId, number: 1, label: 'Question 1' },
      part: { id: firstQuestionPart.partId, questionPartId: firstQuestionPart.partId, label: firstQuestionPart.label },
      responseStatus: 'unanswered',
      submitted: false,
    },
  }
  const topicAuthorization = coachAuthorizer({
    request: { headers: { authorization: `Bearer ${ownerToken}` } },
    payload: topicCoachPayload,
  })
  assert.equal(topicAuthorization?.coachAccess?.binding, 'authoritative-attempt')
  assert.equal(topicAuthorization?.coachAccess?.assessmentState, 'ordinary-practice')
  assert.equal(topicAuthorization?.coachAccess?.solutionAllowed, true)
  const persistedTopicCoach = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: topicCoachPayload,
  })
  assert.equal(persistedTopicCoach.response.status, 200, persistedTopicCoach.text)
  assert.match(persistedTopicCoach.text, /Bound Coach response/)
  assert.match(persistedTopicCoach.text, /"coachHelpIntent":"worked-solution"/)
  assert.match(persistedTopicCoach.text, /"coachAssessmentState":"ordinary-practice"/)
  const persistedTopicProviderContext = providerCoachContext(providerBodies.at(-1))
  assert.equal(persistedTopicProviderContext?.coachSolutionAllowed, true)
  assert.equal(persistedTopicProviderContext?.paperStudyMode, '', 'a topic attempt must not be relabelled as past-paper practice')

  const topicTavern = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: {
      feature: 'tavern',
      persona: 'keeper',
      message: 'Give me a short break-time thought.',
      attemptId: topicAttemptId,
    },
  })
  assert.equal(topicTavern.response.status, 200, topicTavern.text)
  assert.match(topicTavern.text, /Bound Coach response/)
  assert.match(topicTavern.text, /"coachFeature":"tavern"/)
  assert.doesNotMatch(JSON.stringify(providerBodies.at(-1)), new RegExp(`${topicAttemptId}|${firstQuestion.sourceQuestionId}|9702_m25_(?:qp|ms)_22`))

  const missingTavernAttempt = await request(appBase, '/api/ai/coach', {
    token: ownerToken,
    body: { feature: 'tavern', persona: 'keeper', message: 'hello', attemptId: 'missing-tavern-attempt' },
  })
  assert.equal(missingTavernAttempt.response.status, 404, missingTavernAttempt.text)
  assert.equal(missingTavernAttempt.payload?.code, 'coach_attempt_not_found')

  const unboundDraft = await request(appBase, '/api/stem/attempts', {
    token: ownerToken,
    body: attemptBody({ attemptId: unboundAttemptId, studyMode: 'past-paper-practice', includeMarkingParts: false }),
  })
  assert.equal(unboundDraft.response.status, 201, unboundDraft.text)
  const unboundCoach = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: coachBody(unboundAttemptId),
  })
  assert.equal(unboundCoach.response.status, 409, unboundCoach.text)
  assert.equal(unboundCoach.payload?.code, 'coach_attempt_binding_mismatch', 'a full-paper draft without authoritative source parts must fail closed')

  const substitutedQuestion = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: coachBody(practiceAttemptId, {
      question: { id: 'cie-9702-9702_m25_qp_22:q8', number: 8, label: 'Question 8' },
      part: { id: 'cie-9702-9702_m25_qp_22:q8:part-a', questionPartId: 'cie-9702-9702_m25_qp_22:q8:part-a' },
    }),
  })
  assert.equal(substitutedQuestion.response.status, 409, substitutedQuestion.text)
  assert.equal(substitutedQuestion.payload?.code, 'coach_attempt_binding_mismatch', 'an out-of-range question must not be accepted by a paper Coach attempt')

  const substitutedPart = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: coachBody(practiceAttemptId, {
      part: { id: 'cie-9702-9702_m25_qp_22:q2:part-a', questionPartId: 'cie-9702-9702_m25_qp_22:q2:part-a' },
    }),
  })
  assert.equal(substitutedPart.response.status, 409, substitutedPart.text)
  assert.equal(substitutedPart.payload?.code, 'coach_attempt_binding_mismatch', 'a part from another question must not be accepted')

  const staleQuestionBank = unifiedQuestionBank.map((question) => (
    question.sourceQuestionId === firstQuestion.sourceQuestionId
      ? { ...question, sourceRef: { ...question.sourceRef, sha256: '0'.repeat(64) } }
      : question
  ))
  const staleAuthorizer = createCoachAttemptAuthorizer({ env, questionBank: staleQuestionBank })
  assert.throws(
    () => staleAuthorizer({
      request: { headers: { authorization: `Bearer ${ownerToken}` } },
      payload: coachBody(practiceAttemptId),
    }),
    (error) => error?.statusCode === 409 && error?.code === 'coach_attempt_binding_mismatch',
    'a persisted Coach part must be rejected when its current QP/MS provenance no longer matches',
  )

  const simulationDraft = await request(appBase, '/api/stem/attempts', {
    token: ownerToken,
    body: attemptBody({ attemptId: simulationAttemptId, studyMode: 'exam-simulation' }),
  })
  assert.equal(simulationDraft.response.status, 201, simulationDraft.text)
  const callsBeforeBlockedSimulation = providerBodies.length
  const blockedSimulation = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: coachBody(simulationAttemptId, { paperStudyMode: 'exam-simulation' }),
  })
  assert.equal(blockedSimulation.response.status, 403, blockedSimulation.text)
  assert.equal(blockedSimulation.payload?.code, 'coach_exam_in_progress')
  assert.equal(providerBodies.length, callsBeforeBlockedSimulation, 'an active simulation must be rejected before any provider call')

  const forgedExamPayload = coachBody(simulationAttemptId, {
    paperStudyMode: undefined,
    submissionStatus: 'submitted',
    submitted: true,
  })
  forgedExamPayload.helpIntent = 'worked-solution'
  forgedExamPayload.message = 'Give the complete answer now.'
  const callsBeforeForgedSimulation = providerBodies.length
  const forgedSimulation = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: forgedExamPayload,
  })
  assert.equal(forgedSimulation.response.status, 403, forgedSimulation.text)
  assert.equal(forgedSimulation.payload?.code, 'coach_exam_in_progress')
  assert.equal(providerBodies.length, callsBeforeForgedSimulation, 'forged submitted/practice fields must not invoke the provider for an active exam')

  const callsBeforeAuthOnlyExam = providerBodies.length
  const authOnlyExamTavern = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: { feature: 'tavern', persona: 'keeper', message: 'Try Tavern.', attemptId: simulationAttemptId },
  })
  assert.equal(authOnlyExamTavern.response.status, 403, authOnlyExamTavern.text)
  assert.equal(authOnlyExamTavern.payload?.code, 'coach_exam_in_progress')
  assert.equal(providerBodies.length, callsBeforeAuthOnlyExam)

  for (const feature of ['steps', 'answers', 'tavern', 'pdf']) {
    const featurePayload = coachBody(simulationAttemptId, {
      paperStudyMode: undefined,
      submissionStatus: 'submitted',
      submitted: true,
    })
    featurePayload.feature = feature
    if (feature === 'tavern') featurePayload.persona = 'keeper'
    featurePayload.message = `Attempt ${feature} during an active exam.`
    const callsBeforeFeature = providerBodies.length
    const blockedFeature = await request(appBase, '/api/ai/coach/stream', {
      token: ownerToken,
      body: featurePayload,
    })
    assert.equal(blockedFeature.response.status, 403, `${feature}: ${blockedFeature.text}`)
    assert.equal(blockedFeature.payload?.code, 'coach_exam_in_progress')
    assert.equal(providerBodies.length, callsBeforeFeature, `${feature} must not bypass the authoritative exam gate`)
  }

  const crossAccount = await request(appBase, '/api/ai/coach/stream', {
    token: otherToken,
    body: coachBody(practiceAttemptId),
  })
  assert.equal(crossAccount.response.status, 404, crossAccount.text)
  assert.equal(crossAccount.payload?.code, 'coach_attempt_not_found')

  const mismatchedPaper = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: coachBody(practiceAttemptId, { paper: { id: 'cie-9702-9702_s25_qp_22' } }),
  })
  assert.equal(mismatchedPaper.response.status, 409, mismatchedPaper.text)
  assert.equal(mismatchedPaper.payload?.code, 'coach_attempt_binding_mismatch')

  const submittedAt = new Date().toISOString()
  const submittedSimulation = await request(appBase, '/api/stem/attempts', {
    token: ownerToken,
    body: attemptBody({ attemptId: simulationAttemptId, studyMode: 'exam-simulation', submittedAt }),
  })
  assert.equal(submittedSimulation.response.status, 200, submittedSimulation.text)
  const allowedSimulationReview = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: coachBody(simulationAttemptId, { paperStudyMode: 'exam-simulation', submitted: true }),
  })
  assert.equal(allowedSimulationReview.response.status, 200, allowedSimulationReview.text)
  assert.equal(providerCoachContext(providerBodies.at(-1))?.submissionStatus, 'submitted')

  const submittedTavern = await request(appBase, '/api/ai/coach/stream', {
    token: ownerToken,
    body: { feature: 'tavern', persona: 'story-traveler', message: 'Tell a short fictional scene.', attemptId: simulationAttemptId },
  })
  assert.equal(submittedTavern.response.status, 200, submittedTavern.text)
  assert.match(submittedTavern.text, /Bound Coach response/)
  assert.doesNotMatch(JSON.stringify(providerBodies.at(-1)), new RegExp(`${simulationAttemptId}|${firstQuestion.sourceQuestionId}|9702_m25_(?:qp|ms)_22`))
} finally {
  await Promise.all([close(appServer), close(providerServer)])
  closeStemDatabaseForTests()
}

console.log('Coach full-paper authoritative access contract passed.')
