import assert from 'node:assert/strict'
import {
  isHumanReviewedIndexItem,
  knowledgeGroupForIndexItem,
  mergeIndexItemPreservingReview,
  minimumQuestionGroupsForImport,
  replaceMachineIndexedPaperItems,
  syllabusMappingForIndexItem,
} from './question-index-review-protection.mjs'
import { normaliseQuestionFragmentHierarchy } from './question-index-fragment-normalization.mjs'

const reviewed = {
  bankId: 'paper:q1',
  prompt: 'Human-reviewed prompt',
  answerBinding: { verificationStatus: 'reviewed', reviewedAt: '2026-08-10T00:00:00Z' },
}
const reimported = {
  bankId: 'paper:q1',
  prompt: 'Machine OCR replacement',
  answerBinding: { verificationStatus: 'machine-indexed' },
}
const machineIndexed = {
  bankId: 'paper:q2',
  prompt: 'Old OCR prompt',
  answerBinding: { verificationStatus: 'machine-indexed' },
}
const improved = {
  bankId: 'paper:q2',
  prompt: 'New OCR prompt',
  answerBinding: { verificationStatus: 'machine-indexed' },
}

assert.equal(isHumanReviewedIndexItem(reviewed), true)
assert.equal(isHumanReviewedIndexItem(machineIndexed), false)
assert.equal(mergeIndexItemPreservingReview(reviewed, reimported), reviewed, 'A force import must not replace reviewed source data')
assert.equal(mergeIndexItemPreservingReview(machineIndexed, improved), improved, 'Machine-indexed data may be refreshed')
assert.equal(mergeIndexItemPreservingReview(undefined, improved), improved, 'New questions must still import')

const refreshedPaper = replaceMachineIndexedPaperItems([
  { ...reviewed, sourceRef: { paperId: 'paper' } },
  { ...machineIndexed, sourceRef: { paperId: 'paper' } },
  { bankId: 'other:q1', sourceRef: { paperId: 'other' }, answerBinding: { verificationStatus: 'machine-indexed' } },
], 'paper', [{ ...improved, sourceRef: { paperId: 'paper' } }])
assert.deepEqual(refreshedPaper.map((item) => item.bankId).sort(), ['other:q1', 'paper:q1', 'paper:q2'])
assert.equal(refreshedPaper.find((item) => item.bankId === 'paper:q1')?.prompt, 'Human-reviewed prompt', 'A paper refresh must preserve reviewed records')
assert.equal(refreshedPaper.find((item) => item.bankId === 'paper:q2')?.prompt, 'New OCR prompt', 'A paper refresh must replace stale machine records')
assert.equal(minimumQuestionGroupsForImport({ subject: '9702', examProfile: { paperNumber: 2, defaultQuestionCount: null } }), 7, 'AS P2 imports must not treat one or two groups as a complete paper')
assert.equal(minimumQuestionGroupsForImport({ subject: '9702', examProfile: { paperNumber: 1, defaultQuestionCount: 40 } }), 40)

const hierarchicalParts = normaliseQuestionFragmentHierarchy([
  { questionNumber: 2, label: '(a)', partId: 'a', promptFragment: 'Standalone part' },
  { questionNumber: 2, label: '(b)', partId: 'b', promptFragment: 'Shared setup for part b' },
  { questionNumber: 2, label: '(i)', partId: 'b(i)', promptFragment: 'First task' },
  { questionNumber: 2, label: '(ii)', partId: 'ii', promptFragment: 'Second task' },
  { questionNumber: 'c', label: '(i)', partId: 'i', promptFragment: 'Third task' },
  { questionNumber: 'c', label: '(ii)', partId: 'ii', promptFragment: 'Fourth task' },
])
assert.deepEqual(hierarchicalParts.map((part) => part.label), ['a', 'b(i)', 'b(ii)', 'c(i)', 'c(ii)'])
assert.match(hierarchicalParts[1].promptFragment, /Shared setup for part b\nFirst task/)

const reviewedPhysics = {
  bankId: '9702:q7',
  knowledgeGroupId: 'physics-9702-topic-11',
  syllabusMapping: {
    primaryTopicId: 'physics-9702-topic-11',
    syllabusPointIds: ['physics-9702-point-11-1-05'],
    reviewStatus: 'reviewed',
    reviewedBy: 'human-review',
  },
  answerBinding: { verificationStatus: 'reviewed' },
}
const remapped = syllabusMappingForIndexItem(reviewedPhysics, {
  fallbackKnowledgeGroupId: 'physics-9702-topic-23',
  specificationId: 'cambridge-9702-2025-2027',
  syllabusUrl: 'https://example.invalid/syllabus.pdf',
})
assert.equal(knowledgeGroupForIndexItem(reviewedPhysics, 'physics-9702-topic-23'), 'physics-9702-topic-11')
assert.equal(remapped.knowledgeGroupId, 'physics-9702-topic-11')
assert.equal(remapped.reviewStatus, 'reviewed')
assert.deepEqual(remapped.syllabusPointIds, ['physics-9702-point-11-1-05'])
assert.equal(remapped.reviewedBy, 'human-review')

const remappedMachine = syllabusMappingForIndexItem(machineIndexed, {
  fallbackKnowledgeGroupId: 'physics-9702-topic-23',
  specificationId: 'cambridge-9702-2025-2027',
  syllabusUrl: 'https://example.invalid/syllabus.pdf',
})
assert.equal(remappedMachine.knowledgeGroupId, 'physics-9702-topic-23')
assert.equal(remappedMachine.mappingStatus, 'machine-indexed')

console.log('Question-index reviewed-data protection checks passed.')
