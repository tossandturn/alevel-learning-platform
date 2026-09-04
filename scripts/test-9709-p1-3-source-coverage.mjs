import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'importedQuestionIndex.json'), 'utf8'))
const questions = (index.questions || [])
  .filter((question) => question.sourceRef?.paperId === 'cie-9709-9709_s25_qp_13')
  .toSorted((left, right) => left.questionId.localeCompare(right.questionId, undefined, { numeric: true }))

assert.deepEqual(
  questions.map((question) => question.questionId.split(':q')[1]),
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
  '9709/13 May/June 2025 must retain all eleven printed question groups',
)
assert.deepEqual(
  questions.map((question) => question.totalMarks),
  [4, 4, 4, 6, 6, 6, 7, 8, 9, 11, 10],
  'QP marks are authoritative even where a mark scheme presents alternate methods',
)

const q8 = questions.find((question) => question.questionId.endsWith(':q8'))
const q9 = questions.find((question) => question.questionId.endsWith(':q9'))
const q10 = questions.find((question) => question.questionId.endsWith(':q10'))
assert.deepEqual([q8.sourceRef.pageStart, q8.sourceRef.pageEnd], [9, 9], 'diagram question Q8 must retain its visible QP page')
assert.deepEqual([q9.sourceRef.pageStart, q9.sourceRef.pageEnd], [10, 11], 'cross-page Q9 must retain both QP pages')
assert.deepEqual([q10.sourceRef.pageStart, q10.sourceRef.pageEnd], [12, 13], 'cross-page Q10 must retain both QP pages')
assert.ok(questions.every((question) => question.parts.every((part) => Number.isInteger(part.sourcePage) && part.sourcePage > 0)))

console.log(JSON.stringify({ status: 'passed', paperId: 'cie-9709-9709_s25_qp_13', groups: questions.length }))
