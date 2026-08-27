import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { studyQuestionBank, unifiedQuestionBank } from '../src/data/questionBank.js'
import { canonicalAiMarkingProvenance, canonicalSourcePracticeProvenance } from '../src/lib/sourceContentContract.js'
import { listAiPdfIngestionCandidates, resolveAiPdfIngestionRoot } from './aiPdfIngestionCandidates.js'
import { issueMarkingCapabilities } from './markingCapability.js'
import { buildSyllabusPracticeSet, rebindSyllabusPracticeUnit, seedSyllabusTables, syllabusDatabaseInventory, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const REBIND_BODY_BYTES = 256 * 1024
const TOKEN_AUDIENCE = 'stem.ieltsist.com'
const TOKEN_ISSUER = 'ieltsist.com'
const STEM_SESSION_COOKIE = 'stem_session'
const STEM_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000
const INTERNAL_AUTH_PATH = '/api/stem/internal/authenticate'
const DEFAULT_INTERNAL_AUTH_ORIGIN = 'http://127.0.0.1:4321'
const NATIVE_AUTH_PROBE_CACHE_MS = 15_000
const NATIVE_AUTH_PROBE_USERNAME = 'stem_bridge_probe'
const NATIVE_AUTH_PROBE_PASSWORD = 'not-a-real-password'
const LEGACY_SCOPE = 'legacy-unscoped'
const MAX_COACH_HISTORY_MESSAGES = 80
const ROUTE_STAGES = new Map([
  ['igcse', 'IGCSE'],
  ['as', 'AS'],
  ['a2', 'A2'],
  ['competition', 'Competition'],
  ['admissions', 'Admissions'],
])
const REGISTERED_ROUTES = new Map(Object.entries({
  'cie-0580-igcse-mathematics': ['IGCSE', 'math-0580'],
  'cie-0606-igcse-additional-mathematics': ['IGCSE', 'math-0606'],
  'cie-0610-igcse-biology': ['IGCSE', 'biology-0610'],
  'cie-0625-igcse-physics': ['IGCSE', 'physics-0625'],
  'cie-9700-as-biology': ['AS', 'biology-9700'],
  'cie-9700-a2-biology': ['A2', 'biology-9700'],
  'cie-9701-as-chemistry': ['AS', 'chemistry-9701'],
  'cie-9701-a2-chemistry': ['A2', 'chemistry-9701'],
  'cie-9702-as-physics': ['AS', 'physics-9702'],
  'cie-9702-a2-physics': ['A2', 'physics-9702'],
  'cie-9708-as-economics': ['AS', 'economics-9708'],
  'cie-9708-a2-economics': ['A2', 'economics-9708'],
  'cie-9709-as-p1-p2': ['AS', 'math-9709'],
  'cie-9709-as-p1-p4': ['AS', 'math-9709'],
  'cie-9709-as-p1-p5': ['AS', 'math-9709'],
  'cie-9709-a2-after-p1-p5-p3-p4': ['A2', 'math-9709'],
  'cie-9709-a2-after-p1-p5-p3-p6': ['A2', 'math-9709'],
  'cie-9709-a2-after-p1-p4-p3-p5': ['A2', 'math-9709'],
  'cie-9231-as-p1-p3': ['AS', 'math-9231'],
  'cie-9231-as-p1-p4': ['AS', 'math-9231'],
  'cie-9231-a2-after-p1-p3-p2-p4': ['A2', 'math-9231'],
  'cie-9231-a2-after-p1-p4-p2-p3': ['A2', 'math-9231'],
  'bpho-admissions-physics': ['Competition', 'bpho'],
  'maa-amc12-admissions-mathematics': ['Competition', 'amc12'],
  'uatuk-esat-admissions': ['Admissions', 'esat'],
  'uatuk-tmua-admissions': ['Admissions', 'tmua'],
}))
let database = null
let databaseQuestionBankSignature = ''
const coachHistoryWriteQueues = new Map()

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function readJson(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        settled = true
        reject(Object.assign(new Error('Request is too large.'), { statusCode: 413 }))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }))
      }
    })
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

function asText(value, maxLength = 200) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function canonicalStage(value, { allowLegacy = false } = {}) {
  const raw = asText(value, 40)
  if (allowLegacy && raw === LEGACY_SCOPE) return LEGACY_SCOPE
  const stage = ROUTE_STAGES.get(raw.toLowerCase())
  if (!stage) throw Object.assign(new Error('Stage must be IGCSE, AS, A2, Competition or Admissions.'), { statusCode: 400 })
  return stage
}

function canonicalRouteId(value, { allowLegacy = false } = {}) {
  const routeId = asText(value, 120).toLowerCase()
  if (allowLegacy && routeId === LEGACY_SCOPE) return LEGACY_SCOPE
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(routeId)) {
    throw Object.assign(new Error('A valid routeId is required.'), { statusCode: 400 })
  }
  if (!REGISTERED_ROUTES.has(routeId)) throw Object.assign(new Error('routeId is not registered.'), { statusCode: 400 })
  return routeId
}

function stageForRoute(routeId) {
  if (routeId === LEGACY_SCOPE) return LEGACY_SCOPE
  return REGISTERED_ROUTES.get(routeId)?.[0] || null
}

function verifiedRouteScope(routeValue, stageValue, { allowLegacy = false } = {}) {
  const routeId = canonicalRouteId(routeValue, { allowLegacy })
  const stage = canonicalStage(stageValue, { allowLegacy })
  if (stageForRoute(routeId) !== stage) {
    throw Object.assign(new Error('routeId and stage must identify the same learning route.'), { statusCode: 400 })
  }
  return { routeId, stage }
}

function verifiedAssignmentScope(routeValue, stageValue, subjectValue) {
  const scope = verifiedRouteScope(routeValue, stageValue)
  const subjectId = asText(subjectValue, 80).toLowerCase()
  if (REGISTERED_ROUTES.get(scope.routeId)?.[1] !== subjectId) {
    throw Object.assign(new Error('subjectId does not match the registered routeId.'), { statusCode: 400 })
  }
  return { ...scope, subjectId }
}

export function assignableQuestionIdsForBank(questionBank = unifiedQuestionBank) {
  return new Set((Array.isArray(questionBank) ? questionBank : [])
    .map((question) => String(question?.bankId || '').trim())
    .filter(Boolean))
}

function mergeTopicPracticeQuestionBanks(baseQuestionBank, additionalQuestionBank) {
  const questions = new Map()
  for (const question of [...(Array.isArray(baseQuestionBank) ? baseQuestionBank : []), ...(Array.isArray(additionalQuestionBank) ? additionalQuestionBank : [])]) {
    const sourceQuestionId = String(question?.sourceQuestionId || question?.questionGroupId || '').trim()
    const routeId = String(question?.routeId || '').trim()
    if (!sourceQuestionId || !routeId) continue
    questions.set(`${routeId}\u0000${sourceQuestionId}`, question)
  }
  return Object.freeze([...questions.values()])
}

function routeScopedQuestionIds(values, routeId, assignableQuestionIds) {
  if (!Array.isArray(values) || !values.length) throw Object.assign(new Error('Assignment needs route-scoped question IDs.'), { statusCode: 400 })
  if (values.length > 60) throw Object.assign(new Error('An assignment can contain at most 60 question IDs.'), { statusCode: 400 })
  const questionIds = values.map((value) => {
    const bankId = asText(value, 320)
    const separator = bankId.indexOf('@')
    const sourceQuestionId = bankId.slice(0, separator)
    const suffix = bankId.slice(separator + 1)
    if (separator <= 0 || sourceQuestionId.includes('@') || /\s/.test(bankId) || suffix !== routeId) {
      throw Object.assign(new Error(`Every question bankId must use <sourceQuestionId>@${routeId}.`), { statusCode: 400 })
    }
    return bankId
  })
  if (new Set(questionIds).size !== questionIds.length) {
    throw Object.assign(new Error('Assignment question IDs must be unique.'), { statusCode: 400 })
  }
  for (const questionId of questionIds) {
    if (!assignableQuestionIds.has(questionId)) {
      throw Object.assign(new Error('Assignment question IDs must be verified and source-complete for this route.'), { statusCode: 400 })
    }
  }
  return questionIds
}

function storedScope(row) {
  const routeId = asText(row.route_id, 120) || LEGACY_SCOPE
  if (routeId === LEGACY_SCOPE) return { routeId: LEGACY_SCOPE, stage: LEGACY_SCOPE, scopeStatus: LEGACY_SCOPE }
  return { routeId, stage: asText(row.stage, 40), scopeStatus: 'scoped' }
}

function nowIso() {
  return new Date().toISOString()
}

function canonicalTimestamp(value, fallback = nowIso()) {
  if (value == null || String(value).trim() === '') return fallback
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) {
    throw Object.assign(new Error('submittedAt must be a valid timestamp.'), {
      statusCode: 400,
      code: 'submitted_at_invalid',
    })
  }
  return new Date(parsed).toISOString()
}

function canonicalAttemptId(value) {
  const attemptId = asText(value, 120)
  if (!attemptId || !/^[A-Za-z0-9._:-]{8,120}$/.test(attemptId)) {
    throw Object.assign(new Error('A valid attemptId is required.'), { statusCode: 400, code: 'attempt_invalid' })
  }
  return attemptId
}

function compactAttemptValue(value, key = '', depth = 0) {
  const normalizedKey = String(key || '').toLowerCase()
  if (
    normalizedKey
    && /(authorization|cookie|token|secret|password|user.?id|owner.?id|data.?url|base64|blob|handwriting|image.?data)/i.test(normalizedKey)
  ) return undefined
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    const text = value.replaceAll(String.fromCharCode(0), '').trim()
    if (/data:[^,]*;base64,/i.test(text) || /^[A-Za-z0-9+/]{96,}={0,2}$/.test(text)) return undefined
    return text.slice(0, 20_000)
  }
  if (depth >= 6 || !value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    return value
      .slice(0, 120)
      .map((item) => compactAttemptValue(item, '', depth + 1))
      .filter((item) => item !== undefined)
  }
  const result = {}
  for (const [childKey, childValue] of Object.entries(value).slice(0, 120)) {
    const compact = compactAttemptValue(childValue, childKey, depth + 1)
    if (compact !== undefined) result[childKey] = compact
  }
  return result
}

function compactStudentAttemptSnapshot(payload, { attemptId, routeId, stage, paperId, submittedAt }) {
  const source = payload?.attempt && typeof payload.attempt === 'object' ? payload.attempt : {}
  const suppliedScoreResult = source.scoreResult ?? source.result ?? payload.scoreResult ?? payload.result
  const hasClientReportedResult = suppliedScoreResult && typeof suppliedScoreResult === 'object' && !Array.isArray(suppliedScoreResult)
  const candidate = {
    attemptId,
    id: asText(source.id, 120) || attemptId,
    unitId: asText(source.unitId || payload.unitId, 200),
    routeId,
    stage,
    paperId,
    // Scores arrive from the browser after local marking. They are useful as
    // saved evidence, but this endpoint has not independently verified them.
    // Keep them explicitly provisional so a reload cannot promote them into
    // formal progress or analytics.
    attemptStatus: hasClientReportedResult ? 'provisional-result' : asText(source.attemptStatus || payload.attemptStatus, 80),
    submittedAt,
    elapsedSec: Number.isFinite(Number(source.elapsedSec)) ? Math.max(0, Math.min(Number(source.elapsedSec), 86_400)) : undefined,
    answeredCount: Number.isFinite(Number(source.answeredCount)) ? Math.max(0, Number(source.answeredCount)) : undefined,
    questionCount: Number.isFinite(Number(source.questionCount)) ? Math.max(0, Number(source.questionCount)) : undefined,
    partial: typeof source.partial === 'boolean' ? source.partial : undefined,
    markingMode: asText(source.markingMode || payload.markingMode, 60),
    paperStudyMode: asText(source.paperStudyMode || payload.paperStudyMode, 60),
    pairKey: asText(source.pairKey || payload.pairKey, 240),
    paperRef: source.paperRef || payload.paperRef,
    profile: source.profile || payload.profile,
    notes: source.notes || payload.notes,
    answers: source.answers,
    working: source.working,
    evidence: source.evidence,
    pdfInkByPage: source.pdfInkByPage || payload.pdfInkByPage,
    pdfInkQuestionMap: source.pdfInkQuestionMap || payload.pdfInkQuestionMap,
    timeUp: typeof source.timeUp === 'boolean' ? source.timeUp : undefined,
    selfMarks: source.selfMarks || payload.selfMarks,
    maxMarksByQuestion: source.maxMarksByQuestion || payload.maxMarksByQuestion,
    aiMarks: source.aiMarks || payload.aiMarks,
    lastSavedReview: source.lastSavedReview || payload.lastSavedReview,
    scoreResult: suppliedScoreResult,
    formalResult: false,
    ...(hasClientReportedResult ? { resultAuthority: 'client-reported' } : {}),
  }
  return compactAttemptValue(candidate)
}

