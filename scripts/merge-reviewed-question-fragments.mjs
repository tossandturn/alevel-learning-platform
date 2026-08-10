import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { normaliseQuestionGroup } from '../src/data/questionParts.js'

const projectRoot = path.resolve(import.meta.dirname, '..')
const outputPath = path.join(projectRoot, 'src', 'data', 'importedQuestionIndex.json')
const reviewedSetsRoot = path.join(projectRoot, 'src', 'data', 'reviewedQuestionSets')
const libraryRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')

function parseArgs(argv) {
  const options = { fragments: [], expectedQuestions: null, expectedMarks: null }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--expected-questions') options.expectedQuestions = Number(argv[++index])
    else if (value === '--expected-marks') options.expectedMarks = Number(argv[++index])
    else options.fragments.push(path.resolve(value))
  }
  return options
}

function sha256File(filePath) {
  assert.ok(fs.existsSync(filePath), `Missing source file ${filePath}`)
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function questionNumber(value) {
  const match = String(value?.sourceRef?.question || value?.questionId || '').match(/(?:q|Q)(\d+)/)
  return match ? Number(match[1]) : null
}

function naturalId(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true })
}

function validateFragment(fragment, sourcePath) {
  assert.equal(fragment.schemaVersion, 2, `${sourcePath}: expected schemaVersion 2`)
  assert.ok(Array.isArray(fragment.questions) && fragment.questions.length, `${sourcePath}: questions are missing`)
  assert.equal(fragment.answers?.length, fragment.questions.length, `${sourcePath}: answer count mismatch`)
  assert.equal(fragment.bindings?.length, fragment.questions.length, `${sourcePath}: binding count mismatch`)
}

function canonicalBindingEvidence(binding, question, answer) {
  const answerParts = new Map((answer.answerParts || []).map((part) => [part.partId, part]))
  return {
    ...binding,
    reviewEvidence: {
      ...binding.reviewEvidence,
      questionPaper: binding.reviewEvidence?.questionPaper || {
        file: question.sourceRef.paper,
        sha256: binding.questionDocumentSha256,
      },
      markScheme: binding.reviewEvidence?.markScheme || {
        file: answer.answerRef.file,
        sha256: binding.answerDocumentSha256,
      },
      partAllocations: (binding.reviewEvidence?.partAllocations || []).map((allocation) => {
        const evidence = (answerParts.get(allocation.partId)?.markSchemeEvidence || [])
          .map((item) => String(item?.text || '').trim())
          .filter(Boolean)
        return {
          ...allocation,
          markPointCount: allocation.markPointCount ?? evidence.length,
          markSchemeEvidence: allocation.markSchemeEvidence || evidence,
        }
      }),
    },
  }
}

function validateReviewedSet({ questions, answers, bindings, expectedQuestions, expectedMarks }) {
  const answersById = new Map(answers.map((answer) => [answer.answerId, answer]))
  const bindingsByQuestion = new Map(bindings.map((binding) => [binding.questionId, binding]))
  assert.equal(answersById.size, answers.length, 'Duplicate reviewed answer IDs')
  assert.equal(bindingsByQuestion.size, bindings.length, 'Duplicate reviewed question bindings')
  const numbers = questions.map(questionNumber).sort((left, right) => left - right)
  assert.ok(numbers.every(Number.isInteger), 'Every reviewed question must have a printed number')
  assert.equal(new Set(numbers).size, numbers.length, 'Duplicate reviewed question numbers')
  if (Number.isInteger(expectedQuestions)) {
    assert.deepEqual(numbers, Array.from({ length: expectedQuestions }, (_, index) => index + 1), 'Reviewed paper must contain every printed question exactly once')
  }
  let paperMarks = 0
  for (const question of questions) {
    const binding = bindingsByQuestion.get(question.questionId)
    const answer = answersById.get(binding?.answerId)
    assert.ok(binding && answer, `${question.questionId}: missing reviewed answer binding`)
    assert.equal(binding.verificationStatus, 'reviewed', `${question.questionId}: binding is not reviewed`)
    assert.equal(binding.questionDocumentSha256, question.sourceRef?.sha256, `${question.questionId}: QP SHA mismatch`)
    assert.equal(binding.answerDocumentSha256, answer.answerRef?.sha256, `${question.questionId}: MS SHA mismatch`)
    assert.equal(binding.reviewEvidence?.method, 'paired-qp-ms-page-review', `${question.questionId}: unsupported review method`)
    assert.equal(binding.reviewEvidence?.questionPaper?.sha256, question.sourceRef?.sha256, `${question.questionId}: reviewed QP evidence mismatch`)
    assert.equal(binding.reviewEvidence?.markScheme?.sha256, answer.answerRef?.sha256, `${question.questionId}: reviewed MS evidence mismatch`)
    const group = normaliseQuestionGroup(question, answer)
    assert.equal(group.status, 'verified', `${question.questionId}: question and answer parts do not reconcile`)
    assert.equal(group.totalMarks, group.parts.reduce((sum, part) => sum + part.marks, 0), `${question.questionId}: part marks do not equal question marks`)
    const allocations = new Map((binding.reviewEvidence.partAllocations || []).map((allocation) => [allocation.partId, allocation]))
    assert.equal(allocations.size, group.parts.length, `${question.questionId}: allocation evidence count mismatch`)
    for (const part of group.parts) {
      const allocation = allocations.get(part.partId)
      const answerPart = answer.answerParts.find((candidate) => candidate.partId === part.partId)
      assert.ok(allocation && answerPart, `${part.partId}: reviewed evidence is incomplete`)
      assert.equal(allocation.marks, part.marks, `${part.partId}: reviewed marks mismatch`)
      assert.equal(allocation.questionPage, part.sourcePage, `${part.partId}: reviewed QP page mismatch`)
      assert.equal(allocation.markSchemePage, part.answerSourcePage, `${part.partId}: reviewed MS page mismatch`)
      const evidenceText = (answerPart.markSchemeEvidence || []).map((item) => String(item?.text || '').trim()).filter(Boolean)
      assert.ok(evidenceText.length, `${part.partId}: quoted mark-scheme evidence is missing`)
      assert.equal(allocation.markPointCount, evidenceText.length, `${part.partId}: mark-point evidence count mismatch`)
      assert.deepEqual(allocation.markSchemeEvidence, evidenceText, `${part.partId}: allocation evidence text mismatch`)
    }
    paperMarks += group.totalMarks
  }
  if (Number.isInteger(expectedMarks)) assert.equal(paperMarks, expectedMarks, 'Reviewed paper total is incorrect')
  return { numbers, paperMarks }
}

