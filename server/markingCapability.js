import crypto from 'node:crypto'
import { isHumanReviewedPastPaperItem } from '../src/data/questionBank.js'
import { canonicalSourceMarkingProvenance } from '../src/lib/sourceContentContract.js'

export const MARKING_CAPABILITY_ISSUER = 'stem.ieltsist.com'
export const MARKING_CAPABILITY_AUDIENCE = 'stem-ai'
export const MARKING_CAPABILITY_SCOPE = 'stem:handwriting-mark'

function asText(value, maxLength = 240) {
  return String(value || '').trim().slice(0, maxLength)
}

function decodeBase64Url(value) {
  return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'))
}

export function validHmacJwt(token, key, { issuer, audience, maxLifetimeSeconds = 900 } = {}) {
  if (!token || !key) return null
  const parts = String(token).split('.')
  if (parts.length !== 3) return null
  const [encodedHeader, encodedPayload, signature] = parts
  const expected = crypto.createHmac('sha256', key).update(`${encodedHeader}.${encodedPayload}`).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    const header = decodeBase64Url(encodedHeader)
    const claims = decodeBase64Url(encodedPayload)
    const now = Math.floor(Date.now() / 1000)
    if (
      header.alg !== 'HS256'
      || (issuer && claims.iss !== issuer)
      || (audience && claims.aud !== audience)
      || !claims.sub
      || !Number.isFinite(Number(claims.exp))
      || Number(claims.exp) <= now
      || (Number(claims.iat) && Number(claims.exp) - Number(claims.iat) > maxLifetimeSeconds)
    ) return null
    return claims
  } catch {
    return null
  }
}

export function signHmacJwt(claims, key, { issuer, audience, expiresInSeconds = 15 * 60 } = {}) {
  if (!key) throw Object.assign(new Error('Marking capability signing is not configured.'), { statusCode: 503, code: 'marking_capability_unavailable' })
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    ...claims,
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + expiresInSeconds,
    jti: crypto.randomUUID(),
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

export function authenticatedStemIdentity(request, signingKey) {
  const authorization = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]
    || String(request.headers['x-stem-identity'] || '').trim()
  const claims = validHmacJwt(authorization, signingKey, {
    issuer: 'ieltsist.com',
    audience: 'stem.ieltsist.com',
    maxLifetimeSeconds: 60 * 60,
  })
  return claims && /^ielts:\d+$/.test(String(claims.sub)) ? { id: String(claims.sub), claims } : null
}

function strictSourceQuestionId(value) {
  const sourceQuestionId = asText(value, 320)
  return sourceQuestionId && !sourceQuestionId.includes('@') && !/\s/.test(sourceQuestionId) ? sourceQuestionId : ''
}

function matchingCanonicalProvenance(provided, canonical) {
  const sourceEvidence = provided?.sourceEvidence || {}
  const expectedEvidence = canonical?.sourceEvidence || {}
  return Boolean(
    canonical
    && provided?.manifestSchemaVersion === canonical.manifestSchemaVersion
    && provided?.sourceQuestionId === canonical.sourceQuestionId
    && provided?.questionPartId === canonical.questionPartId
    && provided?.bindingSignature === canonical.bindingSignature
    && provided?.reviewSchemaVersion === canonical.reviewSchemaVersion
    && provided?.reviewVersion === canonical.reviewVersion
    && provided?.sourceDocumentSha256 === canonical.sourceDocumentSha256
    && provided?.answerDocumentSha256 === canonical.answerDocumentSha256
    && provided?.sourceIndexSha256 === canonical.sourceIndexSha256
    && provided?.sourceManifestChecksum === canonical.sourceManifestChecksum
    && sourceEvidence.assetId === expectedEvidence.assetId
    && Number(sourceEvidence.page) === Number(expectedEvidence.page)
    && sourceEvidence.assetUrl === expectedEvidence.assetUrl
    && sourceEvidence.assetSha256 === expectedEvidence.assetSha256
    && sourceEvidence.quote === expectedEvidence.quote,
  )
}

