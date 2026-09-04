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

const explicitNewQuestionWithFalseContinuation = mergeFragments([
  { page: 5, fragments: [{ questionNumber: 5, partId: 'a', promptFragment: 'Q5 ending', marks: 2 }] },
  { page: 6, fragments: [{ questionNumber: 6, partId: 'a', promptFragment: 'Q6 starts', marks: 2, continues: true }] },
], 'fragments')

assert.deepEqual(
  [...explicitNewQuestionWithFalseContinuation.keys()],
  ['5', '6'],
  'an explicit new question number must win over a noisy continues flag on A2 multi-page papers',
)

const nonAdjacentImplicitContinuation = mergeFragments([
  { page: 5, fragments: [{ questionNumber: 5, partId: 'a', promptFragment: 'Q5', marks: 2 }] },
  { page: 8, fragments: [{ questionNumber: null, partId: 'b', promptFragment: 'unlabelled fragment', marks: 2, continues: true }] },
], 'fragments')

assert.deepEqual(
  [...nonAdjacentImplicitContinuation.keys()],
  ['5'],
  'an unlabelled fragment after a page gap must not be attached to an earlier A2 question',
)
assert.equal(nonAdjacentImplicitContinuation.get('5').fragments.length, 1)

const pageAnchoredContinuation = mergeFragments([
  { page: 4, fragments: [{ questionNumber: 1, partId: 'a', promptFragment: 'Q1 start', marks: 2 }] },
  { page: 5, fragments: [{ questionNumber: 5, partId: 'i', promptFragment: 'Q1 continuation misread as Q5', marks: 2, continues: true }] },
], 'fragments', { pageQuestionNumbers: new Map([[4, '1'], [5, null]]) })

assert.deepEqual(
  [...pageAnchoredContinuation.keys()],
  ['1'],
  'a readable continuation page without a main number must override a noisy AI question number',
)
assert.equal(pageAnchoredContinuation.get('1').fragments.length, 2)

const noisyLetterOnAnchoredContinuation = mergeFragments([
  { page: 18, fragments: [{ questionNumber: 7, partId: 'a', promptFragment: 'Q7 start', marks: 2 }] },
  { page: 19, fragments: [{ questionNumber: 'c', partId: 'i', promptFragment: 'Q7 continuation misread as letter question number', marks: 1, startsHere: true, continues: false }] },
], 'fragments', { pageQuestionNumbers: new Map([[18, '7'], [19, null]]) })

assert.deepEqual(
  [...noisyLetterOnAnchoredContinuation.keys()],
  ['7'],
  'a continuation-only page must override a non-numeric OCR question number even when continues is false',
)
assert.equal(noisyLetterOnAnchoredContinuation.get('7').fragments.length, 2)

const unnumberedContinuationWithoutReadableAnchor = mergeFragments([
  { page: 22, fragments: [{ questionNumber: 9, partId: 'b', promptFragment: 'Q9 previous page', marks: 2 }] },
  { page: 23, fragments: [{ questionNumber: null, partId: 'c-i', promptFragment: 'Q9 continuation without reliable PDF anchor', marks: 2, startsHere: true, continues: false }] },
], 'fragments', { pageQuestionNumbers: new Map([[22, '9']]) })

assert.deepEqual(
  [...unnumberedContinuationWithoutReadableAnchor.keys()],
  ['9'],
  'an adjacent unnumbered fragment may inherit when the local page anchor is unavailable',
)
assert.equal(unnumberedContinuationWithoutReadableAnchor.get('9').fragments.length, 2)

const pageAnchoredNewQuestion = mergeFragments([
  { page: 5, fragments: [{ questionNumber: 5, partId: 'a', promptFragment: 'AI misread Q2 as Q5', marks: 2, startsHere: true }] },
], 'fragments', { pageQuestionNumbers: new Map([[5, '2']]) })

assert.deepEqual(
  [...pageAnchoredNewQuestion.keys()],
  ['2'],
  'an unambiguous printed main number must override an AI question-number hallucination',
)

const anchoredQuestionStateTransition = mergeFragments([
  { page: 4, fragments: [{ questionNumber: 1, partId: 'a', promptFragment: 'Q1', marks: 2 }] },
  { page: 5, fragments: [{ questionNumber: null, partId: 'a', promptFragment: 'Q2 starts but OCR omitted its number', marks: 2, startsHere: true }] },
  { page: 6, fragments: [{ questionNumber: null, partId: 'b', promptFragment: 'Q2 continuation', marks: 2, continues: true }] },
], 'fragments', { pageQuestionNumbers: new Map([[4, '1'], [5, '2'], [6, null]]) })

assert.deepEqual(
  [...anchoredQuestionStateTransition.keys()],
  ['1', '2'],
  'a PDF anchor selected for an unnumbered new question must become the active question for the next page',
)
assert.equal(anchoredQuestionStateTransition.get('2').fragments.length, 2)

const mixedPageAnchors = mergeFragments([
  { page: 4, fragments: [{ questionNumber: 1, partId: 'a', promptFragment: 'Q1 continuation', marks: 2 }] },
  { page: 5, fragments: [{ questionNumber: 1, partId: 'b', promptFragment: 'Q1 continues before Q2', marks: 2, continues: true, startsHere: false }] },
  { page: 5, fragments: [{ questionNumber: 2, partId: 'a', promptFragment: 'Q2 starts later', marks: 2, startsHere: true }] },
], 'fragments', { pageQuestionNumbers: new Map([[4, '1'], [5, '2']]) })

assert.deepEqual(
  [...mixedPageAnchors.keys()],
  ['1', '2'],
  'a page anchor must not steal a preceding continuation before the next question starts',
)

const mixedPageWithUnnumberedContinuation = mergeFragments([
  { page: 4, fragments: [{ questionNumber: 1, partId: 'a', promptFragment: 'Q1 start', marks: 2 }] },
  { page: 5, fragments: [{ questionNumber: null, partId: 'b', promptFragment: 'Q1 unnumbered continuation before Q2', marks: 2, continues: true, startsHere: false }] },
  { page: 5, fragments: [{ questionNumber: 2, partId: 'a', promptFragment: 'Q2 starts later', marks: 2, startsHere: true }] },
], 'fragments', { pageQuestionNumbers: new Map([[4, '1'], [5, '2']]) })

assert.equal(mixedPageWithUnnumberedContinuation.get('1').fragments.length, 2)
assert.equal(mixedPageWithUnnumberedContinuation.get('2').fragments.length, 1)

const samePageImplicitContinuation = mergeFragments([
  { page: 5, fragments: [
    { questionNumber: 5, partId: 'a', promptFragment: 'Q5', marks: 2 },
    { questionNumber: null, partId: 'b', promptFragment: 'Q5 continuation', marks: 2, continues: true },
  ] },
], 'fragments')

assert.deepEqual(
  [...samePageImplicitContinuation.get('5').fragments].map((fragment) => fragment.partId),
  ['a', 'b'],
  'same-page unlabelled parts may continue the active question when explicitly marked as continuation',
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

console.log(JSON.stringify({ status: 'passed', cases: 14 }))
