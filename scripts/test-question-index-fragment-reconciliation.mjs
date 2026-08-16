import assert from 'node:assert/strict'
import {
  alignAnswerFragmentsToQuestionParts,
  collapseFragments,
  mergeFragments,
  resolvePartMarks,
} from './question-index-fragments.mjs'

const numberedGroups = mergeFragments([
  { page: 8, fragments: [{ questionNumber: 7, partId: 'a', promptFragment: 'Q7', marks: 3 }] },
  { page: 10, fragments: [{ questionNumber: 9, partId: 'a', promptFragment: 'Q9', marks: 4 }] },
], 'fragments')

assert.deepEqual(
  [...numberedGroups.keys()],
  ['7', '9'],
  'a printed later question number must never be merged into the previous group merely because an earlier number is absent',
)

const singleQuestionPart = collapseFragments([
  { partId: 'a', label: 'a', promptFragment: 'Find the value.', marks: 4, sourcePage: 3 },
], { questionHierarchy: true })
const markRows = [
  { partId: 'a', label: 'B1', exactText: 'correct setup', marks: 1, sourcePage: 10 },
  { partId: 'b', label: 'M1', exactText: 'valid method', marks: 1, sourcePage: 10 },
  { partId: 'c', label: 'DM1', exactText: 'correct simplification', marks: 1, sourcePage: 10 },
  { partId: 'd', label: 'A1', exactText: 'final answer', marks: 1, sourcePage: 10 },
]
const alignedSinglePartMarks = collapseFragments(
  alignAnswerFragmentsToQuestionParts(singleQuestionPart, markRows),
  { sumMarks: true },
)

assert.equal(alignedSinglePartMarks.length, 1)
assert.equal(alignedSinglePartMarks[0].label, 'a')
assert.equal(alignedSinglePartMarks[0].marks, 4)
assert.equal(alignedSinglePartMarks[0].sourcePage, 10)

const multiQuestionParts = collapseFragments([
  { partId: 'a', label: 'a', promptFragment: 'Part a', marks: 2, sourcePage: 3 },
  { partId: 'b', label: 'b', promptFragment: 'Part b', marks: 2, sourcePage: 3 },
], { questionHierarchy: true })
assert.deepEqual(
  alignAnswerFragmentsToQuestionParts(multiQuestionParts, markRows).map((fragment) => fragment.partId),
  ['a', 'b', 'c', 'd'],
  'multi-part questions must retain their explicit mark-scheme labels for later reconciliation',
)

assert.deepEqual(
  resolvePartMarks({ questionMarks: 4, answerMarks: 6, answerType: 'handwritten' }),
  { marks: 4, markSource: 'question-paper' },
  'alternative methods in a mark scheme must not inflate a question-paper part total',
)
assert.deepEqual(
  resolvePartMarks({ questionMarks: 3, answerMarks: 3, answerType: 'handwritten' }),
  { marks: 3, markSource: 'paired-mark-scheme' },
  'matching QP/MS totals retain paired mark-scheme provenance',
)

console.log(JSON.stringify({ status: 'passed', cases: 5 }))
