import crypto from 'node:crypto'

export const SCORING_CONTEXT_GRANT_SCHEMA = 'stem-ai-scoring-context-grant.v1'

export function normalizeScoringContextText(value) {
  return typeof value === 'string' ? value.replaceAll(String.fromCharCode(0), '').trim().slice(0, 6000) : ''
}

export function scoringContextWorkDigest(key, attemptId, sourceQuestionId, questionPartId, value) {
  const text = normalizeScoringContextText(value)
  if (!key || !attemptId || !sourceQuestionId || !questionPartId || !text) return ''
  return crypto.createHmac('sha256', key).update(JSON.stringify([
    SCORING_CONTEXT_GRANT_SCHEMA, attemptId, sourceQuestionId, questionPartId, text,
  ])).digest('hex')
}

function equalDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(String(left || '')) || !/^[a-f0-9]{64}$/.test(String(right || ''))) return false
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

export function authorizeScoringContext({ question, part, claims, currentGrant, supplied, signingKey, attemptId }) {
  const requirements = part?.scoringContextRequirements
  const grant = claims?.scoringContext
  if (!requirements && !grant) return Object.freeze({ ok: true, dependencies: Object.freeze([]) })
  if (!requirements || !grant || !currentGrant || grant.schemaVersion !== SCORING_CONTEXT_GRANT_SCHEMA
    || requirements.schemaVersion !== 'stem-ai-scoring-context.v1' || requirements.dependency !== 'follow-through'
    || requirements.evidenceRequirement !== 'student-work-visible-and-readable' || requirements.onMissing !== 'human-review-required'
    || !/^[a-f0-9]{64}$/.test(String(part?.scoringContextFingerprint || ''))
    || grant.fingerprint !== part.scoringContextFingerprint
    || !Array.isArray(requirements.dependsOnPartLabels) || !requirements.dependsOnPartLabels.length
    || !Array.isArray(grant.dependencies) || !Array.isArray(supplied)
    || currentGrant.schemaVersion !== grant.schemaVersion || currentGrant.fingerprint !== grant.fingerprint
    || !Array.isArray(currentGrant.dependencies) || currentGrant.dependencies.length !== grant.dependencies.length
    || grant.dependencies.length !== requirements.dependsOnPartLabels.length
    || supplied.length !== requirements.dependsOnPartLabels.length) return Object.freeze({ ok: false })
  const dependencies = []
  for (const label of requirements.dependsOnPartLabels) {
    const candidates = (question?.parts || []).filter((item) => item.label === label)
    if (candidates.length !== 1) return Object.freeze({ ok: false })
    const questionPartId = String(candidates[0].partId || '')
    const granted = grant.dependencies.filter((entry) => entry?.questionPartId === questionPartId)
    const current = currentGrant.dependencies.filter((entry) => entry?.questionPartId === questionPartId)
    const provided = supplied.filter((entry) => entry?.questionPartId === questionPartId)
    if (!questionPartId || granted.length !== 1 || current.length !== 1 || provided.length !== 1
      || Object.keys(provided[0]).some((key) => !['questionPartId', 'typedResponse'].includes(key))) return Object.freeze({ ok: false })
    if (!equalDigest(granted[0].workDigest, current[0].workDigest)) return Object.freeze({ ok: false })
    const typedResponse = normalizeScoringContextText(provided[0].typedResponse)
    const digest = scoringContextWorkDigest(signingKey, attemptId, question.sourceQuestionId, questionPartId, typedResponse)
    if (!typedResponse || !equalDigest(granted[0].workDigest, digest)) return Object.freeze({ ok: false })
    dependencies.push(Object.freeze({ questionPartId, label, typedResponse }))
  }
  return Object.freeze({ ok: true, dependencies: Object.freeze(dependencies) })
}

export function hasReadableScoringContextEvidence(assessment, dependencies) {
  if (!dependencies.length) return true
  if (!Array.isArray(assessment?.dependencyEvidence) || assessment.dependencyEvidence.length !== dependencies.length) return false
  return dependencies.every((dependency) => {
    const matches = assessment.dependencyEvidence.filter((entry) => entry?.questionPartId === dependency.questionPartId)
    if (matches.length !== 1 || matches[0].readable !== true || typeof matches[0].quote !== 'string') return false
    const quote = normalizeScoringContextText(matches[0].quote)
    return Boolean(quote && (quote.length >= 3 || quote === dependency.typedResponse) && dependency.typedResponse.includes(quote))
  })
}
