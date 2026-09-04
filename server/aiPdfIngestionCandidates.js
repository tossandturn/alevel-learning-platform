import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  artifactId,
  hasValidAiStudentStudyRelease,
  resolveArtifactSourcePdfPath,
} from '../scripts/ai-pdf-ingestion/contract.mjs'

export const AI_PDF_INGESTION_CANDIDATE_SCHEMA_VERSION = 'ai-pdf-ingestion-candidates.v1'

const HASH_PATTERN = /^(?:sha256:)?([a-fA-F0-9]{64})$/
const ARTIFACT_ID_PATTERN = /^sha256:[a-f0-9]{64}$/
const ARTIFACT_FILENAME_PATTERN = /^([a-f0-9]{64})(?:--([A-Za-z0-9][A-Za-z0-9._-]{0,96}))?\.json$/i
const SAFE_ARTIFACT_SUFFIX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,96}$/
const ALLOWED_STATUSES = new Set(['ai-verified', 'auto-quarantined'])
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024
const MAX_ARTIFACTS = 2_000

export function resolveAiPdfIngestionRoot(env = process.env, cwd = process.cwd()) {
  const configured = typeof env?.AI_PDF_INGESTION_ROOT === 'string' && env.AI_PDF_INGESTION_ROOT.trim()
    ? env.AI_PDF_INGESTION_ROOT.trim()
    : path.join(cwd, 'data', 'ai-pdf-ingestion')
  return path.resolve(cwd, configured)
}

export function listAiPdfIngestionCandidates({ root, libraryRoot = null } = {}) {
  const resolvedRoot = path.resolve(root || resolveAiPdfIngestionRoot())
  if (!fs.existsSync(resolvedRoot)) {
    return emptyListing('not-configured')
  }
  if (!fs.statSync(resolvedRoot).isDirectory()) {
    return emptyListing('unavailable')
  }

  const entries = []
  for (const paperEntry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
    if (!paperEntry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(paperEntry.name)) continue
    const paperDirectory = path.join(resolvedRoot, paperEntry.name)
    for (const artifactEntry of fs.readdirSync(paperDirectory, { withFileTypes: true })) {
      if (!artifactEntry.isFile() || !ARTIFACT_FILENAME_PATTERN.test(artifactEntry.name)) continue
      entries.push(toSafeCandidate(path.join(paperDirectory, artifactEntry.name), paperEntry.name, libraryRoot))
      if (entries.length >= MAX_ARTIFACTS) break
    }
    if (entries.length >= MAX_ARTIFACTS) break
  }

  const counts = { 'ai-verified': 0, 'auto-quarantined': 0 }
  for (const entry of entries) counts[entry.status] += 1
  return {
    schemaVersion: AI_PDF_INGESTION_CANDIDATE_SCHEMA_VERSION,
    rootStatus: 'ready',
    counts,
    candidates: entries.sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
  }
}

function emptyListing(rootStatus) {
  return {
    schemaVersion: AI_PDF_INGESTION_CANDIDATE_SCHEMA_VERSION,
    rootStatus,
    counts: { 'ai-verified': 0, 'auto-quarantined': 0 },
    candidates: [],
  }
}

