import assert from 'node:assert/strict'
import path from 'node:path'
import {
  AI_PDF_INGESTION_LIFECYCLE,
  AI_PDF_INGESTION_SCHEMA_VERSION,
  artifactId,
  assertLifecycleTransition,
  normalizeRegion,
  resolveArtifactSourcePdfPath,
} from './ai-pdf-ingestion/contract.mjs'
import { validateCandidate } from './ai-pdf-ingestion/validate.mjs'

const hashes = Object.freeze({
  questionPdf: 'a'.repeat(64),
  markSchemePdf: 'b'.repeat(64),
  pageOne: 'c'.repeat(64),
  pageTwo: 'd'.repeat(64),
  markSchemePage: 'e'.repeat(64),
  markSchemePageTwo: 'f'.repeat(64),
})

function validSource() {
  return {
    board: 'CIE',
    paperId: 'cie-9702-9702_m25_qp_22',
    specificationId: 'cambridge-9702-2025-2027',
    rightsStatus: 'unverified-restricted',
    accessPolicyId: 'personal-study-restricted-v1',
    questionPdfSha256: hashes.questionPdf,
    markSchemePdfSha256: hashes.markSchemePdf,
    pageImageHashes: {
      1: hashes.pageOne,
      2: hashes.pageTwo,
    },
    markSchemePageHashes: {
      17: hashes.markSchemePage,
      18: hashes.markSchemePageTwo,
    },
    controlledTags: {
      primaryTopicIds: new Set(['physics-mechanics']),
      secondaryTopicIds: new Set(['physics-forces']),
      syllabusPointIds: new Set(['9702-3.1']),
      skillTagIds: new Set(['calculate']),
      questionFormatIds: new Set(['structured']),
    },
  }
}

function validCandidate() {
  return {
    source: {
      questionPdfSha256: hashes.questionPdf,
      markSchemePdfSha256: hashes.markSchemePdf,
    },
    questions: [{
      questionNumber: '4',
      regions: [
        { page: 1, pageImageSha256: hashes.pageOne, x0: 0.08, y0: 0.12, x1: 0.92, y1: 0.88 },
        { page: 2, pageImageSha256: hashes.pageTwo, x0: 0.08, y0: 0.08, x1: 0.92, y1: 0.42 },
      ],
      diagramRegions: [
        { page: 1, pageImageSha256: hashes.pageOne, x0: 0.58, y0: 0.23, x1: 0.88, y1: 0.51 },
      ],
      markSchemeEvidence: [
        { page: 17, pageImageSha256: hashes.markSchemePage },
        { page: 18, pageImageSha256: hashes.markSchemePageTwo },
      ],
      parts: [
        { label: 'a', marks: 2 },
        { label: 'b', marks: 3 },
      ],
      tags: {
        primaryTopicId: 'physics-mechanics',
        secondaryTopicIds: ['physics-forces'],
        syllabusPointIds: ['9702-3.1'],
        skillTagIds: ['calculate'],
        questionFormatIds: ['structured'],
      },
    }],
  }
}

function validVerification() {
  return {
    questions: [{
      questionNumber: '4',
      pages: [1, 2],
      parts: [
        { label: 'a', marks: 2 },
        { label: 'b', marks: 3 },
      ],
      diagramRegionCount: 1,
      markSchemeEvidence: [
        { page: 17, pageImageSha256: hashes.markSchemePage },
        { page: 18, pageImageSha256: hashes.markSchemePageTwo },
      ],
    }],
  }
}

const validExtraction = validateCandidate({
  candidate: validCandidate(),
  verification: validVerification(),
  source: validSource(),
})
assert.equal(validExtraction.ok, true)
assert.equal(validExtraction.status, AI_PDF_INGESTION_LIFECYCLE.AI_VERIFIED)
assert.deepEqual(validExtraction.reasonCodes, [])
assert.deepEqual(validExtraction.candidate, validCandidate())