function rejected(code, message, statusCode = 422) {
  return { ok: false, code, message, statusCode }
}

/**
 * Resolve every requested part against the effective server bank. The client
 * never chooses a reviewed capability, a source version, or a page image.
 */
export function canonicalMarkingCapabilityRequest(payload = {}, questionBank = []) {
  const mode = asText(payload.mode, 32)
  const attemptId = asText(payload.attemptId, 120)
  const paperId = asText(payload.paperId, 200)
  if (!['topic', 'full-paper'].includes(mode)) return rejected('marking_mode_invalid', 'Marking mode must be topic or full-paper.')
  if (payload.submitted !== true) return rejected('attempt_not_submitted', 'AI marking is available only after submission.', 409)
  if (!attemptId || !/^[A-Za-z0-9._:-]{8,120}$/.test(attemptId)) return rejected('attempt_invalid', 'A valid submitted attempt is required.')
  if (mode === 'full-paper' && !paperId) return rejected('paper_context_missing', 'A full-paper marking capability needs its paper ID.')
  const requestedParts = Array.isArray(payload.parts) ? payload.parts : []
  if (!requestedParts.length || requestedParts.length > 60) return rejected('marking_parts_invalid', 'At least one reviewed answer part is required.')

  const resolved = []
  const seen = new Set()
  for (const requestPart of requestedParts) {
    const provenance = requestPart?.provenance && typeof requestPart.provenance === 'object' ? requestPart.provenance : requestPart
    const sourceQuestionId = strictSourceQuestionId(provenance?.sourceQuestionId)
    const questionPartId = asText(provenance?.questionPartId, 360)
    const routeId = asText(provenance?.routeId, 160)
    if (!sourceQuestionId || !questionPartId || !routeId) return rejected('source_provenance_missing', 'The reviewed source provenance is incomplete.')
    const uniqueKey = `${sourceQuestionId}\u0000${questionPartId}`
    if (seen.has(uniqueKey)) return rejected('marking_parts_duplicate', 'Every requested answer part must be unique.')
    seen.add(uniqueKey)
    const question = questionBank.find((candidate) => (
      candidate?.routeId === routeId
      && candidate?.sourceQuestionId === sourceQuestionId
      && isHumanReviewedPastPaperItem(candidate)
    ))
    if (!question) return rejected('source_question_unreviewed', 'The reviewed source record is unavailable.')
    if (mode === 'full-paper' && String(question.sourceRef?.paperId || '') !== paperId) {
      return rejected('paper_context_mismatch', 'The requested part is not in this submitted paper.')
    }
    if (mode === 'topic' && paperId && String(question.sourceRef?.paperId || '') !== paperId) {
      return rejected('paper_context_mismatch', 'The requested part is not in this submitted paper.')
    }
    const part = (question.parts || []).find((candidate) => String(candidate?.questionPartId || candidate?.partId || candidate?.id || '') === questionPartId)
    if (!part) return rejected('source_question_unknown', 'The reviewed answer part is unavailable.')
    const canonical = canonicalSourceMarkingProvenance(question, part)
    if (!matchingCanonicalProvenance(provenance, canonical)) return rejected('source_provenance_mismatch', 'The reviewed source binding no longer matches the current catalog.')
    resolved.push(Object.freeze({ question, part, canonical }))
  }
  return Object.freeze({ ok: true, mode, attemptId, paperId: mode === 'full-paper' ? paperId : '', parts: Object.freeze(resolved) })
}