function parseStudentAttemptRow(row) {
  let binding = null
  let snapshot = {}
  try { binding = JSON.parse(row.binding_json) } catch { binding = null }
  try { snapshot = JSON.parse(row.attempt_json) || {} } catch { snapshot = {} }
  return {
    userId: String(row.user_id),
    attemptId: String(row.attempt_id),
    binding,
    snapshot,
    submissionStatus: String(row.submission_status || (row.submitted_at ? 'submitted' : 'draft')),
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function publicStudentAttempt(row) {
  const parsed = parseStudentAttemptRow(row)
  const snapshot = { ...parsed.snapshot }
  const hasClientReportedResult = snapshot.scoreResult && typeof snapshot.scoreResult === 'object' && !Array.isArray(snapshot.scoreResult)
  if (hasClientReportedResult) {
    snapshot.attemptStatus = 'provisional-result'
    snapshot.formalResult = false
    snapshot.resultAuthority = 'client-reported'
  } else {
    snapshot.formalResult = false
  }
  return {
    attemptId: parsed.attemptId,
    mode: parsed.binding?.mode || null,
    routeId: parsed.binding?.routeId || null,
    stage: parsed.binding?.stage || null,
    paperId: parsed.binding?.paperId || '',
    submissionStatus: parsed.submissionStatus,
    submittedAt: parsed.submittedAt,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    binding: parsed.binding,
    attempt: {
      ...snapshot,
      attemptId: parsed.attemptId,
      submissionStatus: parsed.submissionStatus,
      submittedAt: parsed.submittedAt,
    },
  }
}

function canonicalAttemptProvenanceMatches(provided, canonical) {
  const sourceEvidence = provided?.sourceEvidence || {}
  const expectedEvidence = canonical?.sourceEvidence || {}
  return Boolean(
    canonical
    && (!canonical.schemaVersion || provided.schemaVersion === canonical.schemaVersion)
    && (!canonical.manifestSchemaVersion || provided.manifestSchemaVersion === canonical.manifestSchemaVersion)
    && (!canonical.reviewSchemaVersion || provided.reviewSchemaVersion === canonical.reviewSchemaVersion)
    && provided.sourceQuestionId === canonical.sourceQuestionId
    && provided.questionPartId === canonical.questionPartId
    && provided.bindingSignature === canonical.bindingSignature
    && provided.reviewVersion === canonical.reviewVersion
    && provided.sourceDocumentSha256 === canonical.sourceDocumentSha256
    && provided.answerDocumentSha256 === canonical.answerDocumentSha256
    && provided.sourceIndexSha256 === canonical.sourceIndexSha256
    && provided.sourceManifestChecksum === canonical.sourceManifestChecksum
    && sourceEvidence.assetId === expectedEvidence.assetId
    && Number(sourceEvidence.page) === Number(expectedEvidence.page)
    && sourceEvidence.assetUrl === expectedEvidence.assetUrl
    && sourceEvidence.assetSha256 === expectedEvidence.assetSha256
    && sourceEvidence.quote === expectedEvidence.quote
    && (!expectedEvidence.coordinateSpace || sourceEvidence.coordinateSpace === expectedEvidence.coordinateSpace)
    && (!expectedEvidence.region || JSON.stringify(sourceEvidence.region) === JSON.stringify(expectedEvidence.region))
    && (!expectedEvidence.markSchemePage || Number(sourceEvidence.markSchemePage) === Number(expectedEvidence.markSchemePage))
    && (!expectedEvidence.markSchemePageImageSha256 || sourceEvidence.markSchemePageImageSha256 === expectedEvidence.markSchemePageImageSha256)
  )
}

function canonicalStudentAttemptBinding(payload, questionBank) {
  const attempt = payload?.attempt && typeof payload.attempt === 'object' ? payload.attempt : {}
  const attemptId = canonicalAttemptId(payload.attemptId)
  if (attempt.id && String(attempt.id) !== attemptId) {
    throw Object.assign(new Error('The attempt body ID must match attemptId.'), {
      statusCode: 409,
      code: 'attempt_binding_mismatch',
    })
  }
  for (const [label, outerValue, innerValue] of [
    ['mode', payload.mode, attempt.mode],
    ['routeId', payload.routeId, attempt.routeId],
    ['stage', payload.stage, attempt.stage],
    ['paperId', payload.paperId, attempt.paperId],
  ]) {
    if (outerValue && innerValue && asText(outerValue, 240) !== asText(innerValue, 240)) {
      throw Object.assign(new Error(`The supplied ${label} values do not match.`), {
        statusCode: 409,
        code: 'attempt_binding_mismatch',
      })
    }
  }
  const mode = asText(payload.mode || attempt.mode, 32)
  if (!['topic', 'full-paper'].includes(mode)) {
    throw Object.assign(new Error('Attempt mode must be topic or full-paper.'), { statusCode: 400, code: 'attempt_mode_invalid' })
  }
  const routeCandidate = asText(payload.routeId || attempt.routeId, 120)
  const stageCandidate = asText(payload.stage || attempt.stage || stageForRoute(routeCandidate), 40)
  const scope = verifiedRouteScope(routeCandidate, stageCandidate)
  const paperId = asText(payload.paperId || attempt.paperId, 200)
  if (mode === 'full-paper' && !paperId) {
    throw Object.assign(new Error('A full-paper attempt requires paperId.'), { statusCode: 400, code: 'paper_context_missing' })
  }

  const markingParts = Array.isArray(payload.markingParts)
    ? payload.markingParts
    : (Array.isArray(attempt.markingParts) ? attempt.markingParts : [])
  let parts = []
  if (markingParts.length) {
    const seen = new Set()
    parts = markingParts.map((requestPart) => {
      const provenance = requestPart?.provenance && typeof requestPart.provenance === 'object' ? requestPart.provenance : requestPart
      const sourceQuestionId = asText(provenance.sourceQuestionId, 320)
      const questionPartId = asText(provenance.questionPartId, 360)
      const routeId = asText(provenance.routeId, 160)
      const uniqueKey = `${sourceQuestionId}\u0000${questionPartId}`
      if (!sourceQuestionId || !questionPartId || !routeId || seen.has(uniqueKey)) {
        throw Object.assign(new Error('Every source-bound attempt part must be unique and complete.'), { statusCode: 422, code: 'source_provenance_missing' })
      }
      seen.add(uniqueKey)
      const question = questionBank.find((candidate) => candidate?.routeId === routeId && candidate?.sourceQuestionId === sourceQuestionId)
      if (!question) throw Object.assign(new Error('The source-bound attempt part is unavailable.'), { statusCode: 422, code: 'source_question_unreviewed' })
      const part = (question.parts || []).find((candidate) => String(candidate?.partId || candidate?.questionPartId || candidate?.id || '') === questionPartId)
      if (!part) throw Object.assign(new Error('The source-bound attempt part is unavailable.'), { statusCode: 422, code: 'source_question_unknown' })
      const aiCanonical = canonicalAiMarkingProvenance(question, part)
      const practiceCanonical = canonicalSourcePracticeProvenance(question, part)
      const canonical = [aiCanonical, practiceCanonical].find((candidate) => canonicalAttemptProvenanceMatches(provenance, candidate))
      if (!canonical) throw Object.assign(new Error('The source-bound attempt provenance no longer matches the current catalog.'), { statusCode: 409, code: 'source_provenance_mismatch' })
      if (question.routeId !== scope.routeId || question.stage !== scope.stage) {
        throw Object.assign(new Error('Every source part must belong to the attempt route and stage.'), {
          statusCode: 409,
          code: 'attempt_binding_mismatch',
        })
      }
      if (paperId && String(question.sourceRef?.paperId || '') !== paperId) {
        throw Object.assign(new Error('Every source part must belong to the attempt paper.'), { statusCode: 409, code: 'attempt_binding_mismatch' })
      }
      return {
        routeId: question.routeId,
        stage: question.stage,
        paperId: String(question.sourceRef?.paperId || ''),
        sourceQuestionId: canonical.sourceQuestionId,
        questionPartId: canonical.questionPartId,
        provenance: canonical,
      }
    }).sort((left, right) => (
      `${left.sourceQuestionId}\u0000${left.questionPartId}`.localeCompare(`${right.sourceQuestionId}\u0000${right.questionPartId}`)
    ))
  }

  return {
    attemptId,
    mode,
    routeId: scope.routeId,
    stage: scope.stage,
    paperId: mode === 'full-paper' ? paperId : '',
    parts,
  }
}

function sameCanonicalBinding(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null)
}

function ensureColumn(database, table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((item) => item.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function migrateRouteScope(database) {
  ensureColumn(database, 'assignments', 'route_id', 'TEXT')
  ensureColumn(database, 'submission_events', 'route_id', 'TEXT')
  ensureColumn(database, 'submission_events', 'stage', 'TEXT')
  database.prepare("UPDATE assignments SET route_id = ? WHERE route_id IS NULL OR TRIM(route_id) = ''").run(LEGACY_SCOPE)
  database.prepare("UPDATE submission_events SET route_id = ? WHERE route_id IS NULL OR TRIM(route_id) = ''").run(LEGACY_SCOPE)
  database.prepare("UPDATE submission_events SET stage = ? WHERE stage IS NULL OR TRIM(stage) = ''").run(LEGACY_SCOPE)
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_assignments_route_stage ON assignments(route_id, stage, classroom_id);
  `)
}

function canonicalStoredSourceScope(value, routeId, stage) {
  try {
    const scope = JSON.parse(value)
    if (!scope || Array.isArray(scope) || typeof scope !== 'object') return value
    return JSON.stringify({ ...scope, routeId, stage })
  } catch {
    // Preserve malformed historical payloads for manual review instead of erasing provenance.
    return value
  }
}

function migrateRegisteredRouteStages(database) {
  const assignments = database.prepare('SELECT id, route_id, stage, source_scope_json FROM assignments WHERE route_id IS NOT NULL AND TRIM(route_id) <> ?').all(LEGACY_SCOPE)
  const updates = assignments.flatMap((assignment) => {
    const routeId = asText(assignment.route_id, 120)
    const stage = stageForRoute(routeId)
    if (!stage) return []
    const sourceScopeJson = canonicalStoredSourceScope(assignment.source_scope_json, routeId, stage)
    if (asText(assignment.stage, 40) === stage && sourceScopeJson === assignment.source_scope_json) return []
    return [{ id: assignment.id, routeId, stage, sourceScopeJson }]
  })
  const stageCorrections = [...REGISTERED_ROUTES.entries()].filter(([, [stage]]) => Boolean(stage))
  if (!updates.length && !stageCorrections.length) return

  const updateAssignment = database.prepare('UPDATE assignments SET stage = ?, source_scope_json = ? WHERE id = ?')
  const updateSubmissionStage = database.prepare('UPDATE submission_events SET stage = ? WHERE route_id = ? AND (stage IS NULL OR TRIM(stage) <> ?)')
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const update of updates) updateAssignment.run(update.stage, update.sourceScopeJson, update.id)
    for (const [routeId, [stage]] of stageCorrections) updateSubmissionStage.run(stage, routeId, stage)
    database.exec('COMMIT')
  } catch (error) {
    try { database.exec('ROLLBACK') } catch { /* No active migration transaction. */ }
    throw error
  }
}

function hasAssignmentScopedIdempotency(database) {
  return database.prepare('PRAGMA index_list(submission_events)').all().some((index) => {
    if (!index.unique) return false
    const columns = database.prepare(`PRAGMA index_info(${index.name})`).all().sort((left, right) => left.seqno - right.seqno).map((item) => item.name)
    return columns.join(',') === 'assignment_id,student_user_id,idempotency_key'
  })
}

function migrateSubmissionIdempotency(database) {
  if (!hasAssignmentScopedIdempotency(database)) {
    database.exec('PRAGMA foreign_keys = OFF')
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS submission_events_route_migration;
        CREATE TABLE submission_events_route_migration (
          id TEXT PRIMARY KEY,
          assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
          student_user_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          event_type TEXT NOT NULL,
          route_id TEXT NOT NULL,
          stage TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          UNIQUE (assignment_id, student_user_id, idempotency_key)
        );
        INSERT INTO submission_events_route_migration
          (id, assignment_id, student_user_id, idempotency_key, event_type, route_id, stage, payload_json, occurred_at)
        SELECT id, assignment_id, student_user_id, idempotency_key, event_type, route_id, stage, payload_json, occurred_at
        FROM submission_events;
        DROP TABLE submission_events;
        ALTER TABLE submission_events_route_migration RENAME TO submission_events;
        COMMIT;
      `)
    } catch (error) {
      try { database.exec('ROLLBACK') } catch { /* No active migration transaction. */ }
      throw error
    } finally {
      database.exec('PRAGMA foreign_keys = ON')
    }
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_submission_events_assignment ON submission_events(assignment_id, student_user_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_submission_events_route_stage ON submission_events(route_id, stage, occurred_at DESC);
  `)
}

function questionBankSeedSignature(questionBank = []) {
  const records = (Array.isArray(questionBank) ? questionBank : []).map((question) => [
    String(question?.routeId || ''),
    String(question?.sourceQuestionId || question?.questionGroupId || ''),
    String(question?.sourceRef?.sha256 || ''),
    String(question?.answerRef?.sha256 || ''),
    String(question?.answerBinding?.verificationStatus || ''),
    String(question?.sourceContent?.bindingSignature || ''),
    String(question?.knowledgeGroupId || question?.topicId || ''),
    [...(question?.topicTags || [])].map(String).sort().join(','),
    (question?.parts || []).map((part) => [part?.partId, part?.marks, part?.sourcePage, part?.answerSourcePage].join(':')).join(','),
  ].join('\u0000')).sort()
  return crypto.createHash('sha256').update(records.join('\n')).digest('hex')
}

function seedCurrentQuestionBank(databaseHandle, questionBank) {
  const signature = questionBankSeedSignature(questionBank)
  if (signature === databaseQuestionBankSignature) return
  seedSyllabusTables(databaseHandle, questionBank)
  databaseQuestionBankSignature = signature
}

function appDatabase(env, questionBank = unifiedQuestionBank) {
  if (database) {
    seedCurrentQuestionBank(database, questionBank)
    return database
  }
  if (!globalThis.process?.versions?.node) throw new Error('STEM storage requires Node.js.')
  // node:sqlite is available in the Node 22 runtime used by the deployment.
  const { DatabaseSync } = requireNodeSqlite()
  const configuredDatabasePath = String(env.STEM_DATABASE_PATH || env.STEM_DB_PATH || path.join(process.cwd(), 'data', 'stem.sqlite'))
  const databasePath = configuredDatabasePath === ':memory:' ? configuredDatabasePath : path.resolve(configuredDatabasePath)
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS classrooms (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS class_memberships (
      classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (classroom_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_class_memberships_user ON class_memberships(user_id, classroom_id);
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      route_id TEXT NOT NULL,
      syllabus_point_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_scope_json TEXT NOT NULL,
      due_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_classroom ON assignments(classroom_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS assignment_reminders (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      audience TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignment_reminders_assignment ON assignment_reminders(assignment_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS assignment_feedback (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      student_user_id TEXT,
      author_user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignment_feedback_assignment ON assignment_feedback(assignment_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS submission_events (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      student_user_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      route_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE (assignment_id, student_user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_submission_events_assignment ON submission_events(assignment_id, student_user_id, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS student_attempts (
      user_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      route_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      binding_json TEXT NOT NULL,
      attempt_json TEXT NOT NULL,
      submission_status TEXT NOT NULL DEFAULT 'draft',
      submitted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, attempt_id)
    );
    CREATE INDEX IF NOT EXISTS idx_student_attempts_user_updated ON student_attempts(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_student_attempts_attempt ON student_attempts(attempt_id);
    CREATE TABLE IF NOT EXISTS private_notes (
      user_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (user_id, route_id)
    );
    CREATE INDEX IF NOT EXISTS idx_private_notes_user ON private_notes(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS stem_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar_data_url TEXT NOT NULL,
      roles_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stem_sessions_user ON stem_sessions(user_id, expires_at DESC);
  `)
  ensureColumn(database, 'private_notes', 'deleted_at', 'TEXT')
  migrateStudentAttemptsSchema(database)
  migrateRouteScope(database)
  migrateRegisteredRouteStages(database)
  migrateSubmissionIdempotency(database)
  databaseQuestionBankSignature = ''
  seedCurrentQuestionBank(database, questionBank)
  return database
}

function migrateStudentAttemptsSchema(database) {
  const columns = database.prepare('PRAGMA table_info(student_attempts)').all()
  if (!columns.length) return
  if (!columns.some((column) => column.name === 'submission_status')) {
    database.exec("ALTER TABLE student_attempts ADD COLUMN submission_status TEXT NOT NULL DEFAULT 'draft'")
  }
  database.prepare("UPDATE student_attempts SET submission_status = 'submitted' WHERE submitted_at IS NOT NULL AND TRIM(submitted_at) <> '' AND submission_status <> 'submitted'").run()

  const submittedAtColumn = columns.find((column) => column.name === 'submitted_at')
  if (submittedAtColumn?.notnull !== 1) return

  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE student_attempts_migrated (
        user_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        route_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        paper_id TEXT NOT NULL,
        binding_json TEXT NOT NULL,
        attempt_json TEXT NOT NULL,
        submission_status TEXT NOT NULL DEFAULT 'draft',
        submitted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, attempt_id)
      );
      INSERT INTO student_attempts_migrated
        (user_id, attempt_id, mode, route_id, stage, paper_id, binding_json, attempt_json, submission_status, submitted_at, created_at, updated_at)
      SELECT user_id, attempt_id, mode, route_id, stage, paper_id, binding_json, attempt_json,
        CASE WHEN submitted_at IS NULL OR TRIM(submitted_at) = '' THEN 'draft' ELSE 'submitted' END,
        submitted_at, created_at, updated_at
      FROM student_attempts;
      DROP TABLE student_attempts;
      ALTER TABLE student_attempts_migrated RENAME TO student_attempts;
      CREATE INDEX IF NOT EXISTS idx_student_attempts_user_updated ON student_attempts(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_student_attempts_attempt ON student_attempts(attempt_id);
    `)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function requireNodeSqlite() {
  // This indirection keeps browser bundling out of the Vite client graph.
  const module = process.getBuiltinModule?.('node:sqlite')
  if (!module?.DatabaseSync) throw Object.assign(new Error('Server storage is unavailable.'), { statusCode: 503 })
  return module
}

function decodeBase64Url(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function verifiedRoleClaims(payload) {
  const values = []
  for (const value of [payload.roles, payload.workspaceRoles]) {
    if (Array.isArray(value)) values.push(...value)
    else if (typeof value === 'string') values.push(...value.split(','))
  }
  if (typeof payload.role === 'string') values.push(payload.role)
  return [...new Set(values.map((value) => asText(value, 40).toLowerCase()))].filter((value) => ['teacher', 'owner', 'school', 'school_admin', 'school_owner'].includes(value))
}

function identityFromRequest(request, signingKey) {
  const header = String(request.headers.authorization || '')
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token || !signingKey) throw Object.assign(new Error('Sign in to STEM with the same account to continue.'), { statusCode: 401 })
  const parts = token.split('.')
  if (parts.length !== 3) throw Object.assign(new Error('Your shared sign-in has expired. Please refresh and try again.'), { statusCode: 401 })
  const [encodedHeader, encodedPayload, signature] = parts
  const expected = crypto.createHmac('sha256', signingKey).update(`${encodedHeader}.${encodedPayload}`).digest('base64url')
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw Object.assign(new Error('Your shared sign-in could not be verified.'), { statusCode: 401 })
  }
  let tokenHeader
  let payload
  try {
    tokenHeader = decodeBase64Url(encodedHeader)
    payload = decodeBase64Url(encodedPayload)
  } catch {
    throw Object.assign(new Error('Your shared sign-in is invalid.'), { statusCode: 401 })
  }
  const now = Math.floor(Date.now() / 1000)
  const issuedAt = Number(payload.iat)
  const expiresAt = Number(payload.exp)
  if (
    tokenHeader.alg !== 'HS256'
    || payload.iss !== TOKEN_ISSUER
    || payload.aud !== TOKEN_AUDIENCE
    || !/^ielts:\d+$/.test(String(payload.sub || ''))
    || !Number.isInteger(issuedAt)
    || !Number.isInteger(expiresAt)
    || issuedAt > now + 300
    || expiresAt <= now
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > 60 * 60
  ) {
    throw Object.assign(new Error('Your shared sign-in has expired. Please refresh and try again.'), { statusCode: 401 })
  }
  return { id: payload.sub, username: asText(payload.username, 80), avatarDataUrl: String(payload.avatarDataUrl || '').slice(0, 500_000), roles: verifiedRoleClaims(payload) }
}

function identityToken(identity, signingKey) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 5 * 60
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    sub: identity.id,
    username: identity.username,
    avatarDataUrl: identity.avatarDataUrl || '',
    roles: identity.roles || [],
    workspaceRoles: identity.roles || [],
    iat: issuedAt,
    exp: expiresAt,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return {
    accessToken: `${header}.${payload}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  }
}

