import assert from 'node:assert/strict'
import { paperQuestionMarkingMetadata } from '../src/data/questionBank.js'
import {
  buildSharedMarkingSubmission,
  paperSubmissionMarkingSummary,
  readSharedMarkingAvailability,
  sharedMarkingIsAvailable,
} from '../src/lib/paperMarking.js'

const paperId = 'cie-0580-0580_m25_qp_12'
const tuple = {
  routeId: 'cie-0580-igcse-mathematics',
  qualification: 'IGCSE',
  specificationVersion: 'cambridge-0580-2025-2027',
  paperId,
}
const metadata = paperQuestionMarkingMetadata({ paperId, routeId: tuple.routeId })
const questionNumbers = Object.keys(metadata).map(Number).sort((left, right) => left - right)
assert.deepEqual(questionNumbers, Array.from({ length: 26 }, (_, index) => index + 1))
assert.equal(Object.values(metadata).reduce((sum, question) => sum + question.maxMarks, 0), 80)
assert.equal(Object.values(metadata).flatMap((question) => question.parts).length, 46)
assert.match(metadata[22].expectedMarkPoints.map((point) => point.point).join(' '), /7\/15 \+ 1\/5/)
assert.doesNotMatch(metadata[22].expectedMarkPoints.map((point) => point.point).join(' '), /7\/15 \+ 1\/3/)

const fullPaper = buildSharedMarkingSubmission({
  attemptId: 'client-contract-fixture',
  organizationId: 'school-42',
  classroomId: 'class-12',
  assignmentId: 'assignment-0580-m25',
  ...tuple,
  submissionSuffix: 'batch-1',
  responses: questionNumbers.map((questionNumber) => ({ questionNumber, typedText: `fixture response ${questionNumber}`, questionMetadata: metadata[questionNumber] })),
})
assert.equal(fullPaper.ok, true)
assert.equal(fullPaper.payload.submissionId, 'stem-paper-client-contract-fixture-batch-1')
assert.deepEqual(
  [fullPaper.payload.organizationId, fullPaper.payload.classroomId, fullPaper.payload.assignmentId],
  ['school-42', 'class-12', 'assignment-0580-m25'],
  'paper AI marking must retain its organization, classroom and assignment authorization chain',
)
assert.deepEqual(fullPaper.missingQuestionNumbers, [])
assert.equal(fullPaper.payload.questions.length, 46)
assert.equal(fullPaper.payload.questions.reduce((sum, question) => sum + question.availableMarks, 0), 80)
assert.equal(new Set(fullPaper.payload.questions.map((question) => question.questionPartId)).size, 46)
assert.ok(fullPaper.payload.questions.every((question) => (
  question.sourceQuestionId
  && question.review?.status === 'approved'
  && question.reviewSchemaVersion === 'stem-source-review.v1'
  && question.reviewVersion
  && question.sourceEvidence?.assetId
  && Number.isInteger(question.sourceEvidence?.page)
)), 'every shared marking question must carry the manifest-v2 reviewed-source provenance tuple')

const q14Metadata = metadata[14]
const q14LoadedAssets = Object.fromEntries(q14Metadata.parts.map((part) => [
  part.id,
  {
    status: 'available',
    assets: [{
      status: 'available',
      assetUrl: part.markingProvenance.sourceEvidence.assetUrl,
      page: part.markingProvenance.sourceEvidence.page,
      sha256: part.markingProvenance.sourceEvidence.assetSha256,
      imageDataUrl: 'data:image/jpeg;base64,fixture',
    }],
  },
]))
const q14Paper = buildSharedMarkingSubmission({
  attemptId: 'cross-page-q14-client-contract',
  ...tuple,
  responses: [{ questionNumber: 14, typedText: 'cross-page response', questionMetadata: q14Metadata, questionAssetsByPart: q14LoadedAssets }],
})
assert.equal(q14Paper.ok, true)
const q14cPayload = q14Paper.payload.questions.find((question) => question.questionPartId.endsWith(':part-c'))
assert.deepEqual(q14cPayload.assets.map((asset) => [asset.sourceEvidence.page, asset.assetUrl, asset.checksum]), [[
  9,
  '/question-assets/cie-0580-0580_m25_qp_12/qp-09.jpg',
  `sha256:${q14Metadata.parts.find((part) => part.id.endsWith(':part-c')).markingProvenance.sourceEvidence.assetSha256}`,
]], 'full-paper Q14(c) must carry the exact page-9 URL and reviewed SHA, never page-8 assetUrls[0]')
assert.equal(q14cPayload.assets[0].imageDataUrl, 'data:image/jpeg;base64,fixture')
assert.deepEqual(q14cPayload.visualContext, { status: 'available', pages: [9] })

// This mirrors the student's screenshot: four handwritten top-level answers
// must queue all of Q1-Q4's eight reviewed parts, rather than fall back to self-marking.
const screenshotPath = buildSharedMarkingSubmission({
  attemptId: 'screenshot-q1-q4',
  ...tuple,
  responses: [1, 2, 3, 4].map((questionNumber) => ({ questionNumber, typedText: 'handwritten response transcription', questionMetadata: metadata[questionNumber] })),
})
assert.equal(screenshotPath.ok, true)
assert.deepEqual(screenshotPath.missingQuestionNumbers, [])
assert.equal(screenshotPath.payload.questions.length, 8)
assert.equal(screenshotPath.payload.questions.reduce((sum, question) => sum + question.availableMarks, 0), 9)
assert.deepEqual(screenshotPath.payload.questions.map((question) => question.questionPartId), [
  'cie-0580-0580_m25_qp_12:q1:part-a',
  'cie-0580-0580_m25_qp_12:q2:part-a',
  'cie-0580-0580_m25_qp_12:q2:part-b',
  'cie-0580-0580_m25_qp_12:q2:part-c',
  'cie-0580-0580_m25_qp_12:q3:part-a',
  'cie-0580-0580_m25_qp_12:q4:part-a',
  'cie-0580-0580_m25_qp_12:q4:part-b',
  'cie-0580-0580_m25_qp_12:q4:part-c',
])

const missingMetadata = buildSharedMarkingSubmission({
  attemptId: 'missing-metadata-fixture',
  ...tuple,
  responses: [{ questionNumber: 27, typedText: 'fixture response', questionMetadata: metadata[27] }],
})
assert.equal(missingMetadata.ok, false)
assert.deepEqual(missingMetadata.missingQuestionNumbers, [27])

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

assert.match(paperSubmissionMarkingSummary({ submitted: true, aiMarks: { 1: { status: 'failed', loginRequired: true } }, responseQuestionNumbers: [1] }).text, /Sign in to STEM/)
assert.match(paperSubmissionMarkingSummary({ submitted: true, aiMarks: { 1: { status: 'failed', failureCode: 'service_unavailable' } }, responseQuestionNumbers: [1] }).text, /temporarily unavailable/)

console.log('STEM shared marking client contract checks passed for Q1-Q26 (46 parts, 80 marks).')
