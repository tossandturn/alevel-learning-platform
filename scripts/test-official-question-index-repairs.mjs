import assert from 'node:assert/strict'
import {
  applyOfficialQuestionIndexRepairs,
  OFFICIAL_QUESTION_INDEX_REPAIR_IDS,
} from './official-question-index-repairs.mjs'

const paperId = 'cie-9709-9709_m25_qp_42'
const malformedImport = [
  {
    bankId: `${paperId}:q6`,
    questionId: `${paperId}:q6`,
    sourceRef: { paperId, pageStart: 6, pageEnd: 10 },
    answerBinding: { verificationStatus: 'machine-indexed' },
  },
]
const repaired = applyOfficialQuestionIndexRepairs(malformedImport)
const byId = new Map(repaired.map((item) => [item.questionId, item]))

assert.deepEqual(
  OFFICIAL_QUESTION_INDEX_REPAIR_IDS,
  [1, 2, 3, 4, 5, 6, 7].map((number) => `${paperId}:q${number}`),
  'the repair ledger must name every printed question in the official M25/42 paper',
)
assert.deepEqual(
  [...byId.keys()].filter((id) => id.startsWith(`${paperId}:`)).toSorted(),
  OFFICIAL_QUESTION_INDEX_REPAIR_IDS,
  'a partial machine import must be reconstructed into the complete official question sequence',
)

const q4 = byId.get(`${paperId}:q4`)
assert.deepEqual([q4.sourceRef.pageStart, q4.sourceRef.pageEnd], [6, 7])
assert.deepEqual(q4.sourceRef.assetUrls, [
  `/question-assets/${paperId}/qp-06.jpg`,
  `/question-assets/${paperId}/qp-07.jpg`,
])
assert.deepEqual(q4.answerRef.assetUrls, [
  `/question-assets/${paperId}/ms-11.jpg`,
  `/question-assets/${paperId}/ms-12.jpg`,
])
assert.deepEqual(q4.parts.map((part) => [part.label, part.marks, part.sourcePage]), [['a', 4, 6], ['b', 3, 7]])
assert.deepEqual(q4.answerParts.map((part) => [part.label, part.marks, part.sourcePage]), [['a', 4, 11], ['b', 3, 12]])
assert.equal(q4.answerBinding.verificationStatus, 'machine-indexed', 'a structure repair must not self-approve a question')

const q6 = byId.get(`${paperId}:q6`)
assert.deepEqual([q6.sourceRef.pageStart, q6.sourceRef.pageEnd], [10, 11], 'Q6 must not retain Q4 pages')

const reviewedQ1 = {
  questionId: `${paperId}:q1`,
  prompt: 'Preserved human-reviewed source',
  sourceRef: { paperId },
  answerBinding: { verificationStatus: 'reviewed' },
}
const preserved = applyOfficialQuestionIndexRepairs([reviewedQ1])
assert.equal(preserved.find((item) => item.questionId === reviewedQ1.questionId), reviewedQ1, 'a source repair must not replace an existing human-reviewed record')

console.log(JSON.stringify({ status: 'passed', repairedGroups: OFFICIAL_QUESTION_INDEX_REPAIR_IDS.length }))
