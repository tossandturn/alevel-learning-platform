import assert from 'node:assert/strict'

import {
  normalizePageWindowResponse,
  pageWindowSourceMetadata,
  selectPageWindowMarkSchemePages,
} from './ingest-ai-pdf-questions.mjs'

const questionPaperPageHashes = Object.fromEntries(
  Array.from({ length: 28 }, (_, index) => [index + 1, String(index + 1).repeat(64)]),
)
const markSchemePageHashes = Object.fromEntries(
  Array.from({ length: 14 }, (_, index) => [index + 1, String(index + 1).repeat(64)]),
)

const firstWindow = selectPageWindowMarkSchemePages({
  questionPaperPageHashes,
  markSchemePageHashes,
  pageWindow: { ownedQuestionPaperPages: [1, 2, 3, 4], visibleQuestionPaperPages: [1, 2, 3, 4, 5] },
  contextPageCount: 1,
})
const lastWindow = selectPageWindowMarkSchemePages({
  questionPaperPageHashes,
  markSchemePageHashes,
  pageWindow: { ownedQuestionPaperPages: [25, 26, 27, 28], visibleQuestionPaperPages: [25, 26, 27, 28] },
  contextPageCount: 1,
})

assert.ok(firstWindow.includes(1))
assert.ok(!firstWindow.includes(14))
assert.ok(firstWindow.length < Object.keys(markSchemePageHashes).length)
assert.ok(lastWindow.includes(14))
assert.ok(!lastWindow.includes(1))
assert.ok(lastWindow.length < Object.keys(markSchemePageHashes).length)
assert.deepEqual(firstWindow, [...new Set(firstWindow)].sort((left, right) => left - right))

const source = pageWindowSourceMetadata({
  board: 'CIE',
  paperId: 'cie-9702-9702_m25_qp_42',
  specificationId: 'cie-9702-a2-physics',
  stage: 'A2',
  rightsStatus: 'unverified-restricted',
  accessPolicyId: 'personal-study-restricted-v1',
  questionPdfSha256: 'q'.repeat(64),
  markSchemePdfSha256: 'm'.repeat(64),
  pageImageHashes: questionPaperPageHashes,
  pageSizes: { 1: { width: 1530, height: 1980 } },
  markSchemePageHashes,
  markSchemePageSizes: { 1: { width: 1980, height: 1530 } },
  controlledTags: {
    primaryTopicIds: new Set(['physics-9702-topic-12']),
    secondaryTopicIds: new Set(['physics-9702-topic-12']),
    syllabusPointIds: new Set(['physics-9702-point-12-1-01']),
  },
  controlledTopicCatalog: [{ id: 'physics-9702-topic-12', code: '12', name: 'Motion in a circle' }],
}, {
  ownedQuestionPaperPages: [1, 2, 3, 4],
  visibleQuestionPaperPages: [1, 2, 3, 4, 5],
}, { includeTags: true })

assert.deepEqual(Object.keys(source.questionPaperPageHashes), ['1', '2', '3', '4', '5'])
assert.deepEqual(Object.keys(source.markSchemePageHashes), Object.keys(markSchemePageHashes))
assert.equal('pageSizes' in source, false)
assert.equal('markSchemePageSizes' in source, false)
assert.deepEqual(source.controlledTags.primaryTopicIds, ['physics-9702-topic-12'])

const normalized = normalizePageWindowResponse({
  questionStarts: [{ questionNumber: 1, questionStartPage: '4' }],
  questions: [{
    questionNumber: 'Q 2.',
    questionStartPage: '5',
    pages: ['5', '6'],
    parts: [{ label: 'a', marks: '2' }],
    diagramRegionCount: '1',
    markSchemeEvidence: [{ page: '3', pageImageSha256: 'a'.repeat(64) }],
  }],
}, { verification: true })

assert.equal(normalized.questionStarts[0].questionNumber, '1')
assert.equal(normalized.questionStarts[0].questionStartPage, 4)
assert.equal(normalized.questions[0].questionNumber, '2')
assert.equal(normalized.questions[0].questionStartPage, 5)
assert.deepEqual(normalized.questions[0].pages, [5, 6])
assert.equal(normalized.questions[0].parts[0].marks, 2)
assert.equal(normalized.questions[0].diagramRegionCount, 1)
assert.equal(normalized.questions[0].markSchemeEvidence[0].page, 3)

console.log(JSON.stringify({ status: 'passed', checks: 18 }))
