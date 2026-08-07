function dayKey(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isCompletedAttempt(attempt) {
  return attempt?.stage === 'result' && attempt.scoreResult
}

function questionCountForAttempt(attempt) {
  return attempt.scoreResult?.criteria?.length || attempt.scoreResult?.maxMarks || 0
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value))
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

/**
 * The common fact layer for student progress, teacher class views and school
 * aggregates. Consumers decide their own permission and aggregation level.
 */
export function buildLearningEvents({ attempts = [], units = [] }) {
  return attempts
    .filter(isCompletedAttempt)
    .flatMap((attempt) => {
      const unit = units.find((item) => item.id === attempt.unitId)
      const occurredAt = attempt.submittedAt || attempt.updatedAt || null
      if (!occurredAt) return []
      const base = {
        eventId: `attempt:${attempt.id}`, attemptId: attempt.id, subjectId: unit?.subjectId || attempt.contentScope?.subjectId || null,
        topicId: unit?.knowledgeGroupId || unit?.topicId || attempt.contentScope?.topicId || attempt.contentScope?.topic || null,
        questionSetId: unit?.id || attempt.unitId, occurredAt, durationSeconds: Math.max(0, Number(attempt.elapsedSec) || 0),
        score: Number(attempt.scoreResult?.percentage), synced: attempt.serverSync === 'synced',
      }
      const events = [{ ...base, type: 'answer_submitted' }]
      events.push({ ...base, eventId: `result:${attempt.id}`, type: base.score >= 60 ? 'answer_correct' : 'answer_incorrect' })
      if (attempt.retestOf) events.push({ ...base, eventId: `retry:${attempt.id}`, type: 'question_retried' })
      if (base.score >= 80) events.push({ ...base, eventId: `mastery:${attempt.id}`, type: 'topic_mastered' })
      return events
    })
}

export function buildLearningProgress({ attempts = [], drafts = {}, units = [], weeklyTarget = 18 }) {
  const completedAttempts = attempts.filter(isCompletedAttempt)
  const currentWeek = completedAttempts.filter((attempt) => isWithinDays(attempt.submittedAt, 7))
  const topicById = new Map()

  for (const attempt of completedAttempts) {
    const unit = units.find((item) => item.id === attempt.unitId)
    const topicId = unit?.knowledgeGroupId || unit?.topicId || attempt.contentScope?.topicId || attempt.contentScope?.topic
    if (!topicId) continue
    const record = topicById.get(topicId) || { id: topicId, name: unit?.topic || attempt.contentScope?.topic || topicId, attempts: 0, questions: 0, scores: [], lastActivity: null }
    record.attempts += 1
    record.questions += questionCountForAttempt(attempt)
    record.scores.push(attempt.scoreResult.percentage)
    record.lastActivity = record.lastActivity && record.lastActivity > attempt.submittedAt ? record.lastActivity : attempt.submittedAt
    topicById.set(topicId, record)
  }

  const topicProgress = [...topicById.values()].map((topic) => ({
    ...topic,
    mastery: average(topic.scores),
    status: topic.scores.length === 0 ? 'Not started' : average(topic.scores) >= 80 ? 'Secure' : average(topic.scores) >= 60 ? 'Practising' : 'Rebuild',
  }))
  const correctedMistakes = completedAttempts.reduce((total, attempt) => total + (attempt.retestOf ? questionCountForAttempt(attempt) : 0), 0)
  const termsReviewed = Number(typeof window !== 'undefined' ? window.localStorage?.getItem('stem-professional-terms-reviewed') || 0 : 0)
  const milestones = [
    { id: 'first-set', label: 'Complete your first verified set', value: completedAttempts.length, target: 1, unit: 'set' },
    { id: 'three-days', label: 'Study on 3 different days', value: new Set(completedAttempts.map((attempt) => dayKey(attempt.submittedAt))).size, target: 3, unit: 'days' },
    { id: 'fix-ten', label: 'Correct 10 questions', value: correctedMistakes, target: 10, unit: 'questions' },
    { id: 'terms-hundred', label: 'Review 100 professional terms', value: termsReviewed, target: 100, unit: 'terms' },
  ].map((milestone) => ({ ...milestone, complete: milestone.value >= milestone.target, percentage: Math.min(100, Math.round((milestone.value / milestone.target) * 100)) }))

  return {
    week: {
      completedQuestions: currentWeek.reduce((total, attempt) => total + questionCountForAttempt(attempt), 0),
      targetQuestions: Math.max(1, Number(weeklyTarget) || 18),
      completedSets: currentWeek.length,
      average: average(currentWeek.map((attempt) => attempt.scoreResult.percentage)),
    },
    streak: countConsecutiveDays(recentDayKeys(attempts)),
    topicProgress,
    milestones,
    openDrafts: Object.keys(drafts).length,
    completedSets: completedAttempts.length,
    events: buildLearningEvents({ attempts, units }),
  }
}
