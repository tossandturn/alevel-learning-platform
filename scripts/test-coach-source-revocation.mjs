import assert from 'node:assert/strict'
import { studyQuestionBank, isVerifiedPastPaperItem } from '../src/data/questionBank.js'
import { createCoachQuestionSourceResolver } from '../server/coachQuestionSource.js'

const question = studyQuestionBank.find((item) => item.sourceRef?.paper === '9702_m24_qp_22.pdf'
  && item.sourceRef.question === 'Q2' && isVerifiedPastPaperItem(item))
assert.ok(question)
let revoked = false, calls = 0
const provider = ({ routeId }) => {
  calls += 1
  assert.equal(routeId, question.routeId)
  if (revoked) throw Object.assign(new Error('candidate unavailable'), { code: 'AI_STUDY_PROMOTION_INVALID', statusCode: 503 })
  return [question]
}
provider.alwaysRefresh = true
const resolver = createCoachQuestionSourceResolver({ questionBankProvider: provider })
const authorization = { coachAccess: { binding: 'authoritative-attempt' }, routeId: question.routeId,
  paperId: question.sourceRef.paperId, paper: { id: question.sourceRef.paperId, questionFile: question.sourceRef.paper },
  question: { id: question.sourceQuestionId, number: 2 } }
assert.equal(resolver.resolve({ authorization }).method, 'bound-record')
revoked = true
assert.throws(() => resolver.resolve({ authorization }), { code: 'AI_STUDY_PROMOTION_INVALID', statusCode: 503 },
  'a revoked candidate must propagate its error rather than retain a cached source match')
revoked = false
assert.equal(resolver.resolve({ authorization }).method, 'bound-record')
assert.equal(calls, 3)
console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'coach-source-revocation-and-recovery' }))
