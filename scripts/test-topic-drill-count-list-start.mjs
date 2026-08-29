import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { isStudentReleasedAiStudyItem, studyQuestionBank } from '../src/data/questionBank.js'
import { routeById } from '../src/data/routeRegistry.js'
import { syllabusPracticeComponentsForRoute } from '../src/lib/syllabusPracticeRoutes.js'
import { buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const routeIds = [
  'cie-0580-igcse-mathematics',
  'cie-0625-igcse-physics',
  'cie-9702-a2-physics',
  'cie-9709-as-p1-p2',
  'cie-9709-as-p1-p4',
  'cie-9709-as-p1-p5',
  'cie-9709-a2-after-p1-p5-p3-p4',
  'cie-9709-a2-after-p1-p5-p3-p6',
  'cie-9709-a2-after-p1-p4-p3-p5',
]

function call(api, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [])
    request.method = method
    request.url = url
    request.headers = body ? { 'content-type': 'application/json' } : {}
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value },
      end(value = '') {
        const text = String(value || '')
        resolve({ statusCode: this.statusCode, payload: text ? JSON.parse(text) : null })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

function idsForTopicComponent(topic, component) {
  const ids = topic.questionIdsByComponent?.[component] || {}
  return [...new Set([...(ids.verifiedQuestionIds || []), ...(ids.studyQuestionIds || [])])]
}

function releasedAiShadowOfReviewedQuestion(question) {
  const artifactId = `sha256:${'a'.repeat(64)}`
  const source = {
    questionPdfSha256: question.sourceRef.sha256,
    markSchemePdfSha256: question.answerRef.sha256,
  }
  const extractor = {
    provider: 'test-extractor',
    model: 'test-model',
    schemaName: 'ai_pdf_question_extraction_v1',
  }
  const verifier = {
    provider: 'test-verifier',
    model: 'test-model',
    schemaName: 'ai_pdf_question_verification_v1',
  }
  const candidate = { questions: [{ questionNumber: '5' }] }
  const verification = { questions: [{ questionNumber: '5' }] }
  const studentRelease = buildAiStudentStudyRelease({
    artifactId,
    routeId: question.routeId,
    status: 'ai-verified',
    source,
    extractor,
    verifier,
    candidate,
    verification,
  })
  const parts = question.parts.map((part, index) => ({
    ...part,
    sourceFocus: null,
    questionDeclaredMarks: Number(part.marks),
    sourceEvidence: [{
      page: Number(part.sourcePage),
      documentSha256: question.sourceRef.sha256,
      coordinateSpace: 'normalized-xyxy',
      region: [0.1, 0.1 + index * 0.2, 0.9, 0.25 + index * 0.2],
      imageSize: [1020, 1320],
    }],
    markSchemeEvidence: [{
      page: Number(part.answerSourcePage),
      pageImageSha256: 'b'.repeat(64),
    }],
  }))
  return {
    ...question,
    parts,
    answerBinding: {
      ...question.answerBinding,
      verificationStatus: 'ai-verified',
      artifactId,
      questionDocumentSha256: question.sourceRef.sha256,
      answerDocumentSha256: question.answerRef.sha256,
    },
    sourceContent: {
      schemaVersion: 'ai-verified-coordinate-source-v1',
      complete: true,
      fileComplete: true,
      semanticStatus: 'ai-verified',
      reasons: [],
      sourcePages: [...new Set(parts.map((part) => Number(part.sourcePage)))],
      sourcePageStart: Number(parts[0]?.sourcePage),
      sourcePageEnd: Number(parts.at(-1)?.sourcePage),
      assetUrls: [],
      assetPages: [],
      bindingSignature: `ai:${artifactId}:${question.routeId}:5`,
      audit: {
        complete: true,
        fileComplete: true,
        semanticStatus: 'ai-verified',
        reasons: [],
        bindingSignature: `ai:${artifactId}:${question.routeId}:5`,
      },
    },
    studentStudyEligible: true,
    formalProgressEligible: false,
    studentRelease,
  }
}

async function verifyReviewedSourcePrecedence() {
  const reviewedQuestion = studyQuestionBank.find((question) => (
    question.routeId === 'cie-0580-igcse-mathematics'
    && question.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q5'
  ))
  assert.ok(reviewedQuestion, 'the reviewed 0580 M25/12 Q5 fixture must exist')
  assert.ok(reviewedQuestion.parts.every((part) => part.sourceFocus?.pages?.length), 'the reviewed fixture must expose its approved focus bounds')

  const aiShadow = releasedAiShadowOfReviewedQuestion(reviewedQuestion)
  assert.equal(isStudentReleasedAiStudyItem(aiShadow), true, 'the shadow must pass the runtime released-study gate')

  const api = createStemApi({
    env: { NODE_ENV: 'test', STEM_DB_PATH: ':memory:' },
    questionBank: [reviewedQuestion],
    topicQuestionBankProvider: () => [aiShadow],
  })
  try {
    const practice = await call(api, {
      method: 'POST',
      url: '/api/stem/practice-sets',
      body: {
        routeId: reviewedQuestion.routeId,
        syllabusTopicIds: ['math-0580-geometry'],
        components: [1],
        questionCount: 1,
        sourceQuestionIds: [reviewedQuestion.sourceQuestionId],
        excludeAttempted: false,
      },
    })
    assert.equal(practice.statusCode, 201)
    const questionGroup = practice.payload.questionGroups[0]
    assert.equal(questionGroup.reviewStatus, 'reviewed', 'a coordinate-only release must not replace the matching human-reviewed question')
    assert.ok(questionGroup.parts.every((part) => part.sourceFocus?.pages?.length), 'the student route must retain the human-reviewed source crop')
  } finally {
    closeStemDatabaseForTests()
  }
}

async function verifyStudyCountListStart() {
  const api = createStemApi({
    env: {
      NODE_ENV: 'test',
      STEM_DB_PATH: ':memory:',
      STEM_ENABLE_STUDY_ONLY_TOPIC_DRILL: '1',
    },
  })
  try {
    for (const routeId of routeIds) {
      const response = await call(api, { method: 'GET', url: `/api/stem/routes/${encodeURIComponent(routeId)}/syllabus-topics` })
      assert.equal(response.statusCode, 200)
      const inventory = response.payload
      const route = routeById(routeId)
      const practiceComponents = syllabusPracticeComponentsForRoute(routeId)
      assert.deepEqual(
        inventory.topics.map((topic) => topic.id),
        route.syllabus.topics.map((topic) => topic.id),
        `${routeId} inventory must preserve the official syllabus topic order and identity`,
      )
      assert.deepEqual(
        inventory.assessmentComponents.map((item) => item.component),
        practiceComponents,
        `${routeId} inventory must advertise only route-eligible Topic Drill components`,
      )
      const allAvailableIds = new Set()
      let startCandidate = null
      for (const topic of inventory.topics) {
        for (const component of inventory.assessmentComponents.map((item) => item.component)) {
          const ids = idsForTopicComponent(topic, component)
          ids.forEach((id) => allAvailableIds.add(id))
          assert.equal(
            ids.length,
            Number(topic.componentCounts?.[component]?.availableQuestionCount || 0),
            `${routeId}/${topic.id}/P${component} count must equal its startable source ID list`,
          )
          if (ids.length > (startCandidate?.ids.length || 0)) {
            startCandidate = { topic, component, ids: ids.slice(0, 6) }
          }
        }
      }
      assert.equal(inventory.availableQuestionGroupCount, allAvailableIds.size, `${routeId} top-level count must be distinct across multi-topic membership`)
      assert.ok(startCandidate, `${routeId} needs at least one evidence-backed study question for this regression`)

      const practice = await call(api, {
        method: 'POST',
        url: '/api/stem/practice-sets',
        body: {
          routeId,
          syllabusTopicIds: [startCandidate.topic.id],
          components: [startCandidate.component],
          questionCount: startCandidate.ids.length,
          sourceQuestionIds: startCandidate.ids,
          excludeAttempted: false,
          seed: 9709,
        },
      })
      assert.equal(practice.statusCode, 201, `${routeId} count/list evidence must start successfully`)
      assert.equal(practice.payload.questionCount, startCandidate.ids.length)
      assert.deepEqual(practice.payload.sourceQuestionIds, startCandidate.ids)
      assert.ok(
        practice.payload.questionGroups.every((group) => group.paperComponent === startCandidate.component),
        `${routeId} start must use the same component predicate as inventory count/list`,
      )
    }

    const p5Attempt = await call(api, {
      method: 'POST',
      url: '/api/stem/practice-sets',
      body: {
        routeId: 'cie-9702-a2-physics',
        syllabusTopicIds: ['physics-9702-topic-13'],
        components: [5],
        questionCount: 1,
        excludeAttempted: false,
        seed: 9702,
      },
    })
    assert.equal(p5Attempt.statusCode, 400, 'A2 Physics Paper 5 must not start through Topic Drill')
    assert.equal(p5Attempt.payload.code, 'invalid_paper_component')
  } finally {
    closeStemDatabaseForTests()
  }
}

async function verifyProductionGate() {
  const api = createStemApi({ env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' } })
  try {
    for (const routeId of routeIds) {
      const response = await call(api, { method: 'GET', url: `/api/stem/routes/${encodeURIComponent(routeId)}/syllabus-topics` })
      assert.equal(response.statusCode, 200)
      assert.equal(response.payload.studyQuestionGroupCount, 0)
      assert.equal(response.payload.availableQuestionGroupCount, response.payload.verifiedQuestionGroupCount)
      assert.ok(response.payload.topics.every((topic) => topic.studyQuestionCount === 0))
    }
  } finally {
    closeStemDatabaseForTests()
  }
}

await verifyStudyCountListStart()
await verifyReviewedSourcePrecedence()
await verifyProductionGate()

console.log(JSON.stringify({ status: 'passed', scope: 'topic-drill-count-list-start', routes: routeIds.length }))
