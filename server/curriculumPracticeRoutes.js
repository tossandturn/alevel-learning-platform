import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { inspectPngSource, PNG_SOURCE_LIMITS } from './pngSourceIntegrity.js'

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

function pngMetadata(filePath, expected) {
  const bytes = fs.readFileSync(filePath)
  const png = inspectPngSource(bytes, expected)
  return { ...png, sha256: sha256(bytes) }
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

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''))
}

function exactArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index])
}

function validSourceRegion(value) {
  return Array.isArray(value)
    && value.length === 4
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
    && value[2] > value[0]
    && value[3] > value[1]
}

function loadRelease({ releaseRoot, sourceAssetRoot }) {
  const root = path.resolve(String(releaseRoot || ''))
  const assetRoot = path.resolve(String(sourceAssetRoot || ''))
  if (!root || !assetRoot) throw releaseError()
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
    || release.sourceIntegrity?.schemaVersion !== 'apib-png-source-integrity.v1'
    || release.sourceIntegrity?.sourceAssetManifestHash !== release.sourceAssetManifestHash
    || release.sourceIntegrity?.structureCrcVerified !== true
    || release.sourceIntegrity?.trustedDecodeVerified !== true
    || canonicalJson(release.sourceIntegrity?.limits) !== canonicalJson(PNG_SOURCE_LIMITS)
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
    || !Array.isArray(publicCatalog.routes)
    || !Array.isArray(publicCatalog.questions)
    || !Array.isArray(privateAnswers.answers)
    || !Array.isArray(sourceAssets.questions)
    || !Array.isArray(sourceAssets.assets)
    || sourceAssets.rightsStatus !== 'licensed'
    || !isSha256(candidate.source?.handoffSha256)
    || sourceAssets.handoffSha256 !== candidate.source.handoffSha256
    || candidate.source?.sourceAssetsSha256 !== release.files?.sourceAssets?.sha256
    || candidate.rights?.sourceManifestHash !== sourceAssets.manifestHash
    || sourceAssets.manifestHash !== release.sourceAssetManifestHash
    || sourceAssets.manifestHash !== sha256(Buffer.from(canonicalJson(without(sourceAssets, 'manifestHash')), 'utf8'))) throw releaseError()
  assertPublicProjection(publicCatalog)
  if (publicCatalog.questions.length !== 145
    || privateAnswers.answers.length !== 145
    || sourceAssets.questionCount !== 145
    || sourceAssets.questions.length !== 145
    || sourceAssets.assetCount !== sourceAssets.assets.length
    || release.sourceIntegrity?.assetCount !== sourceAssets.assets.length
    || candidate.totals?.sourceAssets !== sourceAssets.assets.length) throw releaseError()

  const questionById = new Map(publicCatalog.questions.map((question) => [question.id, question]))
  const answerById = new Map(privateAnswers.answers.map((answer) => [answer.questionId, answer]))
  const assetById = new Map(sourceAssets.assets.map((asset) => [asset.id, asset]))
  const sourceQuestionById = new Map(sourceAssets.questions.map((question) => [question.questionId, question]))
  const routeById = new Map(publicCatalog.routes.map((route) => [route.id, route]))
  const topicEntries = publicCatalog.routes.flatMap((route) => Array.isArray(route.topics) ? route.topics.map((topic) => [topic.id, topic]) : [])
  const topicById = new Map(topicEntries)
  if (questionById.size !== 145
    || answerById.size !== 145
    || sourceQuestionById.size !== 145
    || assetById.size !== sourceAssets.assets.length
    || routeById.size !== publicCatalog.routes.length
    || topicById.size !== topicEntries.length
    || [...questionById.keys()].some((questionId) => !answerById.has(questionId) || !sourceQuestionById.has(questionId))
    || [...answerById.keys()].some((questionId) => !questionById.has(questionId))
    || [...sourceQuestionById.keys()].some((questionId) => !questionById.has(questionId))) throw releaseError()

  for (const route of publicCatalog.routes) {
    const routeQuestions = publicCatalog.questions.filter((question) => question.routeId === route.id)
    if (!Array.isArray(route.topics)
      || route.questionCount !== routeQuestions.length
      || route.topics.some((topic) => topic.routeId !== route.id
        || topic.questionCount !== routeQuestions.filter((question) => question.topicIds?.includes(topic.id)).length
        || (route.course === 'physics-1' && topic.dimension !== 'official-essential-knowledge')
        || (route.course === 'physics-c-em' && topic.dimension !== 'official-topic'))) throw releaseError()
  }

  const referencedAssetIds = new Set()
  for (const question of questionById.values()) {
    const answer = answerById.get(question.id)
    const sourceQuestion = sourceQuestionById.get(question.id)
    const pages = Array.isArray(question.source?.pages) ? question.source.pages : []
    const sortedPages = [...new Set(pages)].sort((left, right) => left - right)
    if (!answer
      || answer.review?.independentPassCount !== 2
      || !routeById.has(question.routeId)
      || !Array.isArray(question.topicIds)
      || !question.topicIds.length
      || new Set(question.topicIds).size !== question.topicIds.length
      || question.topicIds.some((topicId) => topicById.get(topicId)?.routeId !== question.routeId)
      || !isSha256(question.source?.questionPdfSha256)
      || !pages.length
      || pages.some((page) => !Number.isSafeInteger(page) || page < 1)
      || !exactArray(pages, sortedPages)
      || !Array.isArray(question.source?.assetIds)
      || !question.source.assetIds.length
      || new Set(question.source.assetIds).size !== question.source.assetIds.length
      || !exactArray(question.source.assetIds, sourceQuestion?.assetIds)
      || !Array.isArray(question.options)
      || question.options.length < 2
      || new Set(question.options).size !== question.options.length
      || !Array.isArray(answer.correctOptions)
      || !answer.correctOptions.length
      || !exactArray(answer.correctOptions, [...new Set(answer.correctOptions)].sort())
      || answer.correctOptions.some((option) => !question.options.includes(option))
      || !['single', 'multiple'].includes(question.answerMode)
      || (question.answerMode === 'single' && answer.correctOptions.length !== 1)
      || (question.answerMode === 'multiple' && answer.correctOptions.length < 2)) throw releaseError()
    const questionAssets = []
    for (const assetId of question.source.assetIds) {
      const asset = assetById.get(assetId)
      if (!asset
        || asset.questionId !== question.id
        || asset.paperId !== question.paperId
        || asset.kind !== 'qp-region'
        || !pages.includes(asset.page)
        || !isSha256(asset.sha256)
        || !isSha256(asset.sourcePageSha256)
        || !validSourceRegion(asset.sourceRegion)) throw releaseError()
      referencedAssetIds.add(assetId)
      questionAssets.push(asset)
    }
    if (!exactArray([...new Set(questionAssets.map((asset) => asset.page))].sort((left, right) => left - right), pages)) throw releaseError()
  }
  if (referencedAssetIds.size !== assetById.size) throw releaseError()

  const sourcePageHashes = new Map()
  for (const asset of sourceAssets.assets) {
    const pageKey = `${asset.paperId}:${asset.page}`
    const existingHash = sourcePageHashes.get(pageKey)
    if (existingHash && existingHash !== asset.sourcePageSha256) throw releaseError()
    sourcePageHashes.set(pageKey, asset.sourcePageSha256)
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
      if (!stat.isFile()) return null
      const png = pngMetadata(realFilePath, { expectedBytes: stat.size, expectedWidth: asset.width, expectedHeight: asset.height })
      if (png.sha256 !== asset.sha256) return null
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
