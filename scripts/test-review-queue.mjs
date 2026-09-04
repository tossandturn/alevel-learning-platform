import assert from 'node:assert/strict'
import { answeredQuestionCount, attemptResponseProjection, buildAttemptReviewQueue, buildLearningExport, buildProvisionalAttemptEvidence } from '../src/lib/attemptAudit.js'
import { buildLearningProgress } from '../src/lib/learningProgress.js'

const unit = {
  id: 'queue-unit',
  routeId: 'cie-0580-igcse-mathematics',
  stage: 'IGCSE',
  topic: 'Number',
  parts: Array.from({ length: 10 }, (_, index) => ({
    id: `q${index + 1}`,
    label: `Question ${index + 1}`,
    sourceRef: { paper: '0580_m25_qp_12', question: `Q${index + 1}` },
    markPoints: index === 0 ? ['Uses place value to write 20 000'] : [],
  })),
}
const sourceAttempt = {
  id: 'attempt-original',
  unitId: unit.id,
  routeId: unit.routeId,
  attemptStatus: 'result',
  submittedAt: '2026-08-12T09:00:00.000Z',
  answers: { q1: '20000' },
  scoreResult: {
    rawMarks: 0,
    maxMarks: 1,
    percentage: 0,
    criteria: [{ partId: 'q1', awarded: 0, maxMarks: 1, feedback: 'Check place value.', evidence: [{ point: 'Writes 20 000', awarded: false }] }],
  },
}
const retest = {
  ...sourceAttempt,
  id: 'attempt-retest',
  retestOf: sourceAttempt.id,
  submittedAt: '2026-08-12T10:00:00.000Z',
  scoreResult: { rawMarks: 1, maxMarks: 1, percentage: 100, criteria: [{ partId: 'q1', awarded: 1, maxMarks: 1, feedback: '' }] },
}

const queue = buildAttemptReviewQueue({ attempts: [sourceAttempt], units: [unit], routeId: unit.routeId })
assert.equal(queue.length, 1, 'one answered incorrect part must create one review item')
assert.equal(queue[0].sourcePaperId, '0580_m25_qp_12')
assert.match(queue[0].searchText, /0580_m25_qp_12/i, 'Notebook search must include the source paper ID')
assert.match(queue[0].searchText, /question 1|q1/i, 'Notebook search must include the source question number')
assert.match(queue[0].searchText, /number/i, 'Notebook search must include the topic')
assert.match(queue[0].searchText, /place value/i, 'Notebook search must include mark-point evidence')
assert.equal(answeredQuestionCount(sourceAttempt, unit.parts), 1, 'nine blank parts must remain unanswered')

const exportPayload = buildLearningExport({ attempts: [sourceAttempt], reviewQueueAudit: [] }, { units: [unit], exportedAt: '2026-08-12T09:01:00.000Z' })
assert.equal(exportPayload.audit.answeredQuestionCount, 1, 'export must use answered count, not set size')
assert.equal(exportPayload.data.notebook.items.length, 1, 'export must contain the same one incorrect answered part')
assert.equal(exportPayload.data.responses.length, 1, 'export must include only the answered response, never synthesize blank answers')
assert.equal(buildAttemptReviewQueue({ attempts: [sourceAttempt, retest], units: [unit], routeId: unit.routeId }).length, 0, 'a successful append-only retest must resolve the original queue item without overwriting it')
assert.equal(exportPayload.data.attempts.length, 1)

const snoozed = buildAttemptReviewQueue({
  attempts: [sourceAttempt],
  units: [unit],
  routeId: unit.routeId,
  reviewQueueAudit: [{ id: 'audit-1', reviewItemId: queue[0].id, action: 'snoozed', reason: 'Revise tomorrow', at: '2026-08-12T09:02:00.000Z', snoozeUntil: '2026-08-13T09:02:00.000Z' }],
  now: Date.parse('2026-08-12T10:00:00.000Z'),
})
assert.equal(snoozed.length, 0, 'a future snooze must hide only the review item, not the attempt')

const progress = buildLearningProgress({ attempts: [sourceAttempt], units: [unit], routeId: unit.routeId, weeklyTarget: 10 })
assert.equal(progress.week.completedQuestions, 1, 'Dashboard/Progress must count the single answered part')

