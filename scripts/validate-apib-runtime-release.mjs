import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadImage } from '@napi-rs/canvas'

import { canonicalJson, fileSha256, sha256 } from './build-apib-runtime-artifact.mjs'
import { inspectPngSource, PNG_SOURCE_LIMITS } from '../server/pngSourceIntegrity.js'

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) throw new Error('Arguments must be --name value pairs')
    values.set(argv[index].slice(2), argv[index + 1])
  }
  return values
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
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

function assertNoForbiddenPublicFields(value, label = 'public') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoForbiddenPublicFields(item, `${label}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /correct|answerHash|markScheme|gatewayEnvelope|qwenEnvelope|bindingHash/i, `private field leaked at ${label}.${key}`)
    assertNoForbiddenPublicFields(child, `${label}.${key}`)
  }
}

function assertSha256(value, label) {
  assert.match(String(value || ''), /^[a-f0-9]{64}$/, `${label} must be a lowercase SHA-256 digest`)
}

function assertSourceRegion(value, label) {
  assert.ok(Array.isArray(value) && value.length === 4, `${label} must be an xyxy region`)
  assert.ok(value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1), `${label} coordinates must be normalized`)
  assert.ok(value[2] > value[0] && value[3] > value[1], `${label} must have positive area`)
}

export async function validateApIbRuntimeRelease({ releaseRoot, sourceAssetRoot, write = false, validatedAt = null }) {
  const candidatePath = path.join(releaseRoot, 'candidate-manifest.json')
  const publicPath = path.join(releaseRoot, 'public-catalog.json')
  const privatePath = path.join(releaseRoot, 'private-answer-index.json')
  const sourceAssetsPath = path.join(releaseRoot, 'source-assets.json')
  const [candidate, publicCatalog, privateIndex, sourceAssets] = await Promise.all([candidatePath, publicPath, privatePath, sourceAssetsPath].map(readJson))
  const realSourceAssetRoot = await fs.realpath(path.resolve(sourceAssetRoot))

  assert.equal(candidate.schemaVersion, 'apib-curriculum-practice-candidate.v1')
  assert.equal(candidate.status, 'candidate')
  assert.equal(candidate.candidateHash, sha256(Buffer.from(canonicalJson(without(candidate, 'candidateHash')), 'utf8')))
  const [publicCatalogSha256, privateAnswerIndexSha256, sourceAssetsSha256] = await Promise.all([
    fileSha256(publicPath),
    fileSha256(privatePath),
    fileSha256(sourceAssetsPath),
  ])
  assert.equal(candidate.files.publicCatalog.sha256, publicCatalogSha256)
  assert.equal(candidate.files.privateAnswerIndex.sha256, privateAnswerIndexSha256)
  assert.equal(candidate.files.sourceAssets.sha256, sourceAssetsSha256)
  assert.equal(candidate.source?.sourceAssetsSha256, sourceAssetsSha256, 'candidate source-assets digest must bind the exact manifest bytes')
  assert.equal(publicCatalog.schemaVersion, 'apib-curriculum-practice-public.v1')
  assert.equal(privateIndex.schemaVersion, 'apib-curriculum-practice-private.v1')
  assert.equal(sourceAssets.schemaVersion, 'apib-practice-source-assets.v1')
  assert.equal(sourceAssets.rightsStatus, 'licensed')
  assert.equal(sourceAssets.manifestHash, sha256(Buffer.from(canonicalJson(without(sourceAssets, 'manifestHash')), 'utf8')))
  assertSha256(candidate.source?.handoffSha256, 'candidate handoff')
  assert.equal(sourceAssets.handoffSha256, candidate.source.handoffSha256, 'source-assets handoff must match the exact reviewed candidate handoff')
  assert.equal(candidate.rights?.sourceManifestHash, sourceAssets.manifestHash, 'candidate rights receipt must bind the source-assets manifest')
  assertNoForbiddenPublicFields(publicCatalog)

  assert.equal(publicCatalog.questions.length, 145)
  assert.equal(new Set(publicCatalog.questions.map((question) => question.id)).size, 145)
  assert.equal(privateIndex.answers.length, 145)
  assert.equal(new Set(privateIndex.answers.map((answer) => answer.questionId)).size, 145)
  assert.equal(sourceAssets.questionCount, 145)
  assert.equal(sourceAssets.questions.length, 145)
  assert.equal(new Set(sourceAssets.questions.map((question) => question.questionId)).size, 145, 'source question bindings must be unique')
  assert.equal(sourceAssets.assetCount, sourceAssets.assets.length, 'source asset count must match the actual manifest')
  assert.equal(candidate.totals.sourceAssets, sourceAssets.assets.length, 'candidate asset total must match the actual manifest')
  assert.equal(candidate.review.independentPassCount, 2)
  assert.equal(candidate.review.officiallyBoundQuestions, 145)
  assert.equal(candidate.rights.status, 'licensed')
  assert.equal(candidate.release.studentStudyEligible, false)
  assert.equal(candidate.release.formalProgressEligible, false)
  assert.deepEqual(Object.fromEntries(candidate.routes.map((route) => [route.id, route.questionCount])), {
    'ap-physics-1-mcq-study': 40,
    'ap-physics-c-em-mcq-study': 105,
  })

  const questionById = new Map(publicCatalog.questions.map((question) => [question.id, question]))
  const answerById = new Map(privateIndex.answers.map((answer) => [answer.questionId, answer]))
  const assetById = new Map(sourceAssets.assets.map((asset) => [asset.id, asset]))
  const questionAssetIds = new Map(sourceAssets.questions.map((entry) => [entry.questionId, entry.assetIds]))
  const routeById = new Map(publicCatalog.routes.map((route) => [route.id, route]))
  const topicById = new Map(publicCatalog.routes.flatMap((route) => route.topics.map((topic) => [topic.id, topic])))
  assert.equal(assetById.size, sourceAssets.assets.length, 'source asset IDs must be unique')
  assert.equal(routeById.size, publicCatalog.routes.length, 'public route IDs must be unique')
  assert.equal(topicById.size, publicCatalog.routes.reduce((sum, route) => sum + route.topics.length, 0), 'public topic IDs must be unique')
  assert.deepEqual([...answerById.keys()].sort(), [...questionById.keys()].sort(), 'private answers must correspond exactly to public question IDs')
  assert.deepEqual([...questionAssetIds.keys()].sort(), [...questionById.keys()].sort(), 'source bindings must correspond exactly to public question IDs')

  for (const route of publicCatalog.routes) {
    const routeQuestions = publicCatalog.questions.filter((question) => question.routeId === route.id)
    assert.equal(route.questionCount, routeQuestions.length, `${route.id}: route count must match its exact question set`)
    for (const topic of route.topics) {
      assert.equal(topic.routeId, route.id, `${topic.id}: topic must belong to its declared route`)
      assert.equal(topic.questionCount, routeQuestions.filter((question) => question.topicIds.includes(topic.id)).length, `${topic.id}: topic count must match exact memberships`)
      if (route.course === 'physics-1') assert.equal(topic.dimension, 'official-essential-knowledge', `${topic.id}: AP Physics 1 requires essential-knowledge bindings`)
      if (route.course === 'physics-c-em') assert.equal(topic.dimension, 'official-topic', `${topic.id}: AP Physics C E&M requires official topic bindings`)
    }
  }

  const referencedAssetIds = new Set()
  for (const question of publicCatalog.questions) {
    const answer = answerById.get(question.id)
    assert.ok(answer, `${question.id}: private answer missing`)
    assert.equal(answer.review.independentPassCount, 2)
    for (const field of ['answerHash', 'markSchemePdfSha256']) assert.match(answer[field], /^[a-f0-9]{64}$/)
    for (const field of ['gatewayEnvelopeHash', 'qwenEnvelopeHash', 'packetHash', 'officialBindingHash']) assert.match(answer.review[field], /^[a-f0-9]{64}$/)
    assert.ok(routeById.has(question.routeId), `${question.id}: route is not declared`)
    assert.ok(Array.isArray(question.topicIds) && question.topicIds.length > 0 && new Set(question.topicIds).size === question.topicIds.length, `${question.id}: topic IDs must be non-empty and unique`)
    assert.ok(question.topicIds.every((topicId) => topicById.get(topicId)?.routeId === question.routeId), `${question.id}: topic memberships must belong to the question route`)
    assertSha256(question.source?.questionPdfSha256, `${question.id}: question PDF`)
    assert.ok(Array.isArray(question.source?.pages) && question.source.pages.length > 0, `${question.id}: source pages are required`)
    const pages = [...new Set(question.source.pages)]
    assert.deepEqual(question.source.pages, pages.slice().sort((left, right) => left - right), `${question.id}: source pages must be unique, positive and sorted`)
    assert.ok(pages.every((page) => Number.isSafeInteger(page) && page > 0), `${question.id}: source pages must be positive integers`)
    assert.deepEqual(question.source.assetIds, questionAssetIds.get(question.id), `${question.id}: source question binding must exactly match public asset IDs`)
    assert.ok(question.source.assetIds.length >= 1 && new Set(question.source.assetIds).size === question.source.assetIds.length, `${question.id}: source asset IDs must be non-empty and unique`)
    const questionAssets = []
    for (const assetId of question.source.assetIds) {
      const asset = assetById.get(assetId)
      assert.ok(asset, `${question.id}: source asset is missing: ${assetId}`)
      assert.equal(asset.questionId, question.id, `${assetId}: source asset question binding mismatch`)
      assert.equal(asset.paperId, question.paperId, `${assetId}: source asset paper binding mismatch`)
      assert.equal(asset.kind, 'qp-region', `${assetId}: source asset role must be qp-region`)
      assert.ok(pages.includes(asset.page), `${assetId}: source asset page is outside the question evidence pages`)
      assertSha256(asset.sha256, `${assetId}: source asset`)
      assertSha256(asset.sourcePageSha256, `${assetId}: source page evidence`)
      assertSourceRegion(asset.sourceRegion, `${assetId}: source region`)
      referencedAssetIds.add(assetId)
      questionAssets.push(asset)
    }
    assert.deepEqual([...new Set(questionAssets.map((asset) => asset.page))].sort((left, right) => left - right), pages, `${question.id}: source asset pages must exactly cover the question evidence pages`)
    assert.ok(['single', 'multiple'].includes(question.answerMode))
    assert.ok(Array.isArray(question.options) && question.options.length >= 2 && new Set(question.options).size === question.options.length, `${question.id}: options must be unique`)
    assert.ok(answer.correctOptions.length >= 1 && answer.correctOptions.every((option) => question.options.includes(option)))
    assert.deepEqual(answer.correctOptions, [...new Set(answer.correctOptions)].sort(), `${question.id}: correct option set must be canonical`)
    if (question.answerMode === 'single') assert.equal(answer.correctOptions.length, 1, `${question.id}: single-answer item must bind exactly one correct option`)
    if (question.answerMode === 'multiple') assert.ok(answer.correctOptions.length > 1, `${question.id}: multiple-answer item must bind more than one correct option`)
  }
  assert.equal(referencedAssetIds.size, assetById.size, 'every released source asset must be referenced by exactly one public question')

  const sourcePageHashes = new Map()
  for (const asset of sourceAssets.assets) {
    const pageKey = `${asset.paperId}:${asset.page}`
    const existingPageHash = sourcePageHashes.get(pageKey)
    if (existingPageHash) assert.equal(asset.sourcePageSha256, existingPageHash, `${asset.id}: source page evidence hash conflicts with another crop`)
    else sourcePageHashes.set(pageKey, asset.sourcePageSha256)
    const assetPath = path.resolve(realSourceAssetRoot, asset.relativePath)
    assert.equal(path.extname(assetPath).toLowerCase(), '.png', `${asset.id}: only PNG source assets are allowed`)
    assert.ok(withinRoot(assetPath, realSourceAssetRoot), `asset path escapes root: ${asset.id}`)
    const realAssetPath = await fs.realpath(assetPath)
    assert.ok(withinRoot(realAssetPath, realSourceAssetRoot), `asset symlink escapes root: ${asset.id}`)
    const stat = await fs.stat(realAssetPath)
    assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 10 * 1024 * 1024)
    const bytes = await fs.readFile(realAssetPath)
    const png = inspectPngSource(bytes, { expectedBytes: stat.size, expectedWidth: asset.width, expectedHeight: asset.height })
    assert.equal(sha256(bytes), asset.sha256)
    let decoded
    try {
      decoded = await loadImage(bytes)
    } catch {
      assert.fail(`${asset.id}: trusted PNG decoder rejected the source asset`)
    }
    assert.equal(decoded.width, png.width, `${asset.id}: decoded PNG width must match the structural receipt`)
    assert.equal(decoded.height, png.height, `${asset.id}: decoded PNG height must match the structural receipt`)
  }

  const releasePath = path.join(releaseRoot, 'release-manifest.json')
  const existingRelease = !write && (await fs.stat(releasePath, { throwIfNoEntry: false }))?.isFile()
    ? await readJson(releasePath)
    : null
  const effectiveValidatedAt = validatedAt || existingRelease?.validatedAt || new Date().toISOString()
  const release = {
    schemaVersion: 'apib-curriculum-practice-release.v1',
    status: 'released',
    releaseId: `apib-practice-${candidate.candidateHash.slice(0, 16)}`,
    validatedAt: effectiveValidatedAt,
    authority: 'ai-provisional',
    studentStudyEligible: true,
    formalProgressEligible: false,
    candidateHash: candidate.candidateHash,
    files: candidate.files,
    sourceAssetManifestHash: sourceAssets.manifestHash,
    sourceIntegrity: {
      schemaVersion: 'apib-png-source-integrity.v1',
      sourceAssetManifestHash: sourceAssets.manifestHash,
      assetCount: sourceAssets.assets.length,
      structureCrcVerified: true,
      trustedDecodeVerified: true,
      limits: PNG_SOURCE_LIMITS,
    },
    rights: { status: 'licensed' },
    review: { independentPassCount: 2, officiallyBoundQuestions: 145 },
    routes: candidate.routes,
    totals: candidate.totals,
  }
  release.releaseHash = crypto.createHash('sha256').update(canonicalJson(release), 'utf8').digest('hex')
  if (write) {
    if ((await fs.stat(releasePath, { throwIfNoEntry: false }))?.isFile()) throw new Error(`Refusing to overwrite ${releasePath}`)
    await fs.writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`, 'utf8')
  } else if (existingRelease) {
    assert.deepEqual(existingRelease, release, 'existing release receipt must match a fresh validation exactly')
  }
  return { release, releasePath }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  const required = (name) => {
    const value = args.get(name)
    if (!value) throw new Error(`Missing --${name}`)
    return path.resolve(value)
  }
  const result = await validateApIbRuntimeRelease({ releaseRoot: required('release-root'), sourceAssetRoot: required('source-asset-root'), write: args.get('write') === '1' })
  console.log(JSON.stringify({ status: 'PASS', releasePath: result.releasePath, releaseHash: result.release.releaseHash, totals: result.release.totals }))
}
