import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'

import { canonicalMarkingCapabilityRequest, verifyMarkingCapability } from '../server/markingCapability.js'
import { createAiVerifiedQuestionBankLoader, questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { createNativeQuestionImages } from '../server/nativeQuestionImages.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { buildSyllabusPracticeSet } from '../src/lib/syllabusPractice.js'
import {
  TRANSFORMATIONS_BINDING_V2_MANIFEST,
  TRANSFORMATIONS_BINDING_V2_EVIDENCE_ROOT,
  TRANSFORMATIONS_BINDING_V2_OUTPUT_ROOT,
} from './prepare-chapter-ready-0580-transformations-binding-v2.mjs'

const miniRoot = 'D:/CodexWork/stemist-miniprogram'
const miniClient = path.join(miniRoot, 'utils/nativePractice.js')
const expectedMiniClientSha256 = '0d6d5d7f3f97142253a5a1ccd133bdbede4cb827697578c467c9569738d1b2ca'
const libraryRoot = 'D:/CodexWork/cie-fraft-fetcher/output/pdf'
const signingKey = 'written-binding-mini-compatibility-test-key'

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function token(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    username: `mini-${userId}`,
    iat: now,
    exp: now + 300,
  })).toString('base64url')
  return `${header}.${payload}.${crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')}`
}

