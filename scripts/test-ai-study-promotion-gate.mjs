import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { artifactId, buildAiStudentStudyRelease, sourceReviewInputSha256 } from './ai-pdf-ingestion/contract.mjs'
import { createRuntimeAiQuestionBank } from '../vite.config.js'

const worktreeRoot = fs.realpathSync(path.resolve(import.meta.dirname, '..'))
const root = fs.mkdtempSync(path.join(worktreeRoot, '.promotion-gate-fixture-'))
const libraryRoot = path.join(root, 'library')
const subjectRoot = path.join(libraryRoot, '9702')
const legacyRoot = path.join(root, 'legacy')
const candidateRoot = path.join(root, 'candidate')
const paperId = 'cie-9702-9702_m21_qp_42'
const qpFile = '9702_m21_qp_42.pdf'
const msFile = '9702_m21_ms_42.pdf'
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const qpBytes = Buffer.concat([Buffer.from('%PDF-1.4\nlocal-promotion-question-fixture\n'), Buffer.alloc(512 * 1024)])
const msBytes = Buffer.concat([Buffer.from('%PDF-1.4\nlocal-promotion-mark-scheme-fixture\n'), Buffer.alloc(1024 * 1024)])
const questionPdfSha256 = digest(qpBytes)
const markSchemePdfSha256 = digest(msBytes)
const identity = artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })
const artifactRelative = `${paperId}/${identity.slice('sha256:'.length)}.json`
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

function fixtureArtifact() {
  const session = (id, model) => ({ sessionId: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
    turnId: `10000000-0000-4000-8000-${id.padStart(12, '0')}`, modelProvider: 'fixture', model,
    sessionLogSha256: (id === '1' ? '1' : '2').repeat(64), outputSha256: (id === '1' ? '3' : '4').repeat(64) })
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1', artifactId: identity, paperId, subject: '9702', stage: 'A2',
    syllabusRouteId: 'cie-9702-a2-physics', status: 'ai-verified', storageMode: 'coordinate-only',
    extractor: { provider: 'fixture', model: 'fixture-a', schemaName: 'ai_pdf_question_extraction_v1', runtimeAttestation: session('1', 'fixture-a') },
    verifier: { provider: 'fixture', model: 'fixture-b', schemaName: 'ai_pdf_question_verification_v1', runtimeAttestation: session('2', 'fixture-b') },
    source: { questionPdfPath: path.join(subjectRoot, qpFile), markSchemePdfPath: path.join(subjectRoot, msFile),
      questionPdfSha256, markSchemePdfSha256, renderDpi: 180,
      pageImageHashes: { 3: 'd'.repeat(64) }, pageSizes: { 3: { width: 1200, height: 1600 } },
      markSchemePageHashes: { 5: 'e'.repeat(64) }, markSchemePageSizes: { 5: { width: 1200, height: 1600 } } },
    candidate: { questions: [{ questionNumber: '2',
      regions: [{ page: 3, pageImageSha256: 'd'.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }],
      diagramRegions: [], parts: [{ label: 'a', marks: 4, ocrText: 'Fixture question.' }],
      tags: { primaryTopicId: 'physics-9702-topic-13', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }] }] },
    verification: { questions: [{ questionNumber: '2', pages: [3],
      regions: [{ page: 3, pageImageSha256: 'd'.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }],
      diagramRegions: [], diagramRegionCount: 0, parts: [{ label: 'a', marks: 4 }],
      tags: { primaryTopicId: 'physics-9702-topic-13', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }] }] },
  }
  artifact.studentRelease = buildAiStudentStudyRelease({ ...artifact, routeId: artifact.syllabusRouteId })
  assert.ok(artifact.studentRelease)
  return artifact
}

function writeArtifact(artifactRoot, artifact) {
  const target = path.join(artifactRoot, ...artifactRelative.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(artifact))
  return target
}

function writeMarker(eligible) {
  const target = path.join(candidateRoot, 'candidate-manifest.json')
  fs.writeFileSync(target, JSON.stringify({ schemaVersion: 'stem-ai-study-candidate-manifest.v1',
    status: 'approved', productionEligible: eligible, formalProgressEligible: false }))
  return target
}

