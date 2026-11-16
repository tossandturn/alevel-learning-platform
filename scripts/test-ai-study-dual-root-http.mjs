import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { backup, DatabaseSync } from 'node:sqlite'
import { createServer as createViteServer, preview as createVitePreview } from 'vite'
import { createCanvas } from '@napi-rs/canvas'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { canonicalHandwritingMarkingImages } from '../server/aiApi.js'
import { MARKING_CAPABILITY_AUDIENCE, MARKING_CAPABILITY_ISSUER, MARKING_CAPABILITY_SCOPE, signHmacJwt } from '../server/markingCapability.js'
import { closeStemDatabaseForTests } from '../server/stemApi.js'
import { seedSyllabusTables, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { studyQuestionBank } from '../src/data/questionBank.js'
import { syllabusPracticeRebindPayload } from '../src/lib/syllabusPracticeRebind.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'
import { createReleaseChapterBinding, createRuntimeAiQuestionBank, localCieLibrary, releaseBuildIdentity } from '../vite.config.js'
import { freeFetchPort } from './lib/fetch-safe-port.mjs'
import { artifactTreeIdentity } from './release-content-policy.mjs'

// This is a local-only fixture. All PDFs, artifacts, identities and keys are synthetic.
const workspace = fs.realpathSync(path.resolve(import.meta.dirname, '..'))
const root = fs.mkdtempSync(path.join(workspace, '.dual-root-http-fixture-'))
const releasePinnedMode = process.argv.includes('--release-pinned')
const fixtureCommit = 'a'.repeat(40), fixtureReleaseId = `fixture-${fixtureCommit.slice(0, 7)}`
const siteRoot = path.join(root, 'site')
const releaseRoot = path.join(siteRoot, 'releases', fixtureReleaseId)
const runtimeDataRoot = path.join(siteRoot, 'shared', 'runtime-data')
const requestRoot = releasePinnedMode ? releaseRoot : root
const libraryRoot = path.join(root, 'library')
const legacyRoot = path.join(root, 'legacy')
const candidateRoot = releasePinnedMode ? path.join(runtimeDataRoot, 'ai-study-packs', 'fixture-pack') : path.join(root, 'candidate')
const cacheRoot = path.join(root, 'source-cache')
const databasePath = path.join(root, 'fixture.sqlite')
const signingKey = 'fixture-only-internal-signing-key'
const q8Mode = process.argv.includes('--q8')
const batchMode = process.argv.includes('--batch-9708')
const rollbackMode = process.argv.includes('--rollback-9708')
assert.ok(!(q8Mode && batchMode), 'select one real-source fixture')
assert.ok(!rollbackMode || batchMode, 'rollback verification requires the reviewed batch fixture')
const captureEvidence = q8Mode && process.argv.includes('--capture-evidence')
const routes = {
  physics: { routeId: 'cie-9702-as-physics', subject: '9702', stage: 'AS', topic: 'physics-9702-topic-01', component: 2 },
  biology: { routeId: 'cie-9700-as-biology', subject: '9700', stage: 'AS', topic: '9700-as-topic-01', component: 2 },
  candidate: q8Mode
    ? { routeId: 'cie-9708-a2-economics', subject: '9708', stage: 'A2', topic: '9708-a2-topic-8-1', component: 3 }
    : batchMode ? { routeId: 'cie-9708-as-economics', subject: '9708', stage: 'AS', topic: '9708-as-topic-1-5', component: 1 }
      : { routeId: 'cie-9701-a2-chemistry', subject: '9701', stage: 'A2', topic: '9701-a2-topic-23-energetics', component: 4 },
}
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const keys = crypto.generateKeyPairSync('ed25519')
const trustedPublicKeys = { 'dual-root-http-fixture': keys.publicKey }
const originalCwd = process.cwd()
const originalFetch = globalThis.fetch
let externalNetworkAttempts = 0
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    externalNetworkAttempts += 1
    throw new Error('External network access is forbidden in this fixture')
  }
  return originalFetch(input, options)
}
const forbiddenPrivateConfig = path.resolve(os.homedir(), '.config', 'stemist').toLowerCase()
const guardedMethods = ['lstatSync', 'statSync', 'openSync', 'readFileSync', 'accessSync']
const originalFsMethods = new Map(guardedMethods.map((method) => [method, fs[method]]))
let privateConfigProbes = 0
let privateConfigProbeStack = ''
for (const method of guardedMethods) {
  fs[method] = function guardedPrivateConfig(file, ...args) {
    if (typeof file === 'string') {
      const resolved = path.resolve(file).toLowerCase()
      if (resolved === forbiddenPrivateConfig || resolved.startsWith(`${forbiddenPrivateConfig}${path.sep}`)) {
        privateConfigProbes += 1
        privateConfigProbeStack = new Error('Blocked private configuration probe').stack
        throw new Error('Private provider configuration is forbidden in this fixture')
      }
    }
    return originalFsMethods.get(method).call(this, file, ...args)
  }
}
let provider, server, vite, inspectionDb, oldStemModule

function writeFixtureArtifact(fixture, artifactRoot) {
  const session = (id, provider, model) => ({ sessionId: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
    turnId: `10000000-0000-4000-8000-${id.padStart(12, '0')}`, modelProvider: provider, model,
    sessionLogSha256: (id === '1' ? '1' : '2').repeat(64), outputSha256: (id === '1' ? '3' : '4').repeat(64) })
  const name = `${fixture.subject}_m25_qp_${fixture.component}9.pdf`
  const markSchemeName = name.replace('_qp_', '_ms_')
  const subjectRoot = path.join(libraryRoot, fixture.subject)
  fs.mkdirSync(subjectRoot, { recursive: true })
  const qp = Buffer.from(`%PDF-1.4\nSYNTHETIC FIXTURE ONLY ${fixture.subject} question\n%%EOF\n`)
  const ms = Buffer.from(`%PDF-1.4\nSYNTHETIC FIXTURE ONLY ${fixture.subject} mark scheme\n%%EOF\n`)
  const qpPath = path.join(subjectRoot, name)
  const msPath = path.join(subjectRoot, markSchemeName)
  fs.writeFileSync(qpPath, qp)
  fs.writeFileSync(msPath, ms)
  const paperId = `cie-${fixture.subject}-${name.replace(/\.pdf$/, '')}`
  const questionPdfSha256 = sha256(qp)
  const markSchemePdfSha256 = sha256(ms)
  const identity = artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })
  const canvas = createCanvas(120, 160)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'; context.fillRect(0, 0, 120, 160)
  context.fillStyle = '#000'; context.fillRect(20, 30, 60, 20)
  const page = canvas.toBuffer('image/png'), pageHash = sha256(page)
  for (const [documentHash, pageNumber] of [[questionPdfSha256, 3], [markSchemePdfSha256, 5]]) {
    const directory = path.join(cacheRoot, documentHash)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, `${pageNumber}-${pageHash}.png`), page)
  }
  const region = { page: 3, pageImageSha256: pageHash, x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }
  const evidence = { page: 5, pageImageSha256: pageHash }
  const tags = { primaryTopicId: fixture.topic, secondaryTopicIds: [], syllabusPointIds: [] }
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1', artifactId: identity, paperId,
    subject: fixture.subject, stage: fixture.stage, syllabusRouteId: fixture.routeId,
    status: 'ai-verified', storageMode: 'coordinate-only',
    extractor: { provider: 'synthetic-extractor', model: 'fixture-extractor', schemaName: 'ai_pdf_question_extraction_v1',
      runtimeAttestation: session('1', 'synthetic-extractor', 'fixture-extractor') },
    verifier: { provider: 'synthetic-verifier', model: 'fixture-verifier', schemaName: 'ai_pdf_question_verification_v1',
      runtimeAttestation: session('2', 'synthetic-verifier', 'fixture-verifier') },
    source: { questionPdfPath: qpPath, markSchemePdfPath: msPath, questionPdfSha256, markSchemePdfSha256, renderDpi: 180,
      pageImageHashes: { 3: pageHash }, pageSizes: { 3: { width: 120, height: 160 } },
      markSchemePageHashes: { 5: pageHash }, markSchemePageSizes: { 5: { width: 120, height: 160 } } },
    candidate: { questions: [{ questionNumber: '99', regions: [region], diagramRegions: [],
      parts: [{ label: 'a', marks: 4, ocrText: 'Synthetic fixture question.' }], tags, markSchemeEvidence: [evidence] }] },
    verification: { questions: [{ questionNumber: '99', pages: [3], regions: [region], diagramRegions: [],
      diagramRegionCount: 0, parts: [{ label: 'a', marks: 4 }], tags, markSchemeEvidence: [evidence] }] },
  }
  artifact.studentRelease = buildAiStudentStudyRelease({ ...artifact, routeId: fixture.routeId })
  assert.ok(artifact.studentRelease, `${fixture.routeId}: fixture release must be independently bound`)
  const relative = `${paperId}/${identity.slice('sha256:'.length)}.json`
  const artifactPath = path.join(artifactRoot, ...relative.split('/'))
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
  fs.writeFileSync(artifactPath, JSON.stringify(artifact))
  return { ...fixture, artifactPath, relative, paperId, questionId: `${paperId}:q99`, questionPdfSha256, markSchemePdfSha256 }
}

function writeQ8Simulation(fixture, artifactRoot) {
  const sourceRoot = 'D:/CodexWork/ai-function-regression-20261103/qa/9708-q8-q19-review-20261116/simulation-two-model'
  const paperId = 'cie-9708-9708_s25_qp_32'
  const marker = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'candidate-manifest.json'), 'utf8'))
  assert.equal(marker.productionEligible, false)
  const sourceArtifact = path.join(sourceRoot, paperId, 'q8.json')
  const artifactBytes = fs.readFileSync(sourceArtifact)
  const artifact = JSON.parse(artifactBytes.toString('utf8'))
  assert.equal(artifact.studentRelease?.review?.independentPassCount, 2)
  assert.equal(artifact.studentRelease?.formalProgressEligible, false)
  const subjectRoot = path.join(libraryRoot, '9708')
  fs.mkdirSync(subjectRoot, { recursive: true })
  for (const field of ['questionPdfRelativePath', 'markSchemePdfRelativePath']) {
    const relative = artifact.source[field]
    const original = path.join('D:/CodexWork/cie-fraft-fetcher/output/pdf', ...relative.split('/'))
    fs.copyFileSync(original, path.join(libraryRoot, ...relative.split('/')))
  }
  const originalCache = 'D:/CodexWork/stem-ocr-work/candidate-source-page-cache/9708-s25-p32-q8-local-20261116'
  for (const [documentHash, pageNumber, pageHash] of [
    [artifact.source.questionPdfSha256, 4, artifact.source.pageImageHashes['4']],
    [artifact.source.markSchemePdfSha256, 2, artifact.source.markSchemePageHashes['2']],
  ]) {
    const directory = path.join(cacheRoot, documentHash)
    fs.mkdirSync(directory, { recursive: true })
    fs.copyFileSync(path.join(originalCache, documentHash, `${pageNumber}-${pageHash}.png`), path.join(directory, `${pageNumber}-${pageHash}.png`))
  }
  const relative = `${paperId}/q8.json`
  const artifactPath = path.join(artifactRoot, ...relative.split('/'))
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
  fs.writeFileSync(artifactPath, artifactBytes)
  return { ...fixture, artifactPath, relative, paperId, questionId: `${paperId}:q8`,
    questionPdfSha256: artifact.source.questionPdfSha256, markSchemePdfSha256: artifact.source.markSchemePdfSha256 }
}

