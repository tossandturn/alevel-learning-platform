import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const indexPath = path.join(root, 'src', 'data', 'importedQuestionIndex.json')
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))

if (index.schemaVersion !== 2 || !Array.isArray(index.questions) || !Array.isArray(index.answers) || !Array.isArray(index.bindings)) {
  throw new Error('Question index must use schema v2 with questions, answers and bindings.')
}

const answers = new Map(index.answers.map((answer) => [answer.answerId, answer]))
const bindings = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
const duplicateBindings = new Set()
const seenBindings = new Set()
const inventory = new Map()
const errors = []

for (const binding of index.bindings) {
  if (seenBindings.has(binding.questionId)) duplicateBindings.add(binding.questionId)
  seenBindings.add(binding.questionId)
}

for (const question of index.questions) {
  const binding = bindings.get(question.questionId)
  const answer = answers.get(binding?.answerId)
  const label = `${question.subjectCode || question.qualificationId} ${question.questionId}`
  if (!binding || !answer) errors.push(`${label}: missing answer binding`)
  if (!question.prompt?.trim()) errors.push(`${label}: missing question text`)
  if (!question.qualificationId || !question.knowledgeGroupId || !question.stageTags?.length) errors.push(`${label}: missing syllabus tags`)
  if (!question.sourceRef?.paper || !question.sourceRef?.question || !question.sourceRef?.sha256) errors.push(`${label}: missing question provenance`)
  if (!answer?.answerRef?.file || !answer.answerRef?.sha256) errors.push(`${label}: missing answer provenance`)
  if (binding && question.sourceRef?.sha256 !== binding.questionDocumentSha256) errors.push(`${label}: question SHA does not match binding`)
  if (binding && answer?.answerRef?.sha256 !== binding.answerDocumentSha256) errors.push(`${label}: answer SHA does not match binding`)
  if (question.sourceRef?.sha256 && answer?.answerRef?.sha256 && question.sourceRef.sha256 === answer.answerRef.sha256) errors.push(`${label}: QP and MS cannot share a document SHA`)
  const key = [question.qualificationId, question.stageTags.join('+'), question.knowledgeGroupId].join(' | ')
  inventory.set(key, (inventory.get(key) || 0) + 1)
}

for (const questionId of duplicateBindings) errors.push(`${questionId}: duplicate answer binding`)
for (const answer of index.answers) {
  if (!index.bindings.some((binding) => binding.answerId === answer.answerId)) errors.push(`${answer.answerId}: unbound answer`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  const ready = [...inventory.entries()].filter(([, count]) => count >= 10).length
  const short = [...inventory.entries()].filter(([, count]) => count < 10).length
  console.log(JSON.stringify({
    schemaVersion: index.schemaVersion,
    questions: index.questions.length,
    answers: index.answers.length,
    bindings: index.bindings.length,
    drillReadyTopics: ready,
    topicsNeedingMoreIndexedItems: short,
    inventory: Object.fromEntries([...inventory.entries()].sort()),
  }, null, 2))
}
