import { scoreAttempt } from './scoring.js'

const MIN_AI_CONFIDENCE = 0.55

function boundedMark(value, maxMarks) {
  const mark = Number(value)
  const maximum = Number(maxMarks)
  if (!Number.isFinite(mark) || !Number.isFinite(maximum) || maximum <= 0 || mark < 0 || mark > maximum) return null
  return mark
}

export function canUseAiAssistedMarking(part) {
  return Boolean(part?.aiAssistedMarkingAvailable && part?.reviewStatus === 'reviewed')
}

export function partMarkingCapability(part) {
  if (part?.deterministicScoringAvailable || part?.answerKey) return 'deterministic'
  if (canUseAiAssistedMarking(part)) return 'ai-assisted'
  return 'self-mark'
}

export function markingCapabilityForUnit(unit) {
  const parts = unit?.parts || []
  const counts = parts.reduce((result, part) => {
    const capability = partMarkingCapability(part)
    result[capability] += 1
    return result
  }, { deterministic: 0, 'ai-assisted': 0, 'self-mark': 0 })

  if (counts['self-mark'] === parts.length) {
    return {
      mode: 'self-mark',
      label: 'Self-mark after submission',
      description: 'Compare each response with the paired official mark scheme and record marks. No automatic result is created until you confirm them.',
      counts,
    }
  }
  if (counts['ai-assisted'] === parts.length) {
    return {
      mode: 'ai-assisted',
      label: 'AI-assisted review after submission',
      description: 'Reviewed handwritten evidence can be scored by AI. Missing evidence, low confidence or provider failure stays pending and never becomes an automatic zero.',
      counts,
    }
  }
  if (counts['self-mark'] || counts['ai-assisted']) {
    const resolved = counts.deterministic
    const deferred = counts['self-mark'] + counts['ai-assisted']
    return {
      mode: 'mixed',
      label: 'Mixed marking',
      description: `${resolved} objective response${resolved === 1 ? '' : 's'} can score immediately; ${deferred} written response${deferred === 1 ? '' : 's'} must receive reviewed AI evidence or an explicit student self-mark.`,
      counts,
    }
  }
  return {
    mode: 'deterministic',
    label: 'Instant objective marking',
    description: 'Answers are checked against the verified answer key after submission.',
    counts,
  }
}

export function isSelfMarkOnlyUnit(unit) {
  return markingCapabilityForUnit(unit).mode === 'self-mark'
}

function criterionStatus(awarded, maxMarks) {
  return awarded >= maxMarks ? 'secure' : awarded > 0 ? 'partial' : 'review-needed'
}

function reviewedAiCriterion(part, review) {
  const awarded = boundedMark(review?.rawMarks, part.marks)
  const confidence = Number(review?.confidence)
  const markPoints = Array.isArray(review?.markPoints) ? review.markPoints : []
  const evidenceComplete = markPoints.length > 0 && markPoints.every((point) => typeof point?.awarded === 'boolean')
  if (review?.status !== 'success' || awarded == null || !Number.isFinite(confidence) || confidence < MIN_AI_CONFIDENCE || review.reviewRequired || !evidenceComplete) return null

  return {
    partId: part.id,
    awarded,
    maxMarks: Number(part.marks),
    status: criterionStatus(awarded, Number(part.marks)),
    feedback: String(review.summary || 'Reviewed handwriting was scored against the paired mark scheme.'),
    confidence,
    evidence: markPoints.map((point, index) => ({
      pointId: point.id || `${part.id}-AI${index + 1}`,
      awarded: point.awarded,
      point: point.reason || point.point || '',
    })),
    evidenceStatus: 'reviewed-ai',
    scoringSource: 'vision-assisted',
  }
}

function aiPendingStatus(review) {
  if (review?.status === 'success') return 'ai-review-pending'
  if (review?.status === 'review_required') return 'ai-review-pending'
  return 'ai-retry-pending'
}

function aiPendingReason(review) {
  if (!review || review.status === 'no_evidence') return 'Add handwriting evidence and retry AI review, or record a self-mark from the paired mark scheme.'
  if (review.status === 'unconfigured') return 'AI review is unavailable. Your response is saved and can be self-marked with the paired mark scheme.'
  if (review.status === 'success' || review.status === 'review_required') return 'The AI result needs review and has not been counted. Retry with clearer evidence or record a self-mark.'
  return review.error || 'AI review could not be completed. Retry later or record a self-mark; no automatic zero was created.'
}

function deterministicCriteria(unit, answers, elapsedSec) {
  const parts = (unit?.parts || []).filter((part) => partMarkingCapability(part) === 'deterministic')
  if (!parts.length) return []
  const maxMarks = parts.reduce((total, part) => total + Number(part.marks || 0), 0)
  return scoreAttempt({ ...unit, parts, maxMarks }, answers || {}, elapsedSec).criteria.map((criterion) => ({
    ...criterion,
    evidenceStatus: 'deterministic',
    scoringSource: 'deterministic',
  }))
}

