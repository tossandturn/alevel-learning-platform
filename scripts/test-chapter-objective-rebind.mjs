import assert from 'node:assert/strict'
import { projectNativeObjectivePracticeUnit } from '../server/objectiveAnswers.js'

const question = { routeId: 'cie-9708-as-economics', subjectCode: '9708', paperComponent: 1,
  sourceQuestionId: 'cie-9708-9708_m25_qp_12:q3', sourceRef: { paperId: 'cie-9708-9708_m25_qp_12' },
  parts: [{ partId: 'cie-9708-9708_m25_qp_12:q3:part-whole' }] }
const part = { id: 'synthetic-part', sourceQuestionId: question.sourceQuestionId, questionPartId: `${question.sourceQuestionId}:part-whole`,
  answerType: 'handwritten', answerKey: 'A', markSchemePoints: ['not for the browser'] }
const unit = { routeId: question.routeId, studyMode: 'chapter-study', parts: [part] }
const result = projectNativeObjectivePracticeUnit(unit, { questionBank: [question] })
assert.equal(result.parts[0].answerType, 'multiple-choice')
assert.equal(result.parts[0].serverDeterministicScoringAvailable, true)
assert.deepEqual(result.parts[0].choiceLabels, ['A', 'B', 'C', 'D'])
assert.equal(Object.hasOwn(result.parts[0], 'answerKey'), false)
assert.equal(Object.hasOwn(result.parts[0], 'markSchemePoints'), false)
const otherRoute = projectNativeObjectivePracticeUnit(unit, { questionBank: [{ ...question, routeId: 'cie-9708-a2-economics' }] })
assert.equal(otherRoute.parts[0].serverDeterministicScoringAvailable, undefined)
console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', sourceBoundRebind: true, answerHidden: true }))
