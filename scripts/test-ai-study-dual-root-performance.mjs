import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { createAiStudyDualRootLoader } from '../server/aiStudyDualRoot.js'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const ARTIFACT_COUNT = 573
const ROUTE = 'cie-9709-as-p1-p5'
const PAPER_ID = 'cie-9709-9709_m25_qp_12'
const QUESTION_FILE = '9709_m25_qp_12.pdf'
const MARK_SCHEME_FILE = '9709_m25_ms_12.pdf'
const FIXTURE_PREFIX = '.legacy-loader-benchmark-'
const FIXTURE_TIME = 1_600_000_000
const negativeControl = process.argv.slice(2).includes('--negative-control')
const scale = process.argv.slice(2).includes('--scale')
const expectedGroups = scale ? 581 : 1
assert.ok(process.argv.slice(2).every((arg) => ['--negative-control', '--scale'].includes(arg)), 'Unknown argument')

const workspace = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
let fixtureRoot
let fixtureIdentity

function within(parent, child) {
  const relative = path.relative(parent, child)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function cleanFixture() {
  if (!fixtureRoot || !fixtureIdentity) return
  const stat = fs.lstatSync(fixtureRoot)
  const real = fs.realpathSync(fixtureRoot)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Fixture path is no longer an ordinary directory')
  assert.equal(stat.dev, fixtureIdentity.dev, 'Fixture device changed; refusing cleanup')
  assert.equal(stat.ino, fixtureIdentity.ino, 'Fixture identity changed; refusing cleanup')
  assert.ok(samePath(real, fixtureIdentity.real), 'Fixture target changed; refusing cleanup')
  assert.ok(samePath(path.dirname(real), workspace), 'Fixture is outside the workspace; refusing cleanup')
  assert.ok(path.basename(real).startsWith(FIXTURE_PREFIX), 'Unexpected fixture name; refusing cleanup')
  fs.rmSync(fixtureRoot, { recursive: true, force: false })
  assert.equal(fs.existsSync(fixtureRoot), false, 'Fixture cleanup failed')
  console.log(JSON.stringify({ phase: 'fixture_cleanup', path: fixtureRoot, removed: true }))
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function buildArtifact(subjectRoot, questionBytes, markSchemeBytes) {
  const questionPdfSha256 = sha256(questionBytes)
  const markSchemePdfSha256 = sha256(markSchemeBytes)
  const identity = artifactId({ paperId: PAPER_ID, questionPdfSha256, markSchemePdfSha256 })
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1',
    artifactId: identity,
    paperId: PAPER_ID,
    subject: '9709',
    stage: 'AS',
    syllabusRouteId: ROUTE,
    status: 'ai-verified',
    storageMode: 'coordinate-only',
    extractor: { provider: 'openai', model: 'synthetic', schemaName: 'ai_pdf_question_extraction_v1' },
    verifier: { provider: 'qwen', model: 'synthetic', schemaName: 'ai_pdf_question_verification_v1' },
    source: {
      questionPdfPath: path.join(subjectRoot, QUESTION_FILE),
      markSchemePdfPath: path.join(subjectRoot, MARK_SCHEME_FILE),
      questionPdfSha256,
      markSchemePdfSha256,
      renderDpi: 120,
      pageImageHashes: { 3: 'd'.repeat(64) },
      pageSizes: { 3: { width: 1200, height: 1600 } },
      markSchemePageHashes: { 5: 'e'.repeat(64) },
      markSchemePageSizes: { 5: { width: 1200, height: 1600 } },
    },
    candidate: {
      questions: [{
        questionNumber: '2',
        questionStartPage: 3,
        regions: [{ page: 3, pageImageSha256: 'd'.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }],
        diagramRegions: [],
        parts: [{ label: 'a', marks: 4, ocrText: 'Synthetic question.', math: [], diagramAssociations: [] }],
        tags: { primaryTopicId: '9709-p1-topic-01', secondaryTopicIds: [], syllabusPointIds: [] },
        markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }],
      }],
    },
    verification: {
      questions: [{
        questionNumber: '2',
        questionStartPage: 3,
        pages: [3],
        regions: [{ page: 3, pageImageSha256: 'd'.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }],
        diagramRegions: [],
        parts: [{ label: 'a', marks: 4 }],
        diagramRegionCount: 0,
        tags: { primaryTopicId: '9709-p1-topic-01', secondaryTopicIds: [], syllabusPointIds: [] },
        markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }],
      }],
    },
  }
  artifact.studentRelease = buildAiStudentStudyRelease({
    artifactId: artifact.artifactId,
    routeId: artifact.syllabusRouteId,
    status: artifact.status,
    source: artifact.source,
    extractor: artifact.extractor,
    verifier: artifact.verifier,
    candidate: artifact.candidate,
    verification: artifact.verification,
  })
  assert.ok(artifact.studentRelease, 'Synthetic release must be valid')
  return artifact
}

