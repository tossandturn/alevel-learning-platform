import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MARKERS = Object.freeze(['active-safe-manifest.json', 'candidate-manifest.json'])
const ENVELOPE_NAME = 'study-promotion-manifest.json'
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024
const MAX_SIGNED_BYTES = 32 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SAFE_RELATIVE_ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.json$/
const REFERENCE_MATERIAL_DELIVERY = Object.freeze({
  schemaVersion: 'stem-ai-reference-material-delivery.v1',
  renderer: 'native-question-images',
  clientCapability: 'region-v2',
  coordinateContract: 'normalized-rotation-v1',
  authorization: 'released-question-bank-only',
  markingContext: 'part-source-evidence-v1',
})

function promotionError(code) {
  return Object.assign(new Error('The AI study candidate is not authorized for this catalog.'), { statusCode: 503, code })
}

export function isAiStudyPromotionError(error) {
  return error?.code === 'AI_STUDY_PROMOTION_REQUIRED' || error?.code === 'AI_STUDY_PROMOTION_INVALID'
    || error?.code === 'AI_STUDY_CANDIDATE_BLOCKED' || error?.code === 'AI_STUDY_LEGACY_UNAVAILABLE'
}

function invalid() {
  throw promotionError('AI_STUDY_PROMOTION_INVALID')
}

function exactKeys(value, keys) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()))
}

function validReferenceMaterialDelivery(value) {
  return exactKeys(value, Object.keys(REFERENCE_MATERIAL_DELIVERY))
    && Object.entries(REFERENCE_MATERIAL_DELIVERY).every(([key, expected]) => value[key] === expected)
}

