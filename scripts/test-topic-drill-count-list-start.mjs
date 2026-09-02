import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { isHumanReviewedPastPaperItem, isStudentReleasedAiStudyItem, studyQuestionBank } from '../src/data/questionBank.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { routeById } from '../src/data/routeRegistry.js'
import { syllabusPracticeComponentsForRoute } from '../src/lib/syllabusPracticeRoutes.js'
import { MIN_QUESTION_GROUPS_PER_TEST, MIN_VERIFIED_GROUPS_FOR_PRACTICE } from '../src/lib/practiceConstants.js'
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
    && question.sourceQuestionId === 'cie-0580-0580_m25_qp_12:q1'
    && isHumanReviewedPastPaperItem(question)
  ))
  assert.ok(reviewedQuestion, 'the reviewed 0580 M25/12 Q5 fixture must exist')

  // Use twelve real manifest-bound groups from one canonical syllabus topic.
  // A mixed-topic request must not satisfy one topic's floor with another
  // topic's questions.
  const numberTopic = syllabusTopicsInventory({
    routeId: reviewedQuestion.routeId,
    questionBank: studyQuestionBank,
    includeStudyOnly: false,
  }).topics.find((topic) => topic.id === '0580-igcse-topic-01')
  const numberIds = numberTopic?.questionIdsByComponent?.['1']?.verifiedQuestionIds || []
  const reviewedQuestions = [
    ...numberIds
      .map((sourceQuestionId) => studyQuestionBank.find((question) => question.sourceQuestionId === sourceQuestionId))
      .filter((question) => question && isHumanReviewedPastPaperItem(question))
      .slice(0, MIN_VERIFIED_GROUPS_FOR_PRACTICE),
  ]
  assert.equal(reviewedQuestions.length, MIN_VERIFIED_GROUPS_FOR_PRACTICE, 'the precedence fixture must contain twelve real reviewed question groups')

  const aiShadow = releasedAiShadowOfReviewedQuestion(reviewedQuestions[0])
  assert.equal(isStudentReleasedAiStudyItem(aiShadow), true, 'the shadow must pass the runtime released-study gate')

  const api = createStemApi({
    env: { NODE_ENV: 'test', STEM_DB_PATH: ':memory:' },
    questionBank: reviewedQuestions,
    topicQuestionBankProvider: () => [aiShadow],
  })
  try {
    const practice = await call(api, {
      method: 'POST',
      url: '/api/stem/practice-sets',
      body: {
        routeId: reviewedQuestion.routeId,
        syllabusTopicIds: ['0580-igcse-topic-01'],
        components: [1],
        questionCount: 6,
        sourceQuestionIds: reviewedQuestions.map((question) => question.sourceQuestionId),
        excludeAttempted: false,
      },
    })
    assert.equal(practice.statusCode, 201)
    assert.equal(practice.payload.practiceMode, 'verified')
    assert.equal(practice.payload.verifiedAvailableCount, MIN_VERIFIED_GROUPS_FOR_PRACTICE)
    const questionGroup = practice.payload.questionGroups.find((group) => group.id === reviewedQuestion.sourceQuestionId)
    assert.ok(questionGroup, 'the selected reviewed source group must be present')
    assert.equal(questionGroup.reviewStatus, 'reviewed', 'a coordinate-only release must not replace the matching human-reviewed question')
    assert.equal(questionGroup.sourceRef.sha256, reviewedQuestion.sourceRef.sha256, 'the selected group must retain the reviewed QP binding')
    assert.equal(questionGroup.answerRef.sha256, reviewedQuestion.answerRef.sha256, 'the selected group must retain the reviewed MS binding')
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
          questionCount: MIN_QUESTION_GROUPS_PER_TEST,
          sourceQuestionIds: startCandidate.ids,
          excludeAttempted: false,
          seed: 9709,
        },
      })
      if (startCandidate.ids.length >= MIN_QUESTION_GROUPS_PER_TEST) {
        assert.equal(practice.statusCode, 201, `${routeId} count/list evidence with six groups must start successfully`)
        assert.equal(practice.payload.questionCount, MIN_QUESTION_GROUPS_PER_TEST)
        assert.deepEqual(practice.payload.sourceQuestionIds, startCandidate.ids)
        assert.ok(
          practice.payload.questionGroups.every((group) => group.paperComponent === startCandidate.component),
          `${routeId} start must use the same component predicate as inventory count/list`,
        )
        const componentCounts = startCandidate.topic.componentCounts?.[startCandidate.component] || {}
        const componentVerifiedCount = Number(componentCounts.verifiedQuestionCount || 0)
        const componentStudyCount = Number(componentCounts.studyQuestionCount || 0)
        if (componentVerifiedCount < MIN_VERIFIED_GROUPS_FOR_PRACTICE && componentStudyCount > 0) {
          assert.equal(practice.payload.practiceMode, 'study-only', `${routeId} limited source sets must be labelled study-only`)
          assert.ok(
            practice.payload.questionGroups.every((group) => group.formalProgressEligible === false),
            `${routeId} study-only sets must not expose formal progress eligibility`,
          )
        } else if (componentVerifiedCount < MIN_VERIFIED_GROUPS_FOR_PRACTICE) {
          assert.equal(practice.statusCode, 409, `${routeId} reviewed-only sets below the two-test floor must fail closed`)
          assert.equal(practice.payload.code, 'insufficient_verified_questions')
        }
      } else {
        assert.equal(practice.statusCode, 409, `${routeId} count/list evidence below six groups must not start`)
        assert.equal(practice.payload.code, 'insufficient_verified_questions')
      }
    }

    const p5Attempt = await call(api, {
      method: 'POST',
      url: '/api/stem/practice-sets',
      body: {
        routeId: 'cie-9702-a2-physics',
        syllabusTopicIds: ['physics-9702-topic-13'],
        components: [5],
        questionCount: 6,
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
