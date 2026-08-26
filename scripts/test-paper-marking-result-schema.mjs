import assert from 'node:assert/strict'
import { completedMarksByQuestion } from '../src/lib/paperMarking.js'

const questionNumberByPartId = {
  'question-1-a': 1,
  'question-1-b': 1,
}

function submission(questions) {
  return {
    status: 'completed',
    result: { questions },
  }
}

const valid = completedMarksByQuestion(submission([
  {
    questionPartId: 'question-1-a',
    awardedMarks: 2,
    maxMarks: 3,
    confidence: 0.91,
    reviewRequired: false,
    markPoints: [],
  },
  {
    questionPartId: 'question-1-b',
    awardedMarks: 1,
    maxMarks: 1,
    confidence: 0.88,
    reviewRequired: false,
    markPoints: [],
  },
]), questionNumberByPartId)
assert.equal(valid[1].status, 'completed', 'a complete valid result must remain completed')
assert.deepEqual([valid[1].rawMarks, valid[1].maxMarks], [3, 4], 'valid marks must preserve their numeric totals')

const missingAwardedMarks = completedMarksByQuestion(submission([
  {
    questionPartId: 'question-1-a',
    maxMarks: 3,
    confidence: 0.91,
    reviewRequired: false,
    markPoints: [],
  },
  {
    questionPartId: 'question-1-b',
    awardedMarks: 1,
    maxMarks: 1,
    confidence: 0.88,
    reviewRequired: false,
    markPoints: [],
  },
]), questionNumberByPartId)
assert.deepEqual(missingAwardedMarks, {}, 'missing awardedMarks must not become a completed zero')

const invalidMaxMarks = completedMarksByQuestion(submission([
  {
    questionPartId: 'question-1-a',
    awardedMarks: 0,
    maxMarks: 'not-a-number',
    confidence: 0.91,
    reviewRequired: false,
    markPoints: [],
  },
  {
    questionPartId: 'question-1-b',
    awardedMarks: 1,
    maxMarks: 1,
    confidence: 0.88,
    reviewRequired: false,
    markPoints: [],
  },
]), questionNumberByPartId)
assert.deepEqual(invalidMaxMarks, {}, 'invalid maxMarks must fail closed instead of becoming zero')

const missingResultQuestion = completedMarksByQuestion(submission([
  {
    questionPartId: 'question-1-a',
    awardedMarks: 2,
    maxMarks: 3,
    confidence: 0.91,
    reviewRequired: false,
    markPoints: [],
  },
]), questionNumberByPartId)
assert.deepEqual(missingResultQuestion, {}, 'missing result parts must not yield a partial completed question')

const missingResultQuestions = completedMarksByQuestion({
  status: 'completed',
  result: {},
}, questionNumberByPartId)
assert.deepEqual(missingResultQuestions, {}, 'missing result questions must not yield a completed score')

const unknownResultQuestion = completedMarksByQuestion(submission([
  {
    questionPartId: 'question-1-a',
    awardedMarks: 2,
    maxMarks: 3,
    confidence: 0.91,
    reviewRequired: false,
    markPoints: [],
  },
  {
    questionPartId: 'question-1-b',
    awardedMarks: 1,
    maxMarks: 1,
    confidence: 0.88,
    reviewRequired: false,
    markPoints: [],
  },
  {
    questionPartId: 'question-unknown',
    awardedMarks: 1,
    maxMarks: 1,
    confidence: 0.88,
    reviewRequired: false,
    markPoints: [],
  },
]), questionNumberByPartId)
assert.deepEqual(unknownResultQuestion, {}, 'unrecognized result parts must fail closed')

const invalidMarkPoint = completedMarksByQuestion(submission([
  {
    questionPartId: 'question-1-a',
    awardedMarks: 2,
    maxMarks: 3,
    confidence: 0.91,
    reviewRequired: false,
    markPoints: [{ pointId: 'M1', awardedMarks: 'invalid' }],
  },
  {
    questionPartId: 'question-1-b',
    awardedMarks: 1,
    maxMarks: 1,
    confidence: 0.88,
    reviewRequired: false,
    markPoints: [],
  },
]), questionNumberByPartId)
assert.deepEqual(invalidMarkPoint, {}, 'invalid mark-point numbers must fail closed')

console.log(JSON.stringify({
  status: 'passed',
  validRawMarks: valid[1].rawMarks,
  validMaxMarks: valid[1].maxMarks,
  rejectedCases: 6,
}))
