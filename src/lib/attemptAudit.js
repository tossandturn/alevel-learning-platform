const EXPORT_SCHEMA_VERSION = 'alevel-learning-export-v2'
export const ATTEMPT_SOURCE_BINDING_SCHEMA_VERSION = 'attempt-source-binding.v1'
import { canonicalSourceQuestionId } from './sourceContentContract.js'

export { EXPORT_SCHEMA_VERSION }

export function attemptedSourceQuestionIds(attempts = [], routeId = '') {
  const requestedRouteId = String(routeId || '')
  return [...new Set((Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => !requestedRouteId || attempt?.routeId === requestedRouteId)
    .flatMap((attempt) => (attempt?.sourceBinding?.parts || []).map((part) => String(part?.sourceQuestionId || '').trim()))
    .filter(Boolean))]
}

export function isPendingSelfMarkAttempt(attempt) {
  return Boolean(attempt) && (attempt.selfMarkPending === true || ['self-mark-pending', 'marking-pending'].includes(attempt.attemptStatus))
}

function sourceBoundPart(part) {
  return Boolean(part?.sourceKind === 'past-paper'
    || (part?.sourceQuestionId && part?.questionPartId && part?.markingProvenance))
}

function partSourceSnapshot(part) {
  const provenance = part?.markingProvenance || {}
  const sourceQuestionId = canonicalSourceQuestionId(part?.sourceQuestionId)
  const questionPartId = String(part?.questionPartId || '')
  const bindingSignature = String(provenance.bindingSignature || '')
  const reviewVersion = String(provenance.reviewVersion || '')
  const sourceDocumentSha256 = String(provenance.sourceDocumentSha256 || '')
  const answerDocumentSha256 = String(provenance.answerDocumentSha256 || '')
  const sourceIndexSha256 = String(provenance.sourceIndexSha256 || '')
  const sourceManifestChecksum = String(provenance.sourceManifestChecksum || '')
  if (!sourceQuestionId || !questionPartId || !bindingSignature || !reviewVersion || !sourceDocumentSha256 || !answerDocumentSha256 || !sourceIndexSha256 || !sourceManifestChecksum) return null
  return Object.freeze({
    sourceQuestionId,
    questionPartId,
    bindingSignature,
    reviewVersion,
    sourceDocumentSha256,
    answerDocumentSha256,
    sourceIndexSha256,
    sourceManifestChecksum,
  })
}

export function sourceBindingSnapshotForUnit(unit = {}) {
  const parts = (unit?.parts || []).filter(sourceBoundPart)
  if (!parts.length) return null
  const snapshots = parts.map(partSourceSnapshot)
  if (snapshots.some((snapshot) => !snapshot)) return null
  const uniqueKeys = new Set(snapshots.map((snapshot) => `${snapshot.sourceQuestionId}\u0000${snapshot.questionPartId}`))
  if (uniqueKeys.size !== snapshots.length) return null
  return Object.freeze({
    schemaVersion: ATTEMPT_SOURCE_BINDING_SCHEMA_VERSION,
    unitId: String(unit?.id || ''),
    parts: Object.freeze([...snapshots].toSorted((left, right) => (
      left.sourceQuestionId.localeCompare(right.sourceQuestionId)
      || left.questionPartId.localeCompare(right.questionPartId)
    ))),
  })
}

function sameSourceSnapshot(left, right) {
  return Boolean(left && right
    && left.sourceQuestionId === right.sourceQuestionId
    && left.questionPartId === right.questionPartId
    && left.bindingSignature === right.bindingSignature
    && left.reviewVersion === right.reviewVersion
    && left.sourceDocumentSha256 === right.sourceDocumentSha256
    && left.answerDocumentSha256 === right.answerDocumentSha256
    && left.sourceIndexSha256 === right.sourceIndexSha256
    && left.sourceManifestChecksum === right.sourceManifestChecksum)
}

export function hasCurrentSourceBindingForAttempt(attempt, unit) {
  if (!unit) return false
  const current = sourceBindingSnapshotForUnit(unit)
  if (!current) return !(unit?.parts || []).some(sourceBoundPart)
  const persisted = attempt?.sourceBinding
  if (!persisted || persisted.schemaVersion !== ATTEMPT_SOURCE_BINDING_SCHEMA_VERSION || persisted.unitId !== current.unitId || !Array.isArray(persisted.parts) || persisted.parts.length !== current.parts.length) return false
  return current.parts.every((snapshot, index) => sameSourceSnapshot(snapshot, persisted.parts[index]))
}