function signPromotion(markerPath, artifactPath, { artifactPathInManifest = artifactRelative, signer = privateKey,
  expectedRouteGroups = 1, extraArtifactPaths = [] } = {}) {
  const payload = {
    schemaVersion: 'stem-ai-study-promotion.v1', status: 'approved', scope: 'student-study-only',
    formalProgressEligible: false, expectedRouteGroups,
    candidateManifest: { path: 'candidate-manifest.json', sha256: digest(fs.readFileSync(markerPath)) },
    artifacts: [{ path: artifactPathInManifest, sha256: digest(fs.readFileSync(artifactPath)) },
      ...extraArtifactPaths.map((file) => ({ path: path.relative(candidateRoot, file).split(path.sep).join('/'), sha256: digest(fs.readFileSync(file)) }))],
  }
  const payloadBytes = Buffer.from(JSON.stringify(payload))
  const envelope = {
    schemaVersion: 'stem-ai-study-promotion-envelope.v1',
    payloadBase64: payloadBytes.toString('base64'),
    signature: { algorithm: 'Ed25519', keyId: 'fixture-key', value: crypto.sign(null, payloadBytes, signer).toString('base64') },
  }
  fs.writeFileSync(path.join(candidateRoot, 'study-promotion-manifest.json'), JSON.stringify(envelope))
}

const policy = { mode: 'signed-candidate', trustedPublicKeys: { 'fixture-key': publicKey } }
let rejectionCases = 0
const rejected = (operation, message) => {
  assert.throws(operation,
    (error) => error?.statusCode === 503 && ['AI_STUDY_PROMOTION_REQUIRED', 'AI_STUDY_PROMOTION_INVALID'].includes(error.code), message)
  rejectionCases += 1
}

