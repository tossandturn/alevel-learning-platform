import { SHARED_IDENTITY_ORIGIN } from './identityOrigin.js'
import { documentPageFromAssetUrl, requiredSourceAssetEvidence, sourcePageFromAssetUrl, STEM_MARKING_MANIFEST_SCHEMA_VERSION, STEM_SOURCE_REVIEW_SCHEMA_VERSION, trustedSourceAssetUrls } from './sourceContentContract.js'

export const PAPER_MARKING_SCHEMA_VERSION = 'stem-marking.v1'
export const TRUSTED_MARKING_MANIFEST_SCHEMA_VERSION = STEM_MARKING_MANIFEST_SCHEMA_VERSION
export const SHARED_MARKING_STATUSES = Object.freeze(['queued', 'processing', 'completed', 'failed', 'missing_metadata'])
const QUESTION_ASSET_MAX_BYTES = 2 * 1024 * 1024
const QUESTION_ASSET_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function optionKey(value) {
  const text = String(value ?? '').trim().toUpperCase()
  return text.match(/^([A-D])(?:\b|[.)\s:-])/)?.[1] || (/^[A-D]$/.test(text) ? text : '')
}

/**
 * Paper MCQs are objective and must not enter the self-mark queue. Keep this
 * helper pure so the paper workspace and regression tests use the same rule.
 */
export function scorePaperMultipleChoice({ answer, answerKey, marks = 1 } = {}) {
  const submitted = optionKey(typeof answer === 'object' ? answer?.choice : answer)
  if (!submitted) return null
  const expected = optionKey(answerKey)
  const maximum = Math.max(0, Number(marks) || 0)
  const awarded = expected && submitted === expected ? maximum : 0
  return {
    awarded,
    maxMarks: maximum,
    status: awarded === maximum ? 'secure' : 'missed',
    feedback: awarded === maximum ? 'Correct option selected.' : 'The selected option does not match the official answer key.',
  }
}