export function buildPartMarkingLifecycle(unit, answers = {}, elapsedSec = 0, visionReviews = {}) {
  const deterministicByPart = new Map(deterministicCriteria(unit, answers, elapsedSec).map((criterion) => [criterion.partId, criterion]))
  const partStates = {}
  const provisionalCriteria = []

  for (const part of unit?.parts || []) {
    const capability = partMarkingCapability(part)
    if (capability === 'deterministic') {
      const criterion = deterministicByPart.get(part.id)
      if (!criterion) throw new Error(`Deterministic score is unavailable for ${part.id}.`)
      provisionalCriteria.push(criterion)
      partStates[part.id] = {
        capability,
        status: 'deterministic-scored',
        awarded: criterion.awarded,
        maxMarks: criterion.maxMarks,
      }
      continue
    }

    if (capability === 'ai-assisted') {
      const review = visionReviews[part.id]
      const criterion = reviewedAiCriterion(part, review)
      if (criterion) {
        provisionalCriteria.push(criterion)
        partStates[part.id] = {
          capability,
          status: 'ai-scored',
          awarded: criterion.awarded,
          maxMarks: criterion.maxMarks,
          confidence: criterion.confidence,
        }
      } else {
        partStates[part.id] = {
          capability,
          status: aiPendingStatus(review),
          maxMarks: Number(part.marks),
          reason: aiPendingReason(review),
          providerStatus: review?.status || 'no_evidence',
        }
      }
      continue
    }

    partStates[part.id] = {
      capability,
      status: 'student-self-mark-pending',
      maxMarks: Number(part.marks),
      reason: 'Use the paired official mark scheme and record this part total before the attempt can count.',
    }
  }

  const pendingPartIds = (unit?.parts || []).map((part) => part.id).filter((partId) => !partStates[partId]?.status.endsWith('-scored'))
  const provisionalRawMarks = provisionalCriteria.reduce((total, criterion) => total + Number(criterion.awarded || 0), 0)
  const provisionalMaxMarks = provisionalCriteria.reduce((total, criterion) => total + Number(criterion.maxMarks || 0), 0)
  const totalMaxMarks = (unit?.parts || []).reduce((total, part) => total + Number(part.marks || 0), 0)

  return {
    schemaVersion: 'part-marking-lifecycle-v1',
    partStates,
    provisionalCriteria,
    pendingPartIds,
    provisionalRawMarks,
    provisionalMaxMarks,
    totalMaxMarks,
    complete: pendingPartIds.length === 0,
  }
}

export function pendingPartsForLifecycle(unit, lifecycle) {
  const pendingIds = new Set(lifecycle?.pendingPartIds || [])
  return (unit?.parts || []).filter((part) => pendingIds.has(part.id))
}

export function hasCompleteStudentMarks(unit, lifecycle, marksByPart = {}) {
  const pendingParts = pendingPartsForLifecycle(unit, lifecycle)
  return pendingParts.length > 0 && pendingParts.every((part) => {
    const raw = marksByPart[part.id]
    return raw != null && String(raw).trim() !== '' && boundedMark(raw, part.marks) != null
  })
}

function gradeEstimate(percentage) {
  return percentage >= 80 ? 'A/A* range' : percentage >= 65 ? 'B range' : percentage >= 50 ? 'C range' : 'Needs rebuild'
}

export function finalizePartMarking(unit, lifecycle, marksByPart = {}, elapsedSec = 0) {
  const pendingParts = pendingPartsForLifecycle(unit, lifecycle)
  if (pendingParts.length && !hasCompleteStudentMarks(unit, lifecycle, marksByPart)) {
    throw new Error('Every pending mark must be entered explicitly within the available mark range.')
  }

  const criteriaByPart = new Map((lifecycle?.provisionalCriteria || []).map((criterion) => [criterion.partId, criterion]))
  for (const part of pendingParts) {
    const awarded = boundedMark(marksByPart[part.id], part.marks)
    const originalCapability = lifecycle.partStates?.[part.id]?.capability || partMarkingCapability(part)
    criteriaByPart.set(part.id, {
      partId: part.id,
      awarded,
      maxMarks: Number(part.marks),
      status: criterionStatus(awarded, Number(part.marks)),
      feedback: `Student-recorded total: ${awarded}/${part.marks}. Specific mark-scheme points were not recorded.`,
      evidence: [],
      evidenceStatus: 'not-recorded',
      scoringSource: originalCapability === 'ai-assisted' ? 'student-self-mark-ai-fallback' : 'student-self-mark',
      originalCapability,
    })
  }

  const criteria = (unit?.parts || []).map((part) => criteriaByPart.get(part.id))
  if (criteria.some((criterion) => !criterion || boundedMark(criterion.awarded, criterion.maxMarks) == null)) {
    throw new Error('A complete, valid mark is required for every question part.')
  }
  const maxMarks = criteria.reduce((total, criterion) => total + criterion.maxMarks, 0)
  const rawMarks = criteria.reduce((total, criterion) => total + criterion.awarded, 0)
  const percentage = maxMarks > 0 ? Math.round((rawMarks / maxMarks) * 100) : 0
  const weakest = criteria.find((criterion) => criterion.awarded < criterion.maxMarks)
  const hasStudentMarks = pendingParts.length > 0
  const hasAiMarks = criteria.some((criterion) => criterion.scoringSource === 'vision-assisted')
  return {
    schemaVersion: hasStudentMarks ? 'mixed-marking-v1' : hasAiMarks ? 'reviewed-ai-marking-v1' : 'deterministic-v4-part-bound',
    routeId: unit.routeId,
    stage: unit.stage,
    rawMarks,
    maxMarks,
    percentage,
    gradeEstimate: gradeEstimate(percentage),
    estimateSource: hasStudentMarks ? 'Includes student-recorded self-marks; not an official grade boundary' : 'Practice estimate, not official grade boundary',
    elapsedSec,
    criteria,
    weakestPartId: weakest?.partId || null,
    confidence: hasStudentMarks ? null : criteria.length ? Number((criteria.reduce((total, criterion) => total + Number(criterion.confidence ?? 0.9), 0) / criteria.length).toFixed(2)) : null,
    selfMarked: hasStudentMarks,
  }
}
