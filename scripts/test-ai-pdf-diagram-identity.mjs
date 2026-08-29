import assert from 'node:assert/strict'

import { AI_PDF_INGESTION_LIFECYCLE } from './ai-pdf-ingestion/contract.mjs'
import { validateCandidate } from './ai-pdf-ingestion/validate.mjs'

const hashes = {
  questionPdf: 'a'.repeat(64),
  markSchemePdf: 'b'.repeat(64),
  pages: {
    1: '1'.repeat(64),
    2: '2'.repeat(64),
    3: '3'.repeat(64),
  },
  markSchemePages: {
    10: 'c'.repeat(64),
  },
}

const source = {
  board: 'CIE',
  paperId: 'cie-9702-9702_m25_qp_22',
  specificationId: 'cambridge-9702-2025-2027',
  rightsStatus: 'unverified-restricted',
  accessPolicyId: 'personal-study-restricted-v1',
  questionPdfSha256: hashes.questionPdf,
  markSchemePdfSha256: hashes.markSchemePdf,
  pageImageHashes: hashes.pages,
  markSchemePageHashes: hashes.markSchemePages,
  controlledTags: {
    primaryTopicIds: new Set(['physics-mechanics']),
    secondaryTopicIds: new Set(),
    syllabusPointIds: new Set(['9702-3.1']),
    skillTagIds: new Set(),
    questionFormatIds: new Set(),
  },
}

const candidate = {
  source: {
    questionPdfSha256: hashes.questionPdf,
    markSchemePdfSha256: hashes.markSchemePdf,
  },
  questions: [{
    questionNumber: '4',
    regions: [1, 2, 3].map((page) => ({
      page,
      pageImageSha256: hashes.pages[page],
      x0: 0.05,
      y0: 0.05,
      x1: 0.95,
      y1: 0.95,
    })),
    diagramRegions: [
      { page: 1, pageImageSha256: hashes.pages[1], x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 },
      { page: 2, pageImageSha256: hashes.pages[2], x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 },
      { page: 3, pageImageSha256: hashes.pages[3], x0: 0.3, y0: 0.3, x1: 0.5, y1: 0.5 },
    ],
    parts: [{ label: 'a', marks: 2 }, { label: 'b', marks: 3 }],
    tags: {
      primaryTopicId: 'physics-mechanics',
      secondaryTopicIds: [],
      syllabusPointIds: ['9702-3.1'],
      skillTagIds: [],
      questionFormatIds: [],
    },
    markSchemeEvidence: [{ page: 10, pageImageSha256: hashes.markSchemePages[10] }],
  }],
}

const verification = {
  questions: [{
    questionNumber: '4',
    pages: [1, 2, 3],
    parts: [{ label: 'a', marks: 2 }, { label: 'b', marks: 3 }],
    diagramRegionCount: 2,
    markSchemeEvidence: [{ page: 10, pageImageSha256: hashes.markSchemePages[10] }],
  }],
}

const countDisagreementResult = validateCandidate({ candidate, verification, source })
assert.equal(
  countDisagreementResult.status,
  AI_PDF_INGESTION_LIFECYCLE.AI_VERIFIED,
  JSON.stringify(countDisagreementResult.reasonCodes),
)
assert.deepEqual(countDisagreementResult.reasonCodes, [])

const presenceDisagreementResult = validateCandidate({
  candidate,
  verification: {
    ...verification,
    questions: [{ ...verification.questions[0], diagramRegionCount: 0 }],
  },
  source,
})
assert.equal(presenceDisagreementResult.status, AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED)
assert.ok(presenceDisagreementResult.reasonCodes.includes('VERIFICATION_IDENTITY_DISAGREEMENT'))

console.log(JSON.stringify({ status: 'passed', checks: 2 }))