function canonicalBase64(value, maxBytes) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) invalid()
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== value) invalid()
  return bytes
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function readWithinRoot(root, relative, limit) {
  const candidate = path.resolve(root, ...relative.split('/'))
  const relativeToRoot = path.relative(root, candidate)
  if (!relativeToRoot || path.isAbsolute(relativeToRoot) || relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`)) invalid()
  let descriptor
  try {
    let segmentPath = root
    for (const segment of relative.split('/')) {
      segmentPath = path.join(segmentPath, segment)
      if (fs.lstatSync(segmentPath).isSymbolicLink()) invalid()
    }
    const linkStat = fs.lstatSync(candidate)
    if (!linkStat.isFile() || linkStat.isSymbolicLink() || linkStat.size <= 0 || linkStat.size > limit) invalid()
    const realRoot = fs.realpathSync(root)
    const realFile = fs.realpathSync(candidate)
    const realRelative = path.relative(realRoot, realFile)
    if (!realRelative || path.isAbsolute(realRelative) || realRelative === '..' || realRelative.startsWith(`..${path.sep}`)) invalid()
    descriptor = fs.openSync(realFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit) invalid()
    const bytes = fs.readFileSync(descriptor)
    if (bytes.length !== stat.size) invalid()
    return bytes
  } catch (error) {
    if (error?.code === 'AI_STUDY_PROMOTION_INVALID') throw error
    invalid()
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function parseJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8')) } catch { invalid() }
}

function entryExists(root, name) {
  try { fs.lstatSync(path.join(root, name)); return true }
  catch (error) { if (error?.code === 'ENOENT') return false; invalid() }
}

/**
 * Non-reference legacy roots are unchanged. Reference-bearing content must
 * use a capability-bound release pack; signed candidates still reject it.
 */
export function verifyAiStudyPromotion({ artifactRoot, artifactPaths = [], promotionPolicy = null } = {}) {
  const root = path.resolve(String(artifactRoot || ''))
  const mode = promotionPolicy?.mode || 'legacy'
  if (!['legacy', 'signed-candidate', 'release-pinned'].includes(mode)) invalid()
  const markers = MARKERS.filter((name) => entryExists(root, name))
  const envelopeExists = entryExists(root, ENVELOPE_NAME)
  const blockedExists = entryExists(root, 'BLOCKED.json')
  if (mode === 'legacy') {
    if (markers.length || envelopeExists || blockedExists) throw promotionError('AI_STUDY_PROMOTION_REQUIRED')
    return null
  }
  // This is a fail-closed operational signal, not an authenticated revocation.
  if (blockedExists) throw promotionError('AI_STUDY_CANDIDATE_BLOCKED')
  if (mode === 'release-pinned') {
    const pin = promotionPolicy?.trustedManifestSha256, expectedRoot = promotionPolicy?.expectedRealRoot
    if (!SHA256.test(String(pin || '')) || typeof expectedRoot !== 'string' || !expectedRoot
      || markers.length !== 1 || markers[0] !== 'candidate-manifest.json' || envelopeExists) invalid()
    let rootStat, realRoot
    try { rootStat = fs.lstatSync(root); realRoot = fs.realpathSync(root) } catch { invalid() }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realRoot !== expectedRoot) invalid()
    const bytes = readWithinRoot(root, markers[0], MAX_MANIFEST_BYTES), pack = parseJson(bytes)
    const packV1 = pack?.schemaVersion === 'stem-ai-study-release-pack.v1'
      && exactKeys(pack, ['schemaVersion', 'scope', 'formalProgressEligible', 'routeIds', 'expectedRouteGroups', 'artifacts'])
    const packV2 = pack?.schemaVersion === 'stem-ai-study-release-pack.v2'
      && exactKeys(pack, ['schemaVersion', 'scope', 'formalProgressEligible', 'routeIds', 'expectedRouteGroups',
        'referenceMaterialDelivery', 'artifacts'])
      && validReferenceMaterialDelivery(pack.referenceMaterialDelivery)
    if (digest(bytes) !== pin || (!packV1 && !packV2) || pack.scope !== 'chapter-study'
      || pack.formalProgressEligible !== false || !Array.isArray(pack.routeIds) || !pack.routeIds.length
      || pack.routeIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9-]{1,120}$/.test(id))
      || new Set(pack.routeIds).size !== pack.routeIds.length
      || !Number.isInteger(pack.expectedRouteGroups) || pack.expectedRouteGroups < 1 || pack.expectedRouteGroups > 100000
      || !Array.isArray(pack.artifacts) || !pack.artifacts.length || pack.artifacts.length > 10000) invalid()
    if (!Array.isArray(promotionPolicy.expectedRouteIds)
      || JSON.stringify([...pack.routeIds].sort()) !== JSON.stringify([...promotionPolicy.expectedRouteIds].sort())) invalid()
    const declared = new Map()
    for (const item of pack.artifacts) {
      if (!exactKeys(item, ['path', 'sha256']) || typeof item.path !== 'string'
        || !SAFE_RELATIVE_ARTIFACT.test(item.path) || !SHA256.test(String(item.sha256 || '')) || declared.has(item.path)) invalid()
      declared.set(item.path, item.sha256)
    }
    const actualPaths = artifactPaths.map((file) => path.relative(root, file).split(path.sep).join('/')).sort()
    if (JSON.stringify(actualPaths) !== JSON.stringify([...declared.keys()].sort())) invalid()
    const bytesByPath = new Map(); let totalBytes = 0
    for (const [relative, expected] of declared) {
      const content = readWithinRoot(root, relative, MAX_ARTIFACT_BYTES)
      totalBytes += content.length
      if (totalBytes > MAX_SIGNED_BYTES || digest(content) !== expected) invalid()
      bytesByPath.set(relative, content)
    }
    return Object.freeze({ bytesByPath, artifactCount: declared.size, expectedRouteGroups: pack.expectedRouteGroups,
      routeIds: Object.freeze([...pack.routeIds]), manifestSha256: digest(bytes),
      referenceMaterialDelivery: packV2 ? Object.freeze({ ...pack.referenceMaterialDelivery }) : null })
  }
  if (markers.length !== 1 || !envelopeExists) invalid()
  const markerName = markers[0]
  const markerBytes = readWithinRoot(root, markerName, MAX_MANIFEST_BYTES)
  const marker = parseJson(markerBytes)
  if (marker?.schemaVersion !== 'stem-ai-study-candidate-manifest.v1'
    || marker?.status !== 'approved' || marker?.productionEligible !== true || marker?.formalProgressEligible !== false) invalid()

  const envelope = parseJson(readWithinRoot(root, ENVELOPE_NAME, MAX_MANIFEST_BYTES))
  if (!exactKeys(envelope, ['schemaVersion', 'payloadBase64', 'signature'])
    || envelope.schemaVersion !== 'stem-ai-study-promotion-envelope.v1'
    || !exactKeys(envelope.signature, ['algorithm', 'keyId', 'value'])
    || envelope.signature.algorithm !== 'Ed25519'
    || typeof envelope.signature.keyId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(envelope.signature.keyId)) invalid()
  const keys = promotionPolicy?.trustedPublicKeys
  if (!keys || typeof keys !== 'object' || !Object.hasOwn(keys, envelope.signature.keyId)) invalid()
  let publicKey
  try {
    const value = keys[envelope.signature.keyId]
    publicKey = value instanceof crypto.KeyObject ? value : crypto.createPublicKey(value)
  } catch { invalid() }
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') invalid()
  const payloadBytes = canonicalBase64(envelope.payloadBase64, MAX_MANIFEST_BYTES)
  const signature = canonicalBase64(envelope.signature.value, 64)
  if (signature.length !== 64) invalid()
  try { if (!crypto.verify(null, payloadBytes, publicKey, signature)) invalid() }
  catch { invalid() }
  const payload = parseJson(payloadBytes)
  if (!exactKeys(payload, ['schemaVersion', 'status', 'scope', 'formalProgressEligible', 'expectedRouteGroups', 'candidateManifest', 'artifacts'])
    || payload.schemaVersion !== 'stem-ai-study-promotion.v1' || payload.status !== 'approved'
    || payload.scope !== 'student-study-only' || payload.formalProgressEligible !== false
    || !Number.isInteger(payload.expectedRouteGroups) || payload.expectedRouteGroups < 1 || payload.expectedRouteGroups > 100000
    || !exactKeys(payload.candidateManifest, ['path', 'sha256']) || payload.candidateManifest.path !== markerName
    || !SHA256.test(String(payload.candidateManifest.sha256 || '')) || payload.candidateManifest.sha256 !== digest(markerBytes)
    || !Array.isArray(payload.artifacts) || !payload.artifacts.length || payload.artifacts.length > 10000) invalid()

  const signedFiles = new Map()
  for (const entry of payload.artifacts) {
    if (!exactKeys(entry, ['path', 'sha256']) || typeof entry.path !== 'string'
      || !SAFE_RELATIVE_ARTIFACT.test(entry.path) || !SHA256.test(String(entry.sha256 || '')) || signedFiles.has(entry.path)) invalid()
    signedFiles.set(entry.path, entry.sha256)
  }
  const actualPaths = artifactPaths.map((file) => path.relative(root, file).split(path.sep).join('/')).sort()
  const declaredPaths = [...signedFiles.keys()].sort()
  if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) invalid()
  const bytesByPath = new Map()
  let totalBytes = 0
  for (const relative of declaredPaths) {
    const bytes = readWithinRoot(root, relative, MAX_ARTIFACT_BYTES)
    totalBytes += bytes.length
    if (totalBytes > MAX_SIGNED_BYTES || digest(bytes) !== signedFiles.get(relative)) invalid()
    bytesByPath.set(relative, bytes)
  }
  return Object.freeze({ bytesByPath, artifactCount: declaredPaths.length,
    expectedRouteGroups: payload.expectedRouteGroups, manifestSha256: digest(payloadBytes) })
}

function reviewSessionMatches(session, reviewer) {
  const outputHash = session?.outputSha256 || session?.fullReviewSha256 || session?.questionReviewSha256 || session?.reviewBinding?.outputSha256
  const sessionHash = session?.sessionLogSha256 || session?.sessionLog?.sha256
  return Boolean(session && typeof session.sessionId === 'string' && UUID.test(session.sessionId)
    && typeof session.turnId === 'string' && UUID.test(session.turnId)
    && session.modelProvider === reviewer?.provider && session.model === reviewer?.model
    && SHA256.test(String(sessionHash || '')) && SHA256.test(String(outputHash || '')))
}

function hasBoundReviewSessions(artifact) {
  const review = artifact?.studentRelease?.review
  if (review?.method === 'single-model-source-review') {
    const session = artifact.sourceReview?.runtimeAttestation?.finalSourceReview || artifact.sourceReview?.runtimeAttestation
    return review.independentPassCount === 1 && reviewSessionMatches(session, artifact.sourceReview)
  }
  if (review?.independentPassCount !== 2) return false
  const supplemented = review?.method === 'single-model-plus-independent-source-review'
  const firstReviewer = supplemented ? artifact.sourceReview : artifact.extractor
  const secondReviewer = supplemented ? artifact.independentReview : artifact.verifier
  const first = supplemented ? artifact.sourceReview?.runtimeAttestation?.finalSourceReview : artifact.extractor?.runtimeAttestation
  const second = supplemented ? artifact.independentReview?.providerAttestation : artifact.verifier?.runtimeAttestation
  return reviewSessionMatches(first, firstReviewer) && reviewSessionMatches(second, secondReviewer)
    && String(first.sessionId).toLowerCase() !== String(second.sessionId).toLowerCase()
    && String(first.turnId).toLowerCase() !== String(second.turnId).toLowerCase()
}

function referenceTuple(entry) {
  const page = Number(entry?.page)
  const pageImageSha256 = String(entry?.pageImageSha256 || '').toLowerCase()
  const region = Array.isArray(entry?.region) ? entry.region.map(Number)
    : ['x0', 'y0', 'x1', 'y1'].map((key) => Number(entry?.[key]))
  const partLabels = Array.isArray(entry?.partLabels) ? [...entry.partLabels].map(String).sort() : []
  const rotationDegrees = entry?.rotationDegrees == null ? 0 : Number(entry.rotationDegrees)
  if (!Number.isInteger(page) || page < 1 || !SHA256.test(pageImageSha256)
    || region.length !== 4 || !region.every(Number.isFinite)
    || region[0] < 0 || region[1] < 0 || region[2] > 1 || region[3] > 1
    || region[0] >= region[2] || region[1] >= region[3]
    || !partLabels.length || ![0, 90, 180, 270].includes(rotationDegrees)) return null
  return JSON.stringify([page, pageImageSha256, region, partLabels, rotationDegrees])
}

function exactReferenceTuples(entries) {
  const tuples = entries.map(referenceTuple)
  return tuples.every(Boolean) && new Set(tuples).size === tuples.length ? tuples.sort() : null
}

function hasBoundedNativeImageProjection(group) {
  const sourceHash = String(group?.sourceRef?.sha256 || '').replace(/^sha256:/i, '').toLowerCase()
  const parts = Array.isArray(group?.parts) ? group.parts : []
  const diagrams = Array.isArray(group?.diagramRegions) ? group.diagramRegions : []
  const records = [
    ...parts.flatMap((part) => Array.isArray(part?.sourceEvidence) ? part.sourceEvidence : []),
    ...diagrams,
  ]
  if (!SHA256.test(sourceHash) || !records.length || records.length > 200) return false
  const tuples = records.map((entry) => {
    const page = Number(entry?.page), pageHash = String(entry?.pageImageSha256 || '').toLowerCase()
    const documentHash = String(entry?.documentSha256 || '').toLowerCase()
    const region = Array.isArray(entry?.region) ? entry.region.map(Number) : []
    const imageSize = Array.isArray(entry?.imageSize) ? entry.imageSize.map(Number) : []
    const rotation = entry?.rotationDegrees == null ? 0 : Number(entry.rotationDegrees)
    if (!Number.isInteger(page) || page < 1 || page > 1000 || !SHA256.test(pageHash)
      || documentHash !== sourceHash || entry?.coordinateSpace !== 'normalized-xyxy'
      || region.length !== 4 || !region.every(Number.isFinite)
      || region[0] < 0 || region[1] < 0 || region[2] > 1 || region[3] > 1
      || region[0] >= region[2] || region[1] >= region[3]
      || imageSize.length !== 2 || !imageSize.every((value) => Number.isInteger(value) && value > 0 && value <= 10000)
      || imageSize[0] * imageSize[1] > 24_000_000 || ![0, 90, 180, 270].includes(rotation)) return null
    return JSON.stringify([page, pageHash, region, imageSize, rotation])
  })
  if (tuples.some((tuple) => !tuple)) return false
  // The renderer can merge redundant regions, but promotion uses a stricter
  // exact-unique budget so it can never authorize a zero-descriptor result.
  return new Set(tuples).size <= 20
}

function hasUndeliverableReference(artifact, promotion, groupByIdentity) {
  const declared = (value) => value != null && (!Array.isArray(value) || value.length > 0)
  const list = (value) => Array.isArray(value) ? value : []
  const documents = [artifact.candidate, artifact.verification]
  const hasReference = documents.some((document) =>
    document?.needsReferenceMaterial === true || declared(document?.examReference) || declared(document?.referenceMaterialRegions)
    || list(document?.questions).some((question) => declared(question?.examReference)
      || question?.needsReferenceMaterial === true || declared(question?.referenceMaterialRegions)
      || list(question?.parts).some((part) => part?.needsReferenceMaterial === true || declared(part?.referenceMaterialRegions))))
  if (!hasReference) return false
  if (!validReferenceMaterialDelivery(promotion?.referenceMaterialDelivery)) return true
  if (documents.some((document) => document?.needsReferenceMaterial === true
    || declared(document?.examReference) || declared(document?.referenceMaterialRegions))) return true

  const byNumber = (document) => new Map(list(document?.questions)
    .map((question) => [String(question?.questionNumber || ''), question]))
  const candidateByNumber = byNumber(artifact.candidate)
  const verificationByNumber = byNumber(artifact.verification)
  const declaresReference = (question) => declared(question?.examReference)
    || question?.needsReferenceMaterial === true || declared(question?.referenceMaterialRegions)
    || list(question?.parts).some((part) => part?.needsReferenceMaterial === true
      || declared(part?.referenceMaterialRegions))
  const questionNumbers = new Set([...candidateByNumber.keys(), ...verificationByNumber.keys()])
  for (const number of questionNumbers) {
    const question = candidateByNumber.get(number)
    const verification = verificationByNumber.get(number)
    const candidateDeclaresReference = declaresReference(question)
    const verificationDeclaresReference = declaresReference(verification)
    if (candidateDeclaresReference !== verificationDeclaresReference) return true
    if (!candidateDeclaresReference) continue
    const candidateReferenceRegions = list(question?.referenceMaterialRegions)
    const verificationReferenceRegions = list(verification?.referenceMaterialRegions)
    const referenceParts = list(question?.parts).filter((part) => part?.needsReferenceMaterial === true)
    if (!question || !verification || declared(question.examReference) || question.needsReferenceMaterial === true
      || declared(verification.examReference) || verification.needsReferenceMaterial === true
      || list(question.parts).some((part) => declared(part?.referenceMaterialRegions))
      || list(verification.parts).some((part) => declared(part?.referenceMaterialRegions))
      || question.referenceMaterialEvidenceSchemaVersion !== 'stem-ai-reference-material-evidence.v1'
      || verification.referenceMaterialEvidenceSchemaVersion !== 'stem-ai-reference-material-evidence.v1') return true
    const sourceQuestionId = `${artifact.paperId}:q${number}`
    const group = groupByIdentity.get(JSON.stringify([artifact.syllabusRouteId, sourceQuestionId]))
    const candidateTuples = exactReferenceTuples(candidateReferenceRegions)
    const verificationTuples = exactReferenceTuples(verificationReferenceRegions)
    const groupTuples = exactReferenceTuples(list(group?.referenceMaterialRegions))
    if (!group || !hasBoundedNativeImageProjection(group)
      || !candidateTuples?.length || !verificationTuples?.length || !groupTuples?.length
      || JSON.stringify(candidateTuples) !== JSON.stringify(verificationTuples)
      || JSON.stringify(candidateTuples) !== JSON.stringify(groupTuples)) return true
    const verificationParts = new Map(list(verification.parts).map((part) => [String(part?.label || ''), part]))
    for (const part of referenceParts) {
      const groupPart = list(group.parts).find((entry) => entry.label === part.label)
      const verifiedPart = verificationParts.get(String(part.label || ''))
      const expectedPartTuples = exactReferenceTuples(candidateReferenceRegions
        .filter((entry) => list(entry?.partLabels).map(String).includes(String(part.label))))
      const groupPartTuples = exactReferenceTuples(list(groupPart?.sourceEvidence)
        .filter((entry) => entry?.evidenceRole === 'reference-material'))
      if (verifiedPart?.needsReferenceMaterial !== true || !groupPart?.needsReferenceMaterial
        || !expectedPartTuples?.length || !groupPartTuples?.length
        || JSON.stringify(expectedPartTuples) !== JSON.stringify(groupPartTuples)) return true
    }
  }
  return false
}

function hasDuplicateSourceIds(records) {
  const seen = new Set()
  for (const { artifact } of records) {
    for (const question of Array.isArray(artifact?.candidate?.questions) ? artifact.candidate.questions : []) {
      const sourceId = `${artifact.paperId}:q${question.questionNumber}`
      if (question.sourceQuestionId != null && question.sourceQuestionId !== sourceId) return true
      const key = JSON.stringify([artifact.syllabusRouteId, sourceId])
      if (seen.has(key)) return true
      seen.add(key)
    }
  }
  return false
}

export function assertPromotedAiStudyGroups(promotion, records, groups) {
  const groupByIdentity = new Map(groups.map((group) => [JSON.stringify([group.routeId, group.sourceQuestionId]), group]))
  if (!promotion) {
    if (records.some((record) => hasUndeliverableReference(record.artifact, null, groupByIdentity))) invalid()
    return
  }
  // These are structural conditions, not proof that a review occurred.
  // The authorized signer must independently verify the referenced receipts.
  if (records.length !== promotion.artifactCount || groups.length !== promotion.expectedRouteGroups || hasDuplicateSourceIds(records)
    || groupByIdentity.size !== groups.length
    || (promotion.routeIds && groups.some((group) => !promotion.routeIds.includes(group.routeId)))
    || records.some((record) => hasUndeliverableReference(record.artifact, promotion, groupByIdentity)
      || !hasBoundReviewSessions(record.artifact))) invalid()
}