function dataUrlForImage(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The question image could not be read.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * The shared marking service only receives a locally-hosted, size-limited page
 * image. This avoids sending arbitrary remote URLs while preserving diagrams
 * and graph context for the matching QuestionPart.
 */
async function sha256ForBlob(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (!globalThis.crypto?.subtle) throw new Error('Browser SHA-256 verification is unavailable.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function sourceAssetEvidenceForPart(sourceRef = {}, part = {}) {
  const trustedAssets = trustedSourceAssetUrls(sourceRef)
  const evidence = [...requiredSourceAssetEvidence(part)]
  const provenanceEvidence = part.markingProvenance?.sourceEvidence
  if (provenanceEvidence?.assetSha256 && Number.isInteger(Number(provenanceEvidence.page))) {
    evidence.push({
      page: Number(provenanceEvidence.page),
      assetUrl: String(provenanceEvidence.assetUrl || ''),
      assetSha256: String(provenanceEvidence.assetSha256).toLowerCase(),
    })
  }
  const byPageAndHash = new Map()
  for (const entry of evidence) {
    const page = Number(entry.page)
    const declaredUrl = String(entry.assetUrl || '')
    const assetUrl = declaredUrl
      ? trustedAssets.find((url) => url === declaredUrl && sourcePageFromAssetUrl(url) === page) || ''
      : trustedAssets.find((url) => sourcePageFromAssetUrl(url) === page) || ''
    const sha256 = String(entry.assetSha256 || '').toLowerCase()
    const key = `${page}\u0000${sha256}`
    const existing = byPageAndHash.get(key)
    if (!existing || (!existing.assetUrl && assetUrl)) byPageAndHash.set(key, { page, assetUrl, sha256 })
  }
  return [...byPageAndHash.values()]
    .filter((entry) => Number.isInteger(entry.page) && /^[a-f0-9]{64}$/.test(entry.sha256) && entry.assetUrl)
    .toSorted((left, right) => left.page - right.page || left.assetUrl.localeCompare(right.assetUrl))
}

export async function loadQuestionAsset({ sourceRef, part, page, assetUrl: requestedAssetUrl = '', expectedSha256, fetchImpl = fetch, origin = typeof window === 'undefined' ? '' : window.location.origin } = {}) {
  const pageNumber = Number(page || part?.sourcePage)
  const trustedAssets = trustedSourceAssetUrls(sourceRef || {})
  const assetUrl = requestedAssetUrl
    ? trustedAssets.find((url) => url === requestedAssetUrl && documentPageFromAssetUrl(url) === pageNumber) || ''
    : trustedAssets.find((url) => documentPageFromAssetUrl(url) === pageNumber) || ''
  if (!assetUrl) return { status: 'missing', reason: 'question_asset_not_indexed', imageDataUrl: '' }
  let url
  try {
    url = new URL(assetUrl, origin)
  } catch {
    return { status: 'missing', reason: 'question_asset_invalid', imageDataUrl: '' }
  }
  if (url.origin !== origin || !url.pathname.startsWith('/question-assets/')) {
    return { status: 'missing', reason: 'question_asset_not_local', imageDataUrl: '' }
  }
  try {
    const response = await fetchImpl(url.href, { credentials: 'same-origin' })
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase()
    if (!response.ok || !QUESTION_ASSET_TYPES.has(contentType)) return { status: 'missing', reason: 'question_asset_unavailable', imageDataUrl: '' }
    const blob = await response.blob()
    if (!blob.size || blob.size > QUESTION_ASSET_MAX_BYTES) return { status: 'missing', reason: 'question_asset_size_limit', imageDataUrl: '' }
    const sha256 = await sha256ForBlob(blob)
    if (!expectedSha256 || sha256 !== String(expectedSha256).toLowerCase()) return { status: 'missing', reason: 'question_asset_checksum_mismatch', imageDataUrl: '', assetUrl, page: pageNumber, sha256 }
    const imageDataUrl = await dataUrlForImage(blob)
    return { status: 'available', imageDataUrl, assetUrl, page: pageNumber, sha256 }
  } catch {
    return { status: 'missing', reason: 'question_asset_fetch_failed', imageDataUrl: '' }
  }
}

export async function loadQuestionAssets({ sourceRef, part, fetchImpl = fetch, origin = typeof window === 'undefined' ? '' : window.location.origin } = {}) {
  const evidence = sourceAssetEvidenceForPart(sourceRef, part)
  if (!evidence.length) return { status: 'missing', reason: 'question_asset_evidence_missing', assets: [] }
  const assets = await Promise.all(evidence.map((entry) => loadQuestionAsset({
    sourceRef,
    part,
    page: entry.page,
    assetUrl: entry.assetUrl,
    expectedSha256: entry.sha256,
    fetchImpl,
    origin,
  })))
  const failed = assets.find((asset) => asset.status !== 'available')
  return failed
    ? { status: 'missing', reason: failed.reason, assets }
    : { status: 'available', assets }
}

function reviewedQuestion(questionMetadata) {
  return Boolean(
    questionMetadata?.questionId
    && questionMetadata.reviewStatus === 'reviewed'
    && Number(questionMetadata.maxMarks) > 0
    && questionMetadata.answerRef?.sha256
    && questionMetadata.parts?.length
    && questionMetadata.parts.every((part) => Number(part.marks) > 0),
  )
}

function markSchemePointForPart(metadata, part) {
  const points = (metadata.expectedMarkPoints || []).filter((point) => point.partId === part.id)
  const text = points.map((point) => point.point).filter(Boolean).join(' / ')
  if (!text) return null
  return {
    pointId: `${part.id}:scheme`,
    maxMarks: Number(part.marks),
    text,
    sourceEvidence: { page: part.markSchemePage || metadata.answerRef.pageStart, quote: text.slice(0, 500) },
  }
}

export function reviewedManifestQuestion({ routeId, qualification, specificationVersion, paperId, questionNumber, metadata, part }) {
  const markSchemePoint = markSchemePointForPart(metadata, part)
  const provenance = part.markingProvenance
  if (!markSchemePoint || !provenance || provenance.manifestSchemaVersion !== STEM_MARKING_MANIFEST_SCHEMA_VERSION || provenance.reviewSchemaVersion !== STEM_SOURCE_REVIEW_SCHEMA_VERSION) return null
  const sourcePage = part.sourcePage || metadata.sourceRef.pageStart
  const sourceAssets = sourceAssetEvidenceForPart(metadata.sourceRef, part)
  const sourceAsset = sourceAssets.find((entry) => entry.page === sourcePage)
  if (!sourceAsset || sourceAsset.sha256 !== provenance.sourceEvidence?.assetSha256 || sourceAsset.assetUrl !== provenance.sourceEvidence?.assetUrl) return null
  return {
    routeId,
    qualification,
    specificationVersion,
    paperId,
    questionPartId: part.id,
    sourceQuestionId: provenance.sourceQuestionId,
    review: {
      status: 'approved',
      schemaVersion: provenance.reviewSchemaVersion,
      version: provenance.reviewVersion,
      sourceEvidence: provenance.sourceEvidence,
    },
    reviewSchemaVersion: provenance.reviewSchemaVersion,
    reviewVersion: provenance.reviewVersion,
    sourceEvidence: provenance.sourceEvidence,
    prompt: part.prompt || metadata.prompt,
    availableMarks: Number(part.marks),
    markSchemePoints: [markSchemePoint],
    assets: sourceAssets.map((asset) => ({
      assetId: `${metadata.sourceRef.paperId}:page-${asset.page}`,
      kind: 'pdf-page',
      label: `Question page ${asset.page}`,
      assetUrl: asset.assetUrl,
      checksum: `sha256:${asset.sha256}`,
      sourceEvidence: { page: asset.page, assetUrl: asset.assetUrl, assetSha256: asset.sha256, quote: `Question paper Q${questionNumber}${metadata.parts.length > 1 ? `(${part.label})` : ''}` },
    })),
  }
}

export function buildSharedMarkingSubmission({ attemptId, routeId, qualification, specificationVersion, paperId, organizationId, classroomId, assignmentId, submissionSuffix = '', markingCapabilities = {}, responses = [] }) {
  const missingQuestionNumbers = []
  const questionNumberByPartId = {}
  const questions = []
  for (const response of responses) {
    const metadata = response.questionMetadata
    if (!reviewedQuestion(metadata)) {
      missingQuestionNumbers.push(Number(response.questionNumber))
      continue
    }
    const sourceQuestions = metadata.parts.flatMap((part) => {
      const manifestQuestion = reviewedManifestQuestion({ routeId, qualification, specificationVersion, paperId, questionNumber: response.questionNumber, metadata, part })
      if (!manifestQuestion) return []
      questionNumberByPartId[part.id] = Number(response.questionNumber)
      const { routeId: _routeId, qualification: _qualification, specificationVersion: _specificationVersion, paperId: _paperId, ...canonicalQuestion } = manifestQuestion
      return [{
        ...canonicalQuestion,
        assets: canonicalQuestion.assets.map((asset) => {
          const loaded = response.questionAssetsByPart?.[part.id]
          const loadedAssets = Array.isArray(loaded?.assets)
            ? loaded.assets
            : loaded?.status === 'available' ? [loaded] : []
          const loadedAsset = loadedAssets.find((candidate) => (
            candidate?.status === 'available'
            && candidate.assetUrl === asset.assetUrl
            && candidate.sha256 === String(asset.checksum || '').replace(/^sha256:/, '')
          ))
          return { ...asset, ...(loadedAsset?.imageDataUrl ? { imageDataUrl: loadedAsset.imageDataUrl } : {}) }
        }),
        visualContext: (() => {
          const loaded = response.questionAssetsByPart?.[part.id]
          const loadedAssets = Array.isArray(loaded?.assets)
            ? loaded.assets
            : loaded?.status === 'available' ? [loaded] : []
          const allLoaded = canonicalQuestion.assets.every((asset) => loadedAssets.some((candidate) => (
            candidate?.status === 'available'
            && candidate.assetUrl === asset.assetUrl
            && candidate.sha256 === String(asset.checksum || '').replace(/^sha256:/, '')
            && candidate.imageDataUrl
          )))
          return allLoaded
            ? { status: 'available', pages: canonicalQuestion.assets.map((asset) => asset.sourceEvidence.page) }
            : { status: 'missing', reason: loaded?.reason || 'question_asset_not_indexed', reviewRequired: true, confidenceCap: 0.5 }
        })(),
        markingGrant: markingCapabilities[part.id] || null,
        answer: {
          typedText: String(response.typedText || '').trim(),
          handwritingImageDataUrl: response.handwritingImageDataUrl || undefined,
        },
      }]
    })
    if (sourceQuestions.length !== metadata.parts.length) missingQuestionNumbers.push(Number(response.questionNumber))
    else questions.push(...sourceQuestions)
  }
  const normalizedSuffix = String(submissionSuffix || '').trim().replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  const submissionId = `stem-paper-${attemptId}${normalizedSuffix ? `-${normalizedSuffix}` : ''}`
  return {
    ok: questions.length > 0,
    missingQuestionNumbers: [...new Set(missingQuestionNumbers)].filter(Number.isFinite),
    questionNumberByPartId,
    payload: {
      submissionId,
      idempotencyKey: `${submissionId}:${paperId}:${PAPER_MARKING_SCHEMA_VERSION}`,
      routeId,
      qualification,
      specificationVersion,
      paperId,
      attemptId,
      ...(organizationId ? { organizationId } : {}),
      ...(classroomId ? { classroomId } : {}),
      ...(assignmentId ? { assignmentId } : {}),
      questions,
    },
  }
}

function markingSubmission(value) {
  return value?.submission || value || {}
}

export class SharedMarkingError extends Error {
  constructor(code, message, { retryable = false, loginRequired = false } = {}) {
    super(message)
    this.name = 'SharedMarkingError'
    this.code = code
    this.retryable = retryable
    this.loginRequired = loginRequired
  }
}

export async function sharedMarkingRequest({ token, resource, method = 'GET', body, fetchImpl = fetch, origin = SHARED_IDENTITY_ORIGIN }) {
  if (!token) throw new SharedMarkingError('identity_required', 'Sign in to STEM to use AI-assisted marking.', { loginRequired: true })
  let response
  try {
    response = await fetchImpl(`${origin.replace(/\/+$/, '')}${resource}`, {
      method,
      credentials: 'include',
      headers: { 'X-Stem-Identity': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new SharedMarkingError('service_unavailable', 'The shared marking service is unavailable. Your answer remains saved.', { retryable: true })
  }
  const payload = await response.json().catch(() => ({}))
  const submission = markingSubmission(payload)
  if (response.status === 422 && submission.status === 'missing_metadata') return submission
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new SharedMarkingError('identity_expired', 'Your STEM session expired. Sign in again before retrying marking.', { loginRequired: true })
    throw new SharedMarkingError(submission.failureCode || 'service_unavailable', 'AI-assisted marking could not be completed. Your answer remains saved.', { retryable: response.status >= 500 || Boolean(submission.retryable) })
  }
  if (!SHARED_MARKING_STATUSES.includes(submission.status)) throw new SharedMarkingError('invalid_response', 'The shared marking service returned an invalid status. Your answer remains saved.', { retryable: true })
  return submission
}

/**
 * Read the shared service capability before a student response is queued. This
 * endpoint receives no answer content, so the UI can distinguish sign-in from
 * provider downtime before any reviewed response is submitted for marking.
 */
export async function readSharedMarkingAvailability({ token = '', fetchImpl = fetch, origin = SHARED_IDENTITY_ORIGIN } = {}) {
  let response
  try {
    response = await fetchImpl(`${origin.replace(/\/+$/, '')}/api/stem/marking/availability`, {
      method: 'GET',
      credentials: 'include',
      headers: token ? { 'X-Stem-Identity': token } : {},
    })
  } catch {
    throw new SharedMarkingError('service_unavailable', 'The shared marking service is unavailable. Your answer remains saved.', { retryable: true })
  }
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401 || response.status === 403) {
    return { enabled: false, modelConfigured: false, queueAvailable: false, authenticationRequired: true }
  }
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new SharedMarkingError('service_unavailable', 'The shared marking service is unavailable. Your answer remains saved.', { retryable: response.status >= 500 })
  }
  return {
    enabled: payload.enabled === true,
    modelConfigured: payload.modelConfigured === true,
    queueAvailable: payload.queueAvailable === true,
    authenticationRequired: payload.authenticationRequired === true,
  }
}

export function sharedMarkingIsAvailable(availability) {
  return Boolean(availability?.enabled && availability?.modelConfigured && availability?.queueAvailable && !availability?.authenticationRequired)
}

export function createSharedMarkingSubmission(options) {
  return sharedMarkingRequest({ ...options, resource: '/api/stem/marking/submissions', method: 'POST', body: options.submission })
}

export function readSharedMarkingSubmission(options) {
  return sharedMarkingRequest({ ...options, resource: `/api/stem/marking/submissions/${encodeURIComponent(options.submissionId)}` })
}

export function retrySharedMarkingSubmission(options) {
  return sharedMarkingRequest({
    ...options,
    resource: `/api/stem/marking/submissions/${encodeURIComponent(options.submissionId)}/retry`,
    method: 'POST',
  })
}

export async function waitForSharedMarkingSubmission(options) {
  const attempts = Math.max(1, Number(options.attempts) || 20)
  for (let index = 0; index < attempts; index += 1) {
    const submission = await readSharedMarkingSubmission(options)
    options.onStatus?.(submission)
    if (!['queued', 'processing'].includes(submission.status)) return submission
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs || 1500))
  }
  return { submissionId: options.submissionId, status: 'failed', retryable: true, failureCode: 'status_timeout' }
}