export function issueMarkingCapabilities({ userId, payload, questionBank, signingKey }) {
  const request = canonicalMarkingCapabilityRequest(payload, questionBank)
  if (!request.ok) return request
  const capabilities = request.parts.map(({ canonical, question }) => ({
    sourceQuestionId: canonical.sourceQuestionId,
    questionPartId: canonical.questionPartId,
    markingGrant: signHmacJwt({
      sub: userId,
      scope: MARKING_CAPABILITY_SCOPE,
      attemptId: request.attemptId,
      mode: request.mode,
      submitted: true,
      paperId: String(question?.sourceRef?.paperId || request.paperId || ''),
      routeId: payload.parts.find((part) => (part.provenance || part).questionPartId === canonical.questionPartId)?.provenance?.routeId
        || payload.parts.find((part) => (part.provenance || part).questionPartId === canonical.questionPartId)?.routeId
        || '',
      sourceQuestionId: canonical.sourceQuestionId,
      questionPartId: canonical.questionPartId,
      bindingSignature: canonical.bindingSignature,
      reviewVersion: canonical.reviewVersion,
      sourceDocumentSha256: canonical.sourceDocumentSha256,
      answerDocumentSha256: canonical.answerDocumentSha256,
      sourceIndexSha256: canonical.sourceIndexSha256,
      sourceManifestChecksum: canonical.sourceManifestChecksum,
      sourceEvidence: canonical.sourceEvidence,
    }, signingKey, {
      issuer: MARKING_CAPABILITY_ISSUER,
      audience: MARKING_CAPABILITY_AUDIENCE,
    }),
  }))
  return Object.freeze({
    ok: true,
    attemptId: request.attemptId,
    mode: request.mode,
    submitted: true,
    capabilities: Object.freeze(capabilities),
  })
}

export function verifyMarkingCapability({ request, payload = {}, identitySigningKey, capabilitySigningKey }) {
  const identity = authenticatedStemIdentity(request, identitySigningKey)
  if (!identity) return rejected('identity_required', 'Sign in with your IELTSist account before requesting AI marking.', 401)
  const grant = validHmacJwt(payload.markingGrant, capabilitySigningKey, {
    issuer: MARKING_CAPABILITY_ISSUER,
    audience: MARKING_CAPABILITY_AUDIENCE,
    maxLifetimeSeconds: 15 * 60,
  })
  if (!grant || grant.scope !== MARKING_CAPABILITY_SCOPE || grant.sub !== identity.id) {
    return rejected('marking_capability_invalid', 'This AI marking capability is missing, expired or invalid.', 403)
  }
  if (payload.submitted !== true) {
    return rejected('attempt_not_submitted', 'AI marking is available only after submission.', 409)
  }
  const provenance = payload.provenance || {}
  const sourceEvidence = provenance.sourceEvidence || {}
  const grantEvidence = grant.sourceEvidence || {}
  const matches = payload.submitted === true
    && String(payload.mode || '') === String(grant.mode || '')
    && String(payload.attemptId || '') === String(grant.attemptId || '')
    && String(payload.paperId || '') === String(grant.paperId || '')
    && String(provenance.routeId || '') === String(grant.routeId || '')
    && String(provenance.sourceQuestionId || '') === String(grant.sourceQuestionId || '')
    && String(provenance.questionPartId || '') === String(grant.questionPartId || '')
    && String(provenance.bindingSignature || '') === String(grant.bindingSignature || '')
    && String(provenance.reviewVersion || '') === String(grant.reviewVersion || '')
    && String(provenance.sourceDocumentSha256 || '') === String(grant.sourceDocumentSha256 || '')
    && String(provenance.answerDocumentSha256 || '') === String(grant.answerDocumentSha256 || '')
    && String(provenance.sourceIndexSha256 || '') === String(grant.sourceIndexSha256 || '')
    && String(provenance.sourceManifestChecksum || '') === String(grant.sourceManifestChecksum || '')
    && sourceEvidence.assetId === grantEvidence.assetId
    && Number(sourceEvidence.page) === Number(grantEvidence.page)
    && sourceEvidence.assetUrl === grantEvidence.assetUrl
    && sourceEvidence.assetSha256 === grantEvidence.assetSha256
    && sourceEvidence.quote === grantEvidence.quote
  if (!matches) return rejected('marking_capability_mismatch', 'This AI marking capability does not match the submitted response.')
  return Object.freeze({ ok: true, userId: identity.id, claims: grant })
}