function toSafeCandidate(artifactPath, paperDirectoryName, libraryRoot) {
  let artifact
  try {
    const stat = fs.statSync(artifactPath)
    if (stat.size <= 0 || stat.size > MAX_ARTIFACT_BYTES) throw new Error('ARTIFACT_SIZE_INVALID')
    artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  } catch {
    return invalidCandidate(paperDirectoryName, 'ARTIFACT_INVALID')
  }

  const declaredStatus = ALLOWED_STATUSES.has(artifact?.status) ? artifact.status : null
  const reasonCodes = new Set(safeReasonCodes(artifact?.reasonCodes))
  const source = artifact?.source
  const paperId = safeText(artifact?.paperId || source?.paperId, paperDirectoryName, 160)
  const questionPdfSha256 = normalizeHash(source?.questionPdfSha256)
  const markSchemePdfSha256 = normalizeHash(source?.markSchemePdfSha256)
  const computedId = paperId && questionPdfSha256 && markSchemePdfSha256
    ? artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })
    : null
  const artifactName = path.basename(artifactPath)
  const filenameMatch = ARTIFACT_FILENAME_PATTERN.exec(artifactName)
  const filenameArtifactId = filenameMatch ? `sha256:${filenameMatch[1].toLowerCase()}` : null
  const filenameSuffix = filenameMatch?.[2] || null
  const declaredArtifactId = typeof artifact?.artifactId === 'string' ? artifact.artifactId : filenameArtifactId
  if (!ARTIFACT_ID_PATTERN.test(declaredArtifactId) || declaredArtifactId !== computedId) {
    reasonCodes.add('ARTIFACT_ID_MISMATCH')
  }
  if (!filenameArtifactId || filenameArtifactId !== declaredArtifactId) reasonCodes.add('ARTIFACT_FILENAME_ID_MISMATCH')
  if (artifact?.artifactSuffix !== undefined
    && artifact?.artifactSuffix !== null
    && (!SAFE_ARTIFACT_SUFFIX.test(String(artifact.artifactSuffix)) || filenameSuffix !== String(artifact.artifactSuffix))) {
    reasonCodes.add('ARTIFACT_SUFFIX_MISMATCH')
  }

  let effectiveStatus = declaredStatus || 'auto-quarantined'
  if (!declaredStatus) reasonCodes.add('ARTIFACT_STATUS_INVALID')
  if (!paperId) reasonCodes.add('PAPER_ID_INVALID')
  if (!questionPdfSha256) reasonCodes.add('QUESTION_PDF_SHA256_INVALID')
  if (!markSchemePdfSha256) reasonCodes.add('MARK_SCHEME_PDF_SHA256_INVALID')

  let questionCount = Array.isArray(artifact?.candidate?.questions)
    ? artifact.candidate.questions.length
    : 0
  let assetCount = Array.isArray(artifact?.assets) ? artifact.assets.length : 0
  if (effectiveStatus === 'ai-verified') {
    const integrityCheck = artifact?.storageMode === 'coordinate-only'
      ? validateCoordinateSources(artifact, libraryRoot)
      : validateAssets(artifactPath, artifact, declaredArtifactId)
    for (const reason of integrityCheck.reasonCodes) reasonCodes.add(reason)
    assetCount = integrityCheck.assetCount
    if (!questionCount) reasonCodes.add('QUESTIONS_MISSING')
    if (reasonCodes.size) effectiveStatus = 'auto-quarantined'
  } else {
    questionCount = Math.max(0, questionCount)
    assetCount = Math.max(0, assetCount)
  }

  return {
    artifactId: declaredArtifactId,
    artifactSuffix: filenameSuffix,
    paperId,
    subject: safeText(artifact?.subject, null, 40),
    status: effectiveStatus,
    declaredStatus: declaredStatus || 'invalid',
    studentEligibility: effectiveStatus === 'ai-verified'
      ? hasValidAiStudentStudyRelease(artifact) ? 'study-released' : 'requires-human-review'
      : 'blocked',
    questionCount,
    assetCount,
    source: questionPdfSha256 && markSchemePdfSha256
      ? { questionPdfSha256, markSchemePdfSha256 }
      : null,
    reasonCodes: [...reasonCodes].sort(),
  }
}

