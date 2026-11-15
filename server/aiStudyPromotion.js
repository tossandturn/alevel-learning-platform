import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MARKERS = Object.freeze(['active-safe-manifest.json', 'candidate-manifest.json'])
const ENVELOPE_NAME = 'study-promotion-manifest.json'
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024
const MAX_SIGNED_BYTES = 32 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/
const SAFE_RELATIVE_ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.json$/

function promotionError(code) {
  return Object.assign(new Error('The AI study candidate is not authorized for this catalog.'), { statusCode: 503, code })
}

export function isAiStudyPromotionError(error) {
  return error?.code === 'AI_STUDY_PROMOTION_REQUIRED' || error?.code === 'AI_STUDY_PROMOTION_INVALID'
}

function invalid() {
  throw promotionError('AI_STUDY_PROMOTION_INVALID')
}

function exactKeys(value, keys) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()))
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
 * Legacy roots are unchanged. New candidate roots require an externally
 * trusted Ed25519 public key and a signed, complete artifact inventory.
 */
export function verifyAiStudyPromotion({ artifactRoot, artifactPaths = [], promotionPolicy = null } = {}) {
  const root = path.resolve(String(artifactRoot || ''))
  const mode = promotionPolicy?.mode || 'legacy'
  if (!['legacy', 'signed-candidate'].includes(mode)) invalid()
  const markers = MARKERS.filter((name) => entryExists(root, name))
  const envelopeExists = entryExists(root, ENVELOPE_NAME)
  const blockedExists = entryExists(root, 'BLOCKED.json')
  if (mode === 'legacy') {
    if (markers.length || envelopeExists || blockedExists) throw promotionError('AI_STUDY_PROMOTION_REQUIRED')
    return null
  }
  if (blockedExists || markers.length !== 1 || !envelopeExists) invalid()
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

export function assertPromotedAiStudyGroups(promotion, records, groups) {
  if (!promotion) return
  // This count is a structural condition, not proof of independent review.
  // Release still requires separately authenticated, hash-bound review receipts.
  if (records.length !== promotion.artifactCount || groups.length !== promotion.expectedRouteGroups
    || records.some((record) => record.artifact?.studentRelease?.review?.independentPassCount !== 2)) invalid()
}