function requestCookie(request, name) {
  const raw = String(request.headers.cookie || '')
    .split(/;\s*/)
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) || ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return ''
  }
}

function sessionCookie(value, expiresAt, env) {
  const secure = String(env.STEM_SESSION_SECURE || '1').trim() !== '0' ? '; Secure' : ''
  return `${STEM_SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${expiresAt.toUTCString()}`
}

function clearSessionCookie(env) {
  const secure = String(env.STEM_SESSION_SECURE || '1').trim() !== '0' ? '; Secure' : ''
  return `${STEM_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`
}

function nativeSessionIdentity(request, database) {
  const token = requestCookie(request, STEM_SESSION_COOKIE)
  if (!token) return null
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const row = database.prepare(`
    SELECT user_id, username, avatar_data_url, roles_json, expires_at
    FROM stem_sessions
    WHERE token_hash = ?
  `).get(tokenHash)
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    if (row) database.prepare('DELETE FROM stem_sessions WHERE token_hash = ?').run(tokenHash)
    return null
  }
  let roles = []
  try {
    roles = verifiedRoleClaims({ roles: JSON.parse(row.roles_json) })
  } catch {
    return null
  }
  database.prepare('UPDATE stem_sessions SET last_seen_at = ? WHERE token_hash = ?').run(nowIso(), tokenHash)
  return {
    id: asText(row.user_id, 80),
    username: asText(row.username, 80),
    avatarDataUrl: String(row.avatar_data_url || '').slice(0, 500_000),
    roles,
  }
}