export function sourceBindingStatusForAttempt(attempt, unit) {
  const current = sourceBindingSnapshotForUnit(unit)
  if (!current) return 'not-source-bound'
  return hasCurrentSourceBindingForAttempt(attempt, unit) ? 'current' : 'stale-or-missing'
}

export function isScoredAttempt(attempt, unit = null) {
  if (!attempt || isPendingSelfMarkAttempt(attempt)) return false
  if (attempt.scoreResult?.partial === true || attempt.attemptStatus === 'provisional-result') return false
  if (unit && !hasCurrentSourceBindingForAttempt(attempt, unit)) return false
  return hasValidAttemptScore(attempt)
}

export function isProvisionalAttempt(attempt, unit = null) {
  if (!attempt || isPendingSelfMarkAttempt(attempt)) return false
  if (!(attempt.scoreResult?.partial === true || attempt.attemptStatus === 'provisional-result')) return false
  if (unit && !hasCurrentSourceBindingForAttempt(attempt, unit)) return false
  return hasValidAttemptScore(attempt)
}

function hasValidAttemptScore(attempt) {
  const status = attempt.attemptStatus || attempt.submissionStatus || attempt.status
  const hasCompletedStatus = ['result', 'submitted', 'completed', 'provisional-result'].includes(status)
    || attempt.stage === 'result'
    || (status == null && Boolean(attempt.submittedAt))
  if (!hasCompletedStatus) return false

  const rawMarks = Number(attempt.scoreResult?.rawMarks)
  const maxMarks = Number(attempt.scoreResult?.maxMarks)
  const percentage = Number(attempt.scoreResult?.percentage)
  return Number.isFinite(rawMarks)
    && Number.isFinite(maxMarks)
    && maxMarks > 0
    && rawMarks >= 0
    && rawMarks <= maxMarks
    && Number.isFinite(percentage)
    && percentage >= 0
    && percentage <= 100
}

