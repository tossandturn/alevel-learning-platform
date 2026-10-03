import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'

import { buildApIbRuntimeCandidate, canonicalJson, fileSha256, sha256 } from './build-apib-runtime-artifact.mjs'
import { validateApIbRuntimeRelease } from './validate-apib-runtime-release.mjs'
import { createCurriculumPracticeReleaseLoader } from '../server/curriculumPracticeRoutes.js'
import { inspectPngSource, PNG_SOURCE_LIMITS } from '../server/pngSourceIntegrity.js'

const workRoot = 'D:\\CodexWork\\ap-ib-ocr-delta-20261003'
const handoffPath = path.join(workRoot, 'reports', '2026-10-04', 'apib-question-review-handoff-v2.json')
const sourceAssetsPath = path.join(workRoot, 'runtime-candidate', '2026-10-04', 'source-assets.json')
const sourceAssetRoot = path.join(workRoot, 'runtime-candidate', '2026-10-04', 'assets')
const scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'apib-runtime-release-'))
const releaseFiles = ['release-manifest.json', 'candidate-manifest.json', 'public-catalog.json', 'private-answer-index.json', 'source-assets.json']

function without(value, field) {
  const copy = structuredClone(value)
  delete copy[field]
  return copy
}

async function copyReleaseFiles(sourceRoot, targetRoot) {
  await fs.mkdir(targetRoot)
  for (const name of releaseFiles) await fs.copyFile(path.join(sourceRoot, name), path.join(targetRoot, name))
}

async function readJson(root, name) {
  return JSON.parse(await fs.readFile(path.join(root, name), 'utf8'))
}

async function writeJson(root, name, value) {
  await fs.writeFile(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function rewriteSelfConsistentRelease(root, mutate) {
  const publicCatalog = await readJson(root, 'public-catalog.json')
  const privateAnswers = await readJson(root, 'private-answer-index.json')
  const sourceAssets = await readJson(root, 'source-assets.json')
  await mutate({ publicCatalog, privateAnswers, sourceAssets })
  sourceAssets.manifestHash = sha256(Buffer.from(canonicalJson(without(sourceAssets, 'manifestHash')), 'utf8'))
  await Promise.all([
    writeJson(root, 'public-catalog.json', publicCatalog),
    writeJson(root, 'private-answer-index.json', privateAnswers),
    writeJson(root, 'source-assets.json', sourceAssets),
  ])

  const candidate = await readJson(root, 'candidate-manifest.json')
  candidate.files.publicCatalog.sha256 = await fileSha256(path.join(root, 'public-catalog.json'))
  candidate.files.privateAnswerIndex.sha256 = await fileSha256(path.join(root, 'private-answer-index.json'))
  candidate.files.sourceAssets.sha256 = await fileSha256(path.join(root, 'source-assets.json'))
  candidate.source.sourceAssetsSha256 = candidate.files.sourceAssets.sha256
  candidate.rights.sourceManifestHash = sourceAssets.manifestHash
  candidate.candidateHash = sha256(Buffer.from(canonicalJson(without(candidate, 'candidateHash')), 'utf8'))
  await writeJson(root, 'candidate-manifest.json', candidate)

  const release = await readJson(root, 'release-manifest.json')
  release.candidateHash = candidate.candidateHash
  release.releaseId = `apib-practice-${candidate.candidateHash.slice(0, 16)}`
  release.files = structuredClone(candidate.files)
  release.sourceAssetManifestHash = sourceAssets.manifestHash
  release.sourceIntegrity.sourceAssetManifestHash = sourceAssets.manifestHash
  release.sourceIntegrity.assetCount = sourceAssets.assets.length
  release.releaseHash = sha256(Buffer.from(canonicalJson(without(release, 'releaseHash')), 'utf8'))
  await writeJson(root, 'release-manifest.json', release)
}

function pngWithoutChunk(bytes, omittedType) {
  const chunks = [bytes.subarray(0, 8)]
  let offset = 8
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (type !== omittedType) chunks.push(bytes.subarray(offset, end))
    offset = end
  }
  return Buffer.concat(chunks)
}

function corruptFirstIdatByte(bytes) {
  const corrupted = Buffer.from(bytes)
  let offset = 8
  while (offset < corrupted.length) {
    const length = corrupted.readUInt32BE(offset)
    const type = corrupted.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT' && length > 0) {
      corrupted[offset + 8] ^= 0x01
      return corrupted
    }
    offset += 12 + length
  }
  throw new Error('Real PNG fixture has no non-empty IDAT chunk')
}

