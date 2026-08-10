import assert from 'node:assert/strict'
import { paperQuestionMarkingMetadata } from '../src/data/questionBank.js'
import {
  buildSharedMarkingSubmission,
  paperSubmissionMarkingSummary,
  readSharedMarkingAvailability,
  sharedMarkingIsAvailable,
} from '../src/lib/paperMarking.js'

const paperId = 'cie-0580-0580_m25_qp_12'
const metadata = paperQuestionMarkingMetadata({ paperId, routeId: 'cie-0580-igcse-mathematics' })
const submission = buildSharedMarkingSubmission({
  attemptId: 'client-contract-fixture',
  routeId: 'cie-0580-igcse-mathematics',
  qualification: 'IGCSE',
  specificationVersion: 'cambridge-0580-2025-2027',
  paperId,
  responses: [20, 22, 24].map((questionNumber) => ({ questionNumber, typedText: 'fixture response', questionMetadata: metadata[questionNumber] })),
})

assert.equal(submission.ok, true)
assert.equal(submission.payload.routeId, 'cie-0580-igcse-mathematics')
assert.equal(submission.payload.qualification, 'IGCSE')
assert.equal(submission.payload.specificationVersion, 'cambridge-0580-2025-2027')
assert.equal(submission.payload.paperId, paperId)
assert.deepEqual(submission.missingQuestionNumbers, [])

const unreviewed = buildSharedMarkingSubmission({
  attemptId: 'client-unreviewed-fixture',
  routeId: 'cie-0580-igcse-mathematics',
  qualification: 'IGCSE',
  specificationVersion: 'cambridge-0580-2025-2027',
  paperId,
  responses: [{ questionNumber: 21, typedText: 'fixture response', questionMetadata: metadata[21] }],
})
assert.equal(unreviewed.ok, false)
assert.deepEqual(unreviewed.missingQuestionNumbers, [21])

const calls = []
const enabled = await readSharedMarkingAvailability({
  token: 'short-lived-token',
  origin: 'https://ieltsist.test',
  fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ enabled: true, modelConfigured: true, queueAvailable: true, authenticationRequired: false }), { status: 200 })
  },
})
assert.equal(calls[0].url, 'https://ieltsist.test/api/stem/marking/availability')
assert.equal(calls[0].options.credentials, 'include')
assert.equal(calls[0].options.headers['X-Stem-Identity'], 'short-lived-token')
assert.equal(sharedMarkingIsAvailable(enabled), true)

const unavailable = await readSharedMarkingAvailability({
  fetchImpl: async () => new Response(JSON.stringify({ enabled: false, modelConfigured: false, queueAvailable: false, authenticationRequired: false }), { status: 200 }),
})
assert.equal(sharedMarkingIsAvailable(unavailable), false)

const authRequired = await readSharedMarkingAvailability({
  fetchImpl: async () => new Response('{}', { status: 401 }),
})
assert.equal(authRequired.authenticationRequired, true)
assert.equal(sharedMarkingIsAvailable(authRequired), false)

assert.match(paperSubmissionMarkingSummary({ submitted: true, aiMarks: { 20: { status: 'failed', loginRequired: true } }, responseQuestionNumbers: [20] }).text, /Sign in with your IELTSist ID/)
assert.match(paperSubmissionMarkingSummary({ submitted: true, aiMarks: { 20: { status: 'failed', failureCode: 'service_unavailable' } }, responseQuestionNumbers: [20] }).text, /temporarily unavailable/)

console.log('STEM shared marking client contract checks passed.')
