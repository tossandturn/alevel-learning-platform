import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { Readable } from 'node:stream'

import { createAiVerifiedQuestionBankLoader, questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { routeById } from '../src/data/routeRegistry.js'
import { buildAiStudentStudyRelease, hasValidAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const artifactRoot = 'D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260909/target-0606-calculus-2025/artifacts'
const artifactPath = `${artifactRoot}/cie-0606-0606_w25_qp_21/54178c43ce1620805599299f7ba37601f164c08aa6c256c615032d888bdf240d--route-cie-0606-igcse-additional-mathematics--sel-f5faddf8ae8cecdc91935591.json`
const libraryRoot = 'D:/CodexWork/cie-fraft-fetcher/output/pdf'
const artifactSha256 = '072d56d6f3b8d410c503157424b2af49458908d96096ca63f6b97a6203beed7c'
const expectedNewIds = ['cie-0606-0606_w25_qp_21:q7', 'cie-0606-0606_w25_qp_21:q8', 'cie-0606-0606_w25_qp_21:q11']
const routeId = 'cie-0606-igcse-additional-mathematics'
const topicId = 'math-0606-calculus'

const sorted = (values) => [...values].sort()
const exactIds = (actual, expected, label) => assert.deepEqual(sorted(actual), sorted(expected), label)

function call(api, method, url, body) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [])
    Object.assign(request, { method, url, headers: body ? { 'content-type': 'application/json' } : {} })
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
      end(value = '') {
        try { resolve({ status: this.statusCode, body: value ? JSON.parse(String(value)) : null }) }
        catch (error) { reject(error) }
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

function releasedClone(artifact, mutateTags) {
  const clone = structuredClone(artifact)
  for (const question of clone.candidate.questions) mutateTags(question.tags)
  for (const question of clone.verification.questions) mutateTags(question.tags)
  clone.studentRelease = buildAiStudentStudyRelease({
    artifactId: clone.artifactId,
    routeId: clone.syllabusRouteId,
    status: clone.status,
    source: clone.source,
    extractor: clone.extractor,
    verifier: clone.verifier,
    candidate: clone.candidate,
    verification: clone.verification,
  })
  return clone
}

function idsForComponent(topic, component) {
  return [...new Set(topic.questionIdsByComponent?.[component]?.apiReadyQuestionIds || [])]
}

if (!fs.existsSync(artifactPath)) {
  console.log(JSON.stringify({ status: 'skipped', scope: '0606-frozen-consumer', reason: 'frozen local artifact is not present; self-contained route/loader regression still runs separately' }))
} else {
  const artifactBytes = fs.readFileSync(artifactPath)
  assert.equal(crypto.createHash('sha256').update(artifactBytes).digest('hex'), artifactSha256, 'frozen 0606 artifact hash drift')
  const artifact = JSON.parse(artifactBytes.toString('utf8'))
  const loaded = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })()
  exactIds(loaded.groups.map((group) => group.sourceQuestionId), expectedNewIds, 'real frozen loader must restore exactly three 0606 groups')
  assert.equal(loaded.documents.length, 2)
  assert.ok(loaded.groups.every((group) => group.studentStudyEligible === true && group.formalProgressEligible === false))
  assert.ok(loaded.groups.every((group) => group.syllabusMapping.syllabusPointIds.includes('math-0606-point-calculus-01')))

  const wrongPoint = releasedClone(artifact, (tags) => { tags.syllabusPointIds = ['math-0606-point-calculus-99'] })
  assert.equal(hasValidAiStudentStudyRelease(wrongPoint), true, 'wrong-point proof must pass the release signature before the syllabus gate rejects it')
  assert.equal(questionGroupsFromAiArtifacts([wrongPoint], { libraryRoot }).length, 0, 'a correctly re-signed artifact with an unknown 0606 point must fail closed')
  const wrongTopic = releasedClone(artifact, (tags) => { tags.primaryTopicId = 'math-0606-functions'; tags.secondaryTopicIds = [] })
  assert.equal(hasValidAiStudentStudyRelease(wrongTopic), true, 'wrong-topic proof must pass the release signature before the syllabus gate rejects it')
  assert.equal(questionGroupsFromAiArtifacts([wrongTopic], { libraryRoot }).length, 0, 'a correctly re-signed artifact with the Calculus point under the wrong topic must fail closed')

  const api = createStemApi({
    env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' },
    topicQuestionBankProvider: () => loaded.groups,
    libraryRoot,
  })
  try {
    const listed = await call(api, 'GET', `/api/stem/routes/${routeId}/syllabus-topics`)
    assert.equal(listed.status, 200)
    const calculus = listed.body.topics.find((topic) => topic.id === topicId)
    assert.ok(calculus)
    const p1Ids = idsForComponent(calculus, 1)
    const p2Ids = idsForComponent(calculus, 2)
    exactIds(p2Ids, expectedNewIds, 'P2 list must expose the three real materialized groups')
    assert.equal(p1Ids.length, 3);assert.equal(p2Ids.length, 3)
    const unionIds = [...p1Ids, ...p2Ids]
    assert.equal(new Set(unionIds).size, 6)
    assert.deepEqual({ available: calculus.availableQuestionCount, reviewed: calculus.verifiedQuestionCount, study: calculus.releasedStudyQuestionCount }, { available: 6, reviewed: 3, study: 3 })

    const start = (components, sourceQuestionIds, omitComponents = false) => call(api, 'POST', '/api/stem/practice-sets', {
      routeId,
      syllabusTopicIds: [topicId],
      ...(!omitComponents ? { components } : {}),
      questionCount: 6,
      sourceQuestionIds,
      excludeAttempted: false,
      seed: `0606-${components.join('-')}`,
    })
    const p1 = await start([1], p1Ids)
    const p2 = await start([2], p2Ids)
    const union = await start([1, 2], unionIds)
    const defaults = await start([1, 2], unionIds, true)
    assert.equal(p1.status, 409);assert.equal(p1.body.code, 'insufficient_verified_questions')
    assert.equal(p2.status, 409);assert.equal(p2.body.code, 'insufficient_verified_questions')
    for (const result of [union, defaults]) {
      assert.equal(result.status, 201)
      assert.equal(result.body.practiceMode, 'study-only')
      assert.equal(result.body.formalProgressEligible, false)
      exactIds(result.body.questionGroups.map((group) => group.id), unionIds, 'P1+P2 start must use the listed six groups')
      assert.ok(result.body.questionGroups.filter((group) => expectedNewIds.includes(group.id)).every((group) => group.formalProgressEligible === false))
    }
  } finally {
    closeStemDatabaseForTests()
  }
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex'), artifactSha256, 'consumer verification must not mutate the frozen artifact')
  assert.deepEqual(routeById(routeId).paperComponents, [1, 2])
  console.log(JSON.stringify({ status: 'passed', scope: '0606-frozen-consumer', groups: 3, documents: 2, p1: 3, p2: 3, union: 6, formalProgressEligible: false }))
}
