export const PAPER_MARKING_SCHEMA_VERSION = 'stem-marking.v1'
export const SHARED_MARKING_STATUSES = Object.freeze(['queued', 'processing', 'completed', 'failed', 'missing_metadata'])
const QUESTION_ASSET_MAX_BYTES = 2 * 1024 * 1024
const QUESTION_ASSET_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

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
export async function loadQuestionAsset({ sourceRef, fetchImpl = fetch, origin = typeof window === 'undefined' ? '' : window.location.origin } = {}) {
  const assetUrl = sourceRef?.assetUrls?.[0]
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
    const imageDataUrl = await dataUrlForImage(blob)
    return { status: 'available', imageDataUrl }
  } catch {
    return { status: 'missing', reason: 'question_asset_fetch_failed', imageDataUrl: '' }
  }
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

export function buildSharedMarkingSubmission({ attemptId, routeId, specificationVersion, paperId, organizationId, classroomId, responses = [] }) {
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
      const markSchemePoint = markSchemePointForPart(metadata, part)
      if (!markSchemePoint) return []
      questionNumberByPartId[part.id] = Number(response.questionNumber)
      return [{
        questionPartId: part.id,
        prompt: part.prompt || metadata.prompt,
        availableMarks: Number(part.marks),
        assets: [{
          assetId: `${metadata.sourceRef.paperId}:page-${part.sourcePage || metadata.sourceRef.pageStart}`,
          kind: 'pdf-page',
          label: 'Question page',
          checksum: `sha256:${metadata.sourceRef.sha256}`,
          ...(response.questionAsset?.imageDataUrl ? { imageDataUrl: response.questionAsset.imageDataUrl } : {}),
        }],
        visualContext: response.questionAsset?.status === 'available'
          ? { status: 'available' }
          : { status: 'missing', reason: response.questionAsset?.reason || 'question_asset_not_indexed', reviewRequired: true, confidenceCap: 0.5 },
        markSchemePoints: [markSchemePoint],
        answer: {
          typedText: String(response.typedText || '').trim(),
          handwritingImageDataUrl: response.handwritingImageDataUrl || undefined,
        },
      }]
    })
    if (sourceQuestions.length !== metadata.parts.length) missingQuestionNumbers.push(Number(response.questionNumber))
    else questions.push(...sourceQuestions)
  }
  const submissionId = `stem-paper-${attemptId}`
  return {
    ok: questions.length > 0,
    missingQuestionNumbers: [...new Set(missingQuestionNumbers)].filter(Number.isFinite),
    questionNumberByPartId,
    payload: {
      submissionId,
      idempotencyKey: `${submissionId}:${paperId}:${PAPER_MARKING_SCHEMA_VERSION}`,
      routeId,
      specificationVersion,
      paperId,
      attemptId,
      ...(organizationId ? { organizationId } : {}),
      ...(classroomId ? { classroomId } : {}),
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

export async function sharedMarkingRequest({ token, resource, method = 'GET', body, fetchImpl = fetch, origin = 'https://ieltsist.com' }) {
  if (!token) throw new SharedMarkingError('identity_required', 'Sign in with your IELTSist account to use AI-assisted marking.', { loginRequired: true })
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
    if (response.status === 401 || response.status === 403) throw new SharedMarkingError('identity_expired', 'Your IELTSist session expired. Sign in again before retrying marking.', { loginRequired: true })
    throw new SharedMarkingError(submission.failureCode || 'service_unavailable', 'AI-assisted marking could not be completed. Your answer remains saved.', { retryable: response.status >= 500 || Boolean(submission.retryable) })
  }
  if (!SHARED_MARKING_STATUSES.includes(submission.status)) throw new SharedMarkingError('invalid_response', 'The shared marking service returned an invalid status. Your answer remains saved.', { retryable: true })
  return submission
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
    summary: `${result.rawMarks}/${result.maxMarks} marks from the shared IELTSist marking service.`,
    nextAction: result.reviewRequired ? 'Check the mark-scheme evidence before accepting this assisted mark.' : 'Review any missed mark points, then retry the question.',
  }]))
}

export function paperSubmissionMarkingSummary({ submitted, aiMarks = {}, responseQuestionNumbers = [] }) {
  if (!submitted) return null
  const results = responseQuestionNumbers.map((number) => aiMarks[number]).filter(Boolean)
  const pending = results.filter((result) => result.status === 'queued' || result.status === 'processing').length
  const successful = results.filter((result) => result.status === 'completed').length
  const missingMetadata = results.filter((result) => result.status === 'missing_metadata').length
  const failed = results.filter((result) => result.status === 'failed').length
  if (pending) return { tone: 'pending', text: `Answer sheet submitted. Shared AI marking is ${results.some((result) => result.status === 'processing') ? 'processing' : 'queued'} for ${pending} sourced response${pending === 1 ? '' : 's'}; the paired mark scheme is unlocked.` }
  if (successful) return { tone: failed || missingMetadata ? 'mixed' : 'success', text: `Answer sheet submitted. ${successful} response${successful === 1 ? '' : 's'} received structured AI-assisted marks${missingMetadata ? `; ${missingMetadata} question${missingMetadata === 1 ? '' : 's'} need reviewed metadata` : ''}${failed ? `; ${failed} review${failed === 1 ? '' : 's'} failed and can be retried` : ''}.` }
  if (missingMetadata) return { tone: 'missing', text: `Answer sheet submitted. ${missingMetadata} response${missingMetadata === 1 ? '' : 's'} has no reviewed question-level mark allocation. Your handwriting is saved; use the paired mark scheme to self-mark.` }
  if (failed) return { tone: 'error', text: `Answer sheet submitted. Shared AI marking failed for ${failed} response${failed === 1 ? '' : 's'}; your work remains saved and the paired mark scheme is available.` }
  return { tone: 'saved', text: 'Answer sheet submitted. Your handwriting is saved and the paired mark scheme is unlocked for self-marking.' }
}