export function completedMarksByQuestion(submission, questionNumberByPartId) {
  if (submission?.status !== 'completed' || !submission.result) return {}
  const grouped = new Map()
  for (const result of submission.result.questions || []) {
    const questionNumber = questionNumberByPartId[result.questionPartId]
    if (!questionNumber) continue
    const current = grouped.get(questionNumber) || { rawMarks: 0, maxMarks: 0, confidence: 1, reviewRequired: false, markPoints: [] }
    current.rawMarks += Number(result.awardedMarks) || 0
    current.maxMarks += Number(result.maxMarks) || 0
    current.confidence = Math.min(current.confidence, Number(result.confidence) || 0)
    current.reviewRequired ||= Boolean(result.reviewRequired)
    current.markPoints.push(...(result.markPoints || []).map((point) => ({
      id: point.pointId,
      awarded: Number(point.awardedMarks) > 0,
      marks: Number(point.awardedMarks) || 0,
      reason: point.studentEvidence?.quote || (Number(point.awardedMarks) > 0 ? 'Mark point evidenced.' : 'Mark point not evidenced.'),
    })))
    grouped.set(questionNumber, current)
  }
  return Object.fromEntries([...grouped].map(([number, result]) => [number, {
    ...result,
    status: 'completed',
    summary: `${result.rawMarks}/${result.maxMarks} marks from the shared marking service.`,
    nextAction: result.reviewRequired ? 'Check the mark-scheme evidence before accepting this assisted mark.' : 'Review any missed mark points, then retry the question.',
  }]))
}