const incompleteSource = validSource()
delete incompleteSource.board
delete incompleteSource.paperId
delete incompleteSource.specificationId
delete incompleteSource.rightsStatus
delete incompleteSource.accessPolicyId
incompleteSource.markSchemePageHashes = {}
assert.doesNotThrow(() => validateCandidate({
  candidate: validCandidate(),
  verification: validVerification(),
  source: incompleteSource,
}))
const incompleteSourceResult = validateCandidate({
  candidate: validCandidate(),
  verification: validVerification(),
  source: incompleteSource,
})
assert.equal(incompleteSourceResult.ok, false)
assert.equal(incompleteSourceResult.status, AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED)
for (const reasonCode of [
  'SOURCE_BOARD_INVALID',
  'SOURCE_PAPER_ID_INVALID',
  'SOURCE_SPECIFICATION_ID_INVALID',
  'SOURCE_RIGHTS_STATUS_INVALID',
  'SOURCE_ACCESS_POLICY_ID_INVALID',
  'SOURCE_MARK_SCHEME_PAGE_HASHES_INVALID',
  'CANDIDATE_MARK_SCHEME_EVIDENCE_PAGE_MISSING',
  'VERIFICATION_MARK_SCHEME_EVIDENCE_PAGE_MISSING',
]) {
  assert.ok(incompleteSourceResult.reasonCodes.includes(reasonCode), `${reasonCode} was not returned`)
}

const mismatchedMarkSchemeEvidence = validCandidate()
mismatchedMarkSchemeEvidence.questions[0].markSchemeEvidence[0].pageImageSha256 = hashes.pageTwo
assertQuarantined({ candidate: mismatchedMarkSchemeEvidence }, 'CANDIDATE_MARK_SCHEME_EVIDENCE_PAGE_HASH_MISMATCH')

const missingCandidateMarkSchemeEvidence = validCandidate()
missingCandidateMarkSchemeEvidence.questions[0].markSchemeEvidence = []
assertQuarantined({ candidate: missingCandidateMarkSchemeEvidence }, 'CANDIDATE_MARK_SCHEME_EVIDENCE_INVALID')

const missingVerificationMarkSchemeEvidence = validVerification()
missingVerificationMarkSchemeEvidence.questions[0].markSchemeEvidence = []
assertQuarantined({ verification: missingVerificationMarkSchemeEvidence }, 'VERIFICATION_MARK_SCHEME_EVIDENCE_INVALID')

const invalidVerificationMarkSchemeEvidence = validVerification()
invalidVerificationMarkSchemeEvidence.questions[0].markSchemeEvidence[1].page = 19
assertQuarantined({ verification: invalidVerificationMarkSchemeEvidence }, 'VERIFICATION_MARK_SCHEME_EVIDENCE_PAGE_MISSING')
assertQuarantined({ verification: invalidVerificationMarkSchemeEvidence }, 'VERIFICATION_MARK_SCHEME_EVIDENCE_INVALID')

const partiallyInvalidCandidateMarkSchemeEvidence = validCandidate()
partiallyInvalidCandidateMarkSchemeEvidence.questions[0].markSchemeEvidence.push({
  page: 17,
  pageImageSha256: 'not-a-hash',
})
assert.doesNotThrow(() => validateCandidate({
  candidate: partiallyInvalidCandidateMarkSchemeEvidence,
  verification: validVerification(),
  source: validSource(),
}))
assertQuarantined({
  candidate: partiallyInvalidCandidateMarkSchemeEvidence,
}, 'CANDIDATE_MARK_SCHEME_EVIDENCE_INVALID')

const reorderedVerificationMarkSchemeEvidence = validVerification()
reorderedVerificationMarkSchemeEvidence.questions[0].markSchemeEvidence.reverse()
assertQuarantined({ verification: reorderedVerificationMarkSchemeEvidence }, 'VERIFICATION_MARK_SCHEME_EVIDENCE_DISAGREEMENT')

const secondQuestionCandidate = validCandidate()
secondQuestionCandidate.questions.push({
  ...structuredClone(secondQuestionCandidate.questions[0]),
  questionNumber: '5',
  markSchemeEvidence: [],
})
const secondQuestionVerification = validVerification()
secondQuestionVerification.questions.push({
  ...structuredClone(secondQuestionVerification.questions[0]),
  questionNumber: '5',
})
assertQuarantined({
  candidate: secondQuestionCandidate,
  verification: secondQuestionVerification,
}, 'CANDIDATE_MARK_SCHEME_EVIDENCE_INVALID')