function writeBatchSimulation(fixture, artifactRoot) {
  const sourceRoot = 'D:/CodexWork/stem-ocr-work/candidate-artifacts/9708-m25-p12-18-reviewed-records-pending-20261116'
  const qaRoot = 'D:/CodexWork/ai-function-regression-20261103/qa/9708-m25-p12-batch-20261116'
  const marker = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'candidate-manifest.json'), 'utf8'))
  const batch = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'reviewed-records-manifest.json'), 'utf8'))
  const tableBytes = fs.readFileSync(path.join(qaRoot, 'question-evidence-table-v2.json'))
  const table = JSON.parse(tableBytes)
  assert.equal(marker.productionEligible, false); assert.equal(marker.status, 'pending')
  assert.equal(marker.evidenceTableSha256, sha256(tableBytes))
  assert.equal(batch.status, 'PENDING_NOT_DEPLOYED'); assert.equal(batch.files.length, 18)
  assert.deepEqual(batch.excludedQuestionNumbers, [29])
  const subjectRoot = path.join(libraryRoot, fixture.subject)
  fs.mkdirSync(subjectRoot, { recursive: true })
  for (const file of ['9708_m25_qp_12.pdf', '9708_m25_ms_12.pdf']) {
    fs.copyFileSync(path.join('D:/CodexWork/cie-fraft-fetcher/output/pdf/9708', file), path.join(subjectRoot, file))
  }
  const sourceCache = 'D:/CodexWork/stem-ocr-work/candidate-source-page-cache/active-safe-20261115-v4'
  const copiedPages = new Set(), artifacts = []
  for (const entry of batch.files) {
    const original = fs.readFileSync(path.join(sourceRoot, ...entry.file.split('/')))
    assert.equal(sha256(original), entry.sha256)
    const artifact = JSON.parse(original)
    assert.equal(artifact.status, 'ai-verified')
    assert.equal(artifact.studentRelease.review.method, 'single-model-source-review')
    assert.equal(artifact.studentRelease.review.independentPassCount, 1)
    assert.equal(artifact.studentRelease.formalProgressEligible, false)
    const row = table.rows.find((item) => item.sourceQuestionId === entry.sourceQuestionId)
    assert.equal(row?.status, 'SOURCE_REVIEWED_PENDING_RELEASE')
    const receipt = JSON.parse(fs.readFileSync(row.sessionAttestationPath, 'utf8'))
    assert.equal(sha256(fs.readFileSync(row.reviewPath)), row.reviewSha256)
    assert.equal(receipt.sessionId, row.sessionId)
    const q = artifact.candidate.questions[0]
    const evidence = [...(q.regions || []), ...(q.diagramRegions || []), ...(q.sharedStemRegions || [])]
      .map((region) => ({ document: 'qp', page: region.page, pageImageSha256: region.pageImageSha256 }))
      .concat((q.markSchemeEvidence || []).map((region) => ({ document: 'ms', page: region.page, pageImageSha256: region.pageImageSha256 })))
    assert.equal(artifact.sourceReview.runtimeAttestation.sessionId, row.sessionId)
    assert.equal(artifact.sourceReview.runtimeAttestation.outputSha256, row.reviewSha256)
    for (const region of evidence) {
      const documentHash = region.document === 'qp' ? artifact.source.questionPdfSha256 : artifact.source.markSchemePdfSha256
      const key = `${documentHash}:${region.page}:${region.pageImageSha256}`
      if (copiedPages.has(key)) continue
      const directory = path.join(cacheRoot, documentHash)
      fs.mkdirSync(directory, { recursive: true })
      const file = `${region.page}-${region.pageImageSha256}.png`
      fs.copyFileSync(path.join(sourceCache, documentHash, file), path.join(directory, file))
      copiedPages.add(key)
    }
    const relative = `${artifact.paperId}/q${row.questionNumber}.json`, artifactPath = path.join(artifactRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
    fs.writeFileSync(artifactPath, original)
    assert.equal(sha256(fs.readFileSync(artifactPath)), entry.sha256, 'test the exact pending record bytes')
    artifacts.push({ artifactPath, relative, row })
  }
  const first = artifacts.find((entry) => entry.row.questionNumber === 3)
  assert.ok(first && artifacts.length === 18)
  return { ...fixture, artifactPath: first.artifactPath, relative: first.relative, artifacts,
    paperId: table.paperId, questionId: first.row.sourceQuestionId, questionIds: artifacts.map((entry) => entry.row.sourceQuestionId),
    questionPdfSha256: first.row.qpPageSha256 && JSON.parse(fs.readFileSync(first.artifactPath, 'utf8')).source.questionPdfSha256,
    markSchemePdfSha256: JSON.parse(fs.readFileSync(first.artifactPath, 'utf8')).source.markSchemePdfSha256 }
}

function signCandidate(fixture) {
  const markerPath = path.join(candidateRoot, 'candidate-manifest.json')
  fs.writeFileSync(markerPath, JSON.stringify({ schemaVersion: 'stem-ai-study-candidate-manifest.v1',
    status: 'approved', productionEligible: true, formalProgressEligible: false }))
  const artifacts = fixture.artifacts || [fixture]
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 'stem-ai-study-promotion.v1', status: 'approved',
    scope: 'student-study-only', formalProgressEligible: false, expectedRouteGroups: artifacts.length,
    candidateManifest: { path: 'candidate-manifest.json', sha256: sha256(fs.readFileSync(markerPath)) },
    artifacts: artifacts.map((entry) => ({ path: entry.relative, sha256: sha256(fs.readFileSync(entry.artifactPath)) })) }))
  fs.writeFileSync(path.join(candidateRoot, 'study-promotion-manifest.json'), JSON.stringify({
    schemaVersion: 'stem-ai-study-promotion-envelope.v1', payloadBase64: payload.toString('base64'),
    signature: { algorithm: 'Ed25519', keyId: 'dual-root-http-fixture', value: crypto.sign(null, payload, keys.privateKey).toString('base64') },
  }))
}

function preparePinnedRelease(fixture) {
  const artifacts = fixture.artifacts || [fixture]
  const pageRoot = path.join(candidateRoot, 'source-pages')
  const copied = new Set()
  for (const entry of artifacts) {
    const artifact = JSON.parse(fs.readFileSync(entry.artifactPath, 'utf8'))
    for (const question of artifact.candidate.questions) {
      const evidence = [...(question.regions || []), ...(question.diagramRegions || []), ...(question.sharedStemRegions || [])]
        .map((region) => ({ documentHash: artifact.source.questionPdfSha256, ...region }))
        .concat((question.markSchemeEvidence || []).map((region) => ({ documentHash: artifact.source.markSchemePdfSha256, ...region })))
      for (const item of evidence) {
        const file = `${item.page}-${item.pageImageSha256}.png`, key = `${item.documentHash}/${file}`
        if (copied.has(key)) continue
        const source = path.join(cacheRoot, item.documentHash, file), target = path.join(pageRoot, item.documentHash, file)
        assert.ok(path.relative(root, source).startsWith(`source-cache${path.sep}`), 'only fixture pages may be moved')
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
        assert.equal(sha256(fs.readFileSync(target)), item.pageImageSha256)
        fs.unlinkSync(source)
        copied.add(key)
      }
    }
  }
  const marker = Buffer.from(JSON.stringify({ schemaVersion: 'stem-ai-study-release-pack.v1', scope: 'chapter-study',
    formalProgressEligible: false, routeIds: [fixture.routeId], expectedRouteGroups: artifacts.length,
    artifacts: artifacts.map((entry) => ({ path: entry.relative, sha256: sha256(fs.readFileSync(entry.artifactPath)) })) }))
  fs.writeFileSync(path.join(candidateRoot, 'candidate-manifest.json'), marker)
  const assets = path.join(releaseRoot, 'public', 'question-assets')
  fs.mkdirSync(assets, { recursive: true })
  fs.mkdirSync(path.join(releaseRoot, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(releaseRoot, 'dist', 'index.html'), '<!doctype html><title>fixture</title>')
  fs.writeFileSync(path.join(assets, 'synthetic.txt'), 'fixture only')
  fs.writeFileSync(path.join(releaseRoot, 'dist', 'build-identity.json'), JSON.stringify({
    schemaVersion: 'stem-build-identity.v1', commit: fixtureCommit, sourceState: 'clean' }))
  fs.symlinkSync(runtimeDataRoot, path.join(releaseRoot, 'data'), process.platform === 'win32' ? 'junction' : 'dir')
  const baseline = { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: [routes.physics.routeId, routes.biology.routeId],
    readinessMode: 'student-study', aiStudyFormalProgressEligible: false }
  const manifest = { schemaVersion: 'stem-release-manifest.v1', releaseId: fixtureReleaseId, commit: fixtureCommit,
    packageSha256: 'b'.repeat(64), generatedAt: new Date().toISOString(), releaseTree: artifactTreeIdentity(releaseRoot),
    immutableAssets: { identity: path.basename(assets), ...artifactTreeIdentity(assets) },
    runtimeData: { schemaVersion: 'stem-runtime-data-binding.v1', relativePath: 'data', target: fs.realpathSync(runtimeDataRoot) },
    syllabusScope: { schemaVersion: 'stem-syllabus-release-scope.v2', baseline,
      baselineIdentity: { releaseId: fixtureReleaseId, commit: fixtureCommit, manifestSha256: 'c'.repeat(64) },
      chapterStudy: { schemaVersion: 'stem-chapter-study-release-scope.v1', routeIds: [fixture.routeId],
        topicScopes: { [fixture.routeId]: [fixture.topic] }, formalProgressEligible: false,
        packBinding: { schemaVersion: 'stem-release-study-pack-binding.v1',
          relativePath: 'data/ai-study-packs/fixture-pack', manifestSha256: sha256(marker) } } } }
  const bytes = Buffer.from(JSON.stringify(manifest)), manifestPath = path.join(releaseRoot, 'release-manifest.json')
  fs.writeFileSync(manifestPath, bytes)
  const anchorRoot = path.join(siteRoot, 'shared', 'verified-release-anchors')
  fs.mkdirSync(anchorRoot, { recursive: true })
  const anchorPath = path.join(anchorRoot, `${fixtureReleaseId}.json`)
  fs.writeFileSync(anchorPath, JSON.stringify({ schemaVersion: 'stem-verified-release-anchor.v1',
    releaseId: fixtureReleaseId, commit: fixtureCommit, manifestSha256: sha256(bytes), routeIds: [fixture.routeId] }))
  return { manifestPath, anchorPath, markerBytes: marker }
}

function token(userId = 'ielts:940099') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: userId,
    username: 'synthetic-fixture-student', iat: now, exp: now + 3600 })).toString('base64url')
  return `${header}.${payload}.${crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')}`
}

