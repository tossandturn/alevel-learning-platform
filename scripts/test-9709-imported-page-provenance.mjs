import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'importedQuestionIndex.json'), 'utf8'))
const answers = new Map((index.answers || []).map((answer) => [answer.answerId, answer]))
const bindings = new Map((index.bindings || []).map((binding) => [binding.questionId, binding]))
const questions = (index.questions || []).filter((question) => question.subjectCode === '9709')

assert.ok(questions.length > 0, '9709 source-backed question groups must be present')
for (const question of questions) {
  assert.ok(
    question.parts.every((part) => Number.isInteger(Number(part.sourcePage)) && part.sourcePage >= question.sourceRef.pageStart && part.sourcePage <= question.sourceRef.pageEnd),
    question.questionId + ' must retain every QP part page within its source range',
  )
  const answer = answers.get(bindings.get(question.questionId)?.answerId)
  assert.ok(answer, question.questionId + ' must retain its paired mark scheme')
  assert.ok(
    answer.answerParts.every((part) => Number.isInteger(Number(part.sourcePage)) && part.sourcePage >= answer.answerRef.pageStart && part.sourcePage <= answer.answerRef.pageEnd),
    question.questionId + ' must retain every MS part page within its source range',
  )
}

console.log(JSON.stringify({ status: 'passed', groups: questions.length }))