function validateAssets(artifactPath, artifact, declaredArtifactId) {
  const reasonCodes = new Set()
  const assets = Array.isArray(artifact?.assets) ? artifact.assets : []
  const artifactRoot = path.dirname(artifactPath)
  const suffix = SAFE_ARTIFACT_SUFFIX.test(String(artifact?.artifactSuffix || ''))
    ? String(artifact.artifactSuffix)
    : ''
  const assetStem = `${declaredArtifactId.slice('sha256:'.length)}${suffix ? `--${suffix}` : ''}`
  const assetRoot = path.resolve(artifactRoot, `${assetStem}.assets`)
  const seen = new Set()
  let validCount = 0

  for (const asset of assets) {
    const recordedPath = typeof asset?.questionPdfPath === 'string' ? path.resolve(asset.questionPdfPath) : ''
    const relative = recordedPath ? path.relative(assetRoot, recordedPath) : '..'
    if (!recordedPath || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`) || seen.has(recordedPath)) {
      reasonCodes.add('ASSET_PATH_INVALID')
      continue
    }
    seen.add(recordedPath)
    const stat = fs.statSync(recordedPath, { throwIfNoEntry: false })
    if (!stat?.isFile() || stat.size <= 0) {
      reasonCodes.add('ASSET_MISSING')
      continue
    }
    const bytes = fs.readFileSync(recordedPath)
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      reasonCodes.add('ASSET_NOT_PDF')
      continue
    }
    const expectedHash = normalizeHash(asset.questionPdfSha256)
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex')
    if (!expectedHash || expectedHash !== actualHash) {
      reasonCodes.add('ASSET_SHA256_MISMATCH')
      continue
    }
    validCount += 1
  }
  if (!assets.length) reasonCodes.add('ASSETS_MISSING')
  if (validCount !== assets.length) reasonCodes.add('ASSET_SET_INCOMPLETE')
  return { reasonCodes, assetCount: validCount }
}

function validateCoordinateSources(artifact, libraryRoot) {
  const reasonCodes = new Set()
  const source = artifact?.source || {}
  const sourceFiles = [
    {
      path: resolveArtifactSourcePdfPath({
        source,
        absoluteField: 'questionPdfPath',
        relativeField: 'questionPdfRelativePath',
        libraryRoot,
        subjectCode: artifact?.subject,
      }),
      sha256: normalizeHash(source.questionPdfSha256),
    },
    {
      path: resolveArtifactSourcePdfPath({
        source,
        absoluteField: 'markSchemePdfPath',
        relativeField: 'markSchemePdfRelativePath',
        libraryRoot,
        subjectCode: artifact?.subject,
      }),
      sha256: normalizeHash(source.markSchemePdfSha256),
    },
  ]

  for (const sourceFile of sourceFiles) {
    const sourcePath = typeof sourceFile.path === 'string' && sourceFile.path.trim()
      ? path.resolve(sourceFile.path)
      : ''
    if (!sourcePath) {
      reasonCodes.add('COORDINATE_SOURCE_PATH_INVALID')
      continue
    }
    if (libraryRoot && !withinSubjectLibrary(sourcePath, libraryRoot, artifact?.subject)) {
      reasonCodes.add('COORDINATE_SOURCE_PATH_INVALID')
      continue
    }
    const stat = fs.statSync(sourcePath, { throwIfNoEntry: false })
    if (!stat?.isFile() || stat.size <= 0) {
      reasonCodes.add('COORDINATE_SOURCE_MISSING')
      continue
    }
    const bytes = fs.readFileSync(sourcePath)
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      reasonCodes.add('COORDINATE_SOURCE_NOT_PDF')
      continue
    }
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex')
    if (!sourceFile.sha256 || sourceFile.sha256 !== actualHash) {
      reasonCodes.add('COORDINATE_SOURCE_SHA256_MISMATCH')
    }
  }

  return { reasonCodes, assetCount: 0 }
}

function withinSubjectLibrary(filePath, libraryRoot, subjectCode) {
  const root = path.resolve(String(libraryRoot || ''))
  const subject = typeof subjectCode === 'string' ? subjectCode.trim() : ''
  if (!root || !subject) return false
  const subjectRoot = path.basename(root).toLowerCase() === subject.toLowerCase()
    ? root
    : path.join(root, subject)
  const relative = path.relative(subjectRoot, path.resolve(filePath))
  return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function invalidCandidate(paperId, reason) {
  return {
    artifactId: `sha256:${'0'.repeat(64)}`,
    paperId: safeText(paperId, 'unknown', 160),
    subject: null,
    status: 'auto-quarantined',
    declaredStatus: 'invalid',
    studentEligibility: 'blocked',
    questionCount: 0,
    assetCount: 0,
    source: null,
    reasonCodes: [reason],
  }
}

function normalizeHash(value) {
  const match = typeof value === 'string' ? HASH_PATTERN.exec(value) : null
  return match ? match[1].toLowerCase() : null
}

function safeReasonCodes(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/.test(item)).slice(0, 50)
    : []
}

function safeText(value, fallback, maxLength) {
  const text = typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
  return text || fallback
}
