import { courseRoutes } from '../data/routeRegistry.js'
import { LEGACY_UNSCOPED_ROUTE_ID, resolveRouteBinding } from './routeMigration.js'
import { answeredQuestionCount, isScoredAttempt } from './attemptAudit.js'
import { stableSorted } from './arrayOrder.js'

function dayKey(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isCompletedAttempt(attempt, unit) {
  return isScoredAttempt(attempt, unit) && Boolean(attempt?.submittedAt)
}

function questionCountForAttempt(attempt, unit) {
  return answeredQuestionCount(attempt, unit?.parts || [])
}

function average(values) {
  const usable = values.map(Number).filter(Number.isFinite)
  return usable.length ? Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length) : null
}

function recentDayKeys(attempts) {
  return new Set(attempts.map((attempt) => dayKey(attempt.submittedAt)).filter(Boolean))
}

function countConsecutiveDays(dayKeys) {
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  let count = 0
  while (dayKeys.has(dayKey(cursor))) {
    count += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
}

function isWithinDays(value, days) {
  const time = Date.parse(value || '')
  return Number.isFinite(time) && Date.now() - time < days * 86_400_000
}

function latestPaperReviews(paperReviews = []) {
  const latest = new Map()
  for (const review of paperReviews) {
    const current = latest.get(review.attemptId)
    const nextTime = Date.parse(review.reviewedAt || review.completedAt || '')
    const currentTime = Date.parse(current?.reviewedAt || current?.completedAt || '')
    if (!current || nextTime >= currentTime) latest.set(review.attemptId, review)
  }
  return latest
}

function completedPaperRecords({ paperSessions = [], paperReviews = [], routeId = null } = {}) {
  const reviews = latestPaperReviews(paperReviews)
  return paperSessions
    .filter((session) => !routeId || session.routeId === routeId)
    .map((session) => ({ session, review: reviews.get(session.attemptId) }))
    .filter(({ session, review }) => {
      const questionCount = Number(session.questionCount)
      const scoredCount = review?.scoredQuestionNumbers?.length || 0
      return Boolean(review && review.partial !== true && questionCount > 0 && scoredCount >= questionCount)
    })
}

export function latestSubmittedActivity({ attempts = [], units = [], paperSessions = [], paperReviews = [], routeId = null } = {}) {
  const unitsById = unitMap(units)
  const topicActivities = attempts
    .map((attempt) => ({ attempt, unit: unitsById.get(attempt.unitId) }))
    .filter(({ attempt, unit }) => (!routeId || attempt.routeId === routeId) && unit && isScoredAttempt(attempt, unit))
    .map(({ attempt, unit }) => ({
      kind: 'topic',
      date: attempt.submittedAt,
      rawMarks: attempt.scoreResult.rawMarks,
      maxMarks: attempt.scoreResult.maxMarks,
      percentage: attempt.scoreResult.percentage,
      partial: false,
      answeredCount: answeredQuestionCount(attempt, unit.parts || []),
      questionCount: unit.parts?.length || 0,
    }))
  const reviews = latestPaperReviews(paperReviews)
  const paperActivities = paperSessions
    .filter((session) => !routeId || session.routeId === routeId)
    .map((session) => {
      const review = reviews.get(session.attemptId)
      const maxMarks = review?.maxMarks == null ? null : Number(review.maxMarks)
      const rawMarks = review?.rawMarks == null ? null : Number(review.rawMarks)
      return {
        kind: 'paper',
        date: session.completedAt || session.submittedAt,
        rawMarks: Number.isFinite(rawMarks) ? rawMarks : null,
        maxMarks: Number.isFinite(maxMarks) ? maxMarks : null,
        percentage: Number.isFinite(rawMarks) && Number.isFinite(maxMarks) && maxMarks > 0 ? rawMarks / maxMarks * 100 : null,
        partial: review ? review.partial !== false : true,
        answeredCount: Number(session.answeredCount) || 0,
        questionCount: Number(session.questionCount) || 0,
      }
    })
  return stableSorted(
    [...topicActivities, ...paperActivities]
      .filter((activity) => Number.isFinite(Date.parse(activity.date || ''))),
    (left, right) => Date.parse(right.date) - Date.parse(left.date),
  )[0] || null
}

function readTermsReviewed(routeId) {
  if (typeof window === 'undefined') return 0
  const raw = window.localStorage?.getItem('stem-professional-terms-reviewed')
  if (!raw) return 0
  try {
    const byRoute = JSON.parse(raw)
    return Number(byRoute?.[routeId]) || 0
  } catch {
    // The old scalar total cannot be assigned to one route without guessing.
    return 0
  }
}

function unitMap(units) {
  return new Map(units.map((unit) => [unit.id, unit]))
}

function topicIdentity(attempt, unit) {
  return unit?.knowledgeGroupId || unit?.topicId || unit?.syllabusTopic || unit?.topic || attempt.contentScope?.topicId || attempt.contentScope?.syllabusTopic || attempt.contentScope?.topic || null
}

function routeForRecord(record, unit, routes) {
  return resolveRouteBinding(record, { unit, routes })
}

function scopedAttempts(attempts, units, routes) {
  const unitsById = unitMap(units)
  return attempts
    .map((attempt) => {
      const unit = unitsById.get(attempt.unitId)
      const binding = routeForRecord(attempt, unit, routes)
      return { attempt, unit, ...binding }
    })
    // Historical attempts remain exportable, but they cannot affect progress
    // after their source unit is retired by the current semantic content gate.
    .filter((item) => item.unit && isCompletedAttempt(item.attempt, item.unit) && item.routeId !== LEGACY_UNSCOPED_ROUTE_ID)
}

function emptyRouteProgress(routeId, stage, weeklyTarget, drafts = {}) {
  return {
    routeId,
    stage: stage || null,
    week: { completedQuestions: 0, targetQuestions: Math.max(1, Number(weeklyTarget) || 18), completedSets: 0, average: null },
    streak: 0,
    topicProgress: [],
    masterySnapshots: [],
    milestones: [],
    openDrafts: Object.values(drafts).filter((draft) => draft?.routeId === routeId).length,
    completedSets: 0,
    events: [],
  }
}

function progressForRoute({ routeId, stage, scoped, drafts, weeklyTarget, units, routes, paperSessions = [], paperReviews = [] }) {
  const records = scoped.filter((item) => item.routeId === routeId)
  const paperRecords = completedPaperRecords({ paperSessions, paperReviews, routeId })
  if (!records.length && !paperRecords.length) return emptyRouteProgress(routeId, stage, weeklyTarget, drafts)

  const attempts = records.map((item) => item.attempt)
  const currentWeek = records.filter((item) => isWithinDays(item.attempt.submittedAt, 7))
  const currentWeekPaperRecords = paperRecords.filter(({ session }) => isWithinDays(session.completedAt || session.submittedAt, 7))
  const topicById = new Map()

  for (const { attempt, unit } of records) {
    const topicId = topicIdentity(attempt, unit)
    if (!topicId) continue
    const record = topicById.get(topicId) || {
      id: topicId,
      routeId,
      stage: stage || null,
      name: unit?.topic || attempt.contentScope?.topic || topicId,
      attempts: 0,
      questions: 0,
      scores: [],
      lastActivity: null,
    }
    record.attempts += 1
    record.questions += questionCountForAttempt(attempt, unit)
    record.scores.push(attempt.scoreResult.percentage)
    record.lastActivity = record.lastActivity && record.lastActivity > attempt.submittedAt ? record.lastActivity : attempt.submittedAt
    topicById.set(topicId, record)
  }

  const topicProgress = [...topicById.values()].map((topic) => {
    const mastery = average(topic.scores)
    return {
      ...topic,
      mastery,
      status: mastery == null ? 'Not started' : mastery >= 80 ? 'Secure' : mastery >= 60 ? 'Practising' : 'Rebuild',
    }
  })
  const correctedMistakes = records.reduce((total, { attempt, unit }) => total + (attempt.retestOf ? questionCountForAttempt(attempt, unit) : 0), 0)
  const activityDates = [
    ...attempts.map((attempt) => attempt.submittedAt),
    ...paperRecords.map(({ session }) => session.completedAt || session.submittedAt),
  ]
  const milestones = [
    { id: 'first-set', label: 'Complete your first checked set', value: attempts.length + paperRecords.length, target: 1, unit: 'set' },
    { id: 'three-days', label: 'Study on 3 different days', value: new Set(activityDates.map(dayKey)).size, target: 3, unit: 'days' },
    { id: 'fix-ten', label: 'Correct 10 questions', value: correctedMistakes, target: 10, unit: 'questions' },
    { id: 'terms-hundred', label: 'Review 100 professional terms', value: readTermsReviewed(routeId), target: 100, unit: 'terms' },
  ].map((milestone) => ({
    ...milestone,
    routeId,
    complete: milestone.value >= milestone.target,
    percentage: Math.min(100, Math.round((milestone.value / milestone.target) * 100)),
  }))

  return {
    routeId,
    stage: stage || records[0]?.stage || paperRecords[0]?.session?.stage || null,
    week: {
      completedQuestions: currentWeek.reduce((total, item) => total + questionCountForAttempt(item.attempt, item.unit), 0)
        + currentWeekPaperRecords.reduce((total, { session }) => total + Number(session.questionCount || 0), 0),
      targetQuestions: Math.max(1, Number(weeklyTarget) || 18),
      completedSets: currentWeek.length + currentWeekPaperRecords.length,
      average: average([
        ...currentWeek.map((item) => item.attempt.scoreResult.percentage),
        ...currentWeekPaperRecords.map(({ review }) => Number(review.rawMarks) / Number(review.maxMarks) * 100),
      ]),
    },
    streak: countConsecutiveDays(recentDayKeys(attempts)),
    topicProgress,
    masterySnapshots: topicProgress.map((topic) => ({
      snapshotId: `mastery:${routeId}:${topic.id}:${topic.lastActivity || 'unknown'}`,
      routeId,
      stage: stage || records[0]?.stage || paperRecords[0]?.session?.stage || null,
      topicId: topic.id,
      mastery: topic.mastery,
      sampleSize: topic.attempts,
      questionCount: topic.questions,
      capturedAt: topic.lastActivity,
    })),
    milestones,
    openDrafts: Object.values(drafts).filter((draft) => draft?.routeId === routeId).length,
    completedSets: attempts.length + paperRecords.length,
    events: buildLearningEvents({ attempts, units, routes, routeId, paperSessions, paperReviews }),
  }
}

/**
 * Builds route-bound learning facts. Unscoped legacy attempts never produce
 * events, recommendations, completion or mastery data.
 */
export function buildLearningEvents({ attempts = [], units = [], routes = courseRoutes, routeId = null, paperSessions = [], paperReviews = [] }) {
  const scoped = scopedAttempts(attempts, units, routes)
  const topicEvents = scoped
    .filter((item) => !routeId || item.routeId === routeId)
    .flatMap(({ attempt, unit, routeId: boundRouteId, stage }) => {
      const occurredAt = attempt.submittedAt || attempt.updatedAt || null
      if (!occurredAt) return []
      const base = {
        eventId: `attempt:${attempt.id}`,
        attemptId: attempt.id,
        routeId: boundRouteId,
        stage,
        subjectId: unit?.subjectId || attempt.contentScope?.subjectId || null,
        topicId: topicIdentity(attempt, unit),
        questionSetId: unit?.id || attempt.unitId,
        occurredAt,
        durationSeconds: Math.max(0, Number(attempt.elapsedSec) || 0),
        score: Number(attempt.scoreResult?.percentage),
        synced: attempt.serverSync === 'synced',
      }
      const events = [{ ...base, type: 'answer_submitted' }]
      events.push({ ...base, eventId: `result:${attempt.id}`, type: base.score >= 60 ? 'answer_correct' : 'answer_incorrect' })
      if (attempt.retestOf) events.push({ ...base, eventId: `retry:${attempt.id}`, type: 'question_retried' })
      if (base.score >= 80) events.push({ ...base, eventId: `mastery:${attempt.id}`, type: 'topic_mastered' })
      return events
    })
  const paperEvents = completedPaperRecords({ paperSessions, paperReviews, routeId }).flatMap(({ session, review }) => {
    const score = Number(review.rawMarks) / Number(review.maxMarks) * 100
    const base = {
      eventId: `paper:${session.attemptId}`,
      attemptId: session.attemptId,
      routeId: session.routeId,
      stage: session.stage,
      subjectId: session.subject || null,
      topicId: null,
      questionSetId: session.paperId,
      occurredAt: session.completedAt || session.submittedAt,
      durationSeconds: Math.max(0, Number(session.elapsedSec) || 0),
      score,
      synced: session.serverSync === 'synced',
    }
    return [
      { ...base, type: 'paper_submitted' },
      { ...base, eventId: `paper-result:${session.attemptId}`, type: 'paper_result' },
    ]
  })
  return [...topicEvents, ...paperEvents]
}

/**
 * Returns one selected route at the top level and every route under byRoute.
 * When no route is selected, top-level metrics remain empty to prevent an
 * accidental cross-stage aggregate.
 */
export function buildLearningProgress({ attempts = [], drafts = {}, units = [], routes = courseRoutes, routeId = null, weeklyTarget = 18, paperSessions = [], paperReviews = [] }) {
  const scoped = scopedAttempts(attempts, units, routes)
  const routeMeta = new Map()
  for (const item of scoped) routeMeta.set(item.routeId, item.stage || routeMeta.get(item.routeId) || null)
  for (const unit of units) {
    const binding = resolveRouteBinding(unit, { routes })
    if (binding.routeId !== LEGACY_UNSCOPED_ROUTE_ID) routeMeta.set(binding.routeId, binding.stage || routeMeta.get(binding.routeId) || null)
  }
  for (const session of paperSessions) {
    if (session.routeId && !routeMeta.has(session.routeId)) routeMeta.set(session.routeId, session.stage || null)
  }

  const byRoute = Object.fromEntries([...routeMeta].map(([id, stage]) => [id, progressForRoute({ routeId: id, stage, scoped, drafts, weeklyTarget, units, routes, paperSessions, paperReviews })]))
  const selected = routeId
    ? (byRoute[routeId] || emptyRouteProgress(routeId, routes.find((route) => route.routeId === routeId || route.id === routeId)?.stage, weeklyTarget, drafts))
    : emptyRouteProgress(null, null, weeklyTarget, drafts)
  const unitsById = unitMap(units)
  const eligibleAttemptCount = attempts.filter((attempt) => isCompletedAttempt(attempt, unitsById.get(attempt.unitId))).length
  const excludedLegacyAttempts = eligibleAttemptCount - scoped.length

  return {
    ...selected,
    byRoute,
    routeSummaries: Object.values(byRoute).map((progress) => ({
      routeId: progress.routeId,
      stage: progress.stage,
      completedSets: progress.completedSets,
      completedQuestions: progress.week.completedQuestions,
      average: progress.week.average,
      topicCount: progress.topicProgress.length,
    })),
    excludedLegacyAttempts,
  }
}

export function buildCompletionByUnit({ attempts = [], units = [], routes = courseRoutes, routeId }) {
  if (!routeId || routeId === LEGACY_UNSCOPED_ROUTE_ID) return {}
  const scoped = scopedAttempts(attempts, units, routes).filter((item) => item.routeId === routeId)
  const matchingUnits = units.filter((unit) => resolveRouteBinding(unit, { routes }).routeId === routeId)

  return Object.fromEntries(matchingUnits.map((unit) => {
    const unitAttempts = scoped.filter((item) => item.attempt.unitId === unit.id).map((item) => item.attempt)
    const latestAttempt = [...unitAttempts].sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt)).at(-1) || null
    const bestAttempt = [...unitAttempts].sort((a, b) => Number(b.scoreResult?.percentage) - Number(a.scoreResult?.percentage))[0] || null
    return [unit.id, {
      routeId,
      stage: resolveRouteBinding(unit, { routes }).stage,
      completed: unitAttempts.length > 0,
      attempts: unitAttempts.length,
      latestAttemptId: latestAttempt?.id || null,
      bestAttemptId: bestAttempt?.id || null,
      latest: latestAttempt?.scoreResult || null,
      best: bestAttempt?.scoreResult || null,
    }]
  }))
}

