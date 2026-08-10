import assert from 'node:assert/strict'
import { isHumanReviewedIndexItem, mergeIndexItemPreservingReview } from './question-index-review-protection.mjs'

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

console.log('Question-index reviewed-data protection checks passed.')