try {
  const built = await buildApIbRuntimeCandidate({ handoffPath, sourceAssetsPath, outputRoot: scratchRoot, createdAt: '2026-10-04T00:00:00.000Z' })
  assert.equal(built.candidate.totals.questions, 145)
  assert.equal(built.candidate.totals.sourceAssets, 197)
  const validated = await validateApIbRuntimeRelease({ releaseRoot: scratchRoot, sourceAssetRoot, write: true, validatedAt: '2026-10-04T00:01:00.000Z' })
  assert.equal(validated.release.studentStudyEligible, true)
  assert.equal(validated.release.formalProgressEligible, false)
  assert.equal(validated.release.review.independentPassCount, 2)

  // Broader review evidence must not invent an undelivered public question page.
  const projectionFixture = path.join(scratchRoot, 'delivered-page-projection')
  await fs.mkdir(projectionFixture)
  const reviewContext = JSON.parse(await fs.readFile(handoffPath, 'utf8'))
  const boundAssets = JSON.parse(await fs.readFile(sourceAssetsPath, 'utf8'))
  const record = reviewContext.records.find((entry) => entry.reviewStatus === 'candidate_ai_checked_official_bound')
  const contextPage = 999
  assert.ok(!record.sourceEvidence.some((entry) => entry.kind === 'qp' && Number(entry.page) === contextPage))
  record.sourceEvidence.push({ ...record.sourceEvidence.find((entry) => entry.kind === 'qp'), page: contextPage })
  const fixtureHandoff = path.join(projectionFixture, 'handoff.json')
  await writeJson(projectionFixture, 'handoff.json', reviewContext)
  boundAssets.handoffSha256 = await fileSha256(fixtureHandoff)
  boundAssets.manifestHash = sha256(Buffer.from(canonicalJson(without(boundAssets, 'manifestHash')), 'utf8'))
  await writeJson(projectionFixture, 'source-assets-input.json', boundAssets)
  const projected = await buildApIbRuntimeCandidate({ handoffPath: fixtureHandoff, sourceAssetsPath: path.join(projectionFixture, 'source-assets-input.json'), outputRoot: path.join(projectionFixture, 'candidate'), createdAt: '2026-10-04T00:00:00.000Z' })
  const projectedPublic = await readJson(projected.outputRoot, 'public-catalog.json')
  const publicRecord = projectedPublic.questions.find((entry) => entry.id === record.groupId)
  const declaredAssets = boundAssets.questions.find((entry) => entry.questionId === record.groupId).assetIds
  assert.deepEqual(publicRecord.source.pages, [...new Set(boundAssets.assets.filter((entry) => declaredAssets.includes(entry.id)).map((entry) => Number(entry.page)))].sort((a, b) => a - b))
  assert.ok(!publicRecord.source.pages.includes(contextPage))
  await validateApIbRuntimeRelease({ releaseRoot: projected.outputRoot, sourceAssetRoot })
  assert.deepEqual(validated.release.sourceIntegrity, {
    schemaVersion: 'apib-png-source-integrity.v1',
    sourceAssetManifestHash: validated.release.sourceAssetManifestHash,
    assetCount: 197,
    structureCrcVerified: true,
    trustedDecodeVerified: true,
    limits: PNG_SOURCE_LIMITS,
  })

  const loaded = createCurriculumPracticeReleaseLoader({ releaseRoot: scratchRoot, sourceAssetRoot })()
  assert.equal(loaded.publicCatalog.questions.length, 145)
  assert.equal(loaded.answerById.size, 145)
  assert.equal(loaded.publicCatalog.routes.find((route) => route.id === 'ap-physics-1-mcq-study').questionCount, 40)
  assert.equal(loaded.publicCatalog.routes.find((route) => route.id === 'ap-physics-c-em-mcq-study').questionCount, 105)
  assert.ok(!loaded.publicCatalog.questions.some((question) => question.paperId.includes('2021')), '2021 remains outside the first official-binding release')
  assert.doesNotMatch(JSON.stringify(loaded.publicCatalog), /correctOptions|answerHash|markScheme|gatewayEnvelope|qwenEnvelope|bindingHash/)
  const firstQuestion = loaded.publicCatalog.questions[0]
  const firstAsset = loaded.resolveSourceAsset(firstQuestion.id, firstQuestion.source.assetIds[0])
  assert.ok(firstAsset?.bytes > 0)
  assert.equal(await fileSha256(firstAsset.filePath), firstAsset.sha256)
  const realPngBytes = await fs.readFile(firstAsset.filePath)
  assert.deepEqual(
    inspectPngSource(realPngBytes, { expectedBytes: firstAsset.bytes, expectedWidth: firstAsset.width, expectedHeight: firstAsset.height }),
    { bytes: firstAsset.bytes, width: firstAsset.width, height: firstAsset.height },
    'a real released PNG must pass shared runtime structure, CRC and geometry validation',
  )
  assert.throws(() => inspectPngSource(realPngBytes.subarray(0, 24)), /PNG|truncated|chunk/i, 'header-only PNG stubs must fail')
  assert.throws(() => inspectPngSource(corruptFirstIdatByte(realPngBytes)), /CRC/i, 'IDAT corruption must fail CRC validation')
  assert.throws(() => inspectPngSource(pngWithoutChunk(realPngBytes, 'IDAT')), /IDAT/i, 'a PNG without image data must fail')
  assert.throws(() => inspectPngSource(pngWithoutChunk(realPngBytes, 'IEND')), /IEND/i, 'a PNG without its terminal chunk must fail')
  assert.throws(() => inspectPngSource(realPngBytes, { expectedWidth: firstAsset.width + 1, expectedHeight: firstAsset.height }), /width|geometry/i, 'declared dimensions must match decoded PNG metadata')
  const tooWideRealPng = createCanvas(PNG_SOURCE_LIMITS.maxWidth + 1, 1).toBuffer('image/png')
  assert.throws(() => inspectPngSource(tooWideRealPng), /geometry|dimensions|pixel/i, 'a real decodable PNG beyond the geometry limit must fail')
  const oversizedRealPng = Buffer.concat([realPngBytes, Buffer.alloc(PNG_SOURCE_LIMITS.maxBytes - realPngBytes.length + 1)])
  assert.throws(() => inspectPngSource(oversizedRealPng), /byte length/i, 'an oversized source image must fail before parsing')

  const symlinkAssetRoot = path.join(scratchRoot, 'symlink-assets')
  await fs.mkdir(symlinkAssetRoot)
  const sourceAssetManifest = JSON.parse(await fs.readFile(path.join(scratchRoot, 'source-assets.json'), 'utf8'))
  const topLevelDirectories = [...new Set(sourceAssetManifest.assets.map((asset) => asset.relativePath.split('/')[0]))]
  for (const directory of topLevelDirectories) {
    await fs.symlink(path.join(sourceAssetRoot, directory), path.join(symlinkAssetRoot, directory), process.platform === 'win32' ? 'junction' : 'dir')
  }
  const escaped = createCurriculumPracticeReleaseLoader({ releaseRoot: scratchRoot, sourceAssetRoot: symlinkAssetRoot })()
  assert.equal(escaped.resolveSourceAsset(firstQuestion.id, firstQuestion.source.assetIds[0]), null, 'source loader must reject a symlink that escapes the configured root')
  await assert.rejects(
    () => validateApIbRuntimeRelease({ releaseRoot: scratchRoot, sourceAssetRoot: symlinkAssetRoot }),
    /escapes root/,
  )

  const tamperedRoot = path.join(scratchRoot, 'tampered')
  await fs.mkdir(tamperedRoot)
  for (const name of releaseFiles) {
    await fs.copyFile(path.join(scratchRoot, name), path.join(tamperedRoot, name))
  }
  const tampered = JSON.parse(await fs.readFile(path.join(tamperedRoot, 'public-catalog.json'), 'utf8'))
  tampered.questions[0].correctOptions = ['A']
  await fs.writeFile(path.join(tamperedRoot, 'public-catalog.json'), JSON.stringify(tampered), 'utf8')
  assert.throws(() => createCurriculumPracticeReleaseLoader({ releaseRoot: tamperedRoot, sourceAssetRoot })(), (error) => error.code === 'curriculum_practice_release_unavailable')

  const mismatchCases = [
    {
      name: 'handoff-mismatch',
      pattern: /handoff/i,
      mutate: ({ sourceAssets: value }) => { value.handoffSha256 = '0'.repeat(64) },
    },
    {
      name: 'paper-mismatch',
      pattern: /paper/i,
      mutate: ({ sourceAssets: value }) => { value.assets[0].paperId = `${value.assets[0].paperId}-wrong` },
    },
    {
      name: 'page-mismatch',
      pattern: /page/i,
      mutate: ({ sourceAssets: value }) => { value.assets[0].page = 999 },
    },
    {
      name: 'role-mismatch',
      pattern: /kind|role|qp-region/i,
      mutate: ({ sourceAssets: value }) => { value.assets[0].kind = 'ms-region' },
    },
    {
      name: 'question-binding-mismatch',
      pattern: /question|binding/i,
      mutate: ({ sourceAssets: value }) => { value.questions[0].assetIds = value.questions[0].assetIds.slice(1) },
    },
    {
      name: 'asset-question-id-mismatch',
      pattern: /question|binding/i,
      mutate: ({ sourceAssets: value }) => { value.assets[0].questionId = value.questions[1].questionId },
    },
    {
      name: 'source-page-evidence-mismatch',
      pattern: /source page evidence hash conflicts/i,
      mutate: ({ sourceAssets: value }) => {
        const firstIndex = value.assets.findIndex((asset, index) => value.assets.some((candidate, candidateIndex) => candidateIndex !== index && candidate.paperId === asset.paperId && candidate.page === asset.page))
        const secondIndex = value.assets.findIndex((asset, index) => index !== firstIndex && asset.paperId === value.assets[firstIndex].paperId && asset.page === value.assets[firstIndex].page)
        if (firstIndex < 0 || secondIndex < 0) throw new Error('Real source fixture needs two crops from one source page')
        value.assets[secondIndex].sourcePageSha256 = value.assets[firstIndex].sourcePageSha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64)
      },
    },
    {
      name: 'topic-route-mismatch',
      pattern: /topic/i,
      mutate: ({ publicCatalog: value }) => {
        const question = value.questions[0]
        const otherRoute = value.routes.find((route) => route.id !== question.routeId)
        question.topicIds = [otherRoute.topics[0].id]
      },
    },
    {
      name: 'answer-mode-mismatch',
      pattern: /single-answer/i,
      mutate: ({ publicCatalog, privateAnswers }) => {
        const question = publicCatalog.questions.find((candidate) => candidate.answerMode === 'single')
        const answer = privateAnswers.answers.find((candidate) => candidate.questionId === question.id)
        answer.correctOptions = [...answer.correctOptions, question.options.find((option) => !answer.correctOptions.includes(option))].sort()
      },
    },
  ]
  for (const mismatch of mismatchCases) {
    const mismatchRoot = path.join(scratchRoot, mismatch.name)
    await copyReleaseFiles(scratchRoot, mismatchRoot)
    await rewriteSelfConsistentRelease(mismatchRoot, mismatch.mutate)
    await assert.rejects(
      () => validateApIbRuntimeRelease({ releaseRoot: mismatchRoot, sourceAssetRoot }),
      mismatch.pattern,
      `${mismatch.name}: offline validation must reject a self-consistent but cross-artifact-invalid release`,
    )
    assert.throws(
      () => createCurriculumPracticeReleaseLoader({ releaseRoot: mismatchRoot, sourceAssetRoot })(),
      (error) => error.code === 'curriculum_practice_release_unavailable',
      `${mismatch.name}: runtime loading must repeat the cross-artifact gate`,
    )
  }

  console.log(JSON.stringify({ status: 'PASS', questions: 145, sourceAssets: 197, releaseHash: validated.release.releaseHash, publicAnswerLeak: false, pngStructureCrcGeometryVerified: true, pngRealDecodeVerified: true, crossArtifactBindingVerified: true, symlinkEscapeRejected: true, tamperRejected: true }))
} finally {
  await fs.rm(scratchRoot, { recursive: true, force: true })
}
