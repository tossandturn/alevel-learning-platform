import assert from 'node:assert/strict'
import { artifactId, buildAiStudentStudyRelease, sourceReviewInputSha256 } from './ai-pdf-ingestion/contract.mjs'

const qp = 'a'.repeat(64), ms = 'b'.repeat(64)
const paperId = 'cie-9701-9701_s25_qp_12', routeId = 'cie-9701-as-chemistry'
const region = (page, hash) => ({ page, pageImageSha256: hash.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 })
const question = { questionNumber: '7', regions: [region(3, 'c')], diagramRegions: [],
  sharedStemRegions: [region(2, 'd')], referenceMaterialRegions: [region(16, 'e')],
  markSchemeEvidence: [region(2, 'f')], parts: [{ label: 'answer', marks: 1 }],
  tags: { primaryTopicId: '9701-as-topic-03-bonding', secondaryTopicIds: [], syllabusPointIds: [] } }
const artifact = { artifactId: artifactId({ paperId, questionPdfSha256: qp, markSchemePdfSha256: ms }),
  routeId, status: 'ai-verified', source: { questionPdfSha256: qp, markSchemePdfSha256: ms },
  extractor: { provider: 'fixture-a', model: 'fixture-a', schemaName: 'ai_pdf_question_extraction_v1' },
  verifier: { provider: 'fixture-b', model: 'fixture-b', schemaName: 'ai_pdf_question_verification_v1' },
  candidate: { questions: [question] }, verification: { questions: [structuredClone(question)] } }
const inputSha256 = sourceReviewInputSha256(artifact)
const confirmations = Object.fromEntries(['sourceBindingConfirmed', 'wholeQuestionConfirmed', 'partStructureConfirmed',
  'marksConfirmed', 'markSchemeEvidenceConfirmed', 'topicMappingConfirmed'].map((key) => [key, true]))
const sourceReview = { schemaVersion: 'ai-source-semantic-review.v1', provider: 'fixture-reviewer', model: 'fixture-model',
  decision: 'accept', reviewedAt: '2026-11-16T00:00:00Z', inputSha256, confirmations,
  reviewNote: 'Synthetic source review for required shared and reference pages.',
  evidence: [{ document: 'qp', page: 3, pageImageSha256: 'c'.repeat(64) },
    { document: 'ms', page: 2, pageImageSha256: 'f'.repeat(64) }] }
const build = (review) => buildAiStudentStudyRelease({ ...artifact, sourceReview: review })
assert.throws(() => build(sourceReview), /valid hash-bound AI source review/i,
  'a review missing shared and reference page evidence must not release')
const withShared = structuredClone(sourceReview)
withShared.evidence.push({ document: 'qp', page: 2, pageImageSha256: 'd'.repeat(64) })
assert.throws(() => build(withShared), /valid hash-bound AI source review/i,
  'a review still missing reference page evidence must not release')
const complete = structuredClone(withShared)
complete.evidence.push({ document: 'qp', page: 16, pageImageSha256: 'e'.repeat(64) })
assert.ok(build(complete), 'the complete source-bound review may pass the structural contract')
complete.evidence.at(-1).pageImageSha256 = '0'.repeat(64)
assert.throws(() => build(complete), /valid hash-bound AI source review/i, 'wrong reference page hash must fail closed')
console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'source-review-shared-and-reference-page-binding' }))
