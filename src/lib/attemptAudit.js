const EXPORT_SCHEMA_VERSION = 'alevel-learning-export-v2'
export const ATTEMPT_SOURCE_BINDING_SCHEMA_VERSION = 'attempt-source-binding.v1'
import { canonicalSourceQuestionId } from './sourceContentContract.js'

export { EXPORT_SCHEMA_VERSION }

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
  if (unit && !hasCurrentSourceBindingForAttempt(attempt, unit)) return false
  const status = attempt.attemptStatus || attempt.submissionStatus || attempt.status
  const hasCompletedStatus = ['result', 'submitted', 'completed'].includes(status)
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

export function buildAttemptAudit(attempt, unit) {
  const answeredPartIdsForAttempt = answeredPartIds(attempt, unit?.parts || [])
  const sourceBindingStatus = sourceBindingStatusForAttempt(attempt, unit)
  const scored = isScoredAttempt(attempt, unit)
  const criteria = scored ? attempt.scoreResult.criteria || [] : []
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
    answeredPartIds: answeredPartIdsForAttempt,
    answeredQuestionCount: answeredPartIdsForAttempt.length,
    scoredPartIds: criteria.map((criterion) => criterion.partId).filter(Boolean),
    score: scored ? {
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
  const notebookItems = attempts.flatMap((attempt) => {
    const unit = unitById.get(attempt.unitId)
    if (!isScoredAttempt(attempt, unit)) return []
    return (attempt.scoreResult.criteria || [])
      .filter((criterion) => hasAttemptResponse(attempt, criterion.partId))
      .filter((criterion) => Number(criterion.awarded) < Number(criterion.maxMarks))
      .map((criterion) => ({
        id: `${attempt.id}-${criterion.partId}`,
        attemptId: attempt.id,
        unitId: attempt.unitId || unit?.id || null,
        partId: criterion.partId,
        awarded: criterion.awarded,
        maxMarks: criterion.maxMarks,
        status: criterion.status || 'open',
        feedback: criterion.feedback || '',
      }))
  })
  const profile = state?.profile || {}
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    exportType: 'student-learning-record',
    integrity: { algorithm: 'SHA-256', checksum: null },
    data: {
      attempts: attempts.map(exportAttemptRecord),
      responses,
      notebook: { items: notebookItems, notes: state?.notebookNotes || {} },
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
