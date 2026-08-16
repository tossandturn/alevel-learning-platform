import { createHash } from 'node:crypto'

export const AI_PDF_INGESTION_SCHEMA_VERSION = 'ai-pdf-ingestion.v1'

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

function normalizeSha256(value, name) {
  const match = typeof value === 'string' ? canonicalSha256Pattern.exec(value) : null
  if (!match) {
    throw new TypeError(`${name} must be a canonical SHA-256 string.`)
  }
  return match[1].toLowerCase()
}
