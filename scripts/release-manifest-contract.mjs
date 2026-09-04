const SHA1_PATTERN = /^[a-f0-9]{40}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const RELEASE_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/
const MAX_FUTURE_SKEW_MS = 5 * 60_000

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function validTreeIdentity(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && nonNegativeInteger(value.files)
    && nonNegativeInteger(value.symlinks)
    && nonNegativeInteger(value.bytes)
    && SHA256_PATTERN.test(String(value.sha256 || '')),
  )
}

function validSyllabusScope(value) {
  if (value === undefined) return true
  if (!value || value.schemaVersion !== 'stem-syllabus-release-scope.v1' || !Array.isArray(value.routeIds) || value.routeIds.length === 0) return false
  const routeIds = value.routeIds.map((routeId) => String(routeId || '').trim())
  return routeIds.every((routeId) => /^[A-Za-z0-9._:-]{1,120}$/.test(routeId))
    && new Set(routeIds).size === routeIds.length
}

export function releaseIdMatchesCommit(releaseId, commit) {
  const normalizedReleaseId = String(releaseId || '')
  const normalizedCommit = String(commit || '').toLowerCase()
  return RELEASE_ID_PATTERN.test(normalizedReleaseId)
    && SHA1_PATTERN.test(normalizedCommit)
    && normalizedReleaseId.endsWith(`-${normalizedCommit.slice(0, 7)}`)
}

export function validateBuildIdentity(identity, { commit = '', requireClean = false } = {}) {
  const embeddedCommit = String(identity?.commit || '')
  const sourceState = String(identity?.sourceState || '')
  const expectedCommit = String(commit || '').toLowerCase()
  const valid = Boolean(
    identity
    && identity.schemaVersion === 'stem-build-identity.v1'
    && SHA1_PATTERN.test(embeddedCommit)
    && ['clean', 'dirty'].includes(sourceState)
    && (!expectedCommit || embeddedCommit === expectedCommit)
    && (!requireClean || sourceState === 'clean'),
  )
  return { valid, commit: valid ? embeddedCommit : '', sourceState: valid ? sourceState : '' }
}

export function validateReleaseManifest(manifest, { releaseId = '', now = Date.now() } = {}) {
  const generatedAtMs = Date.parse(String(manifest?.generatedAt || ''))
  const valid = Boolean(
    manifest
    && manifest.schemaVersion === 'stem-release-manifest.v1'
    && RELEASE_ID_PATTERN.test(String(manifest.releaseId || ''))
    && (!releaseId || manifest.releaseId === releaseId)
    && SHA1_PATTERN.test(String(manifest.commit || ''))
    && releaseIdMatchesCommit(manifest.releaseId, manifest.commit)
    && SHA256_PATTERN.test(String(manifest.packageSha256 || ''))
    && Number.isFinite(generatedAtMs)
    && generatedAtMs <= now + MAX_FUTURE_SKEW_MS
    && validTreeIdentity(manifest.releaseTree)
    && typeof manifest.immutableAssets?.identity === 'string'
    && manifest.immutableAssets.identity.length > 0
    && validTreeIdentity(manifest.immutableAssets)
    && validSyllabusScope(manifest.syllabusScope),
  )
  return { valid, generatedAtMs: valid ? generatedAtMs : null }
}

export function sameTreeIdentity(left, right) {
  return Boolean(
    validTreeIdentity(left)
    && validTreeIdentity(right)
    && left.files === right.files
    && left.symlinks === right.symlinks
    && left.bytes === right.bytes
    && left.sha256 === right.sha256,
  )
}
