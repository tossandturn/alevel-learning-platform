import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalJson, fileSha256, sha256 } from './build-apib-runtime-artifact.mjs'

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

function pngMetadata(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}

function assertNoForbiddenPublicFields(value, label = 'public') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoForbiddenPublicFields(item, `${label}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /correct|answerHash|markScheme|gatewayEnvelope|qwenEnvelope|bindingHash/i, `private field leaked at ${label}.${key}`)
    assertNoForbiddenPublicFields(child, `${label}.${key}`)
  }
}

export async function validateApIbRuntimeRelease({ releaseRoot, sourceAssetRoot, write = false, validatedAt = null }) {
  assert.equal((await fs.stat(path.join(releaseRoot, 'BLOCKED.json'), { throwIfNoEntry: false }))?.isFile() || false, false, 'blocked release roots must never validate')
  const candidatePath = path.join(releaseRoot, 'candidate-manifest.json')
  const publicPath = path.join(releaseRoot, 'public-catalog.json')
  const privatePath = path.join(releaseRoot, 'private-answer-index.json')
  const sourceAssetsPath = path.join(releaseRoot, 'source-assets.json')
  const [candidate, publicCatalog, privateIndex, sourceAssets] = await Promise.all([candidatePath, publicPath, privatePath, sourceAssetsPath].map(readJson))
  const realSourceAssetRoot = await fs.realpath(path.resolve(sourceAssetRoot))

  assert.equal(candidate.schemaVersion, 'apib-curriculum-practice-candidate.v1')
  assert.equal(candidate.status, 'candidate')
  assert.equal(candidate.candidateHash, sha256(Buffer.from(canonicalJson(without(candidate, 'candidateHash')), 'utf8')))
  assert.equal(candidate.files.publicCatalog.sha256, await fileSha256(publicPath))
  assert.equal(candidate.files.privateAnswerIndex.sha256, await fileSha256(privatePath))
  assert.equal(candidate.files.sourceAssets.sha256, await fileSha256(sourceAssetsPath))
  assert.equal(publicCatalog.schemaVersion, 'apib-curriculum-practice-public.v1')
  assert.equal(privateIndex.schemaVersion, 'apib-curriculum-practice-private.v1')
  assert.equal(sourceAssets.schemaVersion, 'apib-practice-source-assets.v1')
  assert.equal(sourceAssets.rightsStatus, 'licensed')
  assert.equal(sourceAssets.manifestHash, sha256(Buffer.from(canonicalJson(without(sourceAssets, 'manifestHash')), 'utf8')))
  assertNoForbiddenPublicFields(publicCatalog)

  assert.equal(publicCatalog.questions.length, 145)
  assert.equal(new Set(publicCatalog.questions.map((question) => question.id)).size, 145)
  assert.equal(privateIndex.answers.length, 145)
  assert.equal(new Set(privateIndex.answers.map((answer) => answer.questionId)).size, 145)
  assert.equal(sourceAssets.questionCount, 145)
  assert.equal(candidate.review.independentPassCount, 2)
  assert.equal(candidate.review.officiallyBoundQuestions, 145)
  assert.equal(candidate.rights.status, 'licensed')
  assert.equal(candidate.release.studentStudyEligible, false)
  assert.equal(candidate.release.formalProgressEligible, false)
  assert.deepEqual(Object.fromEntries(candidate.routes.map((route) => [route.id, route.questionCount])), {
    'ap-physics-1-mcq-study': 40,
    'ap-physics-c-em-mcq-study': 105,
  })

  const answerById = new Map(privateIndex.answers.map((answer) => [answer.questionId, answer]))
  const assetById = new Map(sourceAssets.assets.map((asset) => [asset.id, asset]))
  const questionAssetIds = new Map(sourceAssets.questions.map((entry) => [entry.questionId, entry.assetIds]))
  for (const question of publicCatalog.questions) {
    const answer = answerById.get(question.id)
    assert.ok(answer, `${question.id}: private answer missing`)
    assert.equal(answer.review.independentPassCount, 2)
    for (const field of ['answerHash', 'markSchemePdfSha256']) assert.match(answer[field], /^[a-f0-9]{64}$/)
    for (const field of ['gatewayEnvelopeHash', 'qwenEnvelopeHash', 'packetHash', 'officialBindingHash']) assert.match(answer.review[field], /^[a-f0-9]{64}$/)
    assert.deepEqual(question.source.assetIds, questionAssetIds.get(question.id))
    assert.ok(question.source.assetIds.length >= 1)
    for (const assetId of question.source.assetIds) {
      const asset = assetById.get(assetId)
      assert.ok(asset && asset.questionId === question.id && asset.kind === 'qp-region')
    }
    assert.ok(['single', 'multiple'].includes(question.answerMode))
    assert.ok(answer.correctOptions.length >= 1 && answer.correctOptions.every((option) => question.options.includes(option)))
  }

  for (const asset of sourceAssets.assets) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    assert.match(asset.sourcePageSha256, /^[a-f0-9]{64}$/)
    const assetPath = path.resolve(realSourceAssetRoot, asset.relativePath)
    assert.equal(path.extname(assetPath).toLowerCase(), '.png', `${asset.id}: only PNG source assets are allowed`)
    assert.ok(withinRoot(assetPath, realSourceAssetRoot), `asset path escapes root: ${asset.id}`)
    const realAssetPath = await fs.realpath(assetPath)
    assert.ok(withinRoot(realAssetPath, realSourceAssetRoot), `asset symlink escapes root: ${asset.id}`)
    const stat = await fs.stat(realAssetPath)
    assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 10 * 1024 * 1024)
    const bytes = await fs.readFile(realAssetPath)
    const png = pngMetadata(bytes)
    assert.ok(png, `${asset.id}: source asset is not a valid PNG`)
    assert.equal(sha256(bytes), asset.sha256)
    assert.equal(bytes.length, stat.size)
    assert.equal(png.width, asset.width)
    assert.equal(png.height, asset.height)
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