async function listen(target) {
  const port = await freeFetchPort()
  return new Promise((resolve, reject) => {
    target.once('error', reject)
    target.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}`))
  })
}

function close(target) { return new Promise((resolve, reject) => target.close((error) => error ? reject(error) : resolve())) }

function unitFromSet(set, id) {
  return { id, type: 'topic', sourceAuthority: 'server-syllabus', sourceGateVersion: 'server-syllabus-catalog-v2',
    routeId: set.routeId, stage: set.stage, knowledgeGroupId: set.syllabusTopicIds[0],
    syllabusTopic: set.syllabusTopicIds.join(','), paperComponent: set.components, studyMode: set.studyMode,
    sourcePreference: set.sourcePreference, practiceMode: set.practiceMode,
    parts: set.questionGroups.flatMap((group) => group.parts.map((part) => ({
      id: `${id}:${group.id}:${part.partId}`, sourceQuestionId: group.id, questionPartId: part.partId,
      markingProvenance: part.markingProvenance, sourceBindingProvenance: part.sourceBindingProvenance,
    }))) }
}

function draftBody(fixture, unit, attemptId, answers = {}) {
  return { attemptId, mode: 'topic', routeId: fixture.routeId, stage: fixture.stage, unitId: unit.id,
    studyMode: 'chapter-study', sourcePreference: 'official-first',
    markingParts: unit.parts.map((part) => ({ unitPartId: part.id,
      provenance: { routeId: fixture.routeId, ...(part.markingProvenance || part.sourceBindingProvenance) } })),
    attempt: { id: attemptId, unitId: unit.id, routeId: fixture.routeId, stage: fixture.stage,
      studyMode: 'chapter-study', sourcePreference: 'official-first', answers } }
}

function expectStatus(result, status, label) {
  const detail = typeof result.payload === 'string' ? result.payload.slice(0, 500)
    : JSON.stringify({ code: result.payload?.code, error: result.payload?.error, routeId: result.payload?.routeId })
  assert.equal(result.status, status, `${label}: ${detail}`)
}

try {
  if (q8Mode || batchMode) {
    const requiredFixtures = [
      'D:/CodexWork/cie-fraft-fetcher/output/pdf/9702/9702_m25_qp_42.pdf',
      ...(q8Mode ? [
        'D:/CodexWork/ai-function-regression-20261103/qa/9708-q8-q19-review-20261116/simulation-two-model',
        'D:/CodexWork/stem-ocr-work/candidate-source-page-cache/9708-s25-p32-q8-local-20261116',
      ] : [
        'D:/CodexWork/stem-ocr-work/candidate-artifacts/9708-m25-p12-18-reviewed-records-pending-20261116',
        'D:/CodexWork/ai-function-regression-20261103/qa/9708-m25-p12-batch-20261116/question-evidence-table-v2.json',
        'D:/CodexWork/stem-ocr-work/candidate-source-page-cache/active-safe-20261115-v4',
        ...['1.0.92-83b8d9f', '1.0.93-17c480b', '1.0.95-e73701e'].map((version) =>
          `D:/CodexWork/ai-function-regression-20261103/stemist-miniprogram-review-${version}`),
      ]),
    ]
    const missing = requiredFixtures.filter((item) => !fs.existsSync(item))
    assert.deepEqual(missing, [], `Optional local real-source acceptance needs its local fixtures; no production validation ran. Missing: ${missing.join(', ')}`)
  }
  const physics = writeFixtureArtifact(routes.physics, legacyRoot)
  const biology = writeFixtureArtifact(routes.biology, legacyRoot)
  const candidate = q8Mode ? writeQ8Simulation(routes.candidate, candidateRoot)
    : batchMode ? writeBatchSimulation(routes.candidate, candidateRoot) : writeFixtureArtifact(routes.candidate, candidateRoot)
  fs.mkdirSync(path.join(requestRoot, 'public', 'data'), { recursive: true })
  fs.copyFileSync(path.join(workspace, 'public', 'data', 'papers.json'), path.join(requestRoot, 'public', 'data', 'papers.json'))
  fs.copyFileSync('D:/CodexWork/cie-fraft-fetcher/output/pdf/9702/9702_m25_qp_42.pdf',
    path.join(libraryRoot, '9702', '9702_m25_qp_42.pdf'))
  // Fix this before any successful load so a later mutation preserves the
  // exact metadata seen by every loader and HTTP request.
  const fixedTime = new Date('2025-01-02T03:04:05.000Z')
  fs.utimesSync(candidate.artifactPath, fixedTime, fixedTime)
  const pinnedRelease = releasePinnedMode ? preparePinnedRelease(candidate) : null
  if (!releasePinnedMode) signCandidate(candidate)
  const legacy = createAiVerifiedQuestionBankLoader({ artifactRoot: legacyRoot, libraryRoot })()
  const promoted = createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot,
    promotionPolicy: releasePinnedMode ? { mode: 'release-pinned', trustedManifestSha256: sha256(pinnedRelease.markerBytes),
      expectedRealRoot: fs.realpathSync(candidateRoot), expectedRouteIds: [candidate.routeId] }
      : { mode: 'signed-candidate', trustedPublicKeys } })()
  assert.deepEqual(new Set(legacy.groups.map((group) => group.routeId)), new Set([physics.routeId, biology.routeId]))
  assert.deepEqual(new Set(promoted.groups.map((group) => group.sourceQuestionId)), new Set(candidate.questionIds || [candidate.questionId]))
  assert.equal(legacy.documents.length, 4)
  assert.equal(promoted.documents.length, 2)

  let providerCalls = 0
  provider = http.createServer((_request, response) => {
    providerCalls += 1
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: {"choices":[{"delta":{"content":"Synthetic fixture response."}}]}\n\n'
      + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  const providerBase = await listen(provider)
  const env = { NODE_ENV: 'test', STEM_DB_PATH: databasePath, STEM_INTERNAL_AUTH_KEY: signingKey,
    CIE_LIBRARY_ROOT: libraryRoot, AI_PDF_INGESTION_ROOT: legacyRoot,
    ...(!releasePinnedMode ? { STEM_AI_STUDY_CANDIDATE_ROOT: candidateRoot, STEM_AI_STUDY_CANDIDATE_ROUTES: candidate.routeId } : {}),
    STEM_ENABLE_STUDY_ONLY_TOPIC_DRILL: '1', COACH_AI_API_KEY: 'fixture-only-provider-key',
    COACH_AI_MODEL: 'fixture-model', COACH_AI_BASE_URL: providerBase,
    STEM_ACADEMIC_PROVIDER: 'legacy', STEM_ACADEMIC_PROVIDER_SETTINGS: path.join(root, 'no-private-academic-provider.json'),
    STEM_TAVERN_PROVIDER: 'legacy', STEM_TAVERN_PROVIDER_SETTINGS: path.join(root, 'no-private-provider.json'),
    TAVERN_IMAGE_PROVIDER_SETTINGS: path.join(root, 'no-private-image-provider.json'),
    STEM_CURRICULUM_PRACTICE_RELEASE_ROOT: path.join(root, 'empty-release'),
    STEM_CURRICULUM_PRACTICE_SOURCE_ROOT: path.join(root, 'empty-source'),
    STEM_IELTS_DOWNLOADS_ROOT: path.join(root, 'empty-downloads'),
    STEM_IELTS_AUDIO_DOWNLOADS_ROOT: path.join(root, 'empty-audio'),
    STEM_PDF_ACCESS_LOG_PATH: path.join(root, 'fixture-pdf-access.log'), STEM_SOURCE_PAGE_CACHE_ROOT: cacheRoot }
  const releaseChapterBinding = releasePinnedMode
    ? createReleaseChapterBinding(env, releaseRoot, releaseBuildIdentity(env, releaseRoot)) : null
  const runtime = createRuntimeAiQuestionBank({ env, libraryRoot, trustedPublicKeys, releaseChapterBinding })
  const valid = runtime({ routeId: candidate.routeId })
  assert.deepEqual(new Set(valid.groups.map((group) => group.sourceQuestionId)),
    new Set([physics.questionId, biology.questionId, ...(candidate.questionIds || [candidate.questionId])]))
  if (releasePinnedMode) {
    const question = valid.groups.find((group) => group.sourceQuestionId === candidate.questionId)
    const canonical = { ok: true, question, part: question.parts[0],
      provenance: { reviewSchemaVersion: 'stem-ai-coordinate-source-binding.v1' } }
    const rendered = await canonicalHandwritingMarkingImages(canonical, { libraryRoot, env })
    assert.ok(rendered.questionImages.length && rendered.markSchemeImages.length, 'candidate QP/MS pages use its own pinned cache')
    const item = question.parts[0].markSchemeEvidence[0]
    const page = path.join(candidateRoot, 'source-pages', candidate.markSchemePdfSha256, `${item.page}-${item.pageImageSha256}.png`)
    const bytes = fs.readFileSync(page), stat = fs.statSync(page), tamperedPage = Buffer.from(bytes)
    tamperedPage[tamperedPage.length - 1] ^= 1
    fs.writeFileSync(page, tamperedPage); fs.utimesSync(page, stat.atime, stat.mtime)
    try {
      await assert.rejects(() => canonicalHandwritingMarkingImages(canonical, { libraryRoot, env }),
        'same-size MS page tampering must fail closed')
    } finally { fs.writeFileSync(page, bytes); fs.utimesSync(page, stat.atime, stat.mtime) }
    const port = await freeFetchPort()
    const preview = await createVitePreview({ configFile: false, envFile: false, root: requestRoot, publicDir: false, logLevel: 'silent',
      preview: { port, strictPort: true, host: '127.0.0.1' }, plugins: [localCieLibrary(env, { trustedPublicKeys })] })
    try {
      const direct = await fetch(`http://127.0.0.1:${port}/data/ai-study-packs/fixture-pack/source-pages/${candidate.markSchemePdfSha256}/${item.page}-${item.pageImageSha256}.png`)
      assert.doesNotMatch(direct.headers.get('content-type') || '', /^image\/png/i, 'the mark scheme must not be served as a static page')
      assert.notEqual(sha256(Buffer.from(await direct.arrayBuffer())), sha256(bytes), 'the static response must not expose MS bytes')
    } finally { await close(preview.httpServer) }
  }

  // Disable Vite configuration and env-file discovery; cache and root are disposable fixtures.
  process.chdir(requestRoot)
  vite = await createViteServer({ configFile: false, envFile: false, root: requestRoot, cacheDir: path.join(root, 'vite-cache'),
    publicDir: false, logLevel: 'silent', appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: { ignored: '**' } },
    plugins: [localCieLibrary(env, { trustedPublicKeys })] })
  server = http.createServer((request, response) => {
    if (request.headers['x-fixture-delay'] === '1') {
      setTimeout(() => { if (!response.destroyed) vite.middlewares(request, response) }, 200)
      return
    }
    vite.middlewares(request, response)
  })
  let origin = await listen(server)
  const owner = token()
  async function request(url, { method = 'GET', body, authorization = owner, headers = {} } = {}) {
    const response = await fetch(`${origin}${url}`, { method, headers: { ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    let payload = null
    try { payload = JSON.parse(text) } catch { /* Keep non-JSON responses visible in assertion messages. */ payload = text }
    return { status: response.status, payload, contentType: response.headers.get('content-type') || '' }
  }
  const inventory = (fixture) => request(`/api/stem/routes/${encodeURIComponent(fixture.routeId)}/syllabus-topics`)
  const start = (fixture) => request('/api/stem/practice-sets', { method: 'POST', body: {
    routeId: fixture.routeId, syllabusTopicIds: [fixture.topic], components: [fixture.component], questionCount: 1,
    studyMode: 'chapter-study', sourcePreference: 'official-first', sourceQuestionIds: [fixture.questionId], excludeAttempted: false,
  } })
  const topic = (response, fixture) => response.payload.topics.find((entry) => entry.id === fixture.topic)
  const publicIds = (value) => JSON.stringify(value).includes(candidate.questionId)
  const before = new Map()
  const units = new Map()
  const imageUrls = new Map()
  let q8ImageUrl = '', q8ObjectiveBody = null, batchImageUrl = '', batchObjectiveBody = null
  const q8Versions = [], batchVersions = []
  let batchQuestionsChecked = 0, batchTagStarts = 0, rollbackSummary = null
  for (const fixture of [candidate, physics, biology]) {
    const catalog = await inventory(fixture)
    expectStatus(catalog, 200, `${fixture.routeId} valid inventory`)
    assert.ok(topic(catalog, fixture), `${fixture.routeId} topic exists`)
    assert.ok(JSON.stringify(topic(catalog, fixture)).includes(fixture.questionId), `${fixture.routeId} inventory contains the source-bound fixture`)
    const selected = await start(fixture)
    expectStatus(selected, 201, `${fixture.routeId} valid start`)
    assert.deepEqual(selected.payload.questionGroups.map((group) => group.id), [fixture.questionId])
    assert.equal(selected.payload.routeId, fixture.routeId)
    const binding = selected.payload.questionGroups[0].parts[0].sourceBindingProvenance
      || selected.payload.questionGroups[0].parts[0].markingProvenance
    assert.equal(binding?.sourceDocumentSha256, fixture.questionPdfSha256)
    assert.equal(binding?.answerDocumentSha256, fixture.markSchemePdfSha256)
    before.set(fixture.routeId, catalog.payload)
    units.set(fixture.routeId, unitFromSet(selected.payload, `syllabus-set:fixture-${fixture.subject}`))
    imageUrls.set(fixture.routeId, selected.payload.questionGroups[0].nativeSourceImages?.[0]?.url || '')
  }
  if (q8Mode) {
    const secondary = await request('/api/stem/practice-sets', { method: 'POST', body: {
      routeId: candidate.routeId, syllabusTopicIds: ['9708-a2-topic-7-4'], components: [3], questionCount: 1,
      studyMode: 'chapter-study', sourcePreference: 'official-first', sourceQuestionIds: [candidate.questionId], excludeAttempted: false,
    } })
    expectStatus(secondary, 201, 'Q8 secondary chapter start')
    assert.deepEqual(secondary.payload.questionGroups.map((group) => group.id), [candidate.questionId])
    const { miniRuntime } = await import(pathToFileURL('D:/CodexWork/ai-function-regression-20261103/client/scripts/helpers/mini-runtime.mjs'))
    const versions = [['1.0.92', 'stemist-miniprogram-review-1.0.92-83b8d9f'],
      ['1.0.93', 'stemist-miniprogram-review-1.0.93-17c480b'], ['1.0.95', 'stemist-miniprogram-review-1.0.95-e73701e']]
    const previousRuntimeRoot = process.env.STEMIST_TEST_RUNTIME_ROOT
    try {
      for (const [version, folder] of versions) {
        process.env.STEMIST_TEST_RUNTIME_ROOT = path.join('D:/CodexWork/ai-function-regression-20261103', folder)
        let preview = null, downloadFileCalls = 0
        const client = miniRuntime({ wx: { nextTick: (callback) => callback(), previewImage: (options) => { preview = options },
          downloadFile: () => { downloadFileCalls += 1 } },
        modules: { 'utils/image': { readAsJpegDataUrl: async () => '', compressImage: async (value) => value },
          'utils/api': { requestJson: async (url, body) => {
            if (url === '/api/stem/objective-answers') q8ObjectiveBody = structuredClone(body)
            const response = await fetch(new URL(url, origin), { method: 'POST', headers: { authorization: `Bearer ${owner}`,
              'content-type': 'application/json', 'x-stemist-source-images': 'region-v2' }, body: JSON.stringify(body) })
            const value = await response.json()
            if (!response.ok) throw Object.assign(new Error(value.error || 'local request failed'), { statusCode: response.status, code: value.code })
            return value
          } } } })
        client.storage.set('stemistUser', { id: 'ielts:940099' })
        client.storage.set('stemistSessionToken', owner)
        const native = client.load('utils/nativePractice')
        const spec = { routeId: candidate.routeId, stage: candidate.stage, subjectCode: candidate.subject,
          syllabusTopicIds: [candidate.topic], components: [candidate.component], questionCount: 1,
          studyMode: 'chapter-study', sourcePreference: 'official-first', foundationCatalog: 'v2' }
        const session = await native.generatePractice(spec)
        assert.equal(session.questions.length, 1, version)
        const question = session.questions[0]
        assert.equal(question.id, candidate.questionId, version)
        assert.ok(question.sourceRegions?.length, `${version}: source image missing`)
        q8ImageUrl = question.sourceRegions[0].url
        const image = await fetch(new URL(q8ImageUrl, origin))
        assert.equal(image.status, 200, `${version}: original Q8 image`)
        assert.match(image.headers.get('cache-control') || '', /no-store/i, `${version}: revocable source images must not be HTTP-cached`)
        const firstImage = Buffer.from(await image.arrayBuffer())
        assert.ok(firstImage.length > 32)
        const repeated = await fetch(new URL(q8ImageUrl, origin))
        assert.equal(repeated.status, 200, `${version}: repeat image open`)
        assert.match(repeated.headers.get('cache-control') || '', /no-store/i)
        assert.deepEqual(Buffer.from(await repeated.arrayBuffer()), firstImage)
        native.saveSession(session)
        const view = native.questionView(session, 0)
        const page = client.page('pages/stem/practice')
        page.setData({ question: view.question })
        const imageId = page.data.question.images[0].id
        const imageEvent = { currentTarget: { dataset: { id: imageId } } }
        await assert.rejects(fetch(new URL(q8ImageUrl, origin), { headers: { 'x-fixture-delay': '1' }, signal: AbortSignal.timeout(30) }),
          (error) => ['TimeoutError', 'AbortError'].includes(error.name), `${version}: simulated weak network timeout`)
        page.imageFailed(imageEvent)
        assert.equal(page.data.question.images[0].failed, true, `${version}: image failure state`)
        page.retryImage(imageEvent)
        assert.equal(page.data.question.images[0].failed, false, `${version}: image retry state`)
        assert.ok(page.data.question.images[0].url, `${version}: image retry retains its URL`)
        const retry = await fetch(new URL(q8ImageUrl, origin))
        assert.equal(retry.status, 200, `${version}: image retry after simulated timeout`)
        await retry.arrayBuffer()
        page.previewQuestion(imageEvent)
        assert.ok(preview?.current && !preview.current.endsWith('&view=region'), `${version}: preview must request the full source page`)
        assert.equal(downloadFileCalls, 0, `${version}: this dynamic question-image flow must not depend on wx.downloadFile`)
        native.saveChoice(session.id, question.id, 'D')
        const correct = await native.markChoice(session.id, question.id)
        assert.equal(correct.score, correct.maxScore, `${version}: correct local objective answer`)
        native.saveChoice(session.id, question.id, 'A')
        const incorrect = await native.markChoice(session.id, question.id)
        assert.equal(incorrect.score, 0, `${version}: incorrect local objective answer`)
        assert.ok(native.readSession(session.id), `${version}: saved session restores`)
        q8Versions.push(version)
      }
    } finally {
      if (previousRuntimeRoot === undefined) delete process.env.STEMIST_TEST_RUNTIME_ROOT
      else process.env.STEMIST_TEST_RUNTIME_ROOT = previousRuntimeRoot
    }
  }
  if (batchMode) {
    const sets = []
    const catalog = await inventory(candidate)
    expectStatus(catalog, 200, 'reviewed batch inventory')
    for (const entry of candidate.artifacts) {
      const row = entry.row
      for (const topicId of [row.primaryTopicId, ...row.secondaryTopicIds]) {
      const chapter = catalog.payload.topics.find((item) => item.id === topicId)
      const componentIds = chapter?.questionIdsByComponent?.[candidate.component]?.apiReadyQuestionIds
      assert.ok(Array.isArray(componentIds) && componentIds.includes(row.sourceQuestionId), `${row.sourceQuestionId}: chapter list`)
      assert.equal(componentIds.length, chapter.componentCounts[candidate.component].availableQuestionCount,
        `${topicId}: count and available IDs must use the same predicate`)
      const selection = await request('/api/stem/practice-sets', { method: 'POST',
        headers: { 'x-stemist-source-images': 'region-v2' }, body: { routeId: candidate.routeId,
          syllabusTopicIds: [topicId], components: [candidate.component], questionCount: 1,
          studyMode: 'chapter-study', sourcePreference: 'official-first', foundationCatalog: 'v2',
          sourceQuestionIds: [row.sourceQuestionId], excludeAttempted: false } })
      expectStatus(selection, 201, `${row.sourceQuestionId} source selection`)
      assert.deepEqual(selection.payload.questionGroups.map((group) => group.id), [row.sourceQuestionId])
      const group = selection.payload.questionGroups[0]
      assert.equal(group.formalProgressEligible, false)
      assert.equal(group.sourceRef.sha256, candidate.questionPdfSha256)
      assert.equal(group.answerRef, undefined, 'native objective projection must not expose the mark scheme')
      assert.doesNotMatch(JSON.stringify(group), /"answerKey"|"correctOption"/, 'the unsolved question must not expose its answer')
      const binding = group.parts[0].sourceBindingProvenance || group.parts[0].markingProvenance || group.parts[0].provenance
      assert.equal(binding.sourceDocumentSha256, candidate.questionPdfSha256)
      assert.equal(binding.answerDocumentSha256, candidate.markSchemePdfSha256)
      assert.equal(group.nativeSourceImages.length, 1, `${row.sourceQuestionId}: one complete source crop`)
      if (row.sourceQuestionId === candidate.questionId) batchImageUrl = group.nativeSourceImages[0].url
      const image = await fetch(new URL(group.nativeSourceImages[0].url, origin))
      assert.equal(image.status, 200)
      assert.match(image.headers.get('cache-control') || '', /no-store/i)
      assert.equal(sha256(Buffer.from(await image.arrayBuffer())), row.cropSha256,
        `${row.sourceQuestionId}: rendered crop must match the inspected candidate image`)
      batchTagStarts += 1
      if (topicId === row.primaryTopicId) sets.push({ row, payload: selection.payload })
      }
    }
    assert.equal(sets.length, 18)
    assert.equal(batchTagStarts, 21, 'all primary and secondary chapter bindings must start')
    const held = await request('/api/stem/practice-sets', { method: 'POST', body: { routeId: candidate.routeId,
      syllabusTopicIds: ['9708-as-topic-6-1'], components: [candidate.component], questionCount: 1,
      studyMode: 'chapter-study', sourcePreference: 'official-first', sourceQuestionIds: [`${candidate.paperId}:q29`], excludeAttempted: false } })
    assert.ok(held.status >= 400 && held.status < 500, 'held Q29 must not start')
    const { miniRuntime } = await import(pathToFileURL('D:/CodexWork/ai-function-regression-20261103/client/scripts/helpers/mini-runtime.mjs'))
    const versions = [['1.0.92', 'stemist-miniprogram-review-1.0.92-83b8d9f'],
      ['1.0.93', 'stemist-miniprogram-review-1.0.93-17c480b'], ['1.0.95', 'stemist-miniprogram-review-1.0.95-e73701e']]
    const previousRuntimeRoot = process.env.STEMIST_TEST_RUNTIME_ROOT
    try {
      for (const [version, folder] of versions) {
        process.env.STEMIST_TEST_RUNTIME_ROOT = path.join('D:/CodexWork/ai-function-regression-20261103', folder)
        let preview = null
        const client = miniRuntime({ wx: { nextTick: (callback) => callback(), previewImage: (options) => { preview = options } },
          modules: { 'utils/image': { readAsJpegDataUrl: async () => '', compressImage: async (value) => value },
            'utils/api': { requestJson: async (url, body) => {
              if (url === '/api/stem/objective-answers' && body.sourceQuestionId === candidate.questionId) batchObjectiveBody = structuredClone(body)
              const response = await fetch(new URL(url, origin), { method: 'POST', headers: { authorization: `Bearer ${owner}`,
                'content-type': 'application/json', 'x-stemist-source-images': 'region-v2' }, body: JSON.stringify(body) })
              const value = await response.json()
              if (!response.ok) throw Object.assign(new Error(value.error || 'local request failed'), { statusCode: response.status, code: value.code })
              return value
            } } } })
        client.storage.set('stemistUser', { id: 'ielts:940099' }); client.storage.set('stemistSessionToken', owner)
        const native = client.load('utils/nativePractice')
        for (const { row, payload } of sets) {
          const spec = { routeId: candidate.routeId, stage: candidate.stage, subjectCode: candidate.subject,
            syllabusTopicIds: [row.primaryTopicId], components: [candidate.component], questionCount: 1,
            studyMode: 'chapter-study', sourcePreference: 'official-first', foundationCatalog: 'v2' }
          const session = native.createSession(payload, spec), question = session.questions[0]
          assert.equal(question.id, row.sourceQuestionId, `${version}: correct question identity`)
          assert.equal(question.sourceRegions.length, 1)
          native.saveSession(session)
          const view = native.questionView(session, 0), page = client.page('pages/stem/practice')
          assert.deepEqual(Array.from(view.question.options, (option) => option.label), ['A', 'B', 'C', 'D'],
            `${version}: all four answer options`)
          page.setData({ question: view.question })
          assert.equal(page.data.question.images.length, 1)
          const event = { currentTarget: { dataset: { id: page.data.question.images[0].id } } }
          page.imageFailed(event); assert.equal(page.data.question.images[0].failed, true)
          page.retryImage(event); assert.equal(page.data.question.images[0].failed, false)
          page.previewQuestion(event); assert.ok(preview?.current)
          native.saveChoice(session.id, question.id, row.answer)
          const correct = await native.markChoice(session.id, question.id)
          assert.equal(correct.score, 1, `${version} q${row.questionNumber}: correct source answer; available=${correct.available}; status=${correct.sourceStatus}`)
          assert.equal(correct.formalProgressEligible, false)
          native.saveChoice(session.id, question.id, row.answer === 'A' ? 'B' : 'A')
          const wrong = await native.markChoice(session.id, question.id)
          assert.equal(wrong.score, 0, `${version} q${row.questionNumber}: wrong answer must not score`)
          assert.ok(native.readSession(session.id), `${version}: local session restores`)
          batchQuestionsChecked += 1
        }
        batchVersions.push(version)
      }
    } finally {
      if (previousRuntimeRoot === undefined) delete process.env.STEMIST_TEST_RUNTIME_ROOT
      else process.env.STEMIST_TEST_RUNTIME_ROOT = previousRuntimeRoot
    }
    assert.ok(batchObjectiveBody && batchImageUrl, 'the batch must exercise a saved objective attempt and image')
    const forgedQuestion = await request('/api/stem/objective-answers', { method: 'POST', body: {
      ...batchObjectiveBody, sourceQuestionId: `${candidate.paperId}:q4` } })
    expectStatus(forgedQuestion, 409, 'the client cannot substitute another question into a persisted attempt')
    const wrongOwner = await request('/api/stem/objective-answers', { method: 'POST', authorization: token('ielts:940100'), body: batchObjectiveBody })
    expectStatus(wrongOwner, 404, 'another account cannot score a saved objective attempt')
    const wrongMode = await request('/api/stem/objective-answers', { method: 'POST', body: { ...batchObjectiveBody, mode: 'full-paper' } })
    assert.ok(wrongMode.status >= 400 && wrongMode.status < 500, 'a topic attempt cannot be scored as a full paper')
    const invalidOption = await request('/api/stem/objective-answers', { method: 'POST', body: { ...batchObjectiveBody, selectedOption: 'Z' } })
    assert.ok(invalidOption.status >= 400 && invalidOption.status < 500, 'an invalid option must fail closed')
  }
  const crossRouteSelection = await request('/api/stem/practice-sets', { method: 'POST', body: {
    routeId: candidate.routeId, syllabusTopicIds: [candidate.topic], components: [candidate.component], questionCount: 1,
    studyMode: 'chapter-study', sourceQuestionIds: [physics.questionId], excludeAttempted: false,
  } })
  expectStatus(crossRouteSelection, 409, 'a client-selected ID from another route must not become authority')
  for (const fixture of [physics, candidate]) {
    const unit = units.get(fixture.routeId)
    assert.ok(unit.parts.length && unit.parts.every((part) => part.markingProvenance || part.sourceBindingProvenance))
    const saved = await request('/api/stem/attempts', { method: 'POST', body: draftBody(fixture, unit, `fixture-draft-${fixture.subject}-0001`) })
    expectStatus(saved, 201, `${fixture.routeId} synthetic draft save`)
  }
  const historyBefore = await request('/api/stem/attempts')
  expectStatus(historyBefore, 200, 'owner history')
  const originalDraft = historyBefore.payload.attempts.find((entry) => entry.attemptId === 'fixture-draft-9702-0001')
  assert.ok(originalDraft && originalDraft.submissionStatus === 'draft')
  assert.equal(originalDraft.binding.routeId, physics.routeId)
  assert.equal(originalDraft.binding.parts[0].sourceQuestionId, physics.questionId)
  assert.equal(originalDraft.binding.parts[0].provenance.sourceDocumentSha256, physics.questionPdfSha256)
  assert.equal(originalDraft.binding.parts[0].provenance.answerDocumentSha256, physics.markSchemePdfSha256)
  const candidateUnit = units.get(candidate.routeId)
  const candidateAttemptId = `fixture-draft-${candidate.subject}-0001`
  const coachBody = { message: 'Explain the local test question.', context: {
    view: 'topic', attemptId: candidateAttemptId, routeId: candidate.routeId, stage: candidate.stage,
    question: { id: candidate.questionId }, part: { id: candidateUnit.parts[0].questionPartId,
      questionPartId: candidateUnit.parts[0].questionPartId }, responseStatus: 'unanswered' } }
  const healthyCoach = await request('/api/ai/coach/stream', { method: 'POST', body: coachBody })
  expectStatus(healthyCoach, 200, 'the valid fixture can reach the local test provider')
  assert.match(healthyCoach.contentType, /text\/event-stream/i)
  assert.match(healthyCoach.payload, /Synthetic fixture response/)
  assert.equal(providerCalls, 1, 'the local provider counter must observe a real authorized call')
  providerCalls = 0

  inspectionDb = new DatabaseSync(databasePath, { readOnly: true })
  const rows = (fixture, phase = 'before corruption') => {
    const group = inspectionDb.prepare(`SELECT route_id,id,stage,subject_code,paper_component,question_paper_id,mark_scheme_id,
      source_content_complete,study_eligible,student_study_released,verification_status,source_json,answer_json,parts_json
      FROM route_question_groups WHERE route_id = ? AND id = ?`).get(fixture.routeId, fixture.questionId)
    const mapping = inspectionDb.prepare(`SELECT route_id,question_group_id,primary_topic_id,secondary_topic_ids_json,
      syllabus_point_ids_json,confidence,mapping_method,review_status,evidence_json FROM route_question_syllabus_mapping
      WHERE route_id = ? AND question_group_id = ?`).get(fixture.routeId, fixture.questionId)
    assert.ok(group && mapping, `${fixture.routeId} SQLite group and mapping missing ${phase}`)
    assert.equal(group.verification_status, 'ai-verified')
    assert.equal(group.student_study_released, 1)
    assert.equal(mapping.primary_topic_id, fixture.topic)
    return { group: { ...group }, mapping: { ...mapping } }
  }
  const seededRows = new Map([physics, biology, candidate].map((fixture) => [fixture.routeId, rows(fixture)]))
  let evidenceRoot = null
  if (captureEvidence) {
    evidenceRoot = path.join('D:/CodexWork/ai-function-regression-20261103/qa/9708-q8-q19-review-20261116', `dual-root-sqlite-evidence-${crypto.randomUUID()}`)
    fs.mkdirSync(evidenceRoot)
    await backup(inspectionDb, path.join(evidenceRoot, 'before.sqlite'))
  }

  const original = fs.readFileSync(candidate.artifactPath)
  const priorStat = fs.statSync(candidate.artifactPath)
  assert.equal(priorStat.mtimeMs, fixedTime.getTime())
  const tampered = Buffer.from(original)
  const index = tampered.indexOf(Buffer.from(q8Mode ? 'independentReview' : batchMode ? 'sourceQuestionId' : 'Synthetic fixture question.'))
  assert.ok(index >= 0)
  tampered[index] ^= 1
  fs.writeFileSync(candidate.artifactPath, tampered)
  fs.utimesSync(candidate.artifactPath, priorStat.atime, priorStat.mtime)
  const changedStat = fs.statSync(candidate.artifactPath)
  assert.equal(changedStat.size, priorStat.size)
  assert.equal(changedStat.mtimeMs, priorStat.mtimeMs)
  assert.notEqual(sha256(tampered), sha256(original))

  const unavailable = await inventory(candidate)
  expectStatus(unavailable, 503, 'candidate inventory after same-metadata tampering')
  assert.equal(unavailable.payload.code, 'AI_STUDY_PROMOTION_INVALID')
  assert.equal(publicIds(unavailable.payload), false, 'the 503 response must not expose stale candidate inventory')
  const candidateStart = await start(candidate)
  expectStatus(candidateStart, 503, 'candidate start after tampering')
  assert.equal(candidateStart.payload.code, 'AI_STUDY_PROMOTION_INVALID')
  if (q8Mode) {
    const expiredImage = await request(q8ImageUrl)
    expectStatus(expiredImage, 503, 'an old Q8 image URL must not serve a revoked candidate')
    assert.equal(expiredImage.payload.code, 'AI_STUDY_PROMOTION_INVALID')
    assert.ok(q8ObjectiveBody, 'the real client must have made an objective request')
    const unavailableScore = await request('/api/stem/objective-answers', { method: 'POST', body: q8ObjectiveBody })
    expectStatus(unavailableScore, 503, 'Q8 scoring must fail closed while the candidate is unavailable')
    assert.equal(unavailableScore.payload.code, 'AI_STUDY_PROMOTION_INVALID')
  }
  if (batchMode) {
    const staleImage = await request(batchImageUrl)
    expectStatus(staleImage, 503, 'a tampered batch must not serve an old image URL')
    const staleScore = await request('/api/stem/objective-answers', { method: 'POST', body: batchObjectiveBody })
    expectStatus(staleScore, 503, 'a tampered batch must not score a persisted attempt')
  }
  const coach = await request('/api/ai/coach/stream', { method: 'POST', body: coachBody })
  expectStatus(coach, 503, 'persisted candidate Coach binding after tampering')
  assert.equal(coach.payload.code, 'AI_STUDY_PROMOTION_INVALID')
  assert.doesNotMatch(coach.contentType, /text\/event-stream/i)
  const forgedCoach = await request('/api/ai/coach/stream', { method: 'POST', body: {
    message: 'Explain the synthetic question.', context: { view: 'topic', attemptId: candidateAttemptId,
      routeId: physics.routeId, stage: physics.stage, question: { id: physics.questionId }, responseStatus: 'unanswered' },
  } })
  expectStatus(forgedCoach, 409, 'persisted candidate attempt cannot be rebound by claiming a legacy route')
  assert.equal(forgedCoach.payload.code, 'coach_attempt_binding_mismatch')
  assert.equal(providerCalls, 0, 'candidate rejection must precede provider invocation')
  const legacyUnit = units.get(physics.routeId)
  const legacyCoachDuringCandidateFailure = await request('/api/ai/coach/stream', { method: 'POST', body: {
    message: 'Explain the local legacy question.', context: { view: 'topic', attemptId: originalDraft.attemptId,
      routeId: physics.routeId, stage: physics.stage, question: { id: physics.questionId },
      part: { id: legacyUnit.parts[0].questionPartId, questionPartId: legacyUnit.parts[0].questionPartId } },
  } })
  expectStatus(legacyCoachDuringCandidateFailure, 200, 'legacy Coach remains available while a separate candidate is blocked')
  assert.equal(providerCalls, 1)
  providerCalls = 0
  const staticPdf = '/local-pdf/9702/9702_m25_qp_42.pdf'
  expectStatus(await request(staticPdf), 200, 'noncandidate original PDF GET during candidate failure')
  expectStatus(await request(staticPdf, { method: 'HEAD' }), 200, 'noncandidate original PDF HEAD during candidate failure')
  expectStatus(await request(staticPdf, { headers: { range: 'bytes=0-31' } }), 206, 'noncandidate original PDF range during candidate failure')

  const partial = runtime({ routeId: physics.routeId })
  assert.equal(partial.complete, false)
  assert.equal(partial.candidateErrorCode, 'AI_STUDY_PROMOTION_INVALID')
  assert.deepEqual(new Set(partial.groups.map((group) => group.sourceQuestionId)), new Set([physics.questionId, biology.questionId]))
  const candidatePureInventory = syllabusTopicsInventory({ routeId: candidate.routeId, questionBank: partial.groups, includeStudyOnly: true })
  assert.equal(publicIds(candidatePureInventory), false, 'retained candidate SQLite rows are not authority for the unavailable snapshot')
  for (const fixture of [physics, biology]) {
    const catalog = await inventory(fixture)
    expectStatus(catalog, 200, `${fixture.routeId} inventory while candidate unavailable`)
    assert.equal(catalog.payload.aggregation, 'validated-runtime-snapshot')
    assert.deepEqual(topic(catalog, fixture), topic({ payload: before.get(fixture.routeId) }, fixture), `${fixture.routeId} inventory remains consistent`)
    assert.equal(publicIds(catalog.payload), false, 'candidate stale IDs must not inflate available inventory')
    const selected = await start(fixture)
    expectStatus(selected, 201, `${fixture.routeId} start while candidate unavailable`)
    assert.deepEqual(selected.payload.questionGroups.map((group) => group.id), [fixture.questionId])
    const imageUrl = imageUrls.get(fixture.routeId)
    assert.ok(imageUrl, `${fixture.routeId} source image URL is required`)
    const legacyImage = await fetch(new URL(imageUrl, origin))
    assert.equal(legacyImage.status, 200, `${fixture.routeId} image while candidate is unavailable`)
    assert.match(legacyImage.headers.get('cache-control') || '', /no-store/i, `${fixture.routeId}: source images must not be HTTP-cached`)
    await legacyImage.arrayBuffer()
  }
  for (const fixture of [physics, biology, candidate]) {
    assert.deepEqual(rows(fixture, 'during candidate failure'), seededRows.get(fixture.routeId), `${fixture.routeId} SQLite rows must not be deleted or demoted`)
  }
  if (evidenceRoot) {
    await backup(inspectionDb, path.join(evidenceRoot, 'after-fixed.sqlite'))
    const controlPath = path.join(evidenceRoot, 'unsafe-default-control.sqlite')
    await backup(inspectionDb, controlPath)
    const control = new DatabaseSync(controlPath)
    try {
      seedSyllabusTables(control, [...studyQuestionBank, ...partial.groups])
      const controlRow = control.prepare('SELECT verification_status FROM route_question_groups WHERE route_id = ? AND id = ?')
        .get(candidate.routeId, candidate.questionId)
      assert.equal(controlRow?.verification_status, 'machine-indexed', 'the historical full-snapshot control must reproduce the demotion')
    } finally { control.close() }
  }
  const historyDuring = await request('/api/stem/attempts')
  expectStatus(historyDuring, 200, 'owner history during candidate failure')
  assert.deepEqual(historyDuring.payload.attempts.find((entry) => entry.attemptId === originalDraft.attemptId), originalDraft)
  const unit = units.get(physics.routeId)
  const rebound = await request('/api/stem/practice-sets/rebind', { method: 'POST', body: { unit: syllabusPracticeRebindPayload(unit) } })
  expectStatus(rebound, 200, 'legacy draft source rebind during candidate failure')
  assert.equal(rebound.payload.unit.parts[0].sourceQuestionId, physics.questionId)
  const forgedUnit = syllabusPracticeRebindPayload(unit)
  forgedUnit.parts[0].sourceBindingProvenance.sourceDocumentSha256 = '0'.repeat(64)
  const forged = await request('/api/stem/practice-sets/rebind', { method: 'POST', body: { unit: forgedUnit } })
  expectStatus(forged, 409, 'client-supplied question ID cannot override source binding')
  const savedAgain = await request('/api/stem/attempts', { method: 'POST',
    body: draftBody(physics, unit, originalDraft.attemptId, { [unit.parts[0].id]: 'synthetic answer' }) })
  expectStatus(savedAgain, 200, 'legacy draft save during candidate failure')
  assert.equal(savedAgain.payload.attempt.answers[unit.parts[0].id], 'synthetic answer')
  const wrongOwnerHistory = await request('/api/stem/attempts', { authorization: token('ielts:940100') })
  expectStatus(wrongOwnerHistory, 200, 'other synthetic owner history')
  assert.equal(wrongOwnerHistory.payload.attempts.some((entry) => entry.attemptId === originalDraft.attemptId), false)
  const wrongOwnerSave = await request('/api/stem/attempts', { method: 'POST', authorization: token('ielts:940100'),
    body: draftBody(physics, unit, originalDraft.attemptId) })
  expectStatus(wrongOwnerSave, 404, 'another synthetic user cannot claim the saved draft')

  fs.writeFileSync(candidate.artifactPath, original)
  fs.utimesSync(candidate.artifactPath, priorStat.atime, priorStat.mtime)
  const recovered = await inventory(candidate)
  expectStatus(recovered, 200, 'candidate inventory after restoring signed bytes')
  assert.ok(publicIds(topic(recovered, candidate)))
  const recoveredStart = await start(candidate)
  expectStatus(recoveredStart, 201, 'candidate start after restoring signed bytes')
  assert.deepEqual(recoveredStart.payload.questionGroups.map((group) => group.id), [candidate.questionId])
  if (releasePinnedMode) {
    let releaseRootScans = 0
    const readDirectory = fs.readdirSync
    fs.readdirSync = function countReleaseScans(directory, ...args) {
      if (typeof directory === 'string' && path.resolve(directory) === releaseRoot) releaseRootScans += 1
      return readDirectory.call(this, directory, ...args)
    }
    try { expectStatus(await inventory(candidate), 200, 'pinned candidate stays available') }
    finally { fs.readdirSync = readDirectory }
    assert.equal(releaseRootScans, 0, 'candidate requests must not rescan the entire release tree')
    const manifest = fs.readFileSync(pinnedRelease.manifestPath), manifestStat = fs.statSync(pinnedRelease.manifestPath)
    const alteredManifest = Buffer.from(manifest), digestOffset = alteredManifest.indexOf(Buffer.from(sha256(pinnedRelease.markerBytes)))
    assert.ok(digestOffset >= 0); alteredManifest[digestOffset] ^= 1
    fs.writeFileSync(pinnedRelease.manifestPath, alteredManifest)
    fs.utimesSync(pinnedRelease.manifestPath, manifestStat.atime, manifestStat.mtime)
    try {
      expectStatus(await inventory(candidate), 503, 'same-size release manifest substitution must reject the candidate')
      expectStatus(await inventory(physics), 200, 'legacy Physics remains available after release manifest tampering')
      expectStatus(await request('/api/stem/attempts'), 200, 'history remains available after release manifest tampering')
    } finally { fs.writeFileSync(pinnedRelease.manifestPath, manifest); fs.utimesSync(pinnedRelease.manifestPath, manifestStat.atime, manifestStat.mtime) }
    const heldManifest = `${pinnedRelease.manifestPath}.fixture-held`
    fs.renameSync(pinnedRelease.manifestPath, heldManifest)
    try {
      expectStatus(await inventory(candidate), 503, 'missing release manifest must reject the candidate')
      expectStatus(await inventory(biology), 200, 'legacy Biology remains available without the release manifest')
      const restartedVite = await createViteServer({ configFile: false, envFile: false, root: requestRoot,
        cacheDir: path.join(root, 'vite-cache-restart'), publicDir: false, logLevel: 'silent', appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: { ignored: '**' } },
        plugins: [localCieLibrary(env, { trustedPublicKeys })] })
      const restartedServer = http.createServer((req, res) => restartedVite.middlewares(req, res))
      const priorOrigin = origin
      try {
        origin = await listen(restartedServer)
        expectStatus(await inventory(candidate), 503, 'candidate remains rejected after restart with no manifest')
        expectStatus(await inventory(physics), 200, 'legacy remains available after restart with no manifest')
        expectStatus(await request('/api/stem/attempts'), 200, 'history remains available after restart with no manifest')
      } finally {
        origin = priorOrigin
        if (restartedServer.listening) await close(restartedServer)
        await restartedVite.close()
      }
      const missingAnchor = `${pinnedRelease.anchorPath}.fixture-held`
      fs.renameSync(pinnedRelease.anchorPath, missingAnchor)
      try {
        const noScopeVite = await createViteServer({ configFile: false, envFile: false, root: requestRoot,
          cacheDir: path.join(root, 'vite-cache-no-scope'), publicDir: false, logLevel: 'silent', appType: 'custom',
          optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: { ignored: '**' } },
          plugins: [localCieLibrary(env, { trustedPublicKeys })] })
        const noScopeServer = http.createServer((req, res) => noScopeVite.middlewares(req, res))
        try {
          origin = await listen(noScopeServer)
          const withoutScope = await inventory(candidate)
          expectStatus(withoutScope, 200, 'unaffected catalog remains usable with no release authority')
          assert.equal(publicIds(withoutScope.payload), false, 'stored candidate rows cannot become authority without a release')
          assert.ok((await start(candidate)).status >= 400, 'a stored candidate cannot start without release authority')
          expectStatus(await inventory(physics), 200, 'legacy remains available with no release authority')
          expectStatus(await request('/api/stem/attempts'), 200, 'history survives an unknown release scope')
          assert.deepEqual(rows(candidate, 'without release scope'), seededRows.get(candidate.routeId))
        } finally {
          origin = priorOrigin
          if (noScopeServer.listening) await close(noScopeServer)
          await noScopeVite.close()
        }
      } finally { fs.renameSync(missingAnchor, pinnedRelease.anchorPath) }
    } finally { fs.renameSync(heldManifest, pinnedRelease.manifestPath) }
    const heldAnchor = `${pinnedRelease.anchorPath}.fixture-held`
    fs.renameSync(pinnedRelease.anchorPath, heldAnchor)
    try {
      expectStatus(await inventory(candidate), 503, 'missing independent anchor must reject the candidate')
      expectStatus(await request('/api/stem/attempts'), 200, 'history remains available without the anchor')
    } finally { fs.renameSync(heldAnchor, pinnedRelease.anchorPath) }
    const heldRoot = `${candidateRoot}-fixture-held`
    assert.ok(fs.lstatSync(candidateRoot).isDirectory() && !fs.existsSync(heldRoot))
    fs.renameSync(candidateRoot, heldRoot)
    fs.mkdirSync(candidateRoot)
    try {
      expectStatus(await inventory(candidate), 503, 'replacing the candidate root must reject the candidate')
      expectStatus(await inventory(physics), 200, 'legacy Physics remains available after root replacement')
    } finally { fs.rmdirSync(candidateRoot); fs.renameSync(heldRoot, candidateRoot) }
    expectStatus(await inventory(candidate), 200, 'the exact restored candidate root is available again')
    assert.equal(providerCalls, 0, 'anchor and root rejection must not invoke a provider')
  }
  if (batchMode) {
    const markSchemePath = path.join(libraryRoot, '9708', '9708_m25_ms_12.pdf')
    const originalMs = fs.readFileSync(markSchemePath), msStat = fs.statSync(markSchemePath), alteredMs = Buffer.from(originalMs)
    alteredMs[alteredMs.length - 2] ^= 1
    fs.writeFileSync(markSchemePath, alteredMs); fs.utimesSync(markSchemePath, msStat.atime, msStat.mtime)
    try {
      expectStatus(await request('/api/stem/objective-answers', { method: 'POST', body: batchObjectiveBody }), 503,
        'a same-size, same-mtime MS tamper must not score')
      expectStatus(await request(batchImageUrl), 503, 'a source-bound image must stop on MS tamper')
      assert.equal(providerCalls, 0)
    } finally { fs.writeFileSync(markSchemePath, originalMs); fs.utimesSync(markSchemePath, msStat.atime, msStat.mtime) }
    const restored = await request('/api/stem/objective-answers', { method: 'POST', body: batchObjectiveBody })
    expectStatus(restored, 200, 'the saved objective attempt recovers after the exact MS bytes are restored')
    assert.equal(restored.payload.available, true); assert.equal(restored.payload.formalProgressEligible, false)
    const blockPath = path.join(candidateRoot, 'BLOCKED.json')
    fs.writeFileSync(blockPath, '{}', { flag: 'wx' })
    try {
      const blockedImage = await request(batchImageUrl)
      expectStatus(blockedImage, 503, 'an operationally blocked candidate must not serve an old image')
      assert.equal(blockedImage.payload.code, 'AI_STUDY_CANDIDATE_BLOCKED')
      const blockedScore = await request('/api/stem/objective-answers', { method: 'POST', body: batchObjectiveBody })
      expectStatus(blockedScore, 503, 'an operationally blocked candidate must not score')
      assert.equal(blockedScore.payload.code, 'AI_STUDY_CANDIDATE_BLOCKED')
      expectStatus(await request('/api/stem/attempts'), 200, 'candidate blocking must not delete saved history')
      assert.equal(providerCalls, 0)
    } finally { fs.unlinkSync(blockPath) }
    expectStatus(await request('/api/stem/objective-answers', { method: 'POST', body: batchObjectiveBody }), 200,
      'a local operational block can be removed after restoring the exact reviewed fixture')
  }
  if (q8Mode) {
    const restoredImage = await fetch(new URL(q8ImageUrl, origin))
    assert.equal(restoredImage.status, 200, 'Q8 image must recover after exact source restoration')
    await restoredImage.arrayBuffer()
    const restoredScore = await request('/api/stem/objective-answers', { method: 'POST', body: q8ObjectiveBody })
    expectStatus(restoredScore, 200, 'Q8 objective scoring must recover after exact source restoration')
    assert.equal(restoredScore.payload.available, true)
    const blockPath = path.join(candidateRoot, 'BLOCKED.json')
    fs.writeFileSync(blockPath, '{}', { flag: 'wx' })
    try {
      const blockedCatalog = await inventory(candidate)
      expectStatus(blockedCatalog, 503, 'an explicit candidate block must reject inventory')
      assert.equal(blockedCatalog.payload.code, 'AI_STUDY_CANDIDATE_BLOCKED')
      const blockedImage = await request(q8ImageUrl)
      expectStatus(blockedImage, 503, 'an old Q8 image URL must not serve a blocked candidate')
      assert.equal(blockedImage.payload.code, 'AI_STUDY_CANDIDATE_BLOCKED')
      const blockedScore = await request('/api/stem/objective-answers', { method: 'POST', body: q8ObjectiveBody })
      expectStatus(blockedScore, 503, 'an old Q8 objective request must not score a blocked candidate')
      assert.equal(blockedScore.payload.code, 'AI_STUDY_CANDIDATE_BLOCKED')
      const blockedCoach = await request('/api/ai/coach/stream', { method: 'POST', body: coachBody })
      expectStatus(blockedCoach, 503, 'candidate Coach must stop before provider access when blocked')
      assert.equal(providerCalls, 0)
      const blockedHistory = await request('/api/stem/attempts')
      expectStatus(blockedHistory, 200, 'a blocked candidate must not delete saved draft history')
      assert.ok(blockedHistory.payload.attempts.some((entry) => entry.attemptId === candidateAttemptId))
    } finally { fs.unlinkSync(blockPath) }
    expectStatus(await inventory(candidate), 200, 'candidate must recover after the test-only block is removed')
    const unblockedImage = await fetch(new URL(q8ImageUrl, origin))
    assert.equal(unblockedImage.status, 200)
    await unblockedImage.arrayBuffer()
    const unblockedScore = await request('/api/stem/objective-answers', { method: 'POST', body: q8ObjectiveBody })
    expectStatus(unblockedScore, 200, 'the same objective request may recover after the block is removed')
    assert.equal(unblockedScore.payload.available, true)
    const parkedRoot = path.join(root, 'candidate-temporarily-missing')
    assert.equal(path.dirname(candidateRoot), root)
    assert.equal(path.dirname(parkedRoot), root)
    assert.ok(fs.lstatSync(candidateRoot).isDirectory() && !fs.lstatSync(candidateRoot).isSymbolicLink())
    assert.equal(path.dirname(fs.realpathSync(candidateRoot)), fs.realpathSync(root))
    assert.equal(fs.existsSync(parkedRoot), false)
    fs.renameSync(candidateRoot, parkedRoot)
    try {
      expectStatus(await inventory(candidate), 503, 'a missing candidate root must fail closed')
      expectStatus(await request(q8ImageUrl), 503, 'a missing candidate root must not serve a cached Q8 image')
      expectStatus(await request('/api/stem/objective-answers', { method: 'POST', body: q8ObjectiveBody }), 503,
        'a missing candidate root must not score a saved Q8 response')
      expectStatus(await inventory(physics), 200, 'legacy Physics remains available when the separate candidate root is missing')
      expectStatus(await inventory(biology), 200, 'legacy Biology remains available when the separate candidate root is missing')
      assert.deepEqual(rows(candidate, 'while candidate root is missing'), seededRows.get(candidate.routeId))
    } finally { fs.renameSync(parkedRoot, candidateRoot) }
    expectStatus(await inventory(candidate), 200, 'candidate inventory recovers after its exact root is restored')
  }
  assert.equal(providerCalls, 0)

  const legacyQp = path.join(libraryRoot, physics.subject, `${physics.subject}_m25_qp_${physics.component}9.pdf`)
  const originalLegacyQp = fs.readFileSync(legacyQp)
  fs.writeFileSync(legacyQp, Buffer.concat([originalLegacyQp, Buffer.from('!')]))
  const legacyFailure = await inventory(physics)
  expectStatus(legacyFailure, 503, 'legacy source tamper must not fall back to a partial static bank')
  assert.equal(legacyFailure.payload.code, 'AI_STUDY_LEGACY_UNAVAILABLE')
  const staleLegacyImage = await request(imageUrls.get(physics.routeId))
  expectStatus(staleLegacyImage, 503, 'a previously issued legacy image URL must fail closed after source tamper')
  assert.equal(staleLegacyImage.payload.code, 'AI_STUDY_LEGACY_UNAVAILABLE')
  const legacyCoach = await request('/api/ai/coach/stream', { method: 'POST', body: {
    message: 'Explain the synthetic legacy question.', context: { view: 'topic', attemptId: originalDraft.attemptId,
      routeId: physics.routeId, stage: physics.stage, question: { id: physics.questionId },
      part: { id: unit.parts[0].questionPartId, questionPartId: unit.parts[0].questionPartId } },
  } })
  expectStatus(legacyCoach, 503, 'legacy Coach must propagate source failure before streaming')
  assert.equal(legacyCoach.payload.code, 'AI_STUDY_LEGACY_UNAVAILABLE')
  assert.doesNotMatch(legacyCoach.contentType, /text\/event-stream/i)
  const provenance = { routeId: physics.routeId, ...(unit.parts[0].markingProvenance || unit.parts[0].sourceBindingProvenance) }
  const grant = signHmacJwt({ sub: 'ielts:940099', scope: MARKING_CAPABILITY_SCOPE, attemptId: originalDraft.attemptId,
    mode: 'topic', paperId: physics.paperId, ...provenance }, signingKey,
  { issuer: MARKING_CAPABILITY_ISSUER, audience: MARKING_CAPABILITY_AUDIENCE })
  const marking = await request('/api/ai/mark-handwriting', { method: 'POST', body: { submitted: true, mode: 'topic',
    attemptId: originalDraft.attemptId, paperId: physics.paperId, provenance, markingGrant: grant } })
  expectStatus(marking, 503, 'legacy marking must propagate source failure after verifying the grant')
  assert.equal(marking.payload.code, 'AI_STUDY_LEGACY_UNAVAILABLE')
  const lookup = await request('/api/ai/coach/source', { method: 'POST', body: { confirmed: true,
    message: 'Explain this synthetic source question.', context: { routeId: physics.routeId } } })
  expectStatus(lookup, 503, 'Coach source lookup must propagate legacy source failure')
  assert.equal(lookup.payload.code, 'AI_STUDY_LEGACY_UNAVAILABLE')
  assert.equal(providerCalls, 0, 'no provider may be called while the legacy source is unavailable')
  for (const fixture of [physics, biology, candidate]) {
    assert.deepEqual(rows(fixture, 'during legacy failure'), seededRows.get(fixture.routeId), 'legacy failure must not rewrite or delete source rows')
  }
  const historyWithLegacyFailure = await request('/api/stem/attempts')
  expectStatus(historyWithLegacyFailure, 200, 'saved attempts remain readable during legacy failure')
  assert.ok(historyWithLegacyFailure.payload.attempts.some((entry) => entry.attemptId === originalDraft.attemptId))
  fs.writeFileSync(legacyQp, originalLegacyQp)
  expectStatus(await inventory(physics), 200, 'legacy inventory must recover after restoring exact source bytes')
  const restoredLegacyImage = await fetch(new URL(imageUrls.get(physics.routeId), origin))
  assert.equal(restoredLegacyImage.status, 200, 'the same legacy image URL must recover only after source validation')
  await restoredLegacyImage.arrayBuffer()
  assert.equal(providerCalls, 0)
  const originalLegacyArtifact = fs.readFileSync(physics.artifactPath)
  const revokedLegacyArtifact = JSON.parse(originalLegacyArtifact.toString('utf8'))
  delete revokedLegacyArtifact.studentRelease
  fs.writeFileSync(physics.artifactPath, JSON.stringify(revokedLegacyArtifact))
  try {
    const revokedImage = await request(imageUrls.get(physics.routeId))
    expectStatus(revokedImage, 503, 'an old legacy image URL must not serve an unbound or revoked artifact')
    assert.equal(revokedImage.payload.code, 'AI_STUDY_LEGACY_UNAVAILABLE')
    const revokedMarking = await request('/api/ai/mark-handwriting', { method: 'POST', body: { submitted: true, mode: 'topic',
      attemptId: originalDraft.attemptId, paperId: physics.paperId, provenance, markingGrant: grant } })
    expectStatus(revokedMarking, 503, 'an old marking capability must not score an unbound or revoked artifact')
    assert.equal(revokedMarking.payload.code, 'AI_STUDY_LEGACY_UNAVAILABLE')
    const history = await request('/api/stem/attempts')
    expectStatus(history, 200, 'legacy history remains readable while its source is unavailable')
    assert.ok(history.payload.attempts.some((entry) => entry.attemptId === originalDraft.attemptId))
    assert.equal(providerCalls, 0)
    for (const fixture of [physics, biology, candidate]) {
      assert.deepEqual(rows(fixture, 'during unsigned legacy revocation simulation'), seededRows.get(fixture.routeId))
    }
  } finally { fs.writeFileSync(physics.artifactPath, originalLegacyArtifact) }
  expectStatus(await inventory(physics), 200, 'legacy inventory must recover after restoring the validated artifact')
  const imageAfterReinstatement = await fetch(new URL(imageUrls.get(physics.routeId), origin))
  assert.equal(imageAfterReinstatement.status, 200)
  await imageAfterReinstatement.arrayBuffer()
  if (rollbackMode) {
    const baselineRoot = 'D:/CodexWork/stem-rollback-baseline-f997-20261116'
    assert.equal(execFileSync('git', ['-C', baselineRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      'f99742d76a028e5f525cddad538ae7b31f9a8d50')
    const groupState = (db) => candidate.questionIds.map((id) => ({ id,
      group: db.prepare('SELECT verification_status,source_json,answer_json,parts_json FROM route_question_groups WHERE route_id = ? AND id = ?').get(candidate.routeId, id),
      mapping: db.prepare(`SELECT primary_topic_id,secondary_topic_ids_json,syllabus_point_ids_json,confidence,mapping_method,review_status,evidence_json
        FROM route_question_syllabus_mapping WHERE route_id = ? AND question_group_id = ?`).get(candidate.routeId, id) }))
    const beforeRows = groupState(inspectionDb)
    const schema = (db) => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    const beforeSchema = schema(inspectionDb)
    assert.equal(beforeRows.filter((row) => row.group?.verification_status === 'ai-verified' && row.mapping).length, 18)
    const foreignKeys = inspectionDb.prepare("PRAGMA foreign_key_list('route_question_syllabus_mapping')").all()
    assert.ok(foreignKeys.some((key) => key.table === 'route_question_groups' && key.on_delete === 'CASCADE'))
    const beforeHistory = await request('/api/stem/attempts')
    expectStatus(beforeHistory, 200, 'history before rollback')
    const beforeSubmitted = beforeHistory.payload.attempts.find((item) => item.attemptId === batchObjectiveBody.attemptId)
    const beforeDraft = beforeHistory.payload.attempts.find((item) => item.attemptId === candidateAttemptId)
    assert.equal(beforeSubmitted?.submissionStatus, 'submitted')
    assert.equal(beforeDraft?.submissionStatus, 'draft')
    const snapshot = (item) => ({ attemptId: item.attemptId, submissionStatus: item.submissionStatus,
      binding: item.binding, answers: item.attempt?.answers || {} })
    const savedSubmitted = snapshot(beforeSubmitted), savedDraft = snapshot(beforeDraft)

    await close(server); server = null
    await vite.close(); vite = null
    inspectionDb.close(); inspectionDb = null
    closeStemDatabaseForTests()
    const oldBankModule = await import(pathToFileURL(path.join(baselineRoot, 'server/aiVerifiedQuestionBank.js')))
    oldStemModule = await import(pathToFileURL(path.join(baselineRoot, 'server/stemApi.js')))
    const oldLoader = oldBankModule.createAiVerifiedQuestionBankLoader({ artifactRoot: legacyRoot, libraryRoot })
    const oldApi = oldStemModule.createStemApi({ env, libraryRoot, topicQuestionBankProvider: () => oldLoader().groups })
    server = http.createServer((request, response) => oldApi(request, response, () => { response.statusCode = 404; response.end() }))
    origin = await listen(server)
    const oldHistory = await request('/api/stem/attempts')
    expectStatus(oldHistory, 200, 'old-version history remains readable')
    assert.deepEqual(snapshot(oldHistory.payload.attempts.find((item) => item.attemptId === savedSubmitted.attemptId)), savedSubmitted)
    assert.deepEqual(snapshot(oldHistory.payload.attempts.find((item) => item.attemptId === savedDraft.attemptId)), savedDraft)
    expectStatus(await inventory(physics), 200, 'old-version inventory triggers its normal source synchronization')
    inspectionDb = new DatabaseSync(databasePath, { readOnly: true })
    assert.deepEqual(schema(inspectionDb), beforeSchema, 'old-version rollback must not change the fixture schema')
    const oldRows = groupState(inspectionDb)
    const missingGroups = oldRows.filter((row) => !row.group).length
    const demotedGroups = oldRows.filter((row) => row.group && row.group.verification_status !== 'ai-verified').length
    const lostMappings = oldRows.filter((row) => !row.mapping).length
    const changedMappings = oldRows.filter((row, index) => JSON.stringify(row.mapping) !== JSON.stringify(beforeRows[index].mapping)).length
    assert.ok(missingGroups + demotedGroups > 0, 'the rollback test must observe old-version source synchronization')
    assert.ok(oldRows.every((row) => row.group || !row.mapping), 'deleted source rows must cascade to their mapping rows')
    const unavailableRebind = await request('/api/stem/practice-sets/rebind', { method: 'POST',
      body: { unit: syllabusPracticeRebindPayload(candidateUnit) } })
    expectStatus(unavailableRebind, 409, 'the old version must not bind an absent new source')
    const oldWrite = await request('/api/stem/attempts', { method: 'POST',
      body: draftBody(physics, unit, originalDraft.attemptId, { [unit.parts[0].id]: 'written during rollback' }) })
    expectStatus(oldWrite, 200, 'a legacy draft can be updated during rollback')
    const oldHistoryAfterSeed = await request('/api/stem/attempts')
    expectStatus(oldHistoryAfterSeed, 200, 'history after old-version source synchronization')
    assert.deepEqual(snapshot(oldHistoryAfterSeed.payload.attempts.find((item) => item.attemptId === savedSubmitted.attemptId)), savedSubmitted)
    assert.deepEqual(snapshot(oldHistoryAfterSeed.payload.attempts.find((item) => item.attemptId === savedDraft.attemptId)), savedDraft)

    inspectionDb.close(); inspectionDb = null
    await close(server); server = null
    oldStemModule.closeStemDatabaseForTests(); oldStemModule = null
    vite = await createViteServer({ configFile: false, envFile: false, root, cacheDir: path.join(root, 'vite-cache'),
      publicDir: false, logLevel: 'silent', appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: false, watch: { ignored: '**' } },
      plugins: [localCieLibrary(env, { trustedPublicKeys })] })
    server = http.createServer((request, response) => vite.middlewares(request, response))
    origin = await listen(server)
    expectStatus(await inventory(candidate), 200, 'new-version inventory rebuilds validated source rows')
    inspectionDb = new DatabaseSync(databasePath, { readOnly: true })
    assert.deepEqual(schema(inspectionDb), beforeSchema, 'reactivation must not require a new fixture schema migration')
    const restoredRows = groupState(inspectionDb)
    assert.equal(restoredRows.filter((row) => row.group?.verification_status === 'ai-verified' && row.mapping).length, 18)
    const exactRestoredMappings = restoredRows.filter((row, index) => JSON.stringify(row.mapping) === JSON.stringify(beforeRows[index].mapping)).length
    const exactRestoredBindings = restoredRows.filter((row, index) => JSON.stringify(row.group) === JSON.stringify(beforeRows[index].group)).length
    assert.equal(exactRestoredMappings, 18, 'all reviewed mapping fields must be rebuilt exactly')
    assert.equal(exactRestoredBindings, 18, 'all QP/MS and part bindings must be rebuilt exactly')
    const cascadeDb = new DatabaseSync(databasePath)
    try {
      cascadeDb.exec('PRAGMA foreign_keys=ON; SAVEPOINT local_cascade_probe')
      const deleted = cascadeDb.prepare('DELETE FROM route_question_groups WHERE route_id = ? AND id = ?').run(candidate.routeId, candidate.questionId)
      assert.equal(Number(deleted.changes), 1)
      assert.equal(cascadeDb.prepare('SELECT 1 FROM route_question_syllabus_mapping WHERE route_id = ? AND question_group_id = ?')
        .get(candidate.routeId, candidate.questionId), undefined, 'deleting a source group cascades its mapping')
      assert.ok(cascadeDb.prepare('SELECT 1 FROM student_attempts WHERE attempt_id = ?').get(savedSubmitted.attemptId),
        'deleting a source group must not delete a stored student attempt')
      cascadeDb.exec('ROLLBACK TO SAVEPOINT local_cascade_probe; RELEASE SAVEPOINT local_cascade_probe')
      assert.ok(cascadeDb.prepare('SELECT 1 FROM route_question_syllabus_mapping WHERE route_id = ? AND question_group_id = ?')
        .get(candidate.routeId, candidate.questionId), 'the local cascade probe must roll back')
    } finally { cascadeDb.close() }
    const recoveredHistory = await request('/api/stem/attempts')
    expectStatus(recoveredHistory, 200, 'history after reactivation')
    assert.deepEqual(snapshot(recoveredHistory.payload.attempts.find((item) => item.attemptId === savedSubmitted.attemptId)), savedSubmitted)
    assert.deepEqual(snapshot(recoveredHistory.payload.attempts.find((item) => item.attemptId === savedDraft.attemptId)), savedDraft)
    const rollbackWrite = recoveredHistory.payload.attempts.find((item) => item.attemptId === originalDraft.attemptId)
    assert.equal(rollbackWrite.attempt.answers[unit.parts[0].id], 'written during rollback',
      'reactivation must not overwrite newer writes with an old database backup')
    const recoveredRebind = await request('/api/stem/practice-sets/rebind', { method: 'POST',
      body: { unit: syllabusPracticeRebindPayload(candidateUnit) } })
    expectStatus(recoveredRebind, 200, 'new source-backed draft can rebind after recovery')
    assert.equal(recoveredRebind.payload.unit.parts[0].sourceQuestionId, candidate.questionId)
    const recoveredScore = await request('/api/stem/objective-answers', { method: 'POST', body: batchObjectiveBody })
    expectStatus(recoveredScore, 200, 'the prior submitted answer scores after exact source recovery')
    assert.equal(recoveredScore.payload.available, true); assert.equal(recoveredScore.payload.formalProgressEligible, false)
    const originalCandidate = fs.readFileSync(candidate.artifactPath), candidateStat = fs.statSync(candidate.artifactPath)
    const invalidCandidate = Buffer.from(originalCandidate), invalidAt = invalidCandidate.indexOf(Buffer.from('sourceQuestionId'))
    assert.ok(invalidAt >= 0); invalidCandidate[invalidAt] ^= 1
    fs.writeFileSync(candidate.artifactPath, invalidCandidate); fs.utimesSync(candidate.artifactPath, candidateStat.atime, candidateStat.mtime)
    try {
      expectStatus(await request('/api/stem/practice-sets/rebind', { method: 'POST',
        body: { unit: syllabusPracticeRebindPayload(candidateUnit) } }), 503, 'invalid restored source cannot rebind')
      const safeHistory = await request('/api/stem/attempts')
      expectStatus(safeHistory, 200, 'invalid source must not delete stored history')
      assert.deepEqual(snapshot(safeHistory.payload.attempts.find((item) => item.attemptId === savedSubmitted.attemptId)), savedSubmitted)
      assert.equal(providerCalls, 0)
    } finally { fs.writeFileSync(candidate.artifactPath, originalCandidate); fs.utimesSync(candidate.artifactPath, candidateStat.atime, candidateStat.mtime) }
    rollbackSummary = { baselineCommit: 'f99742d76a028e5f525cddad538ae7b31f9a8d50', missingGroups, demotedGroups, lostMappings, changedMappings,
      foreignKeyCascadeDeclared: true, cascadeInOldSync: missingGroups > 0, cascadeVerifiedInRolledBackProbe: true,
      rebuiltGroups: 18, exactRestoredMappings, exactRestoredBindings, submittedAndDraftPreserved: true,
      writeDuringRollbackPreserved: true, invalidSourceRejected: true, schemaUnchanged: true, databaseBackupRestored: false }
  }
  assert.equal(privateConfigProbes, 0, `the test must not attempt to read private provider configuration: ${privateConfigProbeStack}`)
  assert.equal(externalNetworkAttempts, 0, 'the test must not attempt an external fetch')
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'real-vite-http-sqlite-dual-root',
    fixtureRoutes: [physics.routeId, biology.routeId, candidate.routeId], providerPositiveControls: 2, providerCallsForRejectedRequests: providerCalls,
    candidate: 'valid -> same-size/mtime tamper 503 -> restored', legacy: 'inventory/start/draft/rebind/save; source failure 503 then recovery',
    sqlite: 'group and mapping rows retained without stale inventory', externalNetworkAttempts, privateConfigProbes,
    ...(releasePinnedMode ? { releasePinned: { manifestAndAnchorTamperRejected: true, rootReplacementRejected: true,
      missingAuthorityPreservesLegacyAndHistory: true, noHotPathTreeScan: true, separatePageCache: true,
      markSchemeStaticAccessDenied: true, tamperedMarkSchemePageRejected: true } } : {}),
    ...(q8Mode ? { q8Clients: q8Versions } : {}), ...(batchMode ? { batchClients: batchVersions, batchQuestionsChecked, batchTagStarts } : {}),
    ...(rollbackSummary ? { rollback: rollbackSummary } : {}),
    ...(evidenceRoot ? { syntheticSqliteEvidence: evidenceRoot } : {}) }))
} finally {
  if (server?.listening) await close(server)
  if (vite) await vite.close()
  if (provider?.listening) await close(provider)
  if (inspectionDb) inspectionDb.close()
  if (oldStemModule) oldStemModule.closeStemDatabaseForTests()
  closeStemDatabaseForTests()
  for (const [method, original] of originalFsMethods) fs[method] = original
  globalThis.fetch = originalFetch
  process.chdir(originalCwd)
  const resolved = fs.realpathSync(root)
  assert.equal(path.dirname(resolved), workspace, 'refusing cleanup outside the staging worktree')
  assert.ok(path.basename(resolved).startsWith('.dual-root-http-fixture-'), 'refusing cleanup of a non-fixture directory')
  fs.rmSync(resolved, { recursive: true, force: true })
}
