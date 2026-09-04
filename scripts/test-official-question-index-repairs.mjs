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
  OFFICIAL_QUESTION_INDEX_REPAIR_IDS.filter((id) => id.startsWith(`${paperId}:`)),
  [1, 2, 3, 4, 5, 6, 7].map((number) => `${paperId}:q${number}`),
  'the repair ledger must name every printed question in the official M25/42 paper',
)
assert.deepEqual(
  [...byId.keys()].filter((id) => id.startsWith(`${paperId}:`)).toSorted(),
  OFFICIAL_QUESTION_INDEX_REPAIR_IDS.filter((id) => id.startsWith(`${paperId}:`)),
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

const secondPassFixtures = [
  {
    questionId: 'cie-9709-9709_m25_qp_32:q7',
    sourceRef: { paperId: 'cie-9709-9709_m25_qp_32', pageStart: 10, pageEnd: 10 },
    answerBinding: { verificationStatus: 'machine-indexed' },
  },
  {
    questionId: 'cie-9709-9709_m25_qp_52:q3',
    sourceRef: { paperId: 'cie-9709-9709_m25_qp_52', pageStart: 6, pageEnd: 6 },
    answerBinding: { verificationStatus: 'machine-indexed' },
  },
  {
    questionId: 'cie-9709-9709_m25_qp_62:q4',
    sourceRef: { paperId: 'cie-9709-9709_m25_qp_62', pageStart: 8, pageEnd: 8 },
    answerBinding: { verificationStatus: 'machine-indexed' },
  },
]
const secondPassRepaired = new Map(applyOfficialQuestionIndexRepairs(secondPassFixtures).map((item) => [item.questionId, item]))

const p32q7 = secondPassRepaired.get('cie-9709-9709_m25_qp_32:q7')
assert.deepEqual(p32q7.sourceRef.assetUrls, [
  '/question-assets/cie-9709-9709_m25_qp_32/qp-10.jpg',
  '/question-assets/cie-9709-9709_m25_qp_32/qp-11.jpg',
], '9709/32 Q7 must retain its continuation page')
assert.deepEqual(p32q7.parts.map((part) => [part.label, part.marks, part.sourcePage]), [['a', 3, 10], ['b', 2, 11], ['c', 3, 11]])
assert.deepEqual(p32q7.answerParts.map((part) => [part.label, part.marks, part.sourcePage]), [['a', 3, 15], ['b', 2, 15], ['c', 3, 16]])

const p52q3 = secondPassRepaired.get('cie-9709-9709_m25_qp_52:q3')
assert.deepEqual([p52q3.sourceRef.pageStart, p52q3.sourceRef.pageEnd], [6, 7], '9709/52 Q3 must retain the graph and continuation page')
assert.deepEqual(p52q3.parts.map((part) => [part.label, part.marks, part.sourcePage]), [['a', 4, 6], ['b', 2, 7], ['c', 3, 7]])
assert.deepEqual(p52q3.answerParts.map((part) => [part.label, part.marks, part.sourcePage]), [['a', 4, 10], ['b', 2, 10], ['c', 3, 11]])

const p62q4 = secondPassRepaired.get('cie-9709-9709_m25_qp_62:q4')
assert.deepEqual([p62q4.sourceRef.pageStart, p62q4.sourceRef.pageEnd], [8, 9], '9709/62 Q4 must retain its PDF graph and continuation page')
assert.deepEqual(p62q4.parts.map((part) => [part.label, part.marks, part.sourcePage]), [['a(i)', 2, 8], ['a(ii)', 5, 8], ['b', 4, 9]])
assert.deepEqual(p62q4.answerParts.map((part) => [part.label, part.marks, part.sourcePage]), [['a(i)', 2, 12], ['a(ii)', 5, 12], ['b', 4, 13]])
assert.ok(
  [
    'cie-9709-9709_m25_qp_32:q3',
    'cie-9709-9709_m25_qp_32:q7',
    'cie-9709-9709_m25_qp_32:q9',
    'cie-9709-9709_m25_qp_32:q10',
    'cie-9709-9709_m25_qp_52:q1',
    'cie-9709-9709_m25_qp_52:q2',
    'cie-9709-9709_m25_qp_52:q3',
    'cie-9709-9709_m25_qp_52:q4',
    'cie-9709-9709_m25_qp_52:q5',
    'cie-9709-9709_m25_qp_52:q6',
    'cie-9709-9709_m25_qp_62:q2',
    'cie-9709-9709_m25_qp_62:q3',
    'cie-9709-9709_m25_qp_62:q4',
    'cie-9709-9709_m25_qp_62:q5',
    'cie-9709-9709_m25_qp_62:q6',
  ].every((id) => OFFICIAL_QUESTION_INDEX_REPAIR_IDS.includes(id)),
  'the second-pass repair ledger must enumerate every visually verified structural repair',
)

const reviewedQ1 = {
  questionId: `${paperId}:q1`,
  prompt: 'Preserved human-reviewed source',
  sourceRef: { paperId },
  answerBinding: { verificationStatus: 'reviewed' },
}
const preserved = applyOfficialQuestionIndexRepairs([reviewedQ1])
assert.equal(preserved.find((item) => item.questionId === reviewedQ1.questionId), reviewedQ1, 'a source repair must not replace an existing human-reviewed record')

console.log(JSON.stringify({ status: 'passed', repairedGroups: OFFICIAL_QUESTION_INDEX_REPAIR_IDS.length }))
