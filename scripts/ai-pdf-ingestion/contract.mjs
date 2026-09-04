import { createHash } from 'node:crypto'
import path from 'node:path'

export const AI_PDF_INGESTION_SCHEMA_VERSION = 'ai-pdf-ingestion.v1'
export const AI_STUDENT_STUDY_RELEASE_SCHEMA_VERSION = 'ai-student-study-release.v1'

export const AI_PDF_INGESTION_LIFECYCLE = Object.freeze({
  INGESTED: 'ingested',
  RENDERED: 'rendered',
  AI_EXTRACTED: 'ai-extracted',
  DETERMINISTIC_CHECKED: 'deterministic-checked',
  AI_VERIFICATION_PENDING: 'ai-verification-pending',
  AI_VERIFIED: 'ai-verified',
  RETRY_SCHEDULED: 'retry-scheduled',
  AUTO_QUARANTINED: 'auto-quarantined',
})

const allowedLifecycleTransitions = new Map([
  [AI_PDF_INGESTION_LIFECYCLE.INGESTED, new Set([AI_PDF_INGESTION_LIFECYCLE.RENDERED])],
  [AI_PDF_INGESTION_LIFECYCLE.RENDERED, new Set([
    AI_PDF_INGESTION_LIFECYCLE.AI_EXTRACTED,
    AI_PDF_INGESTION_LIFECYCLE.RETRY_SCHEDULED,
    AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED,
  ])],
  [AI_PDF_INGESTION_LIFECYCLE.AI_EXTRACTED, new Set([
    AI_PDF_INGESTION_LIFECYCLE.DETERMINISTIC_CHECKED,
    AI_PDF_INGESTION_LIFECYCLE.RETRY_SCHEDULED,
    AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED,
  ])],
  [AI_PDF_INGESTION_LIFECYCLE.DETERMINISTIC_CHECKED, new Set([
    AI_PDF_INGESTION_LIFECYCLE.AI_VERIFICATION_PENDING,
    AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED,
  ])],
  [AI_PDF_INGESTION_LIFECYCLE.AI_VERIFICATION_PENDING, new Set([
    AI_PDF_INGESTION_LIFECYCLE.AI_VERIFIED,
    AI_PDF_INGESTION_LIFECYCLE.RETRY_SCHEDULED,
    AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED,
  ])],
  [AI_PDF_INGESTION_LIFECYCLE.RETRY_SCHEDULED, new Set([
    AI_PDF_INGESTION_LIFECYCLE.AI_EXTRACTED,
    AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED,
  ])],
  [AI_PDF_INGESTION_LIFECYCLE.AI_VERIFIED, new Set()],
  [AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED, new Set()],
])

const canonicalSha256Pattern = /^(?:sha256:)?([a-fA-F0-9]{64})$/
const safeSourceSubjectPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/
const safeSourcePdfNamePattern = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,255}\.pdf$/i

export function normalizeRegion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RangeError('A region must be an object with normalized coordinates.')
  }

  const region = {}
  for (const coordinate of ['x0', 'y0', 'x1', 'y1']) {
    const coordinateValue = value[coordinate]
    if (!Number.isFinite(coordinateValue) || coordinateValue < 0 || coordinateValue > 1) {
      throw new RangeError(`Region ${coordinate} must be a finite number between 0 and 1.`)
    }
    region[coordinate] = coordinateValue
  }

  if (region.x0 >= region.x1 || region.y0 >= region.y1) {
    throw new RangeError('Region bounds must have positive width and height.')
  }

  return region
}

export function assertLifecycleTransition(from, to) {
  const allowedTransitions = allowedLifecycleTransitions.get(from)
  if (!allowedTransitions?.has(to)) {
    throw new RangeError(`Illegal AI PDF ingestion lifecycle transition: ${String(from)} -> ${String(to)}.`)
  }
}

export function artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 } = {}) {
  if (typeof paperId !== 'string' || paperId.trim().length === 0) {
    throw new TypeError('paperId must be a non-empty string.')
  }

  const normalizedInputs = {
    paperId: paperId.trim(),
    questionPdfSha256: normalizeSha256(questionPdfSha256, 'questionPdfSha256'),
    markSchemePdfSha256: normalizeSha256(markSchemePdfSha256, 'markSchemePdfSha256'),
  }

  const digest = createHash('sha256')
    .update(JSON.stringify(normalizedInputs), 'utf8')
    .digest('hex')

  return `sha256:${digest}`
}

/**
 * Store source PDFs relative to the complete private CIE library so artifacts
 * can move between the Windows ingestion worker and the Linux runtime.
 */
