import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildApIbRuntimeCandidate, fileSha256 } from './build-apib-runtime-artifact.mjs'
import { validateApIbRuntimeRelease } from './validate-apib-runtime-release.mjs'
import { createCurriculumPracticeReleaseLoader } from '../server/curriculumPracticeRoutes.js'

const workRoot = 'D:\\CodexWork\\ap-ib-ocr-delta-20261003'
const handoffPath = path.join(workRoot, 'reports', '2026-10-04', 'apib-question-review-handoff-v2.json')
const sourceAssetsPath = path.join(workRoot, 'runtime-candidate', '2026-10-04', 'source-assets-v7.json')
const sourceAssetRoot = path.join(workRoot, 'runtime-candidate', '2026-10-04', 'assets-v7')
const boundaryAuditPath = path.join(workRoot, 'runtime-candidate', '2026-10-04', 'source-asset-boundary-audit-v7.json')
const scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'apib-runtime-release-'))

try {
  const boundaryAudit = JSON.parse(await fs.readFile(boundaryAuditPath, 'utf8'))
  assert.equal(boundaryAudit.status, 'PASS')
  assert.equal(boundaryAudit.passCount, 145)
  assert.equal(boundaryAudit.blockedCount, 0)
  assert.equal(boundaryAudit.sourceAssetManifestSha256, await fileSha256(sourceAssetsPath))
  const built = await buildApIbRuntimeCandidate({ handoffPath, sourceAssetsPath, outputRoot: scratchRoot, createdAt: '2026-10-04T00:00:00.000Z' })
  assert.equal(built.candidate.totals.questions, 145)
  assert.equal(built.candidate.totals.sourceAssets, 206)
  const validated = await validateApIbRuntimeRelease({ releaseRoot: scratchRoot, sourceAssetRoot, write: true, validatedAt: '2026-10-04T00:01:00.000Z' })
  assert.equal(validated.release.studentStudyEligible, true)
  assert.equal(validated.release.formalProgressEligible, false)
  assert.equal(validated.release.review.independentPassCount, 2)

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
  for (const name of ['release-manifest.json', 'candidate-manifest.json', 'public-catalog.json', 'private-answer-index.json', 'source-assets.json']) {
    await fs.copyFile(path.join(scratchRoot, name), path.join(tamperedRoot, name))
  }
  const tampered = JSON.parse(await fs.readFile(path.join(tamperedRoot, 'public-catalog.json'), 'utf8'))
  tampered.questions[0].correctOptions = ['A']
  await fs.writeFile(path.join(tamperedRoot, 'public-catalog.json'), JSON.stringify(tampered), 'utf8')
  assert.throws(() => createCurriculumPracticeReleaseLoader({ releaseRoot: tamperedRoot, sourceAssetRoot })(), (error) => error.code === 'curriculum_practice_release_unavailable')

  console.log(JSON.stringify({ status: 'PASS', questions: 145, sourceAssets: 206, boundaryAudit: '145/145', releaseHash: validated.release.releaseHash, publicAnswerLeak: false, pngGeometryVerified: true, symlinkEscapeRejected: true, tamperRejected: true }))
} finally {
  await fs.rm(scratchRoot, { recursive: true, force: true })
}