export function recommendForRoute({ attempts = [], drafts = {}, units = [], routes = courseRoutes, routeId, topicId = null }) {
  if (!routeId || routeId === LEGACY_UNSCOPED_ROUTE_ID) return { routeId: routeId || null, unit: null, action: 'Choose practice', reason: 'Select a learning route first.' }
  const routeUnits = units.filter((unit) => (
    resolveRouteBinding(unit, { routes }).routeId === routeId
    && (!topicId || [unit.knowledgeGroupId, unit.topicId, unit.syllabusTopic, ...(unit.syllabusTopicIds || [])].filter(Boolean).includes(topicId))
  ))
  // Keep smaller source slices discoverable in Topic Drill, but do not make one
  // the first student action when this route already has a complete drill.
  // `parts` is the actual answerable QuestionPart count, not an OCR estimate.
  const completeRouteUnits = routeUnits.filter((unit) => (unit.parts?.length || 0) >= 10)
  const recommendedUnits = completeRouteUnits.length ? completeRouteUnits : routeUnits
  const completion = buildCompletionByUnit({ attempts, units: routeUnits, routes, routeId })
  const draftUnit = routeUnits.find((unit) => drafts[unit.id]?.routeId === routeId)
  if (draftUnit) return { routeId, stage: resolveRouteBinding(draftUnit, { routes }).stage, unit: draftUnit, action: 'Resume', reason: 'Continue your saved work in this route.' }

  const weakUnit = recommendedUnits
    .filter((unit) => completion[unit.id]?.completed)
    .sort((a, b) => (completion[a.id]?.best?.percentage ?? 101) - (completion[b.id]?.best?.percentage ?? 101))[0]
  if (weakUnit && Number(completion[weakUnit.id]?.best?.percentage) < 80) {
    return { routeId, stage: resolveRouteBinding(weakUnit, { routes }).stage, unit: weakUnit, action: 'Practise again', reason: 'This is your weakest completed set in the selected route.' }
  }

  const freshUnit = recommendedUnits.find((unit) => !completion[unit.id]?.completed) || null
  return {
    routeId,
    stage: freshUnit ? resolveRouteBinding(freshUnit, { routes }).stage : null,
    unit: freshUnit,
    action: freshUnit ? 'Start' : 'Choose practice',
    reason: freshUnit ? 'This is the next uncompleted set in the selected route.' : 'No additional verified set is available in this route.',
  }
}
