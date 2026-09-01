import assert from 'node:assert/strict'

import { validateCandidate } from './ai-pdf-ingestion/validate.mjs'

const pageHash = 'a'.repeat(64)
const markSchemeHash = 'b'.repeat(64)
const tags = {
  primaryTopicId: 'physics-9702-topic-01',
  secondaryTopicIds: [],
  syllabusPointIds: ['physics-9702-point-1-1-01'],
  skillTagIds: [],
  questionFormatIds: [],
}
const candidateRegion = { page: 1, pageImageSha256: pageHash, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.8 }
const source = {
  board: 'Cambridge International',
  paperId: 'cie-9702-9702_m25_qp_42',
  specificationId: 'cambridge-9702-2025-2027',
  rightsStatus: 'official-personal-study',
  accessPolicyId: 'private-study-library',
  questionPdfSha256: 'c'.repeat(64),
  markSchemePdfSha256: 'd'.repeat(64),
  pageImageHashes: { 1: pageHash },
  markSchemePageHashes: { 1: markSchemeHash },
  controlledTags: {
    primaryTopicIds: new Set([tags.primaryTopicId]),
    secondaryTopicIds: new Set(),
    syllabusPointIds: new Set(tags.syllabusPointIds),
    skillTagIds: new Set(),
    questionFormatIds: new Set(),
  },
}
const candidate = {
  source: { questionPdfSha256: source.questionPdfSha256, markSchemePdfSha256: source.markSchemePdfSha256 },
  questions: [{
    questionNumber: '1',
    regions: [candidateRegion],
    diagramRegions: [],
    parts: [{ label: 'a', marks: 2, ocrText: 'State the answer.', math: [], diagramAssociations: [] }],
    tags,
    markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemeHash }],
  }],
}
const verification = {
  questions: [{
    questionNumber: '1',
    questionStartPage: 1,
    pages: [1],
    regions: [{ ...candidateRegion, x0: 0.2 }],
    diagramRegions: [],
    parts: [{ label: 'a', marks: 2 }],
    diagramRegionCount: 0,
    tags,
    markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemeHash }],
  }],
}

const result = validateCandidate({ candidate, verification, source })
assert.equal(result.ok, false, 'a verifier coordinate mismatch must quarantine the ingestion artifact')
assert.ok(
  result.reasonCodes.includes('VERIFICATION_REGION_DISAGREEMENT'),
  `expected a verification-region reason, got ${result.reasonCodes.join(', ')}`,
)

console.log(JSON.stringify({ status: 'passed', scope: 'ai-pdf-verifier-coordinate-validation' }))