function instrumentIo(artifactRoot, libraryRoot) {
  const original = {
    readFileSync: fs.readFileSync,
    statSync: fs.statSync,
    lstatSync: fs.lstatSync,
    createHash: crypto.createHash,
  }
  const taggedBuffers = new WeakMap()
  let active = null

  function fileClass(file) {
    if (typeof file !== 'string') return null
    const resolved = path.resolve(file)
    if (within(libraryRoot, resolved)) return 'source'
    if (within(artifactRoot, resolved) && path.dirname(resolved) !== artifactRoot && resolved.endsWith('.json')) return 'artifact'
    return null
  }

  fs.readFileSync = function (file, ...args) {
    const result = original.readFileSync.call(this, file, ...args)
    const kind = active && fileClass(file)
    if (kind) {
      const bytes = typeof result === 'string' ? Buffer.byteLength(result, 'utf8') : result.byteLength
      active[kind].reads += 1
      active[kind].bytes += bytes
      if (Buffer.isBuffer(result)) taggedBuffers.set(result, kind)
    }
    return result
  }
  for (const name of ['statSync', 'lstatSync']) {
    fs[name] = function (file, ...args) {
      const kind = active && fileClass(file)
      if (kind) active[kind].stats += 1
      return original[name].call(this, file, ...args)
    }
  }
  crypto.createHash = function (...args) {
    const hash = original.createHash.apply(this, args)
    if (active) active.hash.created += 1
    const update = hash.update
    hash.update = function (data, ...updateArgs) {
      if (active) {
        const bytes = typeof data === 'string' ? Buffer.byteLength(data, updateArgs[0] || 'utf8') : data.byteLength
        active.hash.updates += 1
        active.hash.bytes += bytes
        if (Buffer.isBuffer(data) && taggedBuffers.get(data) === 'source') {
          active.hash.sourceUpdates += 1
          active.hash.sourceBytes += bytes
        }
      }
      return update.call(this, data, ...updateArgs)
    }
    return hash
  }
  syncBuiltinESMExports()

  return {
    async measure(phase, load) {
      const counters = {
        artifact: { reads: 0, bytes: 0, stats: 0 },
        source: { reads: 0, bytes: 0, stats: 0 },
        hash: { created: 0, updates: 0, bytes: 0, sourceUpdates: 0, sourceBytes: 0 },
      }
      const histogram = monitorEventLoopDelay({ resolution: 1 })
      histogram.enable()
      await delay(10)
      const cpuStart = process.cpuUsage()
      const start = performance.now()
      active = counters
      let value
      let wallMs
      let cpu
      try {
        value = load()
      } finally {
        wallMs = performance.now() - start
        cpu = process.cpuUsage(cpuStart)
        active = null
      }
      await delay(10)
      histogram.disable()
      const samples = Number(histogram.count)
      const metrics = {
        phase,
        ...counters,
        wallMs: Number(wallMs.toFixed(3)),
        cpuUserMs: Number((cpu.user / 1000).toFixed(3)),
        cpuSystemMs: Number((cpu.system / 1000).toFixed(3)),
        eventLoopDelay: {
          resolutionMs: 1,
          samples,
          maxMs: samples ? Number((histogram.max / 1e6).toFixed(3)) : null,
          p99Ms: samples ? Number((histogram.percentile(99) / 1e6).toFixed(3)) : null,
        },
      }
      console.log(JSON.stringify(metrics))
      return { value, metrics }
    },
    restore() {
      fs.readFileSync = original.readFileSync
      fs.statSync = original.statSync
      fs.lstatSync = original.lstatSync
      crypto.createHash = original.createHash
      syncBuiltinESMExports()
    },
  }
}

function assertCached(warm, cold) {
  assert.ok(warm.artifact.reads < cold.artifact.reads / 10, 'Warm load rereads too many artifacts')
  assert.ok(warm.source.reads < cold.source.reads / 10, 'Warm load rereads too many sources')
  assert.ok(warm.hash.sourceUpdates < cold.hash.sourceUpdates / 10, 'Warm load rehashes too many sources')
  assert.ok(warm.hash.created < cold.hash.created / 10, 'Warm load performs too much hashing')
}

