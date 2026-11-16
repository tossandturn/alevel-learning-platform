import assert from 'node:assert/strict'
import { buildPartMarkingLifecycle, canUseAiAssistedMarking, dependentScoringResponses, mergeStoredScoringContextReviews, visionReviewFailure, visionReviewOutcome } from '../src/lib/markingLifecycle.js'
import { markingStatusForPart } from '../src/lib/practicePresentation.js'

const part = { id: 'synthetic-c', marks: 2, answerType: 'written', reviewStatus: 'ai-verified',
  aiAssistedMarkingAvailable: true, studentStudyEligible: true,
  markingProvenance: { sourceQuestionId: 'synthetic:q4', questionPartId: 'synthetic:q4:part-c' },
  sourceBindingProvenance: { sourceQuestionId: 'synthetic:q4', questionPartId: 'synthetic:q4:part-c' } }
assert.equal(canUseAiAssistedMarking(part), true, 'released and source-bound AI-verified parts must enter AI review')
for (const untrusted of [{ ...part, studentStudyEligible: false }, { ...part, markingProvenance: null },
  { ...part, sourceBindingProvenance: null }, { ...part, reviewStatus: 'quarantined' }]) {
  assert.equal(canUseAiAssistedMarking(untrusted), false, 'unreleased or unbound parts must remain unavailable')
}
const review = visionReviewFailure({ code: 'scoring_context_human_review_required', reviewRequired: true,
  humanReviewRequired: true, error: 'Automatic marking is unavailable. Your answer remains saved.' })
assert.equal(review.status, 'review_required')
assert.equal(review.code, 'scoring_context_human_review_required')
assert.equal(review.reviewRequired, true)
assert.equal(review.humanReviewRequired, true)
assert.equal(Object.hasOwn(review, 'score'), false)
const provisional = visionReviewOutcome({ mode: 'vision', score: 1, rawMarks: 1, autoFinal: false,
  resultAuthority: 'ai-provisional', reviewRequired: true, humanReviewRequired: true })
assert.equal(provisional.status, 'review_required')
assert.equal(Object.hasOwn(provisional, 'score'), false, 'an unvalidated follow-through suggestion must not enter the client score state')
const restored = mergeStoredScoringContextReviews(undefined, [part.id])[part.id]
assert.deepEqual(restored, JSON.parse(JSON.stringify(review)), 'server rehydration must restore the same no-score review state')
const cleared = mergeStoredScoringContextReviews({ [part.id]: review, other: { status: 'success' } }, [])
assert.equal(Object.hasOwn(cleared, part.id), false, 'a later resolved state must clear only the old context failure')
assert.equal(cleared.other.status, 'success')
const lifecycle = buildPartMarkingLifecycle({ id: 'synthetic-unit', parts: [part] },
  { [part.id]: 'Synthetic submitted work.' }, 10, { [part.id]: restored })
assert.equal(lifecycle.complete, false)
assert.equal(lifecycle.partStates[part.id].status, 'ai-review-pending')
assert.match(lifecycle.partStates[part.id].reason, /automatic marking|answer remains saved/i)
assert.doesNotMatch(lifecycle.partStates[part.id].reason, /queued for|will be reviewed by/i)
assert.equal(lifecycle.provisionalCriteria.length, 0)
const dependent = { ...part, sourceQuestionId: 'synthetic:q4', sourcePartLabel: 'c',
  studyOnly: true, scoringContextRequirements: { dependsOnPartLabels: ['b'] } }
assert.equal(markingStatusForPart(dependent).mode, 'ai-review-required')
assert.equal(markingStatusForPart(dependent).formalMasteryEligible, false)
const sibling = { id: 'synthetic-b', sourceQuestionId: 'synthetic:q4', sourcePartLabel: 'b', questionPartId: 'synthetic:q4:part-b' }
const unrelated = { ...sibling, id: 'other-b', sourceQuestionId: 'synthetic:q5', questionPartId: 'synthetic:q5:part-b' }
assert.deepEqual(dependentScoringResponses({ parts: [dependent, sibling, unrelated] }, dependent,
  { answers: { [sibling.id]: 'Synthetic prior b work.' } }),
[{ questionPartId: sibling.questionPartId, typedResponse: 'Synthetic prior b work.' }])
assert.deepEqual(dependentScoringResponses({ parts: [dependent, sibling, { ...sibling, id: 'duplicate-b' }] }, dependent,
  { answers: { [sibling.id]: 'Synthetic prior b work.' } }), [], 'ambiguous sibling binding must not be sent')
console.log(JSON.stringify({ status: 'PASS_LOCAL_SYNTHETIC_ONLY', savedReviewState: true, noAutomaticScore: true }))