const deleted = buildAttemptReviewQueue({
  attempts: [sourceAttempt],
  units: [unit],
  routeId: unit.routeId,
  reviewQueueAudit: [{ id: 'audit-2', reviewItemId: queue[0].id, action: 'deleted', reason: 'Duplicate review item', at: '2026-08-12T10:02:00.000Z' }],
})
assert.equal(deleted.length, 0, 'a deleted review item must be hidden while the append-only attempt remains exportable')

for (const action of ['ignored', 'archived', 'dismissed', 'manual-mastered']) {
  const event = {
    id: `audit-${action}`,
    reviewItemId: queue[0].id,
    action,
    reason: `${action} for a documented reason`,
    at: '2026-08-12T10:03:00.000Z',
  }
  assert.equal(
    buildAttemptReviewQueue({ attempts: [sourceAttempt], units: [unit], routeId: unit.routeId, reviewQueueAudit: [event] }).length,
    0,
    `${action} must hide the review item without changing the append-only attempt`,
  )
  const auditedExport = buildLearningExport({ attempts: [sourceAttempt], reviewQueueAudit: [event] }, { units: [unit], exportedAt: '2026-08-12T10:04:00.000Z' })
  assert.deepEqual(auditedExport.data.notebook.reviewQueueAudit, [event], `${action} reason and audit time must remain exportable`)
}

const provisional = {
  ...sourceAttempt,
  id: 'attempt-provisional',
  attemptStatus: 'provisional-result',
  scoreResult: { ...sourceAttempt.scoreResult, partial: true, unansweredPartCount: 9 },
}
const provisionalProjection = attemptResponseProjection(provisional, unit)
assert.deepEqual(provisionalProjection.answeredPartIds, ['q1'], 'a partial attempt must retain its one submitted response')
assert.deepEqual(provisionalProjection.incorrectPartIds, ['q1'], 'a partial attempt must identify only its scored incorrect response')
assert.deepEqual(provisionalProjection.unansweredPartIds, ['q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'], 'blank parts must remain explicitly unfinished')
assert.deepEqual(buildProvisionalAttemptEvidence({ attempts: [provisional], units: [unit], routeId: unit.routeId }).map((item) => item.projection), [{
  answeredQuestionCount: 1,
  incorrectQuestionCount: 1,
  unansweredQuestionCount: 9,
}], 'Dashboard, Progress, Notebook and Export must derive provisional evidence from the same response projection')
assert.equal(buildAttemptReviewQueue({ attempts: [provisional], units: [unit], routeId: unit.routeId }).length, 0, 'a partial attempt must not pollute the formal mistake queue')
const provisionalQueue = buildAttemptReviewQueue({ attempts: [provisional], units: [unit], routeId: unit.routeId, includeProvisional: true })
assert.equal(provisionalQueue.length, 1, 'Notebook may show the one answered incorrect response as provisional evidence')
assert.deepEqual(provisionalQueue[0].responseProjection, {
  answeredQuestionCount: 1,
  incorrectQuestionCount: 1,
  unansweredQuestionCount: 9,
}, 'Notebook provisional evidence must retain the same answered, incorrect and unanswered projection as History and Export')
assert.equal(buildLearningProgress({ attempts: [provisional], units: [unit], routeId: unit.routeId, weeklyTarget: 10 }).week.completedQuestions, 0, 'a provisional score must not update Dashboard or Progress')
const provisionalExport = buildLearningExport({ attempts: [provisional] }, { units: [unit], exportedAt: '2026-08-12T10:05:00.000Z' })
assert.deepEqual(provisionalExport.audit.attempts[0].answeredPartIds, ['q1'], 'export must retain the same answered projection for partial attempts')
assert.equal(provisionalExport.audit.attempts[0].incorrectQuestionCount, 1, 'export must retain the same one incorrect response for partial attempts')
assert.equal(provisionalExport.audit.attempts[0].unansweredQuestionCount, 9, 'export must retain the same nine unfinished parts for partial attempts')
assert.equal(provisionalExport.data.notebook.items.length, 0, 'formal exported mistakes must exclude provisional attempts')
assert.equal(provisionalExport.data.notebook.provisionalItems.length, 1, 'export must retain the one answered incorrect response as provisional evidence')
console.log('Review queue projection checks passed')