function hasText(value) {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

export function hasAttemptResponse(attempt, partId) {
  if (!attempt || !partId) return false
  return hasText(attempt.answers?.[partId])
    || hasText(attempt.working?.[partId])
    || Boolean(attempt.evidence?.[partId])
    || Boolean(attempt.imageEvidence?.some((evidence) => evidence?.partId === partId))
}

export function answeredPartIds(attempt, parts = []) {
  const partIds = parts.length
    ? parts.map((part) => part.id)
    : attempt?.scoreResult?.criteria?.map((criterion) => criterion.partId).filter(Boolean) || []
  return partIds.filter((partId) => hasAttemptResponse(attempt, partId))
}

export function answeredQuestionCount(attempt, parts = []) {
  return answeredPartIds(attempt, parts).length
}

export function attemptResponseProjection(attempt, unit = {}) {
  const parts = Array.isArray(unit?.parts) ? unit.parts : []
  const criteria = Array.isArray(attempt?.scoreResult?.criteria) ? attempt.scoreResult.criteria : []
  const knownPartIds = parts.length
    ? parts.map((part) => part.id)
    : [...new Set([
      ...criteria.map((criterion) => criterion?.partId),
      ...Object.keys(attempt?.answers || {}),
      ...Object.keys(attempt?.working || {}),
      ...Object.keys(attempt?.evidence || {}),
      ...(attempt?.imageEvidence || []).map((evidence) => evidence?.partId),
    ].filter(Boolean))]
  const criteriaByPartId = new Map(criteria.filter((criterion) => criterion?.partId).map((criterion) => [criterion.partId, criterion]))
  const answeredPartIdsForAttempt = knownPartIds.filter((partId) => hasAttemptResponse(attempt, partId))
  const unansweredPartIds = knownPartIds.filter((partId) => !hasAttemptResponse(attempt, partId))
  const incorrectCriteria = answeredPartIdsForAttempt
    .map((partId) => criteriaByPartId.get(partId))
    .filter((criterion) => Number.isFinite(Number(criterion?.awarded))
      && Number.isFinite(Number(criterion?.maxMarks))
      && Number(criterion.maxMarks) > 0
      && Number(criterion.awarded) < Number(criterion.maxMarks))
  const correctPartIds = answeredPartIdsForAttempt.filter((partId) => {
    const criterion = criteriaByPartId.get(partId)
    return Number.isFinite(Number(criterion?.awarded))
      && Number.isFinite(Number(criterion?.maxMarks))
      && Number(criterion.maxMarks) > 0
      && Number(criterion.awarded) >= Number(criterion.maxMarks)
  })
  const awaitingMarkPartIds = answeredPartIdsForAttempt.filter((partId) => !criteriaByPartId.has(partId))
  return {
    answeredPartIds: answeredPartIdsForAttempt,
    unansweredPartIds,
    incorrectPartIds: incorrectCriteria.map((criterion) => criterion.partId),
    incorrectCriteria,
    correctPartIds,
    awaitingMarkPartIds,
    answeredQuestionCount: answeredPartIdsForAttempt.length,
    incorrectQuestionCount: incorrectCriteria.length,
    unansweredQuestionCount: unansweredPartIds.length,
  }
}

const REVIEW_ACTIONS = new Set(['ignored', 'archived', 'snoozed', 'dismissed', 'manual-mastered', 'deleted'])

function reviewEventTime(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function reviewQueueState(reviewItemId, reviewQueueAudit = [], now = Date.now()) {
  const latest = [...(Array.isArray(reviewQueueAudit) ? reviewQueueAudit : [])]
    .filter((event) => String(event?.reviewItemId || '') === String(reviewItemId || '') && REVIEW_ACTIONS.has(String(event?.action || '')))
    .toSorted((left, right) => reviewEventTime(left.at) - reviewEventTime(right.at))
    .at(-1) || null
  if (!latest) return { status: 'open', event: null }
  if (latest.action === 'snoozed' && Date.parse(latest.snoozeUntil || '') > now) return { status: 'snoozed', event: latest }
  if (latest.action === 'snoozed') return { status: 'open', event: latest }
  return { status: latest.action, event: latest }
}

function retestCriterionForSource({ attempts, attemptsById, unitsById, sourceAttempt, partId }) {
  return [...attempts].reverse().find((candidate) => {
    let parentId = candidate?.retestOf
    while (parentId) {
      if (parentId === sourceAttempt.id) {
        return isScoredAttempt(candidate, unitsById.get(candidate.unitId))
          && candidate.scoreResult?.criteria?.some((criterion) => criterion.partId === partId)
      }
      parentId = attemptsById.get(parentId)?.retestOf
    }
    return false
  })?.scoreResult?.criteria?.find((criterion) => criterion.partId === partId) || null
}

/**
 * The review queue is an attempt projection. Blank parts are not incorrect:
 * they remain unfinished until the student actually submits a response.
 */
export function buildAttemptReviewQueue({ attempts = [], units = [], routeId = '', reviewQueueAudit = [], now = Date.now(), includeProvisional = false } = {}) {
  const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]))
  const unitsById = new Map(units.map((unit) => [unit.id, unit]))
  return attempts.flatMap((attempt) => {
    const unit = unitsById.get(attempt.unitId)
    const provisional = isProvisionalAttempt(attempt, unit)
    if (!unit || (routeId && unit.routeId !== routeId) || !(isScoredAttempt(attempt, unit) || (includeProvisional && provisional))) return []
    const projection = attemptResponseProjection(attempt, unit)
    return projection.incorrectCriteria
      .filter((criterion) => {
        const retestCriterion = retestCriterionForSource({ attempts, attemptsById, unitsById, sourceAttempt: attempt, partId: criterion.partId })
        return !retestCriterion || Number(retestCriterion.awarded) < Number(retestCriterion.maxMarks)
      })
      .flatMap((criterion) => {
        const part = unit.parts?.find((item) => item.id === criterion.partId)
        if (!part) return []
        const id = `${attempt.id}-${criterion.partId}`
        const review = reviewQueueState(id, reviewQueueAudit, now)
        if (review.status !== 'open') return []
        const sourcePaperId = String(part.sourceRef?.paperId || part.sourceRef?.paper || part.sourceQuestionId || '')
        const sourceQuestion = String(part.sourceRef?.question || part.displayLabel || part.label || criterion.partId)
        const markPoints = [
          ...(criterion.evidence || []).map((point) => point?.point || ''),
          ...(part.markPoints || []),
        ].filter(Boolean).join(' ')
        return [{
          id,
          attempt,
          unit,
          part,
          criterion,
          severity: Number(criterion.awarded) === 0 ? 'High' : 'Medium',
          status: provisional ? 'Provisional review' : criterion.status === 'review-needed' ? 'Review needed' : 'Open',
          sourcePaperId,
          sourceQuestion,
          searchText: `${unit.title} ${unit.topic} ${part.label || ''} ${part.displayLabel || ''} ${sourcePaperId} ${sourceQuestion} ${criterion.feedback || ''} ${markPoints}`.toLowerCase(),
          responseProjection: {
            answeredQuestionCount: projection.answeredQuestionCount,
            incorrectQuestionCount: projection.incorrectQuestionCount,
            unansweredQuestionCount: projection.unansweredQuestionCount,
          },
          review,
        }]
      })
  })
}