const noDiagramCandidate = validCandidate()
noDiagramCandidate.questions[0].diagramRegions = []
const noDiagramVerification = validVerification()
noDiagramVerification.questions[0].diagramRegionCount = 0
assert.equal(validateCandidate({
  candidate: noDiagramCandidate,
  verification: noDiagramVerification,
  source: validSource(),
}).ok, true)

function assertQuarantined({ candidate = validCandidate(), verification = validVerification(), source = validSource() }, expectedCode) {
  const result = validateCandidate({ candidate, verification, source })
  assert.equal(result.ok, false)
  assert.equal(result.status, AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED)
  assert.ok(result.reasonCodes.includes(expectedCode), `${expectedCode} was not returned`)
}

const missingPageCandidate = validCandidate()
missingPageCandidate.questions[0].regions[1].page = 3
assertQuarantined({ candidate: missingPageCandidate }, 'REGION_PAGE_MISSING')

const mismatchedPageHashCandidate = validCandidate()
mismatchedPageHashCandidate.questions[0].regions[0].pageImageSha256 = hashes.pageTwo
assertQuarantined({ candidate: mismatchedPageHashCandidate }, 'REGION_PAGE_HASH_MISMATCH')

const duplicatePartCandidate = validCandidate()
duplicatePartCandidate.questions[0].parts[1].label = 'a'
assertQuarantined({ candidate: duplicatePartCandidate }, 'PART_LABEL_DUPLICATE')

const zeroMarksCandidate = validCandidate()
zeroMarksCandidate.questions[0].parts[0].marks = 0
assertQuarantined({ candidate: zeroMarksCandidate }, 'PART_MARKS_INVALID')

const forbiddenTagCandidate = validCandidate()
forbiddenTagCandidate.questions[0].tags.skillTagIds = ['invented-tag']
assertQuarantined({ candidate: forbiddenTagCandidate }, 'TAG_SKILL_FORBIDDEN')

const disagreementVerification = validVerification()
disagreementVerification.questions[0].parts[1].marks = 4
assertQuarantined({ verification: disagreementVerification }, 'VERIFICATION_IDENTITY_DISAGREEMENT')

const sourceMismatchCandidate = validCandidate()
sourceMismatchCandidate.source.questionPdfSha256 = hashes.pageOne
assertQuarantined({ candidate: sourceMismatchCandidate }, 'SOURCE_QUESTION_PDF_HASH_MISMATCH')

const emptyQuestionsCandidate = validCandidate()
emptyQuestionsCandidate.questions = []
assertQuarantined({ candidate: emptyQuestionsCandidate, verification: { questions: [] } }, 'QUESTIONS_INVALID')

assert.doesNotThrow(() => validateCandidate({ candidate: null, verification: null, source: null }))
assertQuarantined({ candidate: null, verification: null, source: null }, 'CANDIDATE_INVALID')

const validRegion = normalizeRegion({ x0: 0.08, y0: 0.12, x1: 0.92, y1: 0.88 })
assert.deepEqual(validRegion, { x0: 0.08, y0: 0.12, x1: 0.92, y1: 0.88 })

for (const invalidRegion of [
  { x0: -0.01, y0: 0.12, x1: 0.92, y1: 0.88 },
  { x0: 0.08, y0: Number.NaN, x1: 0.92, y1: 0.88 },
  { x0: Infinity, y0: 0.12, x1: 0.92, y1: 0.88 },
  { x0: 0.08, y0: 0.12, x1: 1.01, y1: 0.88 },
  { x0: 0.92, y0: 0.12, x1: 0.08, y1: 0.88 },
  { x0: 0.08, y0: 0.88, x1: 0.92, y1: 0.12 },
  { x0: 0.08, y0: 0.12, x1: 0.08, y1: 0.88 },
  { x0: 0.08, y0: 0.12, x1: 0.92 },
  null,
]) {
  assert.throws(() => normalizeRegion(invalidRegion), RangeError)
}