try {
  fs.mkdirSync(subjectRoot, { recursive: true })
  fs.writeFileSync(path.join(subjectRoot, qpFile), qpBytes)
  fs.writeFileSync(path.join(subjectRoot, msFile), msBytes)
  const artifact = fixtureArtifact()
  writeArtifact(legacyRoot, artifact)
  const artifactPath = writeArtifact(candidateRoot, artifact)
  const legacy = createAiVerifiedQuestionBankLoader({ artifactRoot: legacyRoot, libraryRoot })
  assert.equal(legacy().groups.length, 1, 'an unmarked existing legacy root must preserve its original loading behavior')
  const legacyEntry = createRuntimeAiQuestionBank({ env: { AI_PDF_INGESTION_ROOT: legacyRoot }, libraryRoot })
  assert.equal(legacyEntry().groups.length, 1, 'the production entry must retain unmarked legacy roots by default')
  const legacySourcePath = path.join(subjectRoot, qpFile)
  fs.writeFileSync(legacySourcePath, Buffer.concat([qpBytes, Buffer.from('!')]))
  assert.throws(() => legacyEntry(), (error) => error.code === 'AI_STUDY_LEGACY_UNAVAILABLE' && error.statusCode === 503,
    'the legacy-only runtime must not turn a previously valid source loss into an incomplete snapshot')
  fs.writeFileSync(legacySourcePath, qpBytes)
  assert.equal(legacyEntry().groups.length, 1, 'the original legacy source must recover after exact restoration')

  const legacyMarker = path.join(legacyRoot, 'active-safe-manifest.json')
  fs.writeFileSync(legacyMarker, JSON.stringify({ productionEligible: false }))
  rejected(() => legacy(), 'adding a candidate marker to a cached legacy root must invalidate legacy access')
  fs.unlinkSync(legacyMarker)
  assert.equal(legacy().groups.length, 1, 'removing the test marker restores the unchanged legacy fixture')

  const markerPath = writeMarker(false)
  rejected(() => createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot })(),
    'an identified candidate root must not silently enter through legacy mode')
  rejected(() => createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot, promotionPolicy: policy })(),
    'a candidate without a signed promotion manifest must be rejected')

  signPromotion(markerPath, artifactPath)
  rejected(() => createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot, promotionPolicy: policy })(),
    'a signed envelope must not override productionEligible=false')

  writeMarker(true)
  rejected(() => createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot, promotionPolicy: policy })(),
    'modifying the candidate marker after signing must be rejected')
  fs.unlinkSync(path.join(candidateRoot, 'study-promotion-manifest.json'))
  rejected(() => createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot, promotionPolicy: policy })(),
    'productionEligible=true without a signed promotion must not authorize the candidate')
  signPromotion(markerPath, artifactPath)
  rejected(() => createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot,
    promotionPolicy: { mode: 'signed-candidate', trustedPublicKeys: {} } })(), 'an untrusted signer must be rejected')

  const otherKey = crypto.generateKeyPairSync('ed25519')
  signPromotion(markerPath, artifactPath, { signer: otherKey.privateKey })
  rejected(() => createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot, promotionPolicy: policy })(),
    'a forged signature must be rejected')

  signPromotion(markerPath, artifactPath, { artifactPathInManifest: '../outside.json' })
  rejected(() => createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot, promotionPolicy: policy })(),
    'signed path traversal must be rejected')

  signPromotion(markerPath, artifactPath)
  const candidate = createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot, promotionPolicy: policy })
  assert.equal(candidate().groups.length, 1, 'a valid signed fixture remains subject to the existing artifact release gate')
  assert.equal(candidate().groups[0].formalProgressEligible, false)
  const blockPath = path.join(candidateRoot, 'BLOCKED.json')
  fs.writeFileSync(blockPath, '{}', { flag: 'wx' })
  assert.throws(() => candidate(), (error) => error.code === 'AI_STUDY_CANDIDATE_BLOCKED' && error.statusCode === 503,
    'an explicit block signal must be distinguishable from damaged signed bytes')
  fs.unlinkSync(blockPath)
  assert.equal(candidate().groups.length, 1)
  const candidateEnv = { AI_PDF_INGESTION_ROOT: candidateRoot, STEM_AI_STUDY_PROMOTION_MODE: 'signed-candidate' }
  rejected(() => createRuntimeAiQuestionBank({ env: { AI_PDF_INGESTION_ROOT: candidateRoot }, libraryRoot })(),
    'the real entry must not treat a marked candidate as a legacy root')
  rejected(() => createRuntimeAiQuestionBank({ env: candidateEnv, libraryRoot })(),
    'the real entry must reject signed candidates while no audited trust anchor is installed')
  rejected(() => createRuntimeAiQuestionBank({ env: { ...candidateEnv, STEM_AI_STUDY_PROMOTION_MODE: 'unknown' }, libraryRoot,
    trustedPublicKeys: { 'fixture-key': publicKey } })(), 'an invalid entry mode must fail closed')
  rejected(() => createRuntimeAiQuestionBank({ env: candidateEnv, libraryRoot,
    trustedPublicKeys: { 'fixture-key': publicKey } })(),
  'the single-root runtime entry must not replace the legacy catalog with even a valid signed candidate')

  const repeatedIdPath = path.join(candidateRoot, paperId, 'repeated-id.json')
  fs.copyFileSync(artifactPath, repeatedIdPath)
  signPromotion(markerPath, artifactPath, { extraArtifactPaths: [repeatedIdPath] })
  rejected(() => candidate(), 'a signed candidate must reject a repeated route and source question ID')
  fs.unlinkSync(repeatedIdPath)
  signPromotion(markerPath, artifactPath)

  const duplicates = Array.from({ length: 28 }, (_, index) => {
    const duplicate = path.join(candidateRoot, paperId, `duplicate-${String(index).padStart(2, '0')}.json`)
    const item = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    item.candidate.questions[0].questionNumber = String(index + 3)
    item.verification.questions[0].questionNumber = String(index + 3)
    item.studentRelease = buildAiStudentStudyRelease({ ...item, routeId: item.syllabusRouteId })
    fs.writeFileSync(duplicate, JSON.stringify(item))
    return duplicate
  })
  signPromotion(markerPath, artifactPath, { extraArtifactPaths: duplicates, expectedRouteGroups: 29 })
  const originalRead = fs.readFileSync
  const originalReadSync = fs.readSync
  const originalOpen = fs.openSync
  const originalClose = fs.closeSync
  const descriptors = new Map()
  const sourceDescriptors = new Set()
  const measure = { artifactReads: 0, artifactBytes: 0, sourceReads: 0, sourceBytes: 0 }
  fs.openSync = function measuredOpen(file, ...args) {
    const descriptor = originalOpen.call(this, file, ...args)
    if (typeof file === 'string') descriptors.set(descriptor, file)
    return descriptor
  }
  fs.closeSync = function measuredClose(descriptor, ...args) {
    descriptors.delete(descriptor)
    sourceDescriptors.delete(descriptor)
    return originalClose.call(this, descriptor, ...args)
  }
  fs.readSync = function measuredSourceRead(descriptor, ...args) {
    const count = originalReadSync.call(this, descriptor, ...args)
    const name = descriptors.get(descriptor)
    if (typeof name === 'string' && name.endsWith('.pdf')) {
      if (!sourceDescriptors.has(descriptor)) { sourceDescriptors.add(descriptor); measure.sourceReads += 1 }
      measure.sourceBytes += count
    }
    return count
  }
  fs.readFileSync = function measuredRead(file, ...args) {
    const bytes = originalRead.call(this, file, ...args)
    const name = typeof file === 'number' ? descriptors.get(file) : file
    if (typeof name === 'string' && name.endsWith('.json')) {
      measure.artifactReads += 1
      measure.artifactBytes += Buffer.byteLength(bytes)
    }
    if (typeof name === 'string' && name.endsWith('.pdf')) {
      measure.sourceReads += 1
      measure.sourceBytes += Buffer.byteLength(bytes)
    }
    return bytes
  }
  const startCpu = process.cpuUsage()
  const start = process.hrtime.bigint()
  try { assert.equal(candidate().groups.length, 29) } finally {
    fs.readFileSync = originalRead
    fs.readSync = originalReadSync
    fs.openSync = originalOpen
    fs.closeSync = originalClose
  }
  const cpu = process.cpuUsage(startCpu)
  measure.wallMs = Number(process.hrtime.bigint() - start) / 1e6
  measure.cpuMs = (cpu.user + cpu.system) / 1000
  console.log(JSON.stringify({ benchmark: 'signed-29-artifacts-2-sources', ...measure }))
  assert.equal(measure.sourceReads, 2, 'each unique source must be fully hashed only once per load')
  assert.equal(measure.sourceBytes, qpBytes.length + msBytes.length)
  for (const duplicate of duplicates) fs.unlinkSync(duplicate)
  signPromotion(markerPath, artifactPath)

  const originalArtifact = fs.readFileSync(artifactPath)
  const missingReceipt = JSON.parse(originalArtifact.toString('utf8'))
  delete missingReceipt.verifier.runtimeAttestation
  missingReceipt.studentRelease = buildAiStudentStudyRelease({ ...missingReceipt, routeId: missingReceipt.syllabusRouteId })
  assert.equal(missingReceipt.studentRelease.review.independentPassCount, 2, 'the legacy count alone is not a receipt')
  fs.writeFileSync(artifactPath, JSON.stringify(missingReceipt))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'a signed candidate with a missing review-session receipt must be rejected')
  fs.writeFileSync(artifactPath, originalArtifact)
  signPromotion(markerPath, artifactPath)
  const repeatedSession = JSON.parse(originalArtifact.toString('utf8'))
  repeatedSession.extractor.runtimeAttestation.sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  repeatedSession.verifier.runtimeAttestation.sessionId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
  repeatedSession.studentRelease = buildAiStudentStudyRelease({ ...repeatedSession, routeId: repeatedSession.syllabusRouteId })
  fs.writeFileSync(artifactPath, JSON.stringify(repeatedSession))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'the same session must not appear independent by changing UUID letter case')
  fs.writeFileSync(artifactPath, originalArtifact)
  signPromotion(markerPath, artifactPath)
  const repeatedTurn = JSON.parse(originalArtifact.toString('utf8'))
  repeatedTurn.extractor.runtimeAttestation.turnId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  repeatedTurn.verifier.runtimeAttestation.turnId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
  repeatedTurn.studentRelease = buildAiStudentStudyRelease({ ...repeatedTurn, routeId: repeatedTurn.syllabusRouteId })
  fs.writeFileSync(artifactPath, JSON.stringify(repeatedTurn))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'the same turn must not appear independent by changing UUID letter case')
  fs.writeFileSync(artifactPath, originalArtifact)
  signPromotion(markerPath, artifactPath)
  const originalStat = fs.statSync(artifactPath)
  const modifiedArtifact = Buffer.from(originalArtifact)
  const index = modifiedArtifact.indexOf(Buffer.from('Fixture question.'))
  assert.ok(index >= 0)
  modifiedArtifact[index] = 'X'.charCodeAt(0)
  fs.writeFileSync(artifactPath, modifiedArtifact)
  fs.utimesSync(artifactPath, originalStat.atime, originalStat.mtime)
  rejected(() => candidate(), 'same-size artifact tampering must be rejected even after a prior successful load')
  fs.writeFileSync(artifactPath, originalArtifact)

  const qpPath = path.join(subjectRoot, qpFile)
  const qpStat = fs.statSync(qpPath)
  const tamperedQp = Buffer.from(qpBytes)
  tamperedQp[tamperedQp.length - 2] ^= 1
  fs.writeFileSync(qpPath, tamperedQp)
  fs.utimesSync(qpPath, qpStat.atime, qpStat.mtime)
  rejected(() => candidate(), 'same-size source-PDF tampering must not survive a prior valid candidate load')
  fs.writeFileSync(qpPath, qpBytes)
  assert.equal(candidate().groups.length, 1, 'restored source bytes must be revalidated')

  const oversizedDescriptor = fs.openSync(qpPath, 'r+')
  try { fs.ftruncateSync(oversizedDescriptor, 32 * 1024 * 1024 + 1) } finally { fs.closeSync(oversizedDescriptor) }
  let oversizedReads = 0
  const savedReadSync = fs.readSync
  const savedOpenSync = fs.openSync
  const savedCloseSync = fs.closeSync
  const oversizedDescriptors = new Set()
  fs.openSync = function trackOversizedOpen(file, ...args) {
    const descriptor = savedOpenSync.call(this, file, ...args)
    if (file === qpPath) oversizedDescriptors.add(descriptor)
    return descriptor
  }
  fs.closeSync = function trackOversizedClose(descriptor, ...args) {
    oversizedDescriptors.delete(descriptor)
    return savedCloseSync.call(this, descriptor, ...args)
  }
  fs.readSync = function countOversizedRead(descriptor, ...args) {
    if (oversizedDescriptors.has(descriptor)) oversizedReads += 1
    return savedReadSync.call(this, descriptor, ...args)
  }
  try { rejected(() => candidate(), 'a source above the per-file budget must fail closed') }
  finally { fs.readSync = savedReadSync; fs.openSync = savedOpenSync; fs.closeSync = savedCloseSync; fs.writeFileSync(qpPath, qpBytes) }
  assert.equal(oversizedReads, 0, 'the oversized PDF must be rejected before source bytes are read')
  assert.equal(candidate().groups.length, 1)

  const extra = path.join(candidateRoot, paperId, 'unlisted.json')
  fs.writeFileSync(extra, '{}')
  rejected(() => candidate(), 'an unsigned additional artifact must be rejected')
  fs.unlinkSync(extra)
  assert.equal(candidate().groups.length, 1, 'the valid fixture remains loadable after restoring its exact bytes')

  const unreviewedArtifact = JSON.parse(originalArtifact.toString('utf8'))
  delete unreviewedArtifact.studentRelease
  fs.writeFileSync(artifactPath, JSON.stringify(unreviewedArtifact))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'a valid root signature must not release an artifact without its own review binding')
  fs.writeFileSync(artifactPath, originalArtifact)
  signPromotion(markerPath, artifactPath)
  assert.equal(candidate().groups.length, 1)

  const singlePassArtifact = JSON.parse(originalArtifact.toString('utf8'))
  singlePassArtifact.sourceReview = {
    schemaVersion: 'ai-source-semantic-review.v1', decision: 'accept', provider: 'fixture-reviewer', model: 'fixture-model',
    runtimeAttestation: { sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', modelProvider: 'fixture-reviewer', model: 'fixture-model',
      sessionLogSha256: 'c'.repeat(64), fullReviewSha256: 'd'.repeat(64) },
    reviewedAt: '2026-11-16T00:00:00Z',
    reviewNote: 'Synthetic review confirms the entire source-bound question, marks, coordinates and paired marking evidence.',
    confirmations: Object.fromEntries(['sourceBindingConfirmed', 'wholeQuestionConfirmed', 'partStructureConfirmed',
      'marksConfirmed', 'markSchemeEvidenceConfirmed', 'topicMappingConfirmed'].map((key) => [key, true])),
    inputSha256: sourceReviewInputSha256(singlePassArtifact),
    evidence: [{ document: 'qp', page: 3, pageImageSha256: 'd'.repeat(64) },
      { document: 'ms', page: 5, pageImageSha256: 'e'.repeat(64) }],
  }
  singlePassArtifact.studentRelease = buildAiStudentStudyRelease({ ...singlePassArtifact, routeId: singlePassArtifact.syllabusRouteId })
  assert.equal(singlePassArtifact.studentRelease.review.independentPassCount, 1)
  fs.writeFileSync(artifactPath, JSON.stringify(singlePassArtifact))
  signPromotion(markerPath, artifactPath)
  assert.equal(candidate().groups.length, 1, 'a signed study-only candidate may use one traceable source review')
  const missingSingleReceipt = JSON.parse(JSON.stringify(singlePassArtifact))
  delete missingSingleReceipt.sourceReview.runtimeAttestation
  missingSingleReceipt.studentRelease = buildAiStudentStudyRelease({ ...missingSingleReceipt, routeId: missingSingleReceipt.syllabusRouteId })
  fs.writeFileSync(artifactPath, JSON.stringify(missingSingleReceipt))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'single-review candidates require a source review session receipt')
  const wrongSingleReviewer = JSON.parse(JSON.stringify(singlePassArtifact))
  wrongSingleReviewer.sourceReview.runtimeAttestation.model = 'other-model'
  wrongSingleReviewer.studentRelease = buildAiStudentStudyRelease({ ...wrongSingleReviewer, routeId: wrongSingleReviewer.syllabusRouteId })
  fs.writeFileSync(artifactPath, JSON.stringify(wrongSingleReviewer))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'single-review session model must match the source reviewer')
  const referenceDependent = JSON.parse(originalArtifact.toString('utf8'))
  referenceDependent.candidate.questions[0].parts[0].needsReferenceMaterial = true
  referenceDependent.verification.questions[0].parts[0].needsReferenceMaterial = true
  referenceDependent.studentRelease = buildAiStudentStudyRelease({ ...referenceDependent, routeId: referenceDependent.syllabusRouteId })
  fs.writeFileSync(artifactPath, JSON.stringify(referenceDependent))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'a candidate requiring an unsupported reference must remain unavailable')
  const questionReference = JSON.parse(originalArtifact.toString('utf8'))
  questionReference.candidate.questions[0].needsReferenceMaterial = true
  questionReference.verification.questions[0].needsReferenceMaterial = true
  questionReference.studentRelease = buildAiStudentStudyRelease({ ...questionReference, routeId: questionReference.syllabusRouteId })
  fs.writeFileSync(artifactPath, JSON.stringify(questionReference))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'a question-level reference dependency must not be hidden')
  const referenceRegions = JSON.parse(originalArtifact.toString('utf8'))
  referenceRegions.candidate.questions[0].referenceMaterialRegions = [{ page: 16 }]
  referenceRegions.verification.questions[0].referenceMaterialRegions = [{ page: 16 }]
  referenceRegions.studentRelease = buildAiStudentStudyRelease({ ...referenceRegions, routeId: referenceRegions.syllabusRouteId })
  fs.writeFileSync(artifactPath, JSON.stringify(referenceRegions))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'declared reference regions must remain unavailable until clients can render them')
  const separateReference = JSON.parse(originalArtifact.toString('utf8'))
  separateReference.candidate.examReference = { page: 16, rotationDegrees: 90 }
  separateReference.verification.examReference = { page: 16, rotationDegrees: 90 }
  separateReference.studentRelease = buildAiStudentStudyRelease({ ...separateReference, routeId: separateReference.syllabusRouteId })
  fs.writeFileSync(artifactPath, JSON.stringify(separateReference))
  signPromotion(markerPath, artifactPath)
  rejected(() => candidate(), 'a declared paper reference must not be lost for old clients')
  fs.writeFileSync(artifactPath, originalArtifact)
  signPromotion(markerPath, artifactPath, { expectedRouteGroups: 2 })
  rejected(() => candidate(), 'a signed pack with a missing expected route group must not partially load')
  signPromotion(markerPath, artifactPath)
  assert.equal(candidate().groups.length, 1)

  fs.unlinkSync(markerPath)
  rejected(() => createAiVerifiedQuestionBankLoader({ artifactRoot: candidateRoot, libraryRoot, promotionPolicy: policy })(),
    'signed-candidate mode must reject a missing candidate marker')
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', legacyGroups: 1, signedFixtureGroups: 1,
    rejectionCases, sourceTamperCases: 1, unreviewedArtifactCases: 1, singlePassCases: 1 }))
} finally {
  const resolved = fs.realpathSync(root)
  assert.equal(path.dirname(resolved), worktreeRoot, 'refusing cleanup outside the staging worktree')
  assert.ok(path.basename(resolved).startsWith('.promotion-gate-fixture-'))
  fs.rmSync(resolved, { recursive: true, force: true })
}
