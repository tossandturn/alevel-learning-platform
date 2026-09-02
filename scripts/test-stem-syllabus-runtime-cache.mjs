import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { studyQuestionBank } from '../src/data/questionBank.js'

function call(api, url) {
  return new Promise((resolve, reject) => {
    const request = Readable.from([])
    request.method = 'GET'
    request.url = url
    request.headers = {}
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
      end(value = '') {
        const text = String(value || '')
        resolve({ statusCode: this.statusCode, payload: text ? JSON.parse(text) : null })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled GET ${url}`)))).catch(reject)
  })
}

const routeId = 'cie-9702-a2-physics'
const sourceQuestions = studyQuestionBank.filter((question) => (
  question.routeId === routeId
  && Number(question.sourceRef?.component) === 4
))
assert.ok(sourceQuestions.length >= 2, 'the cache regression needs two route-valid P4 source records')

let syllabusMappingReads = 0
function trackedQuestion(source, suffix) {
  const sourceQuestionId = `${source.sourceQuestionId}:cache-${suffix}`
  const mapping = source.syllabusMapping
  const question = {
    ...source,
    sourceQuestionId,
    questionGroupId: sourceQuestionId,
    bankId: `${sourceQuestionId}@${routeId}`,
  }
  Object.defineProperty(question, 'syllabusMapping', {
    configurable: false,
    enumerable: true,
    get() {
      syllabusMappingReads += 1
      return mapping
    },
  })
  return Object.freeze(question)
}

const firstQuestion = trackedQuestion(sourceQuestions[0], 'first')
const secondQuestion = trackedQuestion(sourceQuestions[1], 'second')
let runtimeSnapshot = Object.freeze([firstQuestion])
let providerCalls = 0
let providerFailure = false
const api = createStemApi({
  env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' },
  questionBank: Object.freeze([]),
  topicQuestionBankProvider() {
    providerCalls += 1
    if (providerFailure) throw new Error('invalid runtime artifact')
    return runtimeSnapshot
  },
})

try {
  const url = `/api/stem/routes/${routeId}/syllabus-topics`
  const first = await call(api, url)
  assert.equal(first.statusCode, 200)
  const readsAfterFirstBuild = syllabusMappingReads
  assert.ok(readsAfterFirstBuild > 0, 'the first request must build the inventory from the runtime snapshot')

  const second = await call(api, url)
  assert.equal(second.statusCode, 200)
  assert.equal(providerCalls, 2, 'each request must still poll the runtime provider for artifact/source invalidation')
  assert.equal(
    syllabusMappingReads,
    readsAfterFirstBuild,
    'an unchanged immutable runtime snapshot must not be expanded and indexed again',
  )

  runtimeSnapshot = Object.freeze([secondQuestion])
  const refreshed = await call(api, url)
  assert.equal(refreshed.statusCode, 200)
  assert.ok(syllabusMappingReads > readsAfterFirstBuild, 'a new runtime snapshot identity must invalidate the inventory cache')
  assert.ok(
    refreshed.payload.topics.some((topic) => Object.values(topic.questionIdsByComponent || {})
      .some((component) => component.indexedQuestionIds?.includes(secondQuestion.sourceQuestionId))),
    'the refreshed inventory must expose the new route-bound question',
  )
  assert.ok(
    refreshed.payload.topics.every((topic) => Object.values(topic.questionIdsByComponent || {})
      .every((component) => !component.indexedQuestionIds?.includes(firstQuestion.sourceQuestionId))),
    'the refreshed inventory must evict the previous runtime snapshot',
  )

  providerFailure = true
  const failedClosed = await call(api, url)
  assert.equal(failedClosed.statusCode, 200)
  assert.ok(
    failedClosed.payload.topics.every((topic) => Object.values(topic.questionIdsByComponent || {})
      .every((component) => !component.indexedQuestionIds?.includes(secondQuestion.sourceQuestionId))),
    'an invalid runtime provider must fail closed instead of serving a stale cached snapshot',
  )
} finally {
  closeStemDatabaseForTests()
}

console.log(JSON.stringify({
  status: 'passed',
  scope: 'stem-syllabus-runtime-cache',
  providerCalls,
  syllabusMappingReads,
}))