function createNativeSession(database, identity) {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + STEM_SESSION_TTL_MS)
  database.prepare(`
    INSERT INTO stem_sessions (token_hash, user_id, username, avatar_data_url, roles_json, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tokenHash,
    identity.id,
    identity.username,
    identity.avatarDataUrl || '',
    JSON.stringify(identity.roles || []),
    expiresAt.toISOString(),
    createdAt,
    createdAt,
  )
  return { token, expiresAt }
}

function removeNativeSession(request, database) {
  const token = requestCookie(request, STEM_SESSION_COOKIE)
  if (!token) return
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  database.prepare('DELETE FROM stem_sessions WHERE token_hash = ?').run(tokenHash)
}

function canonicalInternalAuthPayload({ mode, username, password }) {
  return JSON.stringify({
    mode: asText(mode, 20),
    username: asText(username, 80).toLowerCase(),
    password: String(password || ''),
  })
}

function nativeAuthNotConfigured() {
  return Object.assign(new Error('Native STEM account sign-in is not configured on this server. Your password was not sent.'), {
    statusCode: 503,
    code: 'native_auth_not_configured',
  })
}

function nativeAuthOrigin(env = {}) {
  return String(env.STEM_AUTH_INTERNAL_ORIGIN || DEFAULT_INTERNAL_AUTH_ORIGIN).trim()
}

function internalAuthEndpoint(origin) {
  const configuredOrigin = String(origin || '').trim()
  if (!configuredOrigin) throw nativeAuthNotConfigured()
  let url
  try {
    url = new URL(configuredOrigin)
  } catch {
    throw nativeAuthNotConfigured()
  }
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(hostname)) {
    throw nativeAuthNotConfigured()
  }
  url.pathname = INTERNAL_AUTH_PATH
  url.search = ''
  url.hash = ''
  return url.toString()
}

function internalAuthOriginConfigured(env = {}) {
  try {
    internalAuthEndpoint(nativeAuthOrigin(env))
    return true
  } catch {
    return false
  }
}

function nativeAuthConfigured(env = {}) {
  return Boolean(String(env.STEM_INTERNAL_AUTH_KEY || env.STEM_IDENTITY_SIGNING_KEY || '') && internalAuthOriginConfigured(env))
}

function nativeAuthBridgeError(code, message) {
  return Object.assign(new Error(message), { statusCode: 503, code })
}

function signedInternalAuthRequest({ mode, username, password, env }) {
  const normalizedMode = mode === 'register' ? 'register' : 'login'
  const body = canonicalInternalAuthPayload({ mode: normalizedMode, username, password })
  const signingKey = String(env.STEM_INTERNAL_AUTH_KEY || env.STEM_IDENTITY_SIGNING_KEY || '')
  if (!signingKey) throw nativeAuthNotConfigured()
  const endpoint = internalAuthEndpoint(nativeAuthOrigin(env))
  const timestamp = String(Date.now())
  const digest = crypto.createHash('sha256').update(body).digest('hex')
  const signature = crypto.createHmac('sha256', signingKey).update(`${timestamp}.${digest}`).digest('base64url')
  return {
    body,
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      'X-Stem-Auth-Timestamp': timestamp,
      'X-Stem-Auth-Signature': signature,
    },
  }
}

function internalCoachConversationsEndpoint(origin) {
  const endpoint = internalAuthEndpoint(origin)
  const url = new URL(endpoint)
  url.pathname = '/api/internal/stem/coach/conversations'
  return url.toString()
}

function coachHistoryLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Math.max(1, Math.min(MAX_COACH_HISTORY_MESSAGES, Number.isFinite(parsed) ? parsed : 40))
}

function signedCoachConversationsRequest({ method, userId, payload, query = {}, env }) {
  const signingKey = String(env.STEM_INTERNAL_AUTH_KEY || env.STEM_IDENTITY_SIGNING_KEY || '')
  if (!signingKey) throw nativeAuthNotConfigured()
  const normalizedMethod = String(method || 'GET').toUpperCase()
  const body = normalizedMethod === 'GET'
    ? ''
    : JSON.stringify({ ...(payload || {}), userId: asText(userId, 80) })
  const timestamp = String(Date.now())
  const endpoint = new URL(internalCoachConversationsEndpoint(nativeAuthOrigin(env)))
  if (normalizedMethod === 'GET') {
    endpoint.searchParams.set('userId', asText(userId, 80))
    endpoint.searchParams.set('limit', String(coachHistoryLimit(query.limit)))
  }
  const signedPayload = normalizedMethod === 'GET'
    ? `${body}\n${endpoint.pathname}${endpoint.search}`
    : body
  const digest = crypto.createHash('sha256').update(signedPayload).digest('hex')
  const signature = crypto.createHmac('sha256', signingKey).update(`${timestamp}.${digest}`).digest('base64url')
  return {
    endpoint: endpoint.toString(),
    body,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-Stem-Auth-Timestamp': timestamp,
      'X-Stem-Auth-Signature': signature,
    },
  }
}

async function requestCoachConversations({ method, userId, payload, query, env, fetchImpl = fetch }) {
  if (!nativeAuthConfigured(env)) {
    throw Object.assign(new Error('Shared Coach history is not configured on this server.'), {
      statusCode: 503,
      code: 'coach_history_not_configured',
    })
  }
  const request = signedCoachConversationsRequest({ method, userId, payload, query, env })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetchImpl(request.endpoint, {
      method: String(method || 'GET').toUpperCase(),
      headers: request.headers,
      ...(request.body ? { body: request.body } : {}),
      signal: controller.signal,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw Object.assign(new Error(asText(result.error, 'Shared Coach history is temporarily unavailable.')), {
        statusCode: response.status >= 500 ? 503 : response.status,
        code: asText(result.code, 'coach_history_remote_error'),
        retryable: response.status >= 500,
      })
    }
    return result
  } catch (error) {
    if (error?.statusCode) throw error
    throw Object.assign(new Error(error?.name === 'AbortError'
      ? 'Shared Coach history request timed out.'
      : 'Shared Coach history is temporarily unavailable.'), {
      statusCode: 503,
      code: error?.name === 'AbortError' ? 'coach_history_timeout' : 'coach_history_unavailable',
      retryable: true,
      cause: error,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function coachMessageFingerprint(message) {
  const role = asText(message?.role, 20).toLowerCase()
  const content = String(message?.content || '').replaceAll(String.fromCharCode(0), '').trim().slice(0, 12_000)
  const createdAt = String(message?.createdAt || '').trim().slice(0, 80)
  if (!['user', 'assistant'].includes(role) || !content) return ''
  return `${role}|${createdAt}|${content}`
}

function coachMessageId(message) {
  return asText(message?.id, 120)
}

function coachMessageUpdatedAt(message) {
  return Date.parse(String(message?.updatedAt || message?.createdAt || '')) || 0
}

function sanitizeCoachContextText(value) {
  return asText(value, 6_000)
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/_=-]+/gi, '[image omitted]')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function mergeCoachMessage(existing, candidate) {
  const candidateIsNewer = coachMessageUpdatedAt(candidate) > coachMessageUpdatedAt(existing)
    || (coachMessageUpdatedAt(candidate) === coachMessageUpdatedAt(existing) && candidate._position >= existing._position)
  const primary = candidateIsNewer ? candidate : existing
  const secondary = primary === candidate ? existing : candidate
  const attachments = Array.isArray(primary.attachments) && primary.attachments.length
    ? primary.attachments
    : Array.isArray(secondary.attachments) && secondary.attachments.length
      ? secondary.attachments
      : []
  return {
    ...secondary,
    ...primary,
    ...(attachments.length ? { attachments } : {}),
    _position: Math.min(existing._position, candidate._position),
  }
}

function mergeCoachConversationMessages(...messageLists) {
  const byFingerprint = new Map()
  const byId = new Map()
  let position = 0
  for (const list of messageLists) {
    for (const message of Array.isArray(list) ? list : []) {
      const fingerprint = coachMessageFingerprint(message)
      const currentPosition = position
      position += 1
      if (!fingerprint) continue
      const normalized = { ...message, _position: currentPosition }
      const id = coachMessageId(normalized)
      const existing = (id && byId.get(id)) || byFingerprint.get(fingerprint)
      if (!existing) {
        byFingerprint.set(fingerprint, normalized)
        if (id) byId.set(id, normalized)
        continue
      }
      const merged = mergeCoachMessage(existing, normalized)
      byFingerprint.set(coachMessageFingerprint(existing), merged)
      byFingerprint.set(fingerprint, merged)
      byFingerprint.set(coachMessageFingerprint(merged), merged)
      if (coachMessageId(existing)) byId.set(coachMessageId(existing), merged)
      if (id) byId.set(id, merged)
    }
  }
  return [...new Set(byFingerprint.values())]
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || '') || 0
      const rightTime = Date.parse(right.createdAt || '') || 0
      return leftTime - rightTime || left._position - right._position
    })
    .slice(-MAX_COACH_HISTORY_MESSAGES)
    .map(({ _position, ...message }) => message)
}

function mergeCoachConversation(remote, incoming) {
  const current = incoming && typeof incoming === 'object' ? incoming : {}
  const previous = remote && typeof remote === 'object' ? remote : {}
  const now = new Date().toISOString()
  const contextText = sanitizeCoachContextText(current.contextText || previous.contextText)
  return {
    ...previous,
    ...current,
    sourceProduct: 'stem',
    binding: {
      ...(previous.binding && typeof previous.binding === 'object' ? previous.binding : {}),
      ...(current.binding && typeof current.binding === 'object' ? current.binding : {}),
    },
    messages: mergeCoachConversationMessages(previous.messages, current.messages),
    metadata: {
      ...(previous.metadata && typeof previous.metadata === 'object' ? previous.metadata : {}),
      ...(current.metadata && typeof current.metadata === 'object' ? current.metadata : {}),
      updatedAt: now,
    },
    createdAt: current.createdAt || previous.createdAt || now,
    updatedAt: now,
    ...(contextText ? { contextText } : {}),
  }
}

function mergeCoachConversationPayload(payload, remoteConversations) {
  const incoming = Array.isArray(payload?.conversations)
    ? payload.conversations
    : payload?.conversation
      ? [payload.conversation]
      : []
  const byConversationId = new Map((Array.isArray(remoteConversations) ? remoteConversations : [])
    .filter((conversation) => conversation && typeof conversation === 'object' && asText(conversation.conversationId, 180))
    .map((conversation) => [asText(conversation.conversationId, 180), conversation]))
  return {
    ...(payload && typeof payload === 'object' ? payload : {}),
    conversations: incoming.map((conversation) => mergeCoachConversation(
      byConversationId.get(asText(conversation?.conversationId, 180)),
      conversation,
    )),
  }
}

function withCoachHistoryWriteLock(env, userId, operation) {
  const lockKey = `${nativeAuthOrigin(env)}:${asText(userId, 80)}`
  const previous = coachHistoryWriteQueues.get(lockKey) || Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  coachHistoryWriteQueues.set(lockKey, next)
  return next.finally(() => {
    if (coachHistoryWriteQueues.get(lockKey) === next) coachHistoryWriteQueues.delete(lockKey)
  })
}

async function mergeAndSaveCoachConversations({ userId, payload, env, fetchImpl }) {
  return withCoachHistoryWriteLock(env, userId, async () => {
    const remote = await requestCoachConversations({
      method: 'GET',
      userId,
      query: { limit: MAX_COACH_HISTORY_MESSAGES },
      env,
      fetchImpl,
    })
    return requestCoachConversations({
      method: 'PUT',
      userId,
      payload: mergeCoachConversationPayload(payload, remote?.conversations),
      env,
      fetchImpl,
    })
  })
}

async function probeNativeAuthBridge({ env, fetchImpl = fetch }) {
  if (!nativeAuthConfigured(env)) return { status: 'not_configured' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3_000)
  try {
    const request = signedInternalAuthRequest({
      mode: 'login',
      username: NATIVE_AUTH_PROBE_USERNAME,
      password: NATIVE_AUTH_PROBE_PASSWORD,
      env,
    })
    const response = await fetchImpl(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    // A deliberately invalid account must reach the shared database and be
    // rejected with 401. Anything else is not safe to accept student passwords.
    if (response.status === 401) return { status: 'ready' }
    if (response.status === 403) return { status: 'signature_mismatch' }
    return { status: 'unavailable' }
  } catch {
    return { status: 'unavailable' }
  } finally {
    clearTimeout(timeout)
  }
}

async function authenticateNativeAccount({ mode, username, password, env, fetchImpl = fetch }) {
  const internalRequest = signedInternalAuthRequest({ mode, username, password, env })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetchImpl(internalRequest.endpoint, {
      method: 'POST',
      headers: internalRequest.headers,
      body: internalRequest.body,
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (response.status === 403) {
        throw nativeAuthBridgeError('native_auth_bridge_rejected', 'STEM could not verify the shared account service. Your account details were not accepted.')
      }
      if (response.status >= 500) {
        throw nativeAuthBridgeError('native_auth_bridge_unavailable', 'The shared account service is unavailable. Try again shortly.')
      }
      const message = response.status === 401
        ? 'Invalid username or password.'
        : response.status === 409
          ? 'Username already exists.'
          : response.status === 400
            ? String(payload.error || 'Check your account details.')
            : 'The shared account service is unavailable. Try again shortly.'
      throw Object.assign(new Error(message), { statusCode: response.status === 401 || response.status === 409 || response.status === 400 ? response.status : 503 })
    }
    const identity = payload?.identity
    const id = asText(identity?.id, 80)
    if (!/^ielts:\d+$/.test(id)) throw Object.assign(new Error('The shared account service returned an invalid identity.'), { statusCode: 503 })
    return {
      id,
      username: asText(identity.username, 80),
      avatarDataUrl: String(identity.avatarDataUrl || '').slice(0, 500_000),
      roles: verifiedRoleClaims(identity),
    }
  } catch (error) {
    if (error?.statusCode) throw error
    throw nativeAuthBridgeError('native_auth_bridge_unavailable', 'The shared account service is unavailable. Try again shortly.')
  } finally {
    clearTimeout(timeout)
  }
}

function requireVerifiedStaffClaim(user) {
  if (!user.roles.includes('teacher') && !user.roles.includes('owner')) {
    throw Object.assign(new Error('A server-verified teacher or owner claim is required to create a class.'), { statusCode: 403 })
  }
}

function requireSchoolAdminClaim(user) {
  if (!user.roles.includes('school_admin') && !user.roles.includes('school_owner')) {
    throw Object.assign(new Error('A server-verified school administrator claim is required for school analytics and reports.'), { statusCode: 403 })
  }
}

function membership(database, classroomId, userId) {
  return database.prepare('SELECT role FROM class_memberships WHERE classroom_id = ? AND user_id = ?').get(classroomId, userId) || null
}

function requireMembership(database, classroomId, userId, roles) {
  const record = membership(database, classroomId, userId)
  if (!record || !roles.has(record.role)) throw Object.assign(new Error('You do not have permission for this class.'), { statusCode: 403 })
  return record
}

function publicClassroom(row, role) {
  return { id: row.id, name: row.name, inviteCode: role === 'owner' || role === 'teacher' ? row.invite_code : undefined, role, createdAt: row.created_at, archivedAt: row.archived_at || null }
}

function publicAssignment(row) {
  const scope = storedScope(row)
  return {
    id: row.id,
    classroomId: row.classroom_id,
    subjectId: row.subject_id,
    ...scope,
    legacyStage: scope.scopeStatus === LEGACY_SCOPE ? asText(row.stage, 40) || null : undefined,
    syllabusPointId: row.syllabus_point_id,
    title: row.title,
    sourceScope: JSON.parse(row.source_scope_json),
    dueAt: row.due_at || null,
    status: row.status,
    createdAt: row.created_at,
    reminderCount: Number(row.reminder_count) || 0,
  }
}

function publicFeedback(row) {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    studentUserId: row.student_user_id || null,
    body: row.body,
    createdAt: row.created_at,
  }
}

function assignmentsForWorkspace(database, classes) {
  if (!classes.length) return []
  const classIds = classes.map((item) => item.id)
  const staffClassIds = classes.filter((item) => ['owner', 'teacher', 'school'].includes(item.role)).map((item) => item.id)
  const statusPredicate = staffClassIds.length
    ? `(assignments.status = 'active' OR assignments.classroom_id IN (${staffClassIds.map(() => '?').join(',')}))`
    : "assignments.status = 'active'"
  return database.prepare(`
    SELECT assignments.*, (
      SELECT COUNT(*) FROM assignment_reminders WHERE assignment_id = assignments.id
    ) AS reminder_count
    FROM assignments
    WHERE assignments.classroom_id IN (${classIds.map(() => '?').join(',')}) AND ${statusPredicate}
    ORDER BY assignments.created_at DESC
  `).all(...classIds, ...staffClassIds)
}

function publicSubmission(row, { includeStudentUserId = true } = {}) {
  const payload = JSON.parse(row.payload_json)
  const scope = storedScope(row)
  const result = {
    ...payload,
    id: row.id,
    assignmentId: row.assignment_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    syllabusPointId: row.syllabus_point_id,
    ...scope,
  }
  if (includeStudentUserId) result.studentUserId = row.student_user_id
  return result
}

function scoreStatus(payload) {
  // Assignment completion is authenticated server-side, but browser-calculated
  // marks are untrusted until a server-owned marking workflow verifies them.
  return payload?.scoreStatus === 'verified' ? 'verified' : 'reported'
}

function currentWorkspace(database, user) {
  const classes = database.prepare(`
    SELECT classrooms.*, class_memberships.role
    FROM class_memberships JOIN classrooms ON classrooms.id = class_memberships.classroom_id
    WHERE class_memberships.user_id = ? AND classrooms.archived_at IS NULL
    ORDER BY classrooms.created_at DESC
  `).all(user.id)
  const assignmentRows = assignmentsForWorkspace(database, classes)
  return { identity: user, classrooms: classes.map((item) => publicClassroom(item, item.role)), assignments: assignmentRows.map(publicAssignment) }
}

function timeWindow(url) {
  const from = validDueAt(url.searchParams.get('from'))
  const to = validDueAt(url.searchParams.get('to'))
  if (from && to && from > to) throw Object.assign(new Error('The report start must be before its end.'), { statusCode: 400 })
  return { from, to }
}

function reportFilter(url) {
  const filter = timeWindow(url)
  const requestedRouteId = asText(url.searchParams.get('routeId'), 120)
  const requestedStage = asText(url.searchParams.get('stage'), 40)
  if (!requestedRouteId && !requestedStage) return { ...filter, routeId: null, stage: null }
  if (requestedRouteId) {
    const routeId = canonicalRouteId(requestedRouteId, { allowLegacy: true })
    const stage = requestedStage
      ? canonicalStage(requestedStage, { allowLegacy: true })
      : stageForRoute(routeId)
    if (stageForRoute(routeId) !== stage) throw Object.assign(new Error('routeId and stage filters must match.'), { statusCode: 400 })
    return { ...filter, routeId, stage }
  }
  return { ...filter, routeId: null, stage: canonicalStage(requestedStage, { allowLegacy: true }) }
}

function submissionFilter(column, filter) {
  const conditions = [`${column}.event_type IN ('submitted', 'verified')`]
  const parameters = []
  if (filter?.from) { conditions.push(`${column}.occurred_at >= ?`); parameters.push(filter.from) }
  if (filter?.to) { conditions.push(`${column}.occurred_at <= ?`); parameters.push(filter.to) }
  if (filter?.routeId) { conditions.push(`${column}.route_id = ?`); parameters.push(filter.routeId) }
  if (filter?.stage) {
    conditions.push(`${column}.stage = ?`)
    parameters.push(filter.stage)
    if (filter.stage !== LEGACY_SCOPE) { conditions.push(`${column}.route_id <> ?`); parameters.push(LEGACY_SCOPE) }
  }
  return { sql: conditions.join(' AND '), parameters }
}

function assignmentFilter(column, filter, { activeOnly = false } = {}) {
  const conditions = []
  const parameters = []
  if (activeOnly) conditions.push(`${column}.status = 'active'`)
  if (filter?.routeId) { conditions.push(`${column}.route_id = ?`); parameters.push(filter.routeId) }
  if (filter?.stage === LEGACY_SCOPE && !filter?.routeId) { conditions.push(`${column}.route_id = ?`); parameters.push(LEGACY_SCOPE) }
  else if (filter?.stage && filter.stage !== LEGACY_SCOPE) {
    conditions.push(`${column}.stage = ?`, `${column}.route_id <> ?`)
    parameters.push(filter.stage, LEGACY_SCOPE)
  }
  return { sql: conditions.length ? conditions.join(' AND ') : '1 = 1', parameters }
}

function routeScopesForClass(database, classroomId, filter = {}) {
  const stageCondition = filter.stage && filter.stage !== LEGACY_SCOPE ? 'AND stage = ? AND route_id <> ?' : filter.stage === LEGACY_SCOPE ? 'AND route_id = ?' : ''
  const parameters = filter.stage ? filter.stage === LEGACY_SCOPE ? [LEGACY_SCOPE] : [filter.stage, LEGACY_SCOPE] : []
  return database.prepare(`
    SELECT DISTINCT route_id, CASE WHEN route_id = ? THEN ? ELSE stage END AS stage
    FROM assignments WHERE classroom_id = ? AND status <> 'archived' ${stageCondition}
    ORDER BY route_id, stage
  `).all(LEGACY_SCOPE, LEGACY_SCOPE, classroomId, ...parameters).map(storedScope)
}

function summaryForClass(database, classroomId, filter = {}, { includeRouteGroups = true } = {}) {
  const eventFilter = submissionFilter('events', filter)
  const rows = database.prepare(`
    SELECT events.rowid AS event_sequence, events.id, events.assignment_id, events.student_user_id, events.event_type,
      events.payload_json, events.occurred_at, events.route_id, events.stage,
      assignments.syllabus_point_id, assignments.status
    FROM submission_events AS events
    JOIN assignments ON assignments.id = events.assignment_id
    WHERE assignments.classroom_id = ? AND assignments.status <> 'archived' AND ${eventFilter.sql}
    ORDER BY events.occurred_at, events.rowid
  `).all(classroomId, ...eventFilter.parameters)
  const results = rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }))
  const resultStates = new Map()
  for (const row of results) {
    const key = `${row.assignment_id}::${row.student_user_id}`
    const state = resultStates.get(key) || { verified: null, reported: null }
    const authority = row.event_type === 'verified' && scoreStatus(row.payload) === 'verified'
      ? 'verified'
      : 'reported'
    state[authority] = row
    resultStates.set(key, state)
  }
  const verifiedResults = [...resultStates.values()].flatMap((state) => state.verified ? [state.verified] : [])
  const reportedScoreCount = [...resultStates.values()].filter((state) => (
    state.reported
    && (!state.verified || Number(state.reported.event_sequence) > Number(state.verified.event_sequence))
  )).length
  const percentages = verifiedResults.map((row) => Number(row.payload.percentage)).filter(Number.isFinite)
  const enrolment = database.prepare(`
    SELECT
      SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) AS student_count,
      SUM(CASE WHEN role IN ('owner', 'teacher') THEN 1 ELSE 0 END) AS teacher_count
    FROM class_memberships WHERE classroom_id = ?
  `).get(classroomId)
  const activeFilter = assignmentFilter('assignments', filter, { activeOnly: true })
  const activeAssignments = database.prepare(`SELECT COUNT(*) AS count FROM assignments WHERE classroom_id = ? AND ${activeFilter.sql}`).get(classroomId, ...activeFilter.parameters).count
  const reportableResults = verifiedResults.filter((row) => !['draft', 'archived'].includes(row.status))
  const activeCutoff = new Date(Date.now() - 28 * 86_400_000).toISOString()
  const coverageBySyllabusPoint = reportableResults.reduce((coverage, row) => {
    const scope = storedScope(row)
    const key = `${scope.routeId}::${row.syllabus_point_id}`
    const item = coverage[key] || { ...scope, topicId: row.syllabus_point_id, submissions: 0, verifiedScoreCount: 0, percentages: [] }
    item.submissions += 1
    const percentage = scoreStatus(row.payload) === 'verified' ? Number(row.payload.percentage) : NaN
    if (Number.isFinite(percentage)) {
      item.percentages.push(percentage)
      item.verifiedScoreCount += 1
    }
    coverage[key] = item
    return coverage
  }, {})
  const publicCoverage = Object.fromEntries(Object.entries(coverageBySyllabusPoint).map(([key, item]) => [key, {
    routeId: item.routeId,
    stage: item.stage,
    scopeStatus: item.scopeStatus,
    topicId: item.topicId,
    submissions: item.submissions,
    totalSubmissionCount: item.submissions,
    verifiedScoreCount: item.verifiedScoreCount,
    averagePercentage: item.percentages.length ? Math.round(item.percentages.reduce((total, value) => total + value, 0) / item.percentages.length) : null,
  }]))
  const studentCount = Number(enrolment.student_count) || 0
  const expectedCompletions = activeAssignments * studentCount
  const completionRate = expectedCompletions ? Math.round((reportableResults.filter((row) => row.status === 'active').length / expectedCompletions) * 100) : null
  const riskReasons = []
  if (studentCount && new Set(verifiedResults.filter((row) => row.occurred_at >= activeCutoff).map((row) => row.student_user_id)).size / studentCount < 0.6) riskReasons.push('Low recent participation')
  if (completionRate != null && completionRate < 60) riskReasons.push('Low assignment completion')
  if (percentages.length && percentages.reduce((total, value) => total + value, 0) / percentages.length < 60) riskReasons.push('Low verified accuracy')
  if (!reportableResults.length && activeAssignments) riskReasons.push('No submitted evidence')
  const summary = {
    filter: { routeId: filter.routeId || null, stage: filter.stage || null },
    aggregationMode: filter.routeId || filter.stage ? 'single-scope' : 'cross-route-overview',
    submissions: verifiedResults.length,
    totalSubmissionCount: verifiedResults.length,
    verifiedScoreCount: verifiedResults.length,
    reportedScoreCount,
    averagePercentage: percentages.length ? Math.round(percentages.reduce((total, value) => total + value, 0) / percentages.length) : null,
    needsSupport: percentages.filter((value) => value < 60).length,
    studentCount,
    teacherCount: Number(enrolment.teacher_count) || 0,
    activeStudentCount: new Set(verifiedResults.filter((row) => row.occurred_at >= activeCutoff).map((row) => row.student_user_id)).size,
    activeAssignments,
    completedActiveAssignments: reportableResults.filter((row) => row.status === 'active').length,
    expectedCompletions,
    assignmentCompletionRate: completionRate,
    coverageBySyllabusPoint: publicCoverage,
    riskReasons,
  }
  if (includeRouteGroups && !filter.routeId) {
    summary.routeGroups = routeScopesForClass(database, classroomId, filter).map((scope) => ({
      ...scope,
      summary: summaryForClass(database, classroomId, { ...filter, routeId: scope.routeId, stage: scope.stage }, { includeRouteGroups: false }),
    }))
    summary.legacyUnscoped = summary.routeGroups.find((item) => item.routeId === LEGACY_SCOPE)?.summary || null
  }
  return summary
}

function accessibleStaffClasses(database, userId) {
  return database.prepare(`
    SELECT classrooms.*, class_memberships.role
    FROM class_memberships JOIN classrooms ON classrooms.id = class_memberships.classroom_id
    WHERE class_memberships.user_id = ?
      AND classrooms.archived_at IS NULL
      AND class_memberships.role IN ('owner', 'teacher', 'school')
    ORDER BY classrooms.created_at DESC
  `).all(userId)
}

function schoolAnalytics(database, user, filter) {
  const classes = accessibleStaffClasses(database, user.id)
  const cohorts = classes.map((classroom) => ({
    classroomId: classroom.id,
    name: classroom.name,
    summary: summaryForClass(database, classroom.id, filter),
  }))
  const coverage = {}
  const groupedRoutes = {}
  const risks = new Map()
  for (const cohort of cohorts) {
    for (const item of Object.values(cohort.summary.coverageBySyllabusPoint)) {
      const key = `${item.routeId}::${item.topicId}`
      const current = coverage[key] || { routeId: item.routeId, stage: item.stage, scopeStatus: item.scopeStatus, topicId: item.topicId, totalSubmissionCount: 0, weightedScore: 0, verifiedScoreCount: 0 }
      current.totalSubmissionCount += item.totalSubmissionCount ?? item.submissions
      if (Number.isFinite(item.averagePercentage)) {
        current.weightedScore += item.averagePercentage * item.verifiedScoreCount
        current.verifiedScoreCount += item.verifiedScoreCount
      }
      coverage[key] = current
    }
    const cohortGroups = cohort.summary.routeGroups || [{
      routeId: filter.routeId || LEGACY_SCOPE,
      stage: filter.stage || LEGACY_SCOPE,
      scopeStatus: filter.routeId === LEGACY_SCOPE ? LEGACY_SCOPE : 'scoped',
      summary: cohort.summary,
    }]
    for (const group of cohortGroups) {
      const key = `${group.routeId}::${group.stage}`
      const current = groupedRoutes[key] || { routeId: group.routeId, stage: group.stage, scopeStatus: group.scopeStatus, totalSubmissionCount: 0, verifiedScoreCount: 0, weightedScore: 0, activeAssignments: 0, needsSupport: 0, cohorts: 0 }
      current.totalSubmissionCount += group.summary.totalSubmissionCount ?? group.summary.submissions
      current.verifiedScoreCount += group.summary.verifiedScoreCount
      current.activeAssignments += group.summary.activeAssignments
      current.needsSupport += group.summary.needsSupport
      current.cohorts += 1
      if (Number.isFinite(group.summary.averagePercentage)) current.weightedScore += group.summary.averagePercentage * group.summary.verifiedScoreCount
      groupedRoutes[key] = current
    }
    for (const reason of cohort.summary.riskReasons) risks.set(reason, (risks.get(reason) || 0) + 1)
  }
  const topics = Object.values(coverage).map((item) => ({
    routeId: item.routeId,
    stage: item.stage,
    scopeStatus: item.scopeStatus,
    topicId: item.topicId,
    submissions: item.totalSubmissionCount,
    totalSubmissionCount: item.totalSubmissionCount,
    verifiedScoreCount: item.verifiedScoreCount,
    averagePercentage: item.verifiedScoreCount ? Math.round(item.weightedScore / item.verifiedScoreCount) : null,
  })).sort((left, right) => (left.averagePercentage ?? 101) - (right.averagePercentage ?? 101))
  return {
    generatedAt: nowIso(),
    window: { from: filter.from, to: filter.to },
    filter: { routeId: filter.routeId || null, stage: filter.stage || null },
    aggregationMode: filter.routeId || filter.stage ? 'single-scope' : 'grouped-by-route',
    cohortCount: cohorts.length,
    cohorts,
    routeGroups: Object.values(groupedRoutes).map((item) => ({
      routeId: item.routeId,
      stage: item.stage,
      scopeStatus: item.scopeStatus,
      submissions: item.totalSubmissionCount,
      totalSubmissionCount: item.totalSubmissionCount,
      verifiedScoreCount: item.verifiedScoreCount,
      averagePercentage: item.verifiedScoreCount ? Math.round(item.weightedScore / item.verifiedScoreCount) : null,
      activeAssignments: item.activeAssignments,
      needsSupport: item.needsSupport,
      cohortCount: item.cohorts,
    })).sort((left, right) => left.routeId.localeCompare(right.routeId)),
    topicCoverage: topics,
    riskReasons: [...risks.entries()].map(([reason, cohortsAffected]) => ({ reason, cohortsAffected })).sort((left, right) => right.cohortsAffected - left.cohortsAffected),
    privacy: 'Aggregate only. This report excludes student notes, handwriting, drafts and AI Coach conversations.',
  }
}

function validDueAt(value) {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function eventPayload(value) {
  const rawMarks = Number(value?.rawMarks)
  const maxMarks = Number(value?.maxMarks)
  const percentage = Number(value?.percentage)
  if (![rawMarks, maxMarks, percentage].every(Number.isFinite) || rawMarks < 0 || maxMarks <= 0 || rawMarks > maxMarks || percentage < 0 || percentage > 100) {
    throw Object.assign(new Error('Submission requires valid mark totals and percentage.'), { statusCode: 400 })
  }
  const calculatedPercentage = Math.round((rawMarks / maxMarks) * 100)
  if (percentage !== calculatedPercentage) {
    throw Object.assign(new Error('Submission percentage must match rawMarks and maxMarks.'), { statusCode: 400 })
  }
  const requestedMarkingMode = asText(value.markingMode || 'student-reported', 40)
  const supportedMarkingModes = new Set(['deterministic', 'assisted', 'assisted-vision', 'student-self-mark', 'student-reported', 'teacher-reviewed'])
  return {
    rawMarks,
    maxMarks,
    percentage: calculatedPercentage,
    elapsedSeconds: Math.max(0, Math.min(Number(value.elapsedSeconds) || 0, 86_400)),
    markingMode: supportedMarkingModes.has(requestedMarkingMode) ? requestedMarkingMode : 'student-reported',
    scoreStatus: 'reported',
    reviewRequired: Boolean(value.reviewRequired),
    attemptId: asText(value.attemptId, 100),
  }
}

export function createStemApi({ env, questionBank = unifiedQuestionBank, topicQuestionBankProvider = null, fetchImpl = fetch }) {
  // A single shared server key is sufficient for both the internal account
  // request and the short-lived STEM API token. The legacy identity key is a
  // migration fallback only, so every active path uses the same canonical key.
  const signingKey = String(env.STEM_INTERNAL_AUTH_KEY || env.STEM_IDENTITY_SIGNING_KEY || '')
  const markingCapabilitySigningKey = String(env.STEM_MARKING_CAPABILITY_SIGNING_KEY || signingKey)
  const identityOrigin = String(env.IELTSIST_ORIGIN || 'https://ieltsist.com').replace(/\/$/, '')
  const stemOrigin = String(env.STEM_ORIGIN || 'https://stem.ieltsist.com').replace(/\/$/, '')
  const aiPdfIngestionRoot = resolveAiPdfIngestionRoot(env)
  // Production uses unifiedQuestionBank, which fails closed on file and
  // semantic source completeness. Supplying a fixture is test-only.
  const assignableQuestionIds = assignableQuestionIdsForBank(questionBank)
  // Topic Drill production availability is practice-ready only. Study-only
  // source records may be enabled for local review, but must not inflate the
  // production count/list/start gate.
  const baseTopicPracticeQuestionBank = questionBank === unifiedQuestionBank ? studyQuestionBank : questionBank
  const includeStudyOnly = questionBank === unifiedQuestionBank
  const runtimeReleaseGatedRoutes = new Set(['cie-9702-a2-physics'])
  let nativeBridgeProbe = null

  function includeStudyOnlyForRoute() {
    // Runtime AI records are marked studentStudyEligible=false below until
    // their release gate is satisfied. Static study-only records are also
    // hidden unless a non-production review task opts in explicitly.
    return includeStudyOnly
      && String(env.STEM_ENABLE_STUDY_ONLY_TOPIC_DRILL || '').trim() === '1'
      && String(env.NODE_ENV || '').trim().toLowerCase() !== 'production'
  }

  function currentTopicPracticeQuestionBank() {
    if (typeof topicQuestionBankProvider !== 'function') return baseTopicPracticeQuestionBank
    try {
      const runtimeQuestionBank = topicQuestionBankProvider()
      const guardedRuntimeQuestionBank = (Array.isArray(runtimeQuestionBank) ? runtimeQuestionBank : [])
        .map((question) => runtimeReleaseGatedRoutes.has(String(question?.routeId || ''))
          ? { ...question, studentStudyEligible: false }
          : question)
      return mergeTopicPracticeQuestionBanks(baseTopicPracticeQuestionBank, guardedRuntimeQuestionBank)
    } catch {
      // An invalid runtime artifact must fail closed to the established static study bank.
      return baseTopicPracticeQuestionBank
    }
  }

  async function nativeAccountReadiness() {
    const sessionSigningConfigured = Boolean(signingKey)
    const internalAuthOriginReady = internalAuthOriginConfigured(env)
    const nativeLoginConfigured = Boolean(sessionSigningConfigured && internalAuthOriginReady)
    if (!nativeLoginConfigured) {
      return {
        sessionSigningConfigured,
        internalAuthOriginConfigured: internalAuthOriginReady,
        nativeLoginConfigured: false,
        nativeLoginReady: false,
        bridge: { status: 'not_configured' },
      }
    }

    const now = Date.now()
    if (!nativeBridgeProbe || nativeBridgeProbe.expiresAt <= now) {
      const bridge = await probeNativeAuthBridge({ env, fetchImpl })
      nativeBridgeProbe = { bridge, expiresAt: now + NATIVE_AUTH_PROBE_CACHE_MS }
    }
    return {
      sessionSigningConfigured,
      internalAuthOriginConfigured: internalAuthOriginReady,
      nativeLoginConfigured: true,
      nativeLoginReady: nativeBridgeProbe.bridge.status === 'ready',
      bridge: { status: nativeBridgeProbe.bridge.status },
    }
  }

  return async function stemApi(request, response, next) {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith('/api/stem/') && !['/api/auth/status', '/api/auth/config', '/api/auth/login', '/api/auth/register', '/api/auth/logout'].includes(url.pathname)) return next()
    try {
      if (request.method === 'GET' && url.pathname === '/api/auth/config') {
        const readiness = await nativeAccountReadiness()
        sendJson(response, 200, {
          protocol: 'stem-native-account-v1',
          provider: 'ieltsist',
          providerOrigin: identityOrigin,
          clientOrigin: stemOrigin,
          browserFlow: {
            login: '/api/auth/login',
            register: '/api/auth/register',
            logout: '/api/auth/logout',
          },
          endpoints: {
            login: '/api/auth/login',
            register: '/api/auth/register',
            logout: '/api/auth/logout',
            currentUser: '/api/auth/status',
          },
          session: {
            browserCookie: STEM_SESSION_COOKIE,
            cookieOwner: 'stem.ieltsist.com',
            identityAuthority: 'ieltsist.com-server',
            tokenStorage: 'memory-only',
          },
          responses: {
            loginSuccess: 200,
            registerSuccess: 200,
            invalidCredentials: 401,
            duplicateIdentifier: 409,
            validationError: 400,
            logoutSuccess: 200,
          },
          readiness,
          note: 'STEM signs in on this origin and keeps a separate local browser session. Credentials are checked server-to-server against the shared IELTSist account database and are never persisted by STEM.',
        })
        return
      }
      const topicPracticeQuestionBank = currentTopicPracticeQuestionBank()
      const db = appDatabase(env, topicPracticeQuestionBank)
      const syllabusRouteMatch = url.pathname.match(/^\/api\/stem\/routes\/([^/]+)\/syllabus-topics$/)
      if (request.method === 'GET' && syllabusRouteMatch) {
        const routeId = decodeURIComponent(syllabusRouteMatch[1])
        const routeIncludesStudyOnly = includeStudyOnlyForRoute()
        const staticInventory = syllabusTopicsInventory({ routeId, questionBank: topicPracticeQuestionBank, includeStudyOnly: routeIncludesStudyOnly })
        const databaseRows = syllabusDatabaseInventory(db, routeId, { includeStudyOnly: routeIncludesStudyOnly })
        const databaseById = new Map(databaseRows.map((topic) => [topic.id, topic]))
        // The database is the authority for live inventory counts. Static
        // data supplies only the official syllabus shape and labels; merging
        // it last used to erase production's larger indexed inventory.
        const topics = staticInventory.topics.map((topic) => ({
          ...topic,
          ...(databaseById.get(topic.id) || {}),
          points: topic.points || [],
        }))
        sendJson(response, 200, {
          ...staticInventory,
          topics,
          ready: topics.some((topic) => topic.ready),
          aggregation: 'sqlite-question-groups-and-syllabus-mappings',
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/status') {
        const user = nativeSessionIdentity(request, db)
        if (!user) {
          sendJson(response, 200, { authenticated: false })
          return
        }
        if (!signingKey) throw Object.assign(new Error('STEM account sessions are not configured.'), { statusCode: 503 })
        sendJson(response, 200, { authenticated: true, ...identityToken(user, signingKey), ...currentWorkspace(db, user) })
        return
      }
      if (request.method === 'POST' && (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/register')) {
        if (!signingKey) throw Object.assign(new Error('STEM account sessions are not configured.'), { statusCode: 503 })
        const payload = await readJson(request)
        const identity = await authenticateNativeAccount({
          mode: url.pathname.endsWith('/register') ? 'register' : 'login',
          username: payload.username,
          password: payload.password,
          env,
          fetchImpl,
        })
        const session = createNativeSession(db, identity)
        response.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt, env))
        sendJson(response, 200, {
          authenticated: true,
          ...identityToken(identity, signingKey),
          ...currentWorkspace(db, identity),
        })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        removeNativeSession(request, db)
        response.setHeader('Set-Cookie', clearSessionCookie(env))
        sendJson(response, 200, { ok: true })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/practice-sets') {
        const payload = await readJson(request)
        const user = request.headers.authorization ? identityFromRequest(request, signingKey) : null
        const routeIncludesStudyOnly = includeStudyOnlyForRoute()
        const result = buildSyllabusPracticeSet({
          routeId: payload.routeId,
          syllabusTopicIds: payload.syllabusTopicIds,
          questionCount: payload.questionCount,
          components: payload.components,
          excludeAttempted: payload.excludeAttempted !== false,
          attemptedQuestionIds: payload.attemptedQuestionIds,
          sourceQuestionIds: payload.sourceQuestionIds,
          seed: payload.seed,
          questionBank: topicPracticeQuestionBank,
          includeStudyOnly: routeIncludesStudyOnly,
        })
        sendJson(response, 201, { ...result, ownerId: user?.id || null })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/practice-sets/rebind') {
        const payload = await readJson(request, REBIND_BODY_BYTES)
        if (!payload || typeof payload !== 'object' || !payload.unit || typeof payload.unit !== 'object') {
          throw Object.assign(new Error('A persisted syllabus practice unit is required.'), {
            statusCode: 400,
            code: 'invalid_syllabus_practice_set',
          })
        }
        const unit = rebindSyllabusPracticeUnit(payload.unit, {
          questionBank: topicPracticeQuestionBank,
          includeStudyOnly: includeStudyOnlyForRoute(),
        })
        if (!unit) {
          throw Object.assign(new Error('This saved syllabus set no longer matches the current source catalog.'), {
            statusCode: 409,
            code: 'stale_syllabus_practice_set',
          })
        }
        sendJson(response, 200, { unit })
        return
      }
      const user = identityFromRequest(request, signingKey)
      if (url.pathname === '/api/stem/coach/conversations' && ['GET', 'PUT', 'POST'].includes(request.method)) {
        const payload = request.method === 'GET' ? {} : await readJson(request, 8 * 1024 * 1024)
        const result = request.method === 'GET'
          ? await requestCoachConversations({
              method: 'GET',
              userId: user.id,
              query: { limit: url.searchParams.get('limit') },
              env,
              fetchImpl,
            })
          : await mergeAndSaveCoachConversations({
              userId: user.id,
              payload,
              env,
              fetchImpl,
            })
        sendJson(response, 200, result)
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/stem/content/ai-ingestion-candidates') {
        requireVerifiedStaffClaim(user)
        sendJson(response, 200, listAiPdfIngestionCandidates({ root: aiPdfIngestionRoot }))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/stem/workspace') {
        sendJson(response, 200, currentWorkspace(db, user))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/stem/attempts') {
        const rows = db.prepare(`
          SELECT user_id, attempt_id, binding_json, attempt_json, submission_status, submitted_at, created_at, updated_at
          FROM student_attempts
          WHERE user_id = ?
          ORDER BY updated_at DESC, submitted_at DESC
        `).all(user.id)
        sendJson(response, 200, { attempts: rows.map(publicStudentAttempt) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/attempts') {
        const payload = await readJson(request, 8 * 1024 * 1024)
        const binding = canonicalStudentAttemptBinding(payload, topicPracticeQuestionBank)
        const existingRow = db.prepare(`
          SELECT user_id, attempt_id, mode, route_id, stage, paper_id, binding_json, attempt_json, submission_status, submitted_at, created_at, updated_at
          FROM student_attempts
          WHERE user_id = ? AND attempt_id = ?
        `).get(user.id, binding.attemptId)
        const updatedAt = nowIso()
        const existing = existingRow ? parseStudentAttemptRow(existingRow) : null
        if (existing && !sameCanonicalBinding(existing.binding, binding)) {
          throw Object.assign(new Error('The persisted attempt binding cannot be changed.'), {
            statusCode: 409,
            code: 'attempt_binding_mismatch',
          })
        }
        if (!existingRow) {
          const attemptOwner = db.prepare('SELECT user_id FROM student_attempts WHERE attempt_id = ? LIMIT 1').get(binding.attemptId)
          if (attemptOwner && String(attemptOwner.user_id) !== String(user.id)) {
            throw Object.assign(new Error('The submitted attempt does not belong to this account.'), {
              statusCode: 404,
              code: 'attempt_not_found',
            })
          }
        }
        const submittedAt = existing?.submittedAt || canonicalTimestamp(
          payload.submittedAt || payload.attempt?.submittedAt,
          null,
        )
        const submissionStatus = existing?.submissionStatus === 'submitted' || submittedAt ? 'submitted' : 'draft'
        const attemptSnapshot = compactStudentAttemptSnapshot(payload, {
          attemptId: binding.attemptId,
          routeId: binding.routeId,
          stage: binding.stage,
          paperId: binding.paperId,
          submittedAt,
        })
        const attemptJson = JSON.stringify(attemptSnapshot)
        if (existingRow) {
          db.prepare(`
            UPDATE student_attempts
            SET attempt_json = ?, submission_status = ?, submitted_at = ?, updated_at = ?
            WHERE user_id = ? AND attempt_id = ?
          `).run(attemptJson, submissionStatus, submittedAt, updatedAt, user.id, binding.attemptId)
          const updated = db.prepare(`
            SELECT user_id, attempt_id, mode, route_id, stage, paper_id, binding_json, attempt_json, submission_status, submitted_at, created_at, updated_at
            FROM student_attempts
            WHERE user_id = ? AND attempt_id = ?
          `).get(user.id, binding.attemptId)
          sendJson(response, 200, { attempt: publicStudentAttempt(updated).attempt, duplicate: true })
          return
        }
        db.prepare(`
          INSERT INTO student_attempts
            (user_id, attempt_id, mode, route_id, stage, paper_id, binding_json, attempt_json, submission_status, submitted_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.id,
          binding.attemptId,
          binding.mode,
          binding.routeId,
          binding.stage,
          binding.paperId,
          JSON.stringify(binding),
          attemptJson,
          submissionStatus,
          submittedAt,
          updatedAt,
          updatedAt,
        )
        const created = db.prepare(`
          SELECT user_id, attempt_id, mode, route_id, stage, paper_id, binding_json, attempt_json, submission_status, submitted_at, created_at, updated_at
          FROM student_attempts
          WHERE user_id = ? AND attempt_id = ?
        `).get(user.id, binding.attemptId)
        sendJson(response, 201, { attempt: publicStudentAttempt(created).attempt, duplicate: false })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/marking/capabilities') {
        const payload = await readJson(request)
        const requestedAttemptId = canonicalAttemptId(payload.attemptId)
        const persistedAttemptRow = db.prepare(`
          SELECT user_id, attempt_id, mode, route_id, stage, paper_id, binding_json, attempt_json, submission_status, submitted_at, created_at, updated_at
          FROM student_attempts
          WHERE user_id = ? AND attempt_id = ?
        `).get(user.id, requestedAttemptId)
        if (!persistedAttemptRow) {
          const attemptExists = db.prepare('SELECT 1 FROM student_attempts WHERE attempt_id = ? LIMIT 1').get(requestedAttemptId)
          throw Object.assign(new Error(attemptExists
            ? 'The submitted attempt does not belong to this account.'
            : 'A server-owned submitted attempt is required before AI marking.'), {
            statusCode: attemptExists ? 404 : 409,
            code: attemptExists ? 'attempt_not_found' : 'attempt_not_persisted',
          })
        }
        const issued = issueMarkingCapabilities({
          userId: user.id,
          payload,
          questionBank: topicPracticeQuestionBank,
          signingKey: markingCapabilitySigningKey,
          persistedAttempt: parseStudentAttemptRow(persistedAttemptRow),
        })
        if (!issued.ok) throw Object.assign(new Error(issued.message), { statusCode: issued.statusCode || 422, code: issued.code })
        sendJson(response, 201, issued)
        return
      }
      if (url.pathname === '/api/stem/notebook/notes' && request.method === 'GET') {
        const routeId = canonicalRouteId(url.searchParams.get('routeId'))
        const note = db.prepare('SELECT route_id, body, updated_at, deleted_at FROM private_notes WHERE user_id = ? AND route_id = ?').get(user.id, routeId)
        sendJson(response, 200, {
          routeId,
          note: note ? {
            routeId: note.route_id,
            body: note.deleted_at ? '' : note.body,
            updatedAt: note.updated_at,
            deleted: Boolean(note.deleted_at),
            deletedAt: note.deleted_at || null,
          } : null,
          privacy: 'private-to-student',
        })
        return
      }
      const privateNoteMatch = url.pathname.match(/^\/api\/stem\/notebook\/notes\/([^/]+)$/)
      if (privateNoteMatch && ['PUT', 'DELETE'].includes(request.method)) {
        const routeId = canonicalRouteId(decodeURIComponent(privateNoteMatch[1]))
        if (request.method === 'DELETE') {
          const deletedAt = nowIso()
          db.prepare(`INSERT INTO private_notes (user_id, route_id, body, updated_at, deleted_at) VALUES (?, ?, '', ?, ?)
            ON CONFLICT(user_id, route_id) DO UPDATE SET body = '', updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`)
            .run(user.id, routeId, deletedAt, deletedAt)
          sendJson(response, 200, { routeId, note: { routeId, body: '', updatedAt: deletedAt, deleted: true, deletedAt }, privacy: 'private-to-student' })
          return
        }
        const payload = await readJson(request)
        const body = asText(payload.body, 20_000)
        const updatedAt = nowIso()
        const deletedAt = body ? null : updatedAt
        db.prepare(`INSERT INTO private_notes (user_id, route_id, body, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, route_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`).run(user.id, routeId, body, updatedAt, deletedAt)
        sendJson(response, 200, { routeId, note: { routeId, body, updatedAt, deleted: Boolean(deletedAt), deletedAt }, privacy: 'private-to-student' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/classrooms') {
        requireVerifiedStaffClaim(user)
        const payload = await readJson(request)
        const name = asText(payload.name, 120)
        if (!name) throw Object.assign(new Error('A class needs a name.'), { statusCode: 400 })
        const id = crypto.randomUUID()
        const createdAt = nowIso()
        const inviteCode = crypto.randomBytes(6).toString('base64url')
        db.prepare('INSERT INTO classrooms (id, owner_user_id, name, invite_code, created_at) VALUES (?, ?, ?, ?, ?)').run(id, user.id, name, inviteCode, createdAt)
        db.prepare('INSERT INTO class_memberships (classroom_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, user.id, 'owner', createdAt)
        sendJson(response, 201, { classroom: { id, name, inviteCode, role: 'owner', createdAt, archivedAt: null } })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/classrooms/join') {
        const payload = await readJson(request)
        const inviteCode = asText(payload.inviteCode, 64)
        const classroom = db.prepare('SELECT * FROM classrooms WHERE invite_code = ? AND archived_at IS NULL').get(inviteCode)
        if (!classroom) throw Object.assign(new Error('That class code is invalid or archived.'), { statusCode: 404 })
        const role = user.roles.includes('school') || user.roles.includes('school_admin') || user.roles.includes('school_owner')
          ? 'school'
          : user.roles.includes('teacher') || user.roles.includes('owner') ? 'teacher' : 'student'
        db.prepare('INSERT INTO class_memberships (classroom_id, user_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(classroom_id, user_id) DO NOTHING').run(classroom.id, user.id, role, nowIso())
        sendJson(response, 200, { classroom: publicClassroom(classroom, membership(db, classroom.id, user.id).role) })
        return
      }
      const classroomMatch = url.pathname.match(/^\/api\/stem\/classrooms\/([^/]+)\/summary$/)
      if (request.method === 'GET' && classroomMatch) {
        const classroomId = decodeURIComponent(classroomMatch[1])
        requireMembership(db, classroomId, user.id, new Set(['owner', 'teacher', 'school']))
        const filter = reportFilter(url)
        sendJson(response, 200, { classroomId, summary: summaryForClass(db, classroomId, filter), filter })
        return
      }
      const submissionsMatch = url.pathname.match(/^\/api\/stem\/classrooms\/([^/]+)\/submissions$/)
      if (request.method === 'GET' && submissionsMatch) {
        const classroomId = decodeURIComponent(submissionsMatch[1])
        requireMembership(db, classroomId, user.id, new Set(['owner', 'teacher']))
        const rows = db.prepare(`
          SELECT events.*, assignments.syllabus_point_id
          FROM submission_events AS events
          JOIN assignments ON assignments.id = events.assignment_id
          JOIN (
            SELECT assignment_id, student_user_id, MAX(occurred_at) AS latest_at
            FROM submission_events
            WHERE event_type IN ('submitted', 'verified')
            GROUP BY assignment_id, student_user_id
          ) AS latest ON latest.assignment_id = events.assignment_id
            AND latest.student_user_id = events.student_user_id
            AND latest.latest_at = events.occurred_at
          WHERE assignments.classroom_id = ? AND events.event_type IN ('submitted', 'verified')
          ORDER BY events.occurred_at DESC
          LIMIT 500
        `).all(classroomId)
        sendJson(response, 200, { classroomId, submissions: rows.map((row) => publicSubmission(row)) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stem/assignments') {
        const payload = await readJson(request)
        const classroomId = asText(payload.classroomId, 80)
        requireMembership(db, classroomId, user.id, new Set(['owner', 'teacher']))
        const title = asText(payload.title, 160)
        const { routeId, stage, subjectId } = verifiedAssignmentScope(payload.routeId, payload.stage, payload.subjectId)
        const syllabusPointId = asText(payload.syllabusPointId, 120)
        const sourceScope = payload.sourceScope && typeof payload.sourceScope === 'object' ? payload.sourceScope : null
        if (!title || !subjectId || !syllabusPointId || !sourceScope?.questionIds?.length) throw Object.assign(new Error('Assignment details and verified source question IDs are required.'), { statusCode: 400 })
        if (!sourceScope.routeId || !sourceScope.stage) throw Object.assign(new Error('sourceScope must include routeId and stage.'), { statusCode: 400 })
        const sourceRoute = verifiedRouteScope(sourceScope.routeId, sourceScope.stage)
        if (sourceRoute.routeId !== routeId || sourceRoute.stage !== stage) throw Object.assign(new Error('Assignment questions must use the assignment routeId and stage.'), { statusCode: 400 })
        const questionIds = routeScopedQuestionIds(sourceScope.questionIds, routeId, assignableQuestionIds)
        const id = crypto.randomUUID()
        const createdAt = nowIso()
        const status = payload.status === 'draft' ? 'draft' : 'active'
        db.prepare(`INSERT INTO assignments (id, classroom_id, created_by_user_id, subject_id, stage, route_id, syllabus_point_id, title, source_scope_json, due_at, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, classroomId, user.id, subjectId, stage, routeId, syllabusPointId, title, JSON.stringify({ questionIds, routeId, stage, provenanceVersion: asText(sourceScope.provenanceVersion, 40) || 'v1' }), validDueAt(payload.dueAt), status, createdAt)
        sendJson(response, 201, { assignment: publicAssignment(db.prepare('SELECT * FROM assignments WHERE id = ?').get(id)) })
        return
      }
      const assignmentMatch = url.pathname.match(/^\/api\/stem\/assignments\/([^/]+)$/)
      if (request.method === 'PATCH' && assignmentMatch) {
        const assignmentId = decodeURIComponent(assignmentMatch[1])
        const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId)
        if (!assignment) throw Object.assign(new Error('This assignment no longer exists.'), { statusCode: 404 })
        requireMembership(db, assignment.classroom_id, user.id, new Set(['owner', 'teacher']))
        const payload = await readJson(request)
        const nextStatus = asText(payload.status, 20)
        const allowedStatuses = new Set(['draft', 'active', 'closed', 'archived'])
        if (nextStatus && !allowedStatuses.has(nextStatus)) throw Object.assign(new Error('That assignment status is not recognised.'), { statusCode: 400 })
        if (assignment.status === 'archived' && nextStatus && nextStatus !== 'archived') throw Object.assign(new Error('Archived assignments cannot be reopened.'), { statusCode: 409 })
        const nextTitle = Object.hasOwn(payload, 'title') ? asText(payload.title, 160) : assignment.title
        if (!nextTitle) throw Object.assign(new Error('An assignment needs a title.'), { statusCode: 400 })
        const dueAt = Object.hasOwn(payload, 'dueAt') ? validDueAt(payload.dueAt) : assignment.due_at
        db.prepare('UPDATE assignments SET title = ?, due_at = ?, status = ? WHERE id = ?').run(nextTitle, dueAt, nextStatus || assignment.status, assignment.id)
        sendJson(response, 200, { assignment: publicAssignment(db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignment.id)) })
        return
      }
      const reminderMatch = url.pathname.match(/^\/api\/stem\/assignments\/([^/]+)\/reminders$/)
      if (request.method === 'POST' && reminderMatch) {
        const assignmentId = decodeURIComponent(reminderMatch[1])
        const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId)
        if (!assignment) throw Object.assign(new Error('This assignment no longer exists.'), { statusCode: 404 })
        requireMembership(db, assignment.classroom_id, user.id, new Set(['owner', 'teacher']))
        if (assignment.status !== 'active') throw Object.assign(new Error('Only published assignments can be reminded.'), { statusCode: 409 })
        const payload = await readJson(request)
        const message = asText(payload.message || 'A teacher has asked you to complete this assignment.', 280)
        const audience = payload.audience === 'incomplete' ? 'incomplete' : 'class'
        const id = crypto.randomUUID()
        const createdAt = nowIso()
        db.prepare('INSERT INTO assignment_reminders (id, assignment_id, created_by_user_id, message, audience, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, assignment.id, user.id, message, audience, createdAt)
        const enrolled = db.prepare("SELECT COUNT(*) AS count FROM class_memberships WHERE classroom_id = ? AND role = 'student'").get(assignment.classroom_id).count
        sendJson(response, 201, { reminder: { id, assignmentId: assignment.id, audience, message, createdAt, audienceCount: Number(enrolled) || 0 }, delivery: 'recorded' })
        return
      }
      const feedbackMatch = url.pathname.match(/^\/api\/stem\/assignments\/([^/]+)\/feedback$/)
      if (feedbackMatch) {
        const assignmentId = decodeURIComponent(feedbackMatch[1])
        const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId)
        if (!assignment) throw Object.assign(new Error('This assignment no longer exists.'), { statusCode: 404 })
        const role = membership(db, assignment.classroom_id, user.id)?.role
        if (!role) throw Object.assign(new Error('You do not have permission for this class.'), { statusCode: 403 })
        if (request.method === 'GET') {
          const rows = ['owner', 'teacher'].includes(role)
            ? db.prepare('SELECT * FROM assignment_feedback WHERE assignment_id = ? ORDER BY created_at DESC').all(assignment.id)
            : db.prepare('SELECT * FROM assignment_feedback WHERE assignment_id = ? AND (student_user_id IS NULL OR student_user_id = ?) ORDER BY created_at DESC').all(assignment.id, user.id)
          sendJson(response, 200, { assignmentId: assignment.id, feedback: rows.map(publicFeedback) })
          return
        }
        if (request.method === 'POST') {
          if (!['owner', 'teacher'].includes(role)) throw Object.assign(new Error('Only a teacher can send assignment feedback.'), { statusCode: 403 })
          const payload = await readJson(request)
          const body = asText(payload.body, 1000)
          if (!body) throw Object.assign(new Error('Feedback cannot be empty.'), { statusCode: 400 })
          const studentUserId = asText(payload.studentUserId, 100)
          if (studentUserId) requireMembership(db, assignment.classroom_id, studentUserId, new Set(['student']))
          const id = crypto.randomUUID()
          const createdAt = nowIso()
          db.prepare('INSERT INTO assignment_feedback (id, assignment_id, student_user_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, assignment.id, studentUserId || null, user.id, body, createdAt)
          sendJson(response, 201, { feedback: publicFeedback(db.prepare('SELECT * FROM assignment_feedback WHERE id = ?').get(id)) })
          return
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/stem/school/analytics') {
        requireSchoolAdminClaim(user)
        const classes = accessibleStaffClasses(db, user.id)
        if (!classes.length) throw Object.assign(new Error('No school classes are available for this account.'), { statusCode: 403 })
        sendJson(response, 200, { analytics: schoolAnalytics(db, user, reportFilter(url)) })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/stem/school/reports/anonymous') {
        requireSchoolAdminClaim(user)
        const classes = accessibleStaffClasses(db, user.id)
        if (!classes.length) throw Object.assign(new Error('No school classes are available for this account.'), { statusCode: 403 })
        const analytics = schoolAnalytics(db, user, reportFilter(url))
        const minimumCohortSize = 5
        const eligibleCohorts = analytics.cohorts.filter((cohort) => Number(cohort.summary.studentCount) >= minimumCohortSize)
        const suppressedCohorts = analytics.cohorts.length - eligibleCohorts.length
        const report = {
          generatedAt: analytics.generatedAt,
          window: analytics.window,
          filter: analytics.filter,
          aggregationMode: analytics.aggregationMode,
          cohorts: eligibleCohorts.map((cohort, index) => ({ cohort: `Cohort ${index + 1}`, summary: cohort.summary })),
          routeGroups: suppressedCohorts ? [] : analytics.routeGroups,
          topicCoverage: suppressedCohorts ? [] : analytics.topicCoverage,
          riskReasons: suppressedCohorts ? [] : analytics.riskReasons,
          suppressedCohorts,
          minimumCohortSize,
          privacy: `${analytics.privacy} Cohorts with fewer than ${minimumCohortSize} students are suppressed in anonymous reports.`,
        }
        sendJson(response, 200, { report })
        return
      }
      const verificationMatch = url.pathname.match(/^\/api\/stem\/submissions\/([^/]+)\/verify$/)
      if (request.method === 'POST' && verificationMatch) {
        const sourceEventId = decodeURIComponent(verificationMatch[1])
        const source = db.prepare(`
          SELECT events.*, assignments.classroom_id, assignments.syllabus_point_id
          FROM submission_events AS events
          JOIN assignments ON assignments.id = events.assignment_id
          WHERE events.id = ? AND events.event_type IN ('submitted', 'verified')
        `).get(sourceEventId)
        if (!source) throw Object.assign(new Error('This submitted result is not available.'), { statusCode: 404 })
        requireMembership(db, source.classroom_id, user.id, new Set(['owner', 'teacher']))
        const idempotencyKey = `verify:${sourceEventId}`
        const existing = db.prepare(`
          SELECT events.*, assignments.syllabus_point_id
          FROM submission_events AS events
          JOIN assignments ON assignments.id = events.assignment_id
          WHERE events.assignment_id = ? AND events.student_user_id = ? AND events.idempotency_key = ?
        `).get(source.assignment_id, source.student_user_id, idempotencyKey)
        if (existing) {
          sendJson(response, 200, { submission: publicSubmission(existing), duplicate: true })
          return
        }
        const latest = db.prepare(`
          SELECT id FROM submission_events
          WHERE assignment_id = ? AND student_user_id = ? AND event_type IN ('submitted', 'verified')
          ORDER BY occurred_at DESC LIMIT 1
        `).get(source.assignment_id, source.student_user_id)
        if (latest?.id !== source.id) throw Object.assign(new Error('A newer student result must be reviewed instead.'), { statusCode: 409 })
        const sourcePayload = JSON.parse(source.payload_json)
        if (scoreStatus(sourcePayload) === 'verified') {
          sendJson(response, 200, { submission: publicSubmission(source), duplicate: true })
          return
        }
        const review = await readJson(request)
        const rawMarks = review.rawMarks == null ? sourcePayload.rawMarks : Number(review.rawMarks)
        const maxMarks = review.maxMarks == null ? sourcePayload.maxMarks : Number(review.maxMarks)
        const percentage = maxMarks > 0 ? Math.round((rawMarks / maxMarks) * 100) : NaN
        const verifiedAt = nowIso()
        const verifiedPayload = {
          ...eventPayload({ ...sourcePayload, rawMarks, maxMarks, percentage, markingMode: 'teacher-reviewed', reviewRequired: false }),
          scoreStatus: 'verified',
          reviewRequired: false,
          verifiedAt,
          verifiedByUserId: user.id,
          verifiedFromEventId: source.id,
          reviewerNote: asText(review.reviewerNote, 500),
        }
        const eventId = crypto.randomUUID()
        db.prepare('INSERT INTO submission_events (id, assignment_id, student_user_id, idempotency_key, event_type, route_id, stage, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(eventId, source.assignment_id, source.student_user_id, idempotencyKey, 'verified', source.route_id, source.stage, JSON.stringify(verifiedPayload), verifiedAt)
        const created = db.prepare(`
          SELECT events.*, assignments.syllabus_point_id
          FROM submission_events AS events
          JOIN assignments ON assignments.id = events.assignment_id
          WHERE events.id = ?
        `).get(eventId)
        sendJson(response, 201, { submission: publicSubmission(created), duplicate: false })
        return
      }
      const submissionMatch = url.pathname.match(/^\/api\/stem\/assignments\/([^/]+)\/submissions$/)
      if (request.method === 'POST' && submissionMatch) {
        const assignmentId = decodeURIComponent(submissionMatch[1])
        const assignment = db.prepare('SELECT * FROM assignments WHERE id = ? AND status = \'active\'').get(assignmentId)
        if (!assignment) throw Object.assign(new Error('This assignment is not available.'), { statusCode: 404 })
        requireMembership(db, assignment.classroom_id, user.id, new Set(['student']))
        const payload = await readJson(request)
        const idempotencyKey = asText(payload.idempotencyKey, 100)
        if (!idempotencyKey) throw Object.assign(new Error('Submission needs an idempotency key.'), { statusCode: 400 })
        const assignmentScope = storedScope(assignment)
        if (assignmentScope.scopeStatus === LEGACY_SCOPE) throw Object.assign(new Error('Legacy unscoped assignments cannot accept new submissions.'), { statusCode: 409 })
        if (payload.routeId || payload.stage) {
          const submittedScope = verifiedRouteScope(payload.routeId, payload.stage)
          if (submittedScope.routeId !== assignmentScope.routeId || submittedScope.stage !== assignmentScope.stage) {
            throw Object.assign(new Error('Submission routeId and stage must match the assignment.'), { statusCode: 400 })
          }
        }
        const existing = db.prepare('SELECT id, occurred_at, route_id, stage FROM submission_events WHERE assignment_id = ? AND student_user_id = ? AND idempotency_key = ?').get(assignment.id, user.id, idempotencyKey)
        if (existing) {
          sendJson(response, 200, { eventId: existing.id, occurredAt: existing.occurred_at, duplicate: true, ...storedScope(existing) })
          return
        }
        const eventId = crypto.randomUUID()
        const occurredAt = nowIso()
        db.prepare('INSERT INTO submission_events (id, assignment_id, student_user_id, idempotency_key, event_type, route_id, stage, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(eventId, assignmentId, user.id, idempotencyKey, 'submitted', assignmentScope.routeId, assignmentScope.stage, JSON.stringify(eventPayload(payload)), occurredAt)
        sendJson(response, 201, { eventId, occurredAt, duplicate: false, ...assignmentScope })
        return
      }
      sendJson(response, 404, { error: 'STEM workspace endpoint not found.' })
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        ...(error.code ? { code: error.code } : {}),
        error: error.statusCode ? error.message : 'STEM workspace could not complete that request.',
      })
    }
  }
}

export function closeStemDatabaseForTests() {
  database?.close()
  database = null
  databaseQuestionBankSignature = ''
}