function call(api, { method, url, body, bearer = '' }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [])
    request.method = method
    request.url = url
    request.headers = {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    }
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
      writeHead(statusCode) { this.statusCode = statusCode },
      end(raw = '') {
        const text = String(raw || '')
        resolve({ statusCode: this.statusCode, payload: text ? JSON.parse(text) : null })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

function withoutV2EvidenceFields(provenance) {
  const value = structuredClone(provenance)
  delete value.sourceEvidence.partEvidenceSchemaVersion
  delete value.sourceEvidence.partLabel
  delete value.sourceEvidence.markSchemeRegion
  return value
}

assert.equal(sha256File(miniClient), expectedMiniClientSha256, 'Mini 1.0.33 consumer changed; refresh this compatibility fixture before relying on it')
const { miniRuntime } = await import(pathToFileURL(path.join(miniRoot, 'scripts/helpers/mini-runtime.mjs')).href)
const manifest = JSON.parse(fs.readFileSync(path.resolve(TRANSFORMATIONS_BINDING_V2_EVIDENCE_ROOT, TRANSFORMATIONS_BINDING_V2_MANIFEST), 'utf8'))
const artifacts = manifest.outputs.map((output) => JSON.parse(fs.readFileSync(output.artifact, 'utf8')))
const groups = questionGroupsFromAiArtifacts(artifacts, { libraryRoot })
assert.equal(groups.length, 6)
assert.equal(createAiVerifiedQuestionBankLoader({ artifactRoot: path.resolve(TRANSFORMATIONS_BINDING_V2_OUTPUT_ROOT), libraryRoot })().groups.length, 0)

const localStudyGroups = groups.map((group) => ({ ...group, studentStudyEligible: true }))
const practiceSet = buildSyllabusPracticeSet({
  routeId: 'cie-0580-igcse-mathematics',
  syllabusTopicIds: ['0580-igcse-topic-07'],
  questionCount: 6,
  studyMode: 'chapter-study',
  components: [1, 2, 3, 4],
  questionBank: localStudyGroups,
  includeStudyOnly: true,
  excludeAttempted: false,
  seed: 1,
})
practiceSet.questionGroups = practiceSet.questionGroups.map((group) => ({ ...group, studentStudyEligible: true }))
const nativeImages = createNativeQuestionImages({
  getQuestionBank: () => localStudyGroups,
  libraryRoot,
  isReleased: () => true,
})
const projected = nativeImages.projectSet(practiceSet, { view: 'region' })
const spec = {
  routeId: 'cie-0580-igcse-mathematics',
  stage: 'IGCSE',
  subjectCode: '0580',
  components: [1, 2, 3, 4],
  syllabusTopicIds: ['0580-igcse-topic-07'],
  questionCount: 6,
  studyMode: 'chapter-study',
  sourcePreference: 'official-first',
}
const runtime = miniRuntime()
runtime.storage.set('stemistUser', { id: 'ielts:301' })
runtime.storage.set('stemistSessionToken', token(301))
const mini = runtime.load('utils/nativePractice')
const session = mini.createSession(projected, spec)
const q19 = session.questions.find((question) => question.id === 'cie-0580-0580_w25_qp_12:q19')
const q19c = q19.parts.find((part) => part.label === 'c')
assert.equal(q19c.canMark, true)
assert.equal(q19c.provenance.sourceEvidence.partLabel, 'c', 'unchanged Mini 1.0.33 must preserve exact provenance fields')
assert.equal(q19c.provenance.sourceEvidence.markSchemePage, 9)
assert.equal(JSON.stringify(q19c.provenance.sourceEvidence.markSchemeRegion), JSON.stringify([0.06, 0.1032, 0.94, 0.1897]))
assert.doesNotMatch(JSON.stringify(session), /answerKey|markSchemeEvidence|private answer summary/i)

const legacyProvenance = withoutV2EvidenceFields(q19c.provenance)
const mismatchedProvenance = structuredClone(legacyProvenance)
mismatchedProvenance.sourceEvidence.partLabel = 'a'
const directMismatch = canonicalMarkingCapabilityRequest({
  attemptId: 'mini-compat-direct-mismatch',
  mode: 'topic',
  submitted: true,
  paperId: q19.paperId,
  parts: [{ provenance: { ...mismatchedProvenance, routeId: session.routeId } }],
}, groups)
assert.equal(directMismatch.ok, false)
assert.equal(directMismatch.code, 'source_provenance_mismatch')

const api = createStemApi({
  env: {
    NODE_ENV: 'test',
    STEM_DB_PATH: ':memory:',
    STEM_IDENTITY_SIGNING_KEY: signingKey,
    STEM_MARKING_CAPABILITY_SIGNING_KEY: signingKey,
  },
  questionBank: groups,
  topicQuestionBankProvider: () => groups,
  libraryRoot,
})
const bearer = token(301)
const attemptId = 'mini-compat-written-q19c'
try {
  const attemptBody = {
    attemptId,
    mode: 'topic',
    routeId: session.routeId,
    stage: session.stage,
    paperId: q19.paperId,
    unitId: session.id,
    studyMode: 'chapter-study',
    sourcePreference: 'official-first',
    submittedAt: new Date().toISOString(),
    markingParts: [{ unitPartId: q19c.id, provenance: { ...legacyProvenance, routeId: session.routeId } }],
    attempt: {
      id: attemptId,
      routeId: session.routeId,
      stage: session.stage,
      unitId: session.id,
      studyMode: 'chapter-study',
      sourcePreference: 'official-first',
      attemptStatus: 'marking-pending',
      answers: {},
      evidence: { kind: 'photo', count: 1 },
    },
  }
  const saved = await call(api, { method: 'POST', url: '/api/stem/attempts', body: attemptBody, bearer })
  assert.equal(saved.statusCode, 201, JSON.stringify(saved.payload))
  assert.equal(saved.payload.attempt.attemptId, attemptId)
  const history = await call(api, { method: 'GET', url: '/api/stem/attempts', bearer })
  assert.equal(history.statusCode, 200, JSON.stringify(history.payload))
  const persisted = history.payload.attempts.find((attempt) => attempt.attemptId === attemptId)
  assert.equal(persisted.binding.parts[0].provenance.sourceEvidence.partLabel, 'c', 'server persistence must restore omitted exact evidence')
  assert.deepEqual(persisted.binding.parts[0].provenance.sourceEvidence.markSchemeRegion, [0.06, 0.1032, 0.94, 0.1897])

  const capabilities = await call(api, {
    method: 'POST',
    url: '/api/stem/marking/capabilities',
    bearer,
    body: {
      attemptId,
      mode: 'topic',
      submitted: true,
      paperId: q19.paperId,
      parts: [{ provenance: { ...legacyProvenance, routeId: session.routeId } }],
    },
  })
  assert.equal(capabilities.statusCode, 201, JSON.stringify(capabilities.payload))
  assert.equal(capabilities.payload.capabilities.length, 1)
  const markingGrant = capabilities.payload.capabilities[0].markingGrant
  assert.equal(typeof markingGrant, 'string')

  const verified = verifyMarkingCapability({
    request: { headers: { authorization: `Bearer ${bearer}` } },
    payload: {
      attemptId,
      mode: 'topic',
      submitted: true,
      paperId: q19.paperId,
      markingGrant,
      provenance: { ...legacyProvenance, routeId: session.routeId },
    },
    identitySigningKey: signingKey,
    capabilitySigningKey: signingKey,
  })
  assert.equal(verified.ok, true, JSON.stringify(verified))
  assert.equal(verified.claims.sourceEvidence.partLabel, 'c', 'server-signed grant must restore omitted exact evidence')
  assert.deepEqual(verified.claims.sourceEvidence.markSchemeRegion, [0.06, 0.1032, 0.94, 0.1897])

  const conflictingPayload = structuredClone(legacyProvenance)
  conflictingPayload.sourceEvidence.markSchemeRegion = [0, 0, 1, 1]
  const conflict = verifyMarkingCapability({
    request: { headers: { authorization: `Bearer ${bearer}` } },
    payload: {
      attemptId,
      mode: 'topic',
      submitted: true,
      paperId: q19.paperId,
      markingGrant,
      provenance: { ...conflictingPayload, routeId: session.routeId },
    },
    identitySigningKey: signingKey,
    capabilitySigningKey: signingKey,
  })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'marking_capability_mismatch')
} finally {
  closeStemDatabaseForTests()
}

console.log(JSON.stringify({
  status: 'pass',
  suite: 'written-binding-mini-1.0.33',
  miniClient,
  miniClientSha256: expectedMiniClientSha256,
  sourceQuestionId: q19.id,
  partId: q19c.id,
  omittedV2FieldsDerivedServerSide: true,
  suppliedV2MismatchRejected: true,
  providerCalls: 0,
}))