function mergeIntoIndex(index, paperId, questions, answers, bindings) {
  const prefix = `${paperId}:`
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    questions: [...index.questions.filter((question) => question.sourceRef?.paperId !== paperId && !question.questionId?.startsWith(prefix)), ...questions]
      .sort((left, right) => naturalId(left.questionId, right.questionId)),
    answers: [...index.answers.filter((answer) => !answer.answerId?.startsWith(prefix)), ...answers]
      .sort((left, right) => naturalId(left.answerId, right.answerId)),
    bindings: [...index.bindings.filter((binding) => !binding.questionId?.startsWith(prefix)), ...bindings]
      .sort((left, right) => naturalId(left.questionId, right.questionId)),
  }
}

const options = parseArgs(process.argv.slice(2))
assert.ok(options.fragments.length, 'Pass one or more reviewed fragment JSON files')
const fragments = options.fragments.map((sourcePath) => {
  const fragment = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
  validateFragment(fragment, sourcePath)
  return { sourcePath, fragment }
})
const paperIds = new Set(fragments.flatMap(({ fragment }) => fragment.questions.map((question) => question.sourceRef?.paperId)))
assert.equal(paperIds.size, 1, 'Reviewed fragments must belong to one paper')
const [paperId] = paperIds
const questions = fragments.flatMap(({ fragment }) => fragment.questions)
const answers = fragments.flatMap(({ fragment }) => fragment.answers)
const rawBindings = fragments.flatMap(({ fragment }) => fragment.bindings)
const questionsById = new Map(questions.map((question) => [question.questionId, question]))
const answersById = new Map(answers.map((answer) => [answer.answerId, answer]))
const bindings = rawBindings.map((binding) => canonicalBindingEvidence(binding, questionsById.get(binding.questionId), answersById.get(binding.answerId)))
const { numbers, paperMarks } = validateReviewedSet({ ...options, questions, answers, bindings })

const firstQuestion = questions[0]
const firstAnswer = answers[0]
const qpPath = path.join(libraryRoot, firstQuestion.subjectCode, firstQuestion.sourceRef.paper)
const msPath = path.join(libraryRoot, firstQuestion.subjectCode, firstAnswer.answerRef.file)
assert.equal(sha256File(qpPath), firstQuestion.sourceRef.sha256, 'Reviewed QP checksum does not match the local source PDF')
assert.equal(sha256File(msPath), firstAnswer.answerRef.sha256, 'Reviewed MS checksum does not match the local source PDF')

const reviewedSet = {
  schemaVersion: 'reviewed-question-set.v1',
  generatedAt: new Date().toISOString(),
  paperId,
  questionCount: numbers.length,
  totalMarks: paperMarks,
  sourceFragments: fragments.map(({ sourcePath }) => ({ file: path.basename(sourcePath), sha256: sha256File(sourcePath) })),
  questions: [...questions].sort((left, right) => questionNumber(left) - questionNumber(right)),
  answers: [...answers].sort((left, right) => naturalId(left.answerId, right.answerId)),
  bindings: [...bindings].sort((left, right) => naturalId(left.questionId, right.questionId)),
}
fs.mkdirSync(reviewedSetsRoot, { recursive: true })
const reviewedSetPath = path.join(reviewedSetsRoot, `${paperId}.json`)
fs.writeFileSync(reviewedSetPath, `${JSON.stringify(reviewedSet, null, 2)}\n`)

const index = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
const merged = mergeIntoIndex(index, paperId, reviewedSet.questions, reviewedSet.answers, reviewedSet.bindings)
fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`)
console.log(`Merged ${numbers.length} reviewed questions (${paperMarks} marks) for ${paperId}.`)
console.log(`Canonical reviewed set: ${reviewedSetPath}`)
