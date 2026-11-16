import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

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

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key))
}

function isCanonicalAbsolutePath(value) {
  return (path.posix.isAbsolute(value) && path.posix.resolve(value) === value)
    || (path.win32.isAbsolute(value) && path.win32.resolve(value) === value)
}

export function validRuntimeDataBinding(value) {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (!hasOnlyKeys(value, new Set(['schemaVersion', 'relativePath', 'target']))) return false
  const target = String(value.target || '')
  return value.schemaVersion === 'stem-runtime-data-binding.v1'
    && value.relativePath === 'data'
    && isCanonicalAbsolutePath(target)
}

function validTopicScopes(value, routeIds, readinessMode) {
  if (value === undefined) return true
  if (!['student-study', 'chapter-study'].includes(readinessMode) || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  if (entries.length === 0) return false
  const declaredRoutes = new Set(routeIds)
  return entries.every(([routeId, topicIds]) => (
    routeId === routeId.trim()
    && /^[A-Za-z0-9._:-]{1,120}$/.test(routeId)
    && declaredRoutes.has(routeId)
    && Array.isArray(topicIds)
    && topicIds.length > 0
    && topicIds.every((topicId) => (
      typeof topicId === 'string'
      && topicId === topicId.trim()
      && /^[A-Za-z0-9._-]{1,160}$/.test(topicId)
    ))
    && new Set(topicIds).size === topicIds.length
  ))
}

export function validChapterStudyPackBinding(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && hasOnlyKeys(value, new Set(['schemaVersion', 'relativePath', 'manifestSha256']))
    && value.schemaVersion === 'stem-release-study-pack-binding.v1'
    && typeof value.relativePath === 'string'
    && /^data\/ai-study-packs\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value.relativePath)
    && SHA256_PATTERN.test(String(value.manifestSha256 || '')))
}

function validSyllabusScope(value) {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.schemaVersion === 'stem-syllabus-release-scope.v2') {
    const chapter = value.chapterStudy, baselineIdentity = value.baselineIdentity
    if (!hasOnlyKeys(value, new Set(['schemaVersion', 'baseline', 'baselineIdentity', 'chapterStudy']))
      || value.baseline?.schemaVersion !== 'stem-syllabus-release-scope.v1' || !validSyllabusScope(value.baseline)
      || !baselineIdentity || typeof baselineIdentity !== 'object' || Array.isArray(baselineIdentity)
      || !hasOnlyKeys(baselineIdentity, new Set(['releaseId', 'commit', 'manifestSha256']))
      || !releaseIdMatchesCommit(baselineIdentity.releaseId, baselineIdentity.commit)
      || !SHA256_PATTERN.test(String(baselineIdentity.manifestSha256 || ''))
      || !chapter || typeof chapter !== 'object' || Array.isArray(chapter)
      || !hasOnlyKeys(chapter, new Set(['schemaVersion', 'routeIds', 'topicScopes', 'formalProgressEligible', 'packBinding']))
      || chapter.schemaVersion !== 'stem-chapter-study-release-scope.v1' || chapter.formalProgressEligible !== false
      || !validChapterStudyPackBinding(chapter.packBinding)
      || !Array.isArray(chapter.routeIds) || !chapter.routeIds.length
      || chapter.routeIds.some((routeId) => typeof routeId !== 'string' || routeId !== routeId.trim() || !/^[A-Za-z0-9._:-]{1,120}$/.test(routeId))
      || new Set(chapter.routeIds).size !== chapter.routeIds.length || !chapter.topicScopes
      || Object.keys(chapter.topicScopes).length !== chapter.routeIds.length
      || chapter.routeIds.some((routeId) => !Object.hasOwn(chapter.topicScopes, routeId))) return false
    return validTopicScopes(chapter.topicScopes, chapter.routeIds, 'chapter-study')
  }
  if (!hasOnlyKeys(value, new Set(['schemaVersion', 'routeIds', 'readinessMode', 'aiStudyFormalProgressEligible', 'topicScopes']))
    || value.schemaVersion !== 'stem-syllabus-release-scope.v1'
    || !Array.isArray(value.routeIds) || value.routeIds.length === 0) return false
  if (value.routeIds.some((routeId) => typeof routeId !== 'string' || routeId !== routeId.trim())) return false
  const routeIds = value.routeIds
  const hasReadinessMode = Object.hasOwn(value, 'readinessMode')
  const hasFormalFlag = Object.hasOwn(value, 'aiStudyFormalProgressEligible')
  if (hasReadinessMode !== hasFormalFlag) return false
  if (hasReadinessMode && (!['formal', 'student-study'].includes(value.readinessMode) || value.aiStudyFormalProgressEligible !== false)) return false
  return routeIds.every((routeId) => /^[A-Za-z0-9._:-]{1,120}$/.test(routeId))
    && new Set(routeIds).size === routeIds.length
    && validTopicScopes(value.topicScopes, routeIds, value.readinessMode)
}

export function baselineSyllabusScopeMatches(scope, baselineManifest, manifestSha256) {
  return Boolean(scope?.schemaVersion === 'stem-syllabus-release-scope.v2'
    && baselineManifest?.syllabusScope?.schemaVersion === 'stem-syllabus-release-scope.v1'
    && validSyllabusScope(scope) && validateReleaseManifest(baselineManifest).valid
    && scope.baselineIdentity.releaseId === baselineManifest.releaseId
    && scope.baselineIdentity.commit === baselineManifest.commit
    && scope.baselineIdentity.manifestSha256 === manifestSha256
    && isDeepStrictEqual(scope.baseline, baselineManifest.syllabusScope))
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
    && validRuntimeDataBinding(manifest.runtimeData)
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