export function buildProvisionalAttemptEvidence({ attempts = [], units = [], routeId = '' } = {}) {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]))
  return attempts.flatMap((attempt) => {
    const unit = unitsById.get(attempt?.unitId)
    if (!unit || (routeId && unit.routeId !== routeId) || !isProvisionalAttempt(attempt, unit)) return []
    const responseProjection = attemptResponseProjection(attempt, unit)
    if (responseProjection.answeredQuestionCount === 0) return []
    return [{
      attempt,
      unit,
      projection: {
        answeredQuestionCount: responseProjection.answeredQuestionCount,
        incorrectQuestionCount: responseProjection.incorrectQuestionCount,
        unansweredQuestionCount: responseProjection.unansweredQuestionCount,
      },
    }]
  }).toSorted((left, right) => Date.parse(left.attempt.submittedAt || '') - Date.parse(right.attempt.submittedAt || ''))
}

export function buildAttemptAudit(attempt, unit) {
  const projection = attemptResponseProjection(attempt, unit)
  const sourceBindingStatus = sourceBindingStatusForAttempt(attempt, unit)
  const scored = isScoredAttempt(attempt, unit)
  const provisional = isProvisionalAttempt(attempt, unit)
  const criteria = scored || provisional ? attempt.scoreResult.criteria || [] : []
  return {
    attemptId: attempt?.id || null,
    sourceAttemptId: attempt?.retestOf || null,
    retestOf: attempt?.retestOf || null,
    finalizedFromAttemptId: attempt?.finalizedFromAttemptId || null,
    unitId: attempt?.unitId || unit?.id || null,
    routeId: attempt?.routeId || unit?.routeId || null,
    submittedAt: attempt?.submittedAt || null,
    status: attempt?.attemptStatus || attempt?.stage || 'unknown',
    sourceBindingStatus,
    answeredPartIds: projection.answeredPartIds,
    unansweredPartIds: projection.unansweredPartIds,
    incorrectPartIds: projection.incorrectPartIds,
    awaitingMarkPartIds: projection.awaitingMarkPartIds,
    answeredQuestionCount: projection.answeredQuestionCount,
    incorrectQuestionCount: projection.incorrectQuestionCount,
    unansweredQuestionCount: projection.unansweredQuestionCount,
    scoredPartIds: criteria.map((criterion) => criterion.partId).filter(Boolean),
    score: scored ? {
      rawMarks: attempt.scoreResult.rawMarks,
      maxMarks: attempt.scoreResult.maxMarks,
      percentage: attempt.scoreResult.percentage,
    } : null,
    provisionalScore: provisional ? {
      rawMarks: attempt.scoreResult.rawMarks,
      maxMarks: attempt.scoreResult.maxMarks,
      percentage: attempt.scoreResult.percentage,
    } : null,
  }
}