export function subjectRelativePdfPath(filePath, subjectCode) {
  const subject = safeSourceSubject(subjectCode)
  const fileName = sourcePdfFileName(filePath)
  if (!subject || !fileName) throw new TypeError('A source PDF path and subject code are required.')
  return `${subject}/${fileName}`
}

/**
 * Normalize and validate a portable source path. The canonical form is
 * exactly `<subject>/<filename.pdf>` and never permits traversal or an
 * absolute path.
 */
export function normalizeSubjectRelativePdfPath(value, subjectCode) {
  const subject = safeSourceSubject(subjectCode)
  const normalized = typeof value === 'string' ? value.trim().replaceAll('\\', '/') : ''
  if (!subject || !normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return ''
  const segments = normalized.split('/')
  if (segments.length !== 2 || segments[0] !== subject || !safeSourcePdfNamePattern.test(segments[1])) return ''
  return `${subject}/${segments[1]}`
}

/**
 * Resolve a source reference against the configured library. A portable path
 * is authoritative when present; legacy absolute paths remain supported for
 * artifacts produced before the portable fields existed.
 */
export function resolveArtifactSourcePdfPath({ source, absoluteField, relativeField, libraryRoot, subjectCode } = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return ''
  const rootText = typeof libraryRoot === 'string' ? libraryRoot.trim() : ''
  if (Object.hasOwn(source, relativeField)) {
    const relative = normalizeSubjectRelativePdfPath(source[relativeField], subjectCode)
    if (relative && rootText) {
      const root = path.resolve(rootText)
      const subject = safeSourceSubject(subjectCode)
      const [, fileName] = relative.split('/')
      const rootIsSubject = path.basename(root).toLowerCase() === subject.toLowerCase()
      return rootIsSubject ? path.resolve(root, fileName) : path.resolve(root, subject, fileName)
    }
    // An explicitly supplied portable field is authoritative. Do not fall
    // back to an unrelated legacy path when it is invalid or unresolvable.
    return ''
  }
  const legacy = typeof source[absoluteField] === 'string' ? source[absoluteField].trim() : ''
  if (!legacy) return ''
  if (!rootText) return path.resolve(legacy)

  // Older workers wrote Windows absolute paths. Re-anchor only the validated
  // filename inside the configured subject root; never trust the old parent.
  const subject = safeSourceSubject(subjectCode)
  const fileName = sourcePdfFileName(legacy)
  if (!subject || !fileName) return ''
  const root = path.resolve(rootText)
  const rootIsSubject = path.basename(root).toLowerCase() === subject.toLowerCase()
  return rootIsSubject ? path.resolve(root, fileName) : path.resolve(root, subject, fileName)
}

export function buildAiStudentStudyRelease({ artifactId: boundArtifactId, routeId, status, source, extractor, verifier, candidate, verification } = {}) {
  if (status !== AI_PDF_INGESTION_LIFECYCLE.AI_VERIFIED) return null
  if (!reviewContentAllowsStudentRelease(candidate, verification)) return null
  const questionPdfSha256 = normalizeSha256(source?.questionPdfSha256, 'questionPdfSha256')
  const markSchemePdfSha256 = normalizeSha256(source?.markSchemePdfSha256, 'markSchemePdfSha256')
  if (!/^sha256:[a-f0-9]{64}$/.test(String(boundArtifactId || ''))) throw new TypeError('artifactId must be canonical.')
  if (typeof routeId !== 'string' || !routeId.trim()) throw new TypeError('routeId must be non-empty.')
  if (!validReviewPass(extractor, 'ai_pdf_question_extraction_v1') || !validReviewPass(verifier, 'ai_pdf_question_verification_v1')) {
    throw new TypeError('Both structured AI review passes are required for student release.')
  }
  const contentSha256 = studyContentSha256({
    artifactId: boundArtifactId,
    routeId: routeId.trim(),
    source: { questionPdfSha256, markSchemePdfSha256 },
    extractor,
    verifier,
    candidate,
    verification,
  })
  return Object.freeze({
    schemaVersion: AI_STUDENT_STUDY_RELEASE_SCHEMA_VERSION,
    status: 'released',
    artifactId: boundArtifactId,
    routeId: routeId.trim(),
    authority: 'ai-provisional',
    studentStudyEligible: true,
    formalProgressEligible: false,
    sourceBinding: Object.freeze({ questionPdfSha256, markSchemePdfSha256 }),
    contentBinding: Object.freeze({ algorithm: 'sha256', sha256: contentSha256 }),
    review: Object.freeze({
      extractionSchemaName: 'ai_pdf_question_extraction_v1',
      verificationSchemaName: 'ai_pdf_question_verification_v1',
      independentPassCount: 2,
    }),
  })
}

export function hasValidAiStudentStudyRelease(artifact) {
  const release = artifact?.studentRelease
  const source = artifact?.source
  const questionPdfSha256 = safeSha256(source?.questionPdfSha256)
  const markSchemePdfSha256 = safeSha256(source?.markSchemePdfSha256)
  return Boolean(
    artifact?.status === AI_PDF_INGESTION_LIFECYCLE.AI_VERIFIED
    && release?.schemaVersion === AI_STUDENT_STUDY_RELEASE_SCHEMA_VERSION
    && release?.status === 'released'
    && release?.artifactId === artifact?.artifactId
    && release?.routeId === artifact?.syllabusRouteId
    && release?.authority === 'ai-provisional'
    && release?.studentStudyEligible === true
    && release?.formalProgressEligible === false
    && questionPdfSha256
    && markSchemePdfSha256
    && safeSha256(release?.sourceBinding?.questionPdfSha256) === questionPdfSha256
    && safeSha256(release?.sourceBinding?.markSchemePdfSha256) === markSchemePdfSha256
    && release?.contentBinding?.algorithm === 'sha256'
    && safeSha256(release?.contentBinding?.sha256) === safeStudyContentSha256({
      artifactId: artifact.artifactId,
      routeId: artifact.syllabusRouteId,
      source: { questionPdfSha256, markSchemePdfSha256 },
      extractor: artifact.extractor,
      verifier: artifact.verifier,
      candidate: artifact.candidate,
      verification: artifact.verification,
    })
    && release?.review?.extractionSchemaName === 'ai_pdf_question_extraction_v1'
    && release?.review?.verificationSchemaName === 'ai_pdf_question_verification_v1'
    && release?.review?.independentPassCount === 2
    && validReviewPass(artifact?.extractor, 'ai_pdf_question_extraction_v1')
    && validReviewPass(artifact?.verifier, 'ai_pdf_question_verification_v1')
    && reviewContentAllowsStudentRelease(artifact?.candidate, artifact?.verification)
  )
}

export function reviewDraftAllowsStudentRelease(document) {
  const summary = document?.reviewSummary
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return true
  if (summary.studentRelease === false || summary.studentStudyEligible === false) return false
  const status = typeof summary.status === 'string' ? summary.status.trim().toLowerCase() : ''
  const providerStatus = typeof summary.providerStatus === 'string' ? summary.providerStatus.trim().toLowerCase() : ''
  return !status.includes('not_released')
    && !status.includes('not-released')
    && !status.includes('pending_independent')
    && !providerStatus.startsWith('not_called')
    && !providerStatus.startsWith('not-called')
}

export function reviewContentAllowsStudentRelease(candidate, verification) {
  return reviewDraftAllowsStudentRelease(candidate) && reviewDraftAllowsStudentRelease(verification)
}

function studyContentSha256(value) {
  if (!value?.candidate || typeof value.candidate !== 'object' || Array.isArray(value.candidate)
    || !value?.verification || typeof value.verification !== 'object' || Array.isArray(value.verification)) {
    throw new TypeError('Candidate and verification content are required for student release.')
  }
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function safeStudyContentSha256(value) {
  try {
    return studyContentSha256(value)
  } catch {
    return ''
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const fields = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return `{${fields.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function validReviewPass(value, schemaName) {
  return Boolean(
    value
    && typeof value.provider === 'string'
    && value.provider.trim()
    && typeof value.model === 'string'
    && value.model.trim()
    && value.schemaName === schemaName,
  )
}

function safeSha256(value) {
  const match = typeof value === 'string' ? canonicalSha256Pattern.exec(value) : null
  return match ? match[1].toLowerCase() : ''
}

function safeSourceSubject(value) {
  const subject = typeof value === 'string' ? value.trim() : ''
  return safeSourceSubjectPattern.test(subject) ? subject : ''
}

function sourcePdfFileName(value) {
  const normalized = typeof value === 'string' ? value.trim().replaceAll('\\', '/') : ''
  const fileName = normalized.split('/').filter(Boolean).at(-1) || ''
  return safeSourcePdfNamePattern.test(fileName) ? fileName : ''
}

function normalizeSha256(value, name) {
  const match = typeof value === 'string' ? canonicalSha256Pattern.exec(value) : null
  if (!match) {
    throw new TypeError(`${name} must be a canonical SHA-256 string.`)
  }
  return match[1].toLowerCase()
}
