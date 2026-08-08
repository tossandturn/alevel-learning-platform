import { courseRoutes } from '../data/routeRegistry.js'
import { LEGACY_UNSCOPED_ROUTE_ID, resolveRouteBinding } from './routeMigration.js'

function dayKey(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isCompletedAttempt(attempt) {
  const status = attempt?.attemptStatus || attempt?.submissionStatus || attempt?.status
  return Boolean(attempt?.scoreResult) && Boolean(attempt?.submittedAt) && (
    ['result', 'submitted', 'completed'].includes(status) ||
    attempt?.stage === 'result' ||
    status == null
  )
}

function questionCountForAttempt(attempt) {
  return attempt.scoreResult?.criteria?.length || attempt.scoreResult?.maxMarks || 0
}

function average(values) {
  const usable = values.map(Number).filter(Number.isFinite)
  return usable.length ? Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length) : null
}

function recentDayKeys(attempts) {
  return new Set(attempts.filter(isCompletedAttempt).map((attempt) => dayKey(attempt.submittedAt)).filter(Boolean))
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
    .filter(isCompletedAttempt)
    .map((attempt) => {
      const unit = unitsById.get(attempt.unitId)
      const binding = routeForRecord(attempt, unit, routes)
      return { attempt, unit, ...binding }
    })
    .filter((item) => item.routeId !== LEGACY_UNSCOPED_ROUTE_ID)
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

function progressForRoute({ routeId, stage, scoped, drafts, weeklyTarget, units, routes }) {
  const records = scoped.filter((item) => item.routeId === routeId)
  if (!records.length) return emptyRouteProgress(routeId, stage, weeklyTarget, drafts)

  const attempts = records.map((item) => item.attempt)
  const currentWeek = records.filter((item) => isWithinDays(item.attempt.submittedAt, 7))
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
    record.questions += questionCountForAttempt(attempt)
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
  const correctedMistakes = attempts.reduce((total, attempt) => total + (attempt.retestOf ? questionCountForAttempt(attempt) : 0), 0)
  const milestones = [
    { id: 'first-set', label: 'Complete your first verified set', value: attempts.length, target: 1, unit: 'set' },
    { id: 'three-days', label: 'Study on 3 different days', value: new Set(attempts.map((attempt) => dayKey(attempt.submittedAt))).size, target: 3, unit: 'days' },
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
    stage: stage || records[0]?.stage || null,
    week: {
      completedQuestions: currentWeek.reduce((total, item) => total + questionCountForAttempt(item.attempt), 0),
      targetQuestions: Math.max(1, Number(weeklyTarget) || 18),
      completedSets: currentWeek.length,
      average: average(currentWeek.map((item) => item.attempt.scoreResult.percentage)),
    },
    streak: countConsecutiveDays(recentDayKeys(attempts)),
    topicProgress,
    masterySnapshots: topicProgress.map((topic) => ({
      snapshotId: `mastery:${routeId}:${topic.id}:${topic.lastActivity || 'unknown'}`,
      routeId,
      stage: stage || records[0]?.stage || null,
      topicId: topic.id,
      mastery: topic.mastery,
      sampleSize: topic.attempts,
      questionCount: topic.questions,
      capturedAt: topic.lastActivity,
    })),
    milestones,
    openDrafts: Object.values(drafts).filter((draft) => draft?.routeId === routeId).length,
    completedSets: attempts.length,
    events: buildLearningEvents({ attempts, units, routes, routeId }),
  }
}

/**
 * Builds route-bound learning facts. Unscoped legacy attempts never produce
 * events, recommendations, completion or mastery data.
 */
export function buildLearningEvents({ attempts = [], units = [], routes = courseRoutes, routeId = null }) {
  const scoped = scopedAttempts(attempts, units, routes)
  return scoped
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
}

/**
 * Returns one selected route at the top level and every route under byRoute.
 * When no route is selected, top-level metrics remain empty to prevent an
 * accidental cross-stage aggregate.
 */
export function buildLearningProgress({ attempts = [], drafts = {}, units = [], routes = courseRoutes, routeId = null, weeklyTarget = 18 }) {
  const scoped = scopedAttempts(attempts, units, routes)
  const routeMeta = new Map()
  for (const item of scoped) routeMeta.set(item.routeId, item.stage || routeMeta.get(item.routeId) || null)
  for (const unit of units) {
    const binding = resolveRouteBinding(unit, { routes })
    if (binding.routeId !== LEGACY_UNSCOPED_ROUTE_ID) routeMeta.set(binding.routeId, binding.stage || routeMeta.get(binding.routeId) || null)
  }

  const byRoute = Object.fromEntries([...routeMeta].map(([id, stage]) => [id, progressForRoute({ routeId: id, stage, scoped, drafts, weeklyTarget, units, routes })]))
  const selected = routeId
    ? (byRoute[routeId] || emptyRouteProgress(routeId, routes.find((route) => route.routeId === routeId || route.id === routeId)?.stage, weeklyTarget, drafts))
    : emptyRouteProgress(null, null, weeklyTarget, drafts)
  const excludedLegacyAttempts = attempts.filter(isCompletedAttempt).length - scoped.length

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

export function recommendForRoute({ attempts = [], drafts = {}, units = [], routes = courseRoutes, routeId }) {
  if (!routeId || routeId === LEGACY_UNSCOPED_ROUTE_ID) return { routeId: routeId || null, unit: null, action: 'Choose practice', reason: 'Select a learning route first.' }
  const routeUnits = units.filter((unit) => resolveRouteBinding(unit, { routes }).routeId === routeId)
  const completion = buildCompletionByUnit({ attempts, units: routeUnits, routes, routeId })
  const draftUnit = routeUnits.find((unit) => drafts[unit.id]?.routeId === routeId)
  if (draftUnit) return { routeId, stage: resolveRouteBinding(draftUnit, { routes }).stage, unit: draftUnit, action: 'Resume', reason: 'Continue your saved work in this route.' }

  const weakUnit = routeUnits
    .filter((unit) => completion[unit.id]?.completed)
    .sort((a, b) => (completion[a.id]?.best?.percentage ?? 101) - (completion[b.id]?.best?.percentage ?? 101))[0]
  if (weakUnit && Number(completion[weakUnit.id]?.best?.percentage) < 80) {
    return { routeId, stage: resolveRouteBinding(weakUnit, { routes }).stage, unit: weakUnit, action: 'Practise again', reason: 'This is your weakest completed set in the selected route.' }
  }

  const freshUnit = routeUnits.find((unit) => !completion[unit.id]?.completed) || null
  return {
    routeId,
    stage: freshUnit ? resolveRouteBinding(freshUnit, { routes }).stage : null,
    unit: freshUnit,
    action: freshUnit ? 'Start' : 'Choose practice',
    reason: freshUnit ? 'This is the next uncompleted set in the selected route.' : 'No additional verified set is available in this route.',
  }
}
