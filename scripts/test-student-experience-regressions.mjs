import assert from 'node:assert/strict'
import fs from 'node:fs'
import { courseRoutes, routeForStagePreservingSubject } from '../src/data/routeRegistry.js'
import { filterDefaults, restorePaperFilters, paperFilterStorageKey } from '../src/lib/paperFilters.js'
import { buildLearningProgress, latestSubmittedActivity } from '../src/lib/learningProgress.js'

const igcsePhysics = courseRoutes.find((route) => route.routeId === 'cie-0625-igcse-physics')
const asPhysics = routeForStagePreservingSubject(igcsePhysics, 'AS')
assert.equal(asPhysics?.routeId, 'cie-9702-as-physics', 'switching IGCSE Physics to AS must preserve Physics instead of choosing AS Biology')

const igcseMath = courseRoutes.find((route) => route.routeId === 'cie-0580-igcse-mathematics')
const asMath = routeForStagePreservingSubject(igcseMath, 'AS')
assert.equal(asMath?.subject, 'Mathematics', 'stage switching must preserve the subject family for Mathematics')

assert.equal(
  paperFilterStorageKey('cie-9702-as-physics', 'past-paper-practice'),
  'stem-paper-filters:cie-9702-as-physics:past-paper-practice',
  'paper filters must be scoped by route and study mode',
)
assert.deepEqual(
  restorePaperFilters({ ...filterDefaults('9702'), year: '2025', paperNumber: '2' }, '9702'),
  { ...filterDefaults('9702'), year: '2025', paperNumber: '2' },
  'paper filters should restore valid route-scoped values',
)
assert.deepEqual(
  restorePaperFilters({ ...filterDefaults('9701'), subject: '9701' }, '9702'),
  filterDefaults('9702'),
  'paper filters from another course must not cross-contaminate the active course',
)

const unit = {
  id: 'unit-physics',
  routeId: 'cie-9702-as-physics',
  stage: 'AS',
  parts: [{ id: 'q1' }, { id: 'q2' }],
}
const paperSession = {
  attemptId: 'paper-attempt-1',
  routeId: 'cie-9702-as-physics',
  subject: '9702',
  submittedAt: '2026-08-14T08:00:00.000Z',
  completedAt: '2026-08-14T08:00:00.000Z',
  questionCount: 40,
  answeredCount: 1,
}
const partialPaperReview = {
  attemptId: 'paper-attempt-1',
  rawMarks: 0,
  maxMarks: 40,
  partial: true,
  scoredQuestionNumbers: [1],
}
const activity = latestSubmittedActivity({
  attempts: [],
  units: [unit],
  paperSessions: [paperSession],
  paperReviews: [partialPaperReview],
  routes: courseRoutes,
  routeId: 'cie-9702-as-physics',
})
assert.equal(activity.kind, 'paper', 'the dashboard must expose the latest submitted paper activity')
assert.equal(activity.answeredCount, 1, 'paper activity must preserve the answered count')
assert.equal(activity.partial, true, 'a partial paper review must remain visibly provisional')

const progress = buildLearningProgress({
  attempts: [],
  drafts: {},
  units: [unit],
  routes: courseRoutes,
  routeId: 'cie-9702-as-physics',
  weeklyTarget: 10,
  paperSessions: [paperSession],
  paperReviews: [partialPaperReview],
})
assert.equal(progress.week.completedQuestions, 0, 'partial paper work must not enter formal progress')
assert.equal(progress.week.completedSets, 0, 'partial paper work must not create a completed-set event')

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
assert.match(appSource, /function StudentDashboard\(\{[\s\S]*latestActivity/, 'Today dashboard must receive the latest paper activity')
assert.match(appSource, /const latest = latestActivity \|\| scoredAttempts\.at\(-1\)/, 'Today dashboard must prefer the latest paper/topic activity')

console.log('Student experience regressions passed.')