export function paperSubmissionMarkingSummary({ submitted, aiMarks = {}, responseQuestionNumbers = [] }) {
  if (!submitted) return null
  const results = responseQuestionNumbers.map((number) => aiMarks[number]).filter(Boolean)
  const checking = results.filter((result) => result.status === 'checking_availability').length
  const pending = results.filter((result) => result.status === 'queued' || result.status === 'processing').length
  const successful = results.filter((result) => result.status === 'completed').length
  const missingMetadata = results.filter((result) => result.status === 'missing_metadata').length
  const failed = results.filter((result) => result.status === 'failed').length
  const loginRequired = results.filter((result) => result.status === 'failed' && result.loginRequired).length
  const unavailable = results.filter((result) => result.status === 'failed' && result.failureCode === 'service_unavailable').length
  if (checking) return { tone: 'pending', text: `Answer sheet submitted. Checking whether AI-assisted marking is available for ${checking} reviewed response${checking === 1 ? '' : 's'}; the paired mark scheme is unlocked.` }
  if (pending) return { tone: 'pending', text: `Answer sheet submitted. Shared AI marking is ${results.some((result) => result.status === 'processing') ? 'processing' : 'queued'} for ${pending} reviewed response${pending === 1 ? '' : 's'}; the paired mark scheme is unlocked.` }
  if (successful) return { tone: failed || missingMetadata ? 'mixed' : 'success', text: `Answer sheet submitted. ${successful} response${successful === 1 ? '' : 's'} received structured AI-assisted marks${missingMetadata ? `; ${missingMetadata} question${missingMetadata === 1 ? '' : 's'} need reviewed metadata` : ''}${loginRequired ? `; ${loginRequired} reviewed response${loginRequired === 1 ? '' : 's'} need STEM sign-in` : ''}${unavailable ? `; AI-assisted marking is temporarily unavailable for ${unavailable} reviewed response${unavailable === 1 ? '' : 's'}` : ''}${failed && !loginRequired && !unavailable ? `; ${failed} review${failed === 1 ? '' : 's'} failed and can be retried` : ''}.` }
  if (missingMetadata) return { tone: 'missing', text: `Answer sheet submitted. ${missingMetadata} response${missingMetadata === 1 ? '' : 's'} ${missingMetadata === 1 ? 'has' : 'have'} no reviewed question-level mark allocation. Your handwriting is saved; use the paired mark scheme to self-mark.` }
  if (loginRequired) return { tone: 'error', text: `Answer sheet submitted. Sign in to STEM to request AI-assisted marking for ${loginRequired} reviewed response${loginRequired === 1 ? '' : 's'}; your work remains saved and the paired mark scheme is available.` }
  if (unavailable) return { tone: 'error', text: `Answer sheet submitted. AI-assisted marking is temporarily unavailable for ${unavailable} reviewed response${unavailable === 1 ? '' : 's'}; your work remains saved and the paired mark scheme is available.` }
  if (failed) return { tone: 'error', text: `Answer sheet submitted. Shared AI marking failed for ${failed} response${failed === 1 ? '' : 's'}; your work remains saved and the paired mark scheme is available.` }
  return { tone: 'saved', text: 'Answer sheet submitted. Your handwriting is saved and the paired mark scheme is unlocked for self-marking.' }
}
