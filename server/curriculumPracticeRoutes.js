import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const RELEASE_FILES = Object.freeze({
  manifest: 'release-manifest.json',
  candidate: 'candidate-manifest.json',
  publicCatalog: 'public-catalog.json',
  privateAnswers: 'private-answer-index.json',
  sourceAssets: 'source-assets.json',
})

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath))
}

function releaseError(message = 'AP/IB practice is temporarily unavailable.') {
  return Object.assign(new Error(message), { statusCode: 503, code: 'curriculum_practice_release_unavailable' })
}

function readJson(filePath, maxBytes = 20 * 1024 * 1024) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw releaseError()
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'curriculum_practice_release_unavailable') throw error
    throw releaseError()
  }
}

function without(value, field) {
  const copy = structuredClone(value)
  delete copy[field]
  return copy
}

function withinRoot(filePath, root) {
  const relative = path.relative(root, filePath)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function pngMetadata(filePath) {
  const bytes = fs.readFileSync(filePath)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height, bytes: bytes.length, sha256: sha256(bytes) } : null
}

function assertPublicProjection(value) {
  if (Array.isArray(value)) return value.forEach(assertPublicProjection)
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/correct|answerHash|markScheme|gatewayEnvelope|qwenEnvelope|bindingHash/i.test(key)) throw releaseError()
    assertPublicProjection(child)
  }
}

function immutableSnapshot(value) {
  if (!value || typeof value !== 'object') return value
  for (const child of Object.values(value)) immutableSnapshot(child)
  return Object.freeze(value)
}

function loadRelease({ releaseRoot, sourceAssetRoot }) {
  const root = path.resolve(String(releaseRoot || ''))
  const assetRoot = path.resolve(String(sourceAssetRoot || ''))
  if (!root || !assetRoot) throw releaseError()
  if (fs.statSync(path.join(root, 'BLOCKED.json'), { throwIfNoEntry: false })?.isFile()) throw releaseError()
  let realAssetRoot
  try { realAssetRoot = fs.realpathSync(assetRoot) } catch { throw releaseError() }
  const paths = Object.fromEntries(Object.entries(RELEASE_FILES).map(([key, name]) => [key, path.join(root, name)]))
  const release = readJson(paths.manifest)
  const candidate = readJson(paths.candidate)
  const publicCatalog = readJson(paths.publicCatalog)
  const privateAnswers = readJson(paths.privateAnswers)
  const sourceAssets = readJson(paths.sourceAssets)

  if (release.schemaVersion !== 'apib-curriculum-practice-release.v1'
    || release.status !== 'released'
    || release.authority !== 'ai-provisional'
    || release.studentStudyEligible !== true
    || release.formalProgressEligible !== false
    || release.rights?.status !== 'licensed'
    || release.review?.independentPassCount !== 2
    || release.review?.officiallyBoundQuestions !== 145
    || !/^[a-f0-9]{64}$/.test(String(release.releaseHash || ''))
    || release.releaseHash !== sha256(Buffer.from(canonicalJson(without(release, 'releaseHash')), 'utf8'))) throw releaseError()
  if (candidate.schemaVersion !== 'apib-curriculum-practice-candidate.v1'
    || candidate.candidateHash !== release.candidateHash
    || candidate.candidateHash !== sha256(Buffer.from(canonicalJson(without(candidate, 'candidateHash')), 'utf8'))) throw releaseError()
  if (fileSha256(paths.publicCatalog) !== release.files?.publicCatalog?.sha256
    || fileSha256(paths.privateAnswers) !== release.files?.privateAnswerIndex?.sha256
    || fileSha256(paths.sourceAssets) !== release.files?.sourceAssets?.sha256) throw releaseError()
  if (publicCatalog.schemaVersion !== 'apib-curriculum-practice-public.v1'
    || privateAnswers.schemaVersion !== 'apib-curriculum-practice-private.v1'
    || sourceAssets.schemaVersion !== 'apib-practice-source-assets.v1'
    || sourceAssets.rightsStatus !== 'licensed'
    || sourceAssets.manifestHash !== release.sourceAssetManifestHash
    || sourceAssets.manifestHash !== sha256(Buffer.from(canonicalJson(without(sourceAssets, 'manifestHash')), 'utf8'))) throw releaseError()
  assertPublicProjection(publicCatalog)
  if (publicCatalog.questions?.length !== 145 || privateAnswers.answers?.length !== 145 || sourceAssets.questionCount !== 145) throw releaseError()

  const questionById = new Map(publicCatalog.questions.map((question) => [question.id, question]))
  const answerById = new Map(privateAnswers.answers.map((answer) => [answer.questionId, answer]))
  const assetById = new Map(sourceAssets.assets.map((asset) => [asset.id, asset]))
  if (questionById.size !== 145 || answerById.size !== 145 || assetById.size !== sourceAssets.assets.length) throw releaseError()
  for (const question of questionById.values()) {
    const answer = answerById.get(question.id)
    if (!answer || answer.review?.independentPassCount !== 2 || !Array.isArray(question.source?.assetIds) || !question.source.assetIds.length) throw releaseError()
    if (!Array.isArray(answer.correctOptions) || !answer.correctOptions.length || answer.correctOptions.some((option) => !question.options.includes(option))) throw releaseError()
    if (question.source.assetIds.some((assetId) => assetById.get(assetId)?.questionId !== question.id)) throw releaseError()
  }

  function resolveSourceAsset(questionId, assetId) {
    const question = questionById.get(String(questionId || ''))
    const asset = assetById.get(String(assetId || ''))
    if (!question || !asset || asset.kind !== 'qp-region' || asset.questionId !== question.id || !question.source.assetIds.includes(asset.id)) return null
    const filePath = path.resolve(realAssetRoot, asset.relativePath)
    if (!withinRoot(filePath, realAssetRoot) || path.extname(filePath).toLowerCase() !== '.png') return null
    try {
      const realFilePath = fs.realpathSync(filePath)
      if (!withinRoot(realFilePath, realAssetRoot)) return null
      const stat = fs.statSync(realFilePath)
      const png = pngMetadata(realFilePath)
      if (!stat.isFile() || stat.size <= 0 || stat.size > 10 * 1024 * 1024 || !png
        || png.sha256 !== asset.sha256 || png.bytes !== stat.size
        || png.width !== asset.width || png.height !== asset.height) return null
      return Object.freeze({ filePath: realFilePath, sha256: asset.sha256, bytes: stat.size, width: asset.width, height: asset.height, contentType: 'image/png' })
    } catch {
      return null
    }
  }

  return immutableSnapshot({
    release,
    publicCatalog,
    questionById,
    answerById,
    assetById,
    resolveSourceAsset,
  })
}

export function createCurriculumPracticeReleaseLoader({ releaseRoot, sourceAssetRoot } = {}) {
  let cached = null
  let snapshot = ''
  return function loadCurriculumPracticeRelease({ refresh = false } = {}) {
    const files = Object.values(RELEASE_FILES).map((name) => path.join(path.resolve(String(releaseRoot || '')), name))
    const nextSnapshot = files.map((filePath) => {
      const stat = fs.statSync(filePath, { throwIfNoEntry: false })
      return stat?.isFile() ? `${filePath}:${stat.size}:${stat.mtimeMs}` : `${filePath}:missing`
    }).join('|')
    if (!refresh && cached && snapshot === nextSnapshot) return cached
    cached = loadRelease({ releaseRoot, sourceAssetRoot })
    snapshot = nextSnapshot
    return cached
  }
}
