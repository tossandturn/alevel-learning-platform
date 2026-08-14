import assert from 'node:assert/strict'
import fs from 'node:fs'
import { coachPracticeOptions, buildCoachPractice, paperQuestionMarkingMetadata } from '../src/lib/verifiedPracticeCatalog.js'
import { scorePaperMultipleChoice } from '../src/lib/paperMarking.js'

const physicsRouteId = 'cie-9702-as-physics'
const options = coachPracticeOptions()
const physicsOptions = options.filter((option) => option.routeId === physicsRouteId)

assert.equal(physicsOptions.length, 1, 'AI Practice must expose one exact AS Physics route')
assert.equal(physicsOptions[0].subjectId, 'physics', 'Physics route metadata must remain Physics-specific')

const buildableTopic = physicsOptions[0].topics.find((topic) => Number(topic.inventory) >= 10)
assert.ok(buildableTopic, 'regression fixture must retain one Physics topic with at least ten reviewed groups')
const generated = buildCoachPractice({
  routeId: physicsRouteId,
  subjectId: physicsOptions[0].subjectId,
  stage: physicsOptions[0].stage,
  knowledgeGroupId: buildableTopic.id,
  questionCount: 10,
})
assert.equal(generated.questionGroupCount, 10, 'ten-question selection must contain ten source question groups')
assert.ok(generated.parts.length >= generated.questionGroupCount, 'answer parts may exceed question groups without changing the question count')
assert.equal(generated.routeId, physicsRouteId, 'generated practice must stay on the selected Physics route')

const p1Metadata = paperQuestionMarkingMetadata({
  paperId: 'cie-9702-9702_m25_qp_12',
  routeId: physicsRouteId,
})
assert.deepEqual(Object.keys(p1Metadata).map(Number), Array.from({ length: 40 }, (_, index) => index + 1), '9702 M25 P1 must expose the official forty MCQ slots')
assert.equal(p1Metadata[1].parts[0].answerKey, 'D', '9702 M25 P1 Q1 must preserve the official D answer key')

const wrong = scorePaperMultipleChoice({ answer: { choice: 'A' }, answerKey: 'D', marks: 1 })
const correct = scorePaperMultipleChoice({ answer: { choice: 'D' }, answerKey: 'D', marks: 1 })
assert.equal(wrong.awarded, 0, 'an incorrect MCQ must receive an explicit numeric zero')
assert.equal(wrong.maxMarks, 1)
assert.equal(wrong.status, 'missed')
assert.equal(correct.awarded, 1)

const p2Metadata = paperQuestionMarkingMetadata({
  paperId: 'cie-9702-9702_m25_qp_22',
  routeId: physicsRouteId,
})
assert.deepEqual(Object.keys(p2Metadata).map(Number), [1, 2, 3, 4, 5, 6, 7], '9702 M25 P2 must not create phantom Q8-Q12 answer slots')

const paperWorkspaceSource = fs.readFileSync(new URL('../src/components/PaperWorkspace.jsx', import.meta.url), 'utf8')
assert.match(paperWorkspaceSource, /if \(score == null\) continue/, 'paper MCQ submission must retain an explicit zero score')
assert.doesNotMatch(paperWorkspaceSource, /if \(!score\) continue/, 'paper MCQ submission must not treat an explicit zero score as missing')

const practiceWorkspaceSource = fs.readFileSync(new URL('../src/components/PracticeWorkspace.jsx', import.meta.url), 'utf8')
assert.match(practiceWorkspaceSource, /source question/, 'topic workspace must distinguish source question groups from answer parts')
assert.match(practiceWorkspaceSource, /answer part/, 'topic workspace must label answer-part progress explicitly')

console.log(JSON.stringify({
  status: 'passed',
  physicsTopics: physicsOptions[0].topics.length,
  generatedQuestionGroups: generated.questionGroupCount,
  generatedAnswerParts: generated.parts.length,
  p1QuestionCount: Object.keys(p1Metadata).length,
  p2QuestionCount: Object.keys(p2Metadata).length,
  q1AnswerKey: p1Metadata[1].parts[0].answerKey,
  wrongAnswerAwarded: wrong.awarded,
}))
