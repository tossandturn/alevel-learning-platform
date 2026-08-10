import fs from 'node:fs'
import path from 'node:path'
import { normaliseQuestionGroup } from '../src/data/questionParts.js'

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

function reviewedPartEvidenceErrors(question, answer, binding, label) {
  if (binding.verificationStatus !== 'reviewed') return []
  const evidence = binding.reviewEvidence
  const reviewErrors = []
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(binding.reviewedAt || ''))) reviewErrors.push(`${label}: reviewed binding is missing reviewedAt`)
  if (!String(binding.reviewedBy || '').trim()) reviewErrors.push(`${label}: reviewed binding is missing reviewedBy`)
  if (!evidence || evidence.method !== 'paired-qp-ms-page-review') reviewErrors.push(`${label}: reviewed binding is missing paired QP/MS review evidence`)
  if (evidence?.questionPaper?.sha256 !== question.sourceRef?.sha256) reviewErrors.push(`${label}: reviewed QP checksum does not match source`)
  if (evidence?.markScheme?.sha256 !== answer?.answerRef?.sha256) reviewErrors.push(`${label}: reviewed MS checksum does not match source`)
  const allocations = new Map((evidence?.partAllocations || []).map((allocation) => [allocation.partId, allocation]))
  const group = normaliseQuestionGroup(question, answer)
  for (const part of group.parts || []) {
    const allocation = allocations.get(part.partId)
    const answerPart = answer?.answerParts?.find((candidate) => candidate.partId === part.partId)
    const expectedMarkSchemePage = Number(answerPart?.sourcePage || answer?.answerRef?.pageStart)
    if (!allocation) {
      reviewErrors.push(`${label}: reviewed binding is missing allocation evidence for ${part.partId}`)
      continue
    }
    if (Number(allocation.marks) !== Number(part.marks)) reviewErrors.push(`${label}: reviewed allocation marks do not match ${part.partId}`)
    if (Number(allocation.questionPage) !== Number(part.sourcePage)) reviewErrors.push(`${label}: reviewed QP page does not match ${part.partId}`)
    if (Number(allocation.markSchemePage) !== expectedMarkSchemePage) reviewErrors.push(`${label}: reviewed MS page does not match ${part.partId}`)
    if (!Number.isInteger(Number(allocation.markPointCount)) || Number(allocation.markPointCount) < 1) reviewErrors.push(`${label}: reviewed allocation has no mark-point evidence for ${part.partId}`)
    const answerEvidence = (answerPart?.markSchemeEvidence || []).map((item) => String(item?.text || '').trim()).filter(Boolean)
    const allocationEvidence = (allocation.markSchemeEvidence || []).map((item) => String(item || '').trim()).filter(Boolean)
    if (!answerEvidence.length) reviewErrors.push(`${label}: reviewed answer part is missing quoted mark-scheme evidence for ${part.partId}`)
    if (Number(allocation.markPointCount) !== answerEvidence.length) reviewErrors.push(`${label}: reviewed allocation evidence count does not match ${part.partId}`)
    if (JSON.stringify(allocationEvidence) !== JSON.stringify(answerEvidence)) reviewErrors.push(`${label}: reviewed allocation evidence does not match answer evidence for ${part.partId}`)
  }
  if (allocations.size !== (group.parts || []).length) reviewErrors.push(`${label}: reviewed binding has extra allocation evidence`)
  return reviewErrors
}

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
  if (binding && !['machine-indexed', 'reviewed', 'quarantined'].includes(binding.verificationStatus)) errors.push(`${label}: unknown verification status`)
  if (binding && question.sourceRef?.sha256 !== binding.questionDocumentSha256) errors.push(`${label}: question SHA does not match binding`)
  if (binding && answer?.answerRef?.sha256 !== binding.answerDocumentSha256) errors.push(`${label}: answer SHA does not match binding`)
  if (question.sourceRef?.sha256 && answer?.answerRef?.sha256 && question.sourceRef.sha256 === answer.answerRef.sha256) errors.push(`${label}: QP and MS cannot share a document SHA`)
  if (binding?.verificationStatus !== 'quarantined' && normaliseQuestionGroup(question, answer).status !== 'verified') errors.push(`${label}: question parts do not reconcile with total marks`)
  if (binding) errors.push(...reviewedPartEvidenceErrors(question, answer, binding, label))
  if (binding?.verificationStatus !== 'quarantined') {
    const key = [question.qualificationId, question.stageTags.join('+'), question.knowledgeGroupId].join(' | ')
    inventory.set(key, (inventory.get(key) || 0) + 1)
  }
}

for (const questionId of duplicateBindings) errors.push(`${questionId}: duplicate answer binding`)
for (const answer of index.answers) {
  if (!index.bindings.some((binding) => binding.answerId === answer.answerId)) errors.push(`${answer.answerId}: unbound answer`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  const quarantined = index.bindings.filter((binding) => binding.verificationStatus === 'quarantined').length
  const ready = [...inventory.entries()].filter(([, count]) => count >= 10).length
  const short = [...inventory.entries()].filter(([, count]) => count < 10).length
  console.log(JSON.stringify({
    schemaVersion: index.schemaVersion,
    questions: index.questions.length,
    answers: index.answers.length,
    bindings: index.bindings.length,
    quarantined,
    drillReadyTopics: ready,
    topicsNeedingMoreIndexedItems: short,
    inventory: Object.fromEntries([...inventory.entries()].sort()),
  }, null, 2))
}