function exportAttemptRecord(attempt) {
  const {
    answers: _answers,
    working: _working,
    evidence: _evidence,
    imageEvidence: _imageEvidence,
    submitting: _submitting,
    saveStatus: _saveStatus,
    ...record
  } = attempt || {}
  return record
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export function canonicalExportJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function buildLearningExport(state, { units = [], exportedAt = new Date().toISOString() } = {}) {
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const attempts = state?.attempts || []
  const responses = attempts.flatMap((attempt) => {
    const unit = unitById.get(attempt.unitId)
    const partIds = answeredPartIds(attempt, unit?.parts || [])
    return partIds.map((partId) => ({
      attemptId: attempt.id,
      unitId: attempt.unitId || unit?.id || null,
      partId,
      answer: attempt.answers?.[partId] || '',
      working: attempt.working?.[partId] || '',
      evidence: attempt.evidence?.[partId] || attempt.imageEvidence?.find((item) => item?.partId === partId) || null,
    }))
  })
  const notebookItems = buildAttemptReviewQueue({
    attempts,
    units,
    reviewQueueAudit: state?.reviewQueueAudit || [],
  }).map((item) => ({
    id: item.id,
    attemptId: item.attempt.id,
    unitId: item.unit.id,
    partId: item.part.id,
    awarded: item.criterion.awarded,
    maxMarks: item.criterion.maxMarks,
    status: item.status,
    feedback: item.criterion.feedback || '',
    sourcePaperId: item.sourcePaperId || null,
    sourceQuestion: item.sourceQuestion || null,
  }))
  const provisionalNotebookItems = buildAttemptReviewQueue({
    attempts,
    units,
    reviewQueueAudit: state?.reviewQueueAudit || [],
    includeProvisional: true,
  }).filter((item) => isProvisionalAttempt(item.attempt, item.unit)).map((item) => ({
    id: item.id,
    attemptId: item.attempt.id,
    unitId: item.unit.id,
    partId: item.part.id,
    awarded: item.criterion.awarded,
    maxMarks: item.criterion.maxMarks,
    status: item.status,
    feedback: item.criterion.feedback || '',
    sourcePaperId: item.sourcePaperId || null,
    sourceQuestion: item.sourceQuestion || null,
  }))
  const profile = state?.profile || {}
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    exportType: 'student-learning-record',
    integrity: { algorithm: 'SHA-256', checksum: null },
    data: {
      attempts: attempts.map(exportAttemptRecord),
      responses,
      notebook: { items: notebookItems, provisionalItems: provisionalNotebookItems, notes: state?.notebookNotes || {}, reviewQueueAudit: state?.reviewQueueAudit || [] },
      vocabulary: state?.vocabulary || state?.savedVocabulary || [],
      goals: {
        targetGrade: profile.targetGrade || null,
        weeklyQuestions: profile.weeklyQuestions || null,
        deadline: profile.deadline || null,
        preferredMode: profile.preferredMode || null,
      },
      drafts: { practice: state?.drafts || {}, selfMark: state?.selfMarkDrafts || {}, papers: state?.paperDrafts || {} },
      paperSessions: state?.paperSessions || [],
      paperReviews: state?.paperReviews || [],
      consents: state?.consents || state?.privacyConsents || {},
    },
    audit: {
      attemptCount: attempts.length,
      answeredQuestionCount: attempts.reduce((total, attempt) => total + answeredQuestionCount(attempt, unitById.get(attempt.unitId)?.parts || []), 0),
      attempts: attempts.map((attempt) => buildAttemptAudit(attempt, unitById.get(attempt.unitId))),
    },
  }
}

async function browserSha256(value) {
  const result = await globalThis.crypto?.subtle?.digest('SHA-256', new TextEncoder().encode(value))
  if (!result) throw new Error('SHA-256 is unavailable.')
  return result
}

function digestHex(value) {
  if (typeof value === 'string') return value.toLowerCase()
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const ZERO_CHECKSUM = '0'.repeat(64)

export async function prepareLearningExport(state, { units = [], exportedAt, digest = browserSha256, serialize = canonicalExportJson } = {}) {
  try {
    const payload = buildLearningExport(state, { units, exportedAt })
    const checksumScope = 'canonical-json-with-zeroed-checksum'
    const unsignedPayload = { ...payload, integrity: { algorithm: 'SHA-256', checksum: ZERO_CHECKSUM, scope: checksumScope } }
    const unsignedJson = serialize(unsignedPayload)
    const checksum = digestHex(await digest(unsignedJson))
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Export checksum is invalid.')
    const signedPayload = { ...payload, integrity: { algorithm: 'SHA-256', checksum, scope: checksumScope } }
    // Serialize the signed object independently. Replacing a sentinel in JSON
    // could alter a student's answer when it happens to contain that text.
    const json = serialize(signedPayload)
    return { payload: signedPayload, json, checksum }
  } catch {
    throw new Error('Your export could not be prepared. Try again.')
  }
}