try {
  fixtureRoot = fs.mkdtempSync(path.join(workspace, FIXTURE_PREFIX))
  const created = fs.lstatSync(fixtureRoot)
  fixtureIdentity = { dev: created.dev, ino: created.ino, real: fs.realpathSync(fixtureRoot) }
  assert.ok(created.isDirectory() && !created.isSymbolicLink())
  assert.ok(samePath(path.dirname(fixtureIdentity.real), workspace))

  const artifactRoot = path.join(fixtureRoot, 'artifacts')
  const artifactDirectory = path.join(artifactRoot, PAPER_ID)
  const libraryRoot = path.join(fixtureRoot, 'library')
  const subjectRoot = path.join(libraryRoot, '9709')
  const questionPath = path.join(subjectRoot, QUESTION_FILE)
  const markSchemePath = path.join(subjectRoot, MARK_SCHEME_FILE)
  const questionBytes = Buffer.from('Synthetic QP fixture; this is not a real PDF.\n', 'utf8')
  const markSchemeBytes = Buffer.from('Synthetic MS fixture; this is not a real PDF.\n', 'utf8')
  fs.mkdirSync(artifactDirectory, { recursive: true })
  fs.mkdirSync(subjectRoot, { recursive: true })
  fs.writeFileSync(questionPath, questionBytes, { flag: 'wx' })
  fs.writeFileSync(markSchemePath, markSchemeBytes, { flag: 'wx' })
  fs.utimesSync(questionPath, FIXTURE_TIME, FIXTURE_TIME)
  fs.utimesSync(markSchemePath, FIXTURE_TIME, FIXTURE_TIME)

  const artifact = buildArtifact(subjectRoot, questionBytes, markSchemeBytes)
  const artifactBytes = Buffer.from(JSON.stringify(artifact), 'utf8')
  let totalArtifactBytes = 0
  for (let i = 0; i < ARTIFACT_COUNT; i += 1) {
    let bytes = artifactBytes
    if (scale) {
      const current = structuredClone(artifact)
      current.candidate.questions[0].questionNumber = String(i + 1)
      current.verification.questions[0].questionNumber = String(i + 1)
      if (i < 8) {
        const extraCandidate = structuredClone(current.candidate.questions[0])
        const extraVerification = structuredClone(current.verification.questions[0])
        extraCandidate.questionNumber = String(ARTIFACT_COUNT + i + 1)
        extraVerification.questionNumber = String(ARTIFACT_COUNT + i + 1)
        current.candidate.questions.push(extraCandidate)
        current.verification.questions.push(extraVerification)
      }
      current.studentRelease = buildAiStudentStudyRelease({ ...current, routeId: current.syllabusRouteId })
      bytes = Buffer.from(JSON.stringify(current), 'utf8')
    }
    totalArtifactBytes += bytes.length
    fs.writeFileSync(path.join(artifactDirectory, `artifact-${String(i).padStart(3, '0')}.json`), bytes, { flag: 'wx' })
  }
  assert.equal(fs.readdirSync(artifactDirectory).length, ARTIFACT_COUNT)
  assert.ok(totalArtifactBytes + ARTIFACT_COUNT * (questionBytes.length + markSchemeBytes.length) < 4 * 1024 * 1024,
    'Synthetic cold file I/O budget exceeded')
  console.log(JSON.stringify({
    phase: 'fixture',
    path: fixtureRoot,
    variant: negativeControl ? 'forced-legacy-refresh-negative-control' : 'normal',
    artifactFiles: ARTIFACT_COUNT,
    expectedGroups,
    uniqueSourceFiles: 2,
    artifactBytesEach: artifactBytes.length,
    sourceBytes: { question: questionBytes.length, markScheme: markSchemeBytes.length },
  }))

  const legacyCalls = []
  const candidateCalls = []
  function observeLegacy(actual) {
    return (...args) => {
      const effectiveArgs = negativeControl ? [{ refresh: true }] : args
      legacyCalls.push(effectiveArgs)
      return actual(...effectiveArgs)
    }
  }
  function createObservedLegacy() {
    return observeLegacy(createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot }))
  }
  const legacy = createObservedLegacy()
  const load = createAiStudyDualRootLoader({ legacyLoader: legacy })
  const failingCandidate = (options) => {
    candidateCalls.push(options)
    throw Object.assign(new Error('Synthetic candidate failure'), { code: 'AI_STUDY_PROMOTION_INVALID' })
  }
  const withFailedCandidate = createAiStudyDualRootLoader({
    legacyLoader: legacy,
    candidateLoader: failingCandidate,
    candidateRouteIds: [ROUTE],
  })

  const instrumentation = instrumentIo(artifactRoot, libraryRoot)
  try {
    const cold = await instrumentation.measure('cold_candidate_absent', () => load())
    assert.equal(cold.value.complete, true)
    assert.equal(cold.value.groups.length, expectedGroups, 'The fixture must contain the expected number of unique groups')
    assert.equal(cold.value.documents.length, 2)
    assert.equal(cold.value.groups[0].routeId, ROUTE)
    assert.equal(cold.value.groups[0].studentStudyEligible, true)
    assert.equal(cold.value.groups[0].sourceRef.sha256, sha256(questionBytes))
    assert.equal(cold.value.groups[0].answerRef.sha256, sha256(markSchemeBytes))
    assert.equal(cold.metrics.artifact.reads, ARTIFACT_COUNT, 'Instrumentation must see every cold artifact read')
    assert.equal(cold.metrics.artifact.bytes, totalArtifactBytes)
    assert.equal(cold.metrics.source.reads, 2, 'Each unique legacy source must be read only once in a cold load')
    assert.equal(cold.metrics.source.bytes, questionBytes.length + markSchemeBytes.length)
    assert.ok(cold.metrics.source.stats <= 4, 'Each unique legacy source must have bounded metadata checks in a cold load')
    assert.equal(cold.metrics.hash.sourceUpdates, 2, 'Each unique legacy source must be hashed only once in a cold load')
    assert.equal(cold.metrics.hash.sourceBytes, cold.metrics.source.bytes)

    for (let i = 1; i <= 3; i += 1) {
      const warm = await instrumentation.measure(`warm_candidate_absent_${i}`, () => load())
      assert.deepEqual(warm.value, cold.value)
      assertCached(warm.metrics, cold.metrics)
    }
    if (scale) {
      const strict = createAiStudyDualRootLoader({ legacyLoader: createAiVerifiedQuestionBankLoader({
        artifactRoot, libraryRoot, failOnPreviouslyVerifiedLoss: true,
      }) })
      const strictCold = await instrumentation.measure('cold_strict_581_groups', () => strict())
      assert.equal(strictCold.value.groups.length, expectedGroups)
      const strictWarm = await instrumentation.measure('warm_strict_581_groups', () => strict())
      assert.equal(strictWarm.value.groups.length, expectedGroups)
      assertCached(strictWarm.metrics, strictCold.metrics)
    }
    const failed = await instrumentation.measure('warm_candidate_failure', () => withFailedCandidate())
    assertCached(failed.metrics, cold.metrics)
    assert.equal(failed.value.complete, false)
    assert.equal(failed.value.candidateErrorCode, 'AI_STUDY_PROMOTION_INVALID')
    assert.deepEqual(failed.value.groups, cold.value.groups)
    assert.throws(() => withFailedCandidate({ routeId: ROUTE }), (error) => error.code === 'AI_STUDY_PROMOTION_INVALID')
    assert.deepEqual(candidateCalls, [{ refresh: true }, { refresh: true }])

    const blockedPath = path.join(artifactRoot, 'BLOCKED.json')
    fs.writeFileSync(blockedPath, '{}', { flag: 'wx' })
    assert.throws(() => load(), (error) => error.code === 'AI_STUDY_PROMOTION_REQUIRED')
    fs.unlinkSync(blockedPath)
    assert.deepEqual(load(), cold.value, 'Removing BLOCKED must recover the cached legacy catalog')

    const originalStat = fs.statSync(questionPath)
    const altered = Buffer.from(questionBytes)
    altered[0] ^= 1
    fs.writeFileSync(questionPath, altered)
    fs.utimesSync(questionPath, originalStat.atime, originalStat.mtime)
    const tamperedStat = fs.statSync(questionPath)
    assert.equal(tamperedStat.size, originalStat.size)
    assert.equal(tamperedStat.mtimeMs, originalStat.mtimeMs, 'Test requires exactly restored mtime')
    assert.notEqual(sha256(altered), sha256(questionBytes))
    const sameMetadataGroups = load().groups.length
    assert.ok([0, expectedGroups].includes(sameMetadataGroups))
    const sameSizeRestoredMtimeGap = sameMetadataGroups === expectedGroups
    fs.writeFileSync(questionPath, questionBytes)
    fs.utimesSync(questionPath, originalStat.atime, originalStat.mtime)

    const mtimeActual = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })
    const mtimeLoad = createAiStudyDualRootLoader({ legacyLoader: observeLegacy(mtimeActual) })
    assert.equal(mtimeLoad().groups.length, expectedGroups)
    fs.writeFileSync(questionPath, altered)
    fs.utimesSync(questionPath, originalStat.atime, new Date(originalStat.mtimeMs + 2000))
    assert.equal(fs.statSync(questionPath).size, originalStat.size)
    assert.notEqual(fs.statSync(questionPath).mtimeMs, originalStat.mtimeMs)
    assert.equal(mtimeLoad().groups.length, 0, 'Changed source mtime and hash must reject its group')
    fs.writeFileSync(questionPath, questionBytes)
    fs.utimesSync(questionPath, originalStat.atime, originalStat.mtime)
    const sourceRestoreGroupsWithoutRefresh = mtimeLoad().groups.length
    assert.equal(sourceRestoreGroupsWithoutRefresh, expectedGroups, 'Restored source must recover without forcing a legacy refresh')
    const sourceRestoreGroupsWithExplicitRefresh = mtimeActual({ refresh: true }).groups.length
    assert.equal(sourceRestoreGroupsWithExplicitRefresh, expectedGroups, 'Restored fixture must validate after an explicit legacy refresh')

    const sizeLoad = createAiStudyDualRootLoader({ legacyLoader: createObservedLegacy() })
    assert.equal(sizeLoad().groups.length, expectedGroups)
    fs.writeFileSync(questionPath, Buffer.concat([questionBytes, Buffer.from('!')]))
    fs.utimesSync(questionPath, originalStat.atime, originalStat.mtime)
    assert.notEqual(fs.statSync(questionPath).size, originalStat.size)
    assert.equal(fs.statSync(questionPath).mtimeMs, originalStat.mtimeMs)
    assert.equal(sizeLoad().groups.length, 0, 'Changed source size and hash must reject its group')

    fs.writeFileSync(questionPath, questionBytes)
    fs.utimesSync(questionPath, originalStat.atime, originalStat.mtime)
    const raceLoad = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })
    const priorRead = fs.readFileSync
    let changedDuringLoad = false
    fs.readFileSync = function raceRead(file, ...args) {
      const result = priorRead.call(this, file, ...args)
      if (file === questionPath && !changedDuringLoad) {
        changedDuringLoad = true
        fs.writeFileSync(questionPath, altered)
        const changedAt = new Date(Date.now() + 5000)
        fs.utimesSync(questionPath, changedAt, changedAt)
      }
      return result
    }
    try {
      assert.throws(() => raceLoad(), (error) => error.code === 'AI_STUDY_LEGACY_UNAVAILABLE' && error.statusCode === 503,
        'A source changed during a load must not produce a cached snapshot')
    } finally {
      fs.readFileSync = priorRead
      fs.writeFileSync(questionPath, questionBytes)
      fs.utimesSync(questionPath, originalStat.atime, originalStat.mtime)
    }
    assert.equal(raceLoad().groups.length, expectedGroups, 'A coherent source must recover after the in-flight mutation')

    const strictLegacy = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot, failOnPreviouslyVerifiedLoss: true })
    assert.equal(strictLegacy().groups.length, expectedGroups)
    fs.writeFileSync(questionPath, Buffer.concat([questionBytes, Buffer.from('!')]))
    assert.throws(() => strictLegacy(), (error) => error.code === 'AI_STUDY_LEGACY_UNAVAILABLE' && error.statusCode === 503,
      'A previously verified legacy group lost to source tampering must fail the whole legacy snapshot')
    fs.writeFileSync(questionPath, questionBytes)
    assert.equal(strictLegacy().groups.length, expectedGroups, 'Restoring the legacy source must restore the same validated group')

    assert.ok(legacyCalls.length > 0)
    assert.ok(legacyCalls.every((args) => args[0]?.refresh !== true), 'Dual-root must not refresh legacy')
    console.log(JSON.stringify({
      phase: 'result',
      status: 'PASS',
      artifactFiles: ARTIFACT_COUNT,
      uniqueGroups: cold.value.groups.length,
      uniqueDocuments: cold.value.documents.length,
      legacyCalls: legacyCalls.length,
      legacyRefreshTrueCalls: legacyCalls.filter((args) => args[0]?.refresh === true).length,
      candidateRefreshTrueCalls: candidateCalls.filter((options) => options?.refresh === true).length,
      blockedRevokesAndRecovers: true,
      changedMtimeRejected: true,
      changedSizeRejected: true,
      sameSizeRestoredMtimeGap,
      sourceRestoreGroupsWithoutRefresh,
      sourceRestoreGroupsWithExplicitRefresh,
      instrumentation: 'synchronous path-based readFileSync, statSync, lstatSync and crypto.createHash',
    }))
  } finally {
    instrumentation.restore()
  }
} finally {
  cleanFixture()
}