assert.doesNotThrow(() => assertLifecycleTransition(
  AI_PDF_INGESTION_LIFECYCLE.DETERMINISTIC_CHECKED,
  AI_PDF_INGESTION_LIFECYCLE.AI_VERIFICATION_PENDING,
))
assert.doesNotThrow(() => assertLifecycleTransition(
  AI_PDF_INGESTION_LIFECYCLE.DETERMINISTIC_CHECKED,
  AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED,
))
for (const from of [
  AI_PDF_INGESTION_LIFECYCLE.RENDERED,
  AI_PDF_INGESTION_LIFECYCLE.AI_EXTRACTED,
]) {
  assert.doesNotThrow(() => assertLifecycleTransition(
    from,
    AI_PDF_INGESTION_LIFECYCLE.RETRY_SCHEDULED,
  ))
  assert.doesNotThrow(() => assertLifecycleTransition(
    from,
    AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED,
  ))
}
assert.doesNotThrow(() => assertLifecycleTransition(
  AI_PDF_INGESTION_LIFECYCLE.RETRY_SCHEDULED,
  AI_PDF_INGESTION_LIFECYCLE.AI_EXTRACTED,
))
assert.throws(() => assertLifecycleTransition(
  AI_PDF_INGESTION_LIFECYCLE.RENDERED,
  AI_PDF_INGESTION_LIFECYCLE.AI_VERIFIED,
), RangeError)
assert.throws(() => assertLifecycleTransition(
  AI_PDF_INGESTION_LIFECYCLE.AI_VERIFIED,
  AI_PDF_INGESTION_LIFECYCLE.RETRY_SCHEDULED,
), RangeError)
assert.throws(() => assertLifecycleTransition(
  AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED,
  AI_PDF_INGESTION_LIFECYCLE.RETRY_SCHEDULED,
), RangeError)

const artifactInputs = {
  paperId: 'cie-9702-9702_m25_qp_22',
  questionPdfSha256: 'a'.repeat(64),
  markSchemePdfSha256: 'b'.repeat(64),
}
const firstArtifactId = artifactId(artifactInputs)
const secondArtifactId = artifactId({ ...artifactInputs })
const changedArtifactId = artifactId({ ...artifactInputs, paperId: 'cie-9702-9702_m25_ms_22' })

assert.equal(firstArtifactId, secondArtifactId)
assert.notEqual(firstArtifactId, changedArtifactId)
assert.match(firstArtifactId, /^sha256:[a-f0-9]{64}$/)
assert.throws(() => artifactId({ ...artifactInputs, paperId: '  ' }), TypeError)
assert.equal(
  artifactId({
    ...artifactInputs,
    questionPdfSha256: `sha256:${'A'.repeat(64)}`,
    markSchemePdfSha256: 'B'.repeat(64),
  }),
  artifactId({
    ...artifactInputs,
    questionPdfSha256: 'a'.repeat(64),
    markSchemePdfSha256: 'b'.repeat(64),
  }),
)

const portableLibraryRoot = path.resolve('fixture-library')
assert.equal(
  resolveArtifactSourcePdfPath({
    source: { questionPdfPath: 'D:\\CodexWork\\cie-fraft-fetcher\\output\\pdf\\9702\\9702_m21_qp_42.pdf' },
    absoluteField: 'questionPdfPath',
    relativeField: 'questionPdfRelativePath',
    libraryRoot: portableLibraryRoot,
    subjectCode: '9702',
  }),
  path.join(portableLibraryRoot, '9702', '9702_m21_qp_42.pdf'),
  'legacy Windows source paths must resolve inside the configured subject library',
)
assert.equal(
  resolveArtifactSourcePdfPath({
    source: {
      questionPdfPath: 'D:\\CodexWork\\cie-fraft-fetcher\\output\\pdf\\9702\\9702_m21_qp_42.pdf',
      questionPdfRelativePath: '../outside.pdf',
    },
    absoluteField: 'questionPdfPath',
    relativeField: 'questionPdfRelativePath',
    libraryRoot: portableLibraryRoot,
    subjectCode: '9702',
  }),
  '',
  'an explicitly invalid portable path must fail closed instead of falling back to legacy data',
)
for (const invalidHash of [
  'a'.repeat(63),
  'a'.repeat(65),
  'g'.repeat(64),
  `sha256:${'a'.repeat(63)}`,
  `SHA256:${'a'.repeat(64)}`,
]) {
  assert.throws(() => artifactId({ ...artifactInputs, questionPdfSha256: invalidHash }), TypeError)
}

console.log(JSON.stringify({
  status: 'passed',
  schemaVersion: AI_PDF_INGESTION_SCHEMA_VERSION,
  checks: 35,
}))
