import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { artifactId, hasValidAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'
import { providersFromEnvironment } from './ai-pdf-ingestion/provider-fallback.mjs'
import { runCli } from './ingest-ai-pdf-questions.mjs'
import {
  ingestPaddleJob,
  loadCompletedPaddleJob,
  routePlansForJob,
} from './ingest-paddle-ocr-queue.mjs'

export const REVIEW_LEDGER_SCHEMA_VERSION = 'stem-paddle-ocr-review-ledger.v1'

const TERMINAL_LEDGER_STATUSES = new Set(['completed', 'blocked', 'failed'])
const TERMINAL_ARTIFACT_STATUSES = new Set(['ai-verified', 'auto-quarantined'])
const SHA256_ID = /^sha256:[a-f0-9]{64}$/

export function openAiOnlyProviders(env = {}, options = {}) {
  return Object.freeze(providersFromEnvironment(env, options).filter((provider) => provider.name === 'openai'))
}

export async function consumePaddleReviewQueue({
  workRoot,
  outputRoot,
  ledgerPath = null,
  env = process.env,
  reviewId = null,
  limit = Number.POSITIVE_INFINITY,
  retryFailed = false,
  retryBlocked = false,
  retryQuarantined = false,
  retryCompleted = false,
  now = () => new Date(),
  loadCompletedJobImpl = loadCompletedPaddleJob,
  ingestJobImpl = ingestPaddleJob,
} = {}) {
  const root = requiredDirectory(workRoot, 'workRoot')
  const artifactsRoot = requiredDirectory(outputRoot, 'outputRoot')
  const resolvedLedgerPath = resolveInside(root, ledgerPath || path.join(root, 'state', 'structure-review-ledger.json'))
  const manifest = readJsonFile(path.join(root, 'manifest', 'manifest.json'), 'PADDLE_MANIFEST_UNREADABLE')
  const queueRows = readJsonLines(path.join(root, 'queue', 'structure-review.jsonl'))
  const jobsById = manifestJobsById(manifest)
  const ledger = readReviewLedger(resolvedLedgerPath)
  const entriesById = new Map(ledger.entries.map((entry) => [entry.reviewId, entry]))
  const requestedId = normalizeOptionalReviewId(reviewId)
  if (retryCompleted && !requestedId) throw new RangeError('retryCompleted requires one explicit reviewId')
  const boundedLimit = normalizedLimit(limit)
  const summary = {
    selected: 0,
    completed: 0,
    blocked: 0,
    failed: 0,
    skipped: 0,
    releasedRoutes: 0,
    quarantinedRoutes: 0,
  }
  const selectedRows = []
  for (const row of queueRows.filter((candidate) => !requestedId || candidate?.reviewId === requestedId)) {
    const existingEntry = entriesById.get(String(row?.reviewId || ''))
    if (existingEntry && shouldSkipLedgerEntry(existingEntry, { retryFailed, retryBlocked, retryQuarantined, retryCompleted })) {
      summary.skipped += 1
      continue
    }
    if (selectedRows.length >= boundedLimit) break
    selectedRows.push(row)
  }
  summary.selected = selectedRows.length

  for (const row of selectedRows) {
    const startedAt = isoNow(now)
    try {
      const job = validateReviewHandoff({ root, row, jobsById })
      const routePlans = routePlansForJob(job)
      const existingRoutes = routePlans.map((route) => readTerminalRouteArtifact({
        outputRoot: artifactsRoot,
        job,
        route,
      }))
      let source = 'provider-review'

      const shouldRetryQuarantine = retryQuarantined
        && existingRoutes.some((artifact) => artifact?.status === 'auto-quarantined')
      const shouldRetryCompleted = retryCompleted && Boolean(requestedId)
      if (!existingRoutes.every(Boolean) || shouldRetryQuarantine || shouldRetryCompleted) {
        const completed = loadCompletedJobImpl({ workRoot: root, job })
        await ingestJobImpl({
          workRoot: root,
          job,
          outputRoot: artifactsRoot,
          env,
          completed,
          retry: shouldRetryQuarantine || shouldRetryCompleted,
          runCliImpl: runOpenAiOnlyCli,
        })
      } else {
        source = 'existing-artifacts'
      }

      const routes = routePlans.map((route) => {
        const artifact = readTerminalRouteArtifact({ outputRoot: artifactsRoot, job, route })
        if (!artifact) throw codedError('PADDLE_TERMINAL_ARTIFACT_MISSING')
        return routeLedgerRecord({ artifact, route, outputRoot: artifactsRoot, job })
      })
      const entry = {
        reviewId: job.jobId,
        paperId: job.paperId,
        status: 'completed',
        source,
        startedAt,
        completedAt: isoNow(now),
        routes,
      }
      entriesById.set(job.jobId, entry)
      summary.completed += 1
      summary.releasedRoutes += routes.filter((route) => route.status === 'ai-verified').length
      summary.quarantinedRoutes += routes.filter((route) => route.status === 'auto-quarantined').length
    } catch (error) {
      const errorCode = safeErrorCode(error)
      const blocked = errorCode.startsWith('PADDLE_')
      const entry = {
        reviewId: safeReviewId(row?.reviewId),
        paperId: safeText(row?.paperId),
        status: blocked ? 'blocked' : 'failed',
        source: 'consumer',
        startedAt,
        completedAt: isoNow(now),
        errorCode,
        routes: [],
      }
      entriesById.set(entry.reviewId, entry)
      if (blocked) summary.blocked += 1
      else summary.failed += 1
    }

    writeReviewLedgerAtomic(resolvedLedgerPath, {
      schemaVersion: REVIEW_LEDGER_SCHEMA_VERSION,
      updatedAt: isoNow(now),
      entries: [...entriesById.values()].sort((left, right) => left.reviewId.localeCompare(right.reviewId)),
    })
  }

  return summary
}

export async function watchPaddleReviewQueue({
  consumeOptions = {},
  pollIntervalMs = 15000,
  idleExitPolls = 120,
  consumeImpl = consumePaddleReviewQueue,
  sleepImpl = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
  onPoll = null,
} = {}) {
  const interval = positiveInteger(pollIntervalMs, 'pollIntervalMs')
  const idleLimit = positiveInteger(idleExitPolls, 'idleExitPolls')
  let polls = 0
  let idlePolls = 0
  while (idlePolls < idleLimit) {
    const result = await consumeImpl(consumeOptions)
    polls += 1
    idlePolls = result?.selected === 0 ? idlePolls + 1 : 0
    if (typeof onPoll === 'function') await onPoll(result)
    if (idlePolls >= idleLimit) break
    await sleepImpl(interval)
  }
  return { polls, idlePolls, stopped: 'idle' }
}

export function acquireReviewConsumerLock({
  workRoot,
  pid = process.pid,
  nonce = randomUUID(),
  now = () => new Date(),
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  const root = requiredDirectory(workRoot, 'workRoot')
  const locksRoot = path.join(root, 'locks')
  fs.mkdirSync(locksRoot, { recursive: true })
  const lockPath = resolveInside(root, path.join(locksRoot, 'paddle-review-consumer.lock'))
  const lockRecord = {
    schemaVersion: 'stem-paddle-ocr-review-consumer-lock.v1',
    pid: positiveInteger(pid, 'pid'),
    nonce: safeText(nonce),
    startedAt: isoNow(now),
  }
  if (!lockRecord.nonce) throw new RangeError('nonce must be non-empty')

  try {
    fs.writeFileSync(lockPath, `${JSON.stringify(lockRecord)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const existing = readExistingLock(lockPath)
    if (!existing || isProcessAlive(Number(existing.pid))) throw codedError('PADDLE_REVIEW_CONSUMER_LOCKED')
    fs.rmSync(lockPath, { force: true })
    fs.writeFileSync(lockPath, `${JSON.stringify(lockRecord)}\n`, { encoding: 'utf8', flag: 'wx' })
  }

  let released = false
  return Object.freeze({
    path: lockPath,
    release() {
      if (released) return
      released = true
      const existing = readExistingLock(lockPath)
      if (existing?.pid === lockRecord.pid && existing?.nonce === lockRecord.nonce) {
        fs.rmSync(lockPath, { force: true })
      }
    },
  })
}

export function writeReviewLedgerAtomic(filePath, ledger) {
  const target = path.resolve(String(filePath || ''))
  if (!target) throw codedError('PADDLE_REVIEW_LEDGER_PATH_INVALID')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const existing = fs.lstatSync(target, { throwIfNoEntry: false })
  if (existing?.isSymbolicLink()) throw codedError('PADDLE_REVIEW_LEDGER_PATH_INVALID')
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`)
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
}

function runOpenAiOnlyCli(options, adapters) {
  return runCli(options, {
    ...adapters,
    providerChain: openAiOnlyProviders,
  })
}

function validateReviewHandoff({ root, row, jobsById }) {
  const reviewId = safeReviewId(row?.reviewId)
  if (!SHA256_ID.test(reviewId)) throw codedError('PADDLE_REVIEW_ID_INVALID')
  if (row?.status !== 'pending_provider_review' || row?.studentStudyEligible !== false) {
    throw codedError('PADDLE_REVIEW_QUEUE_STATE_INVALID')
  }
  const job = jobsById.get(reviewId)
  if (!job) throw codedError('PADDLE_REVIEW_JOB_MISSING')
  if (safeText(row.paperId) !== safeText(job.paperId)) throw codedError('PADDLE_REVIEW_PAPER_ID_MISMATCH')
  if (safeText(row.artifactPath) !== safeText(job.stagingArtifactPath)) {
    throw codedError('PADDLE_REVIEW_ARTIFACT_PATH_MISMATCH')
  }
  const stagingPath = resolveInside(root, job.stagingArtifactPath)
  const staging = readJsonFile(stagingPath, 'PADDLE_REVIEW_ARTIFACT_UNREADABLE')
  if (staging?.schemaVersion !== 'stem-paddle-ocr-staging-artifact.v1'
    || staging?.artifactId !== job.jobId
    || staging?.paperId !== job.paperId
    || staging?.status !== 'ocr-complete-pending-review'
    || staging?.reviewStatus !== 'pending_ai_structure_review'
    || staging?.syllabusBinding?.status !== 'pending_official_review'
    || staging?.studentStudyEligible !== false
    || staging?.formalProgressEligible !== false) {
    throw codedError('PADDLE_REVIEW_ARTIFACT_BINDING_INVALID')
  }
  if (!sameSourceDocument(staging?.sourcePair?.questionPaper, job.documents?.qp)
    || !sameSourceDocument(staging?.sourcePair?.markScheme, job.documents?.ms)
    || canonicalJson(staging?.syllabusBinding?.routeBindings) !== canonicalJson(job.routeBindings)) {
    throw codedError('PADDLE_REVIEW_ARTIFACT_BINDING_INVALID')
  }
  const expectedId = artifactId({
    paperId: job.paperId,
    questionPdfSha256: job.documents.qp.sha256,
    markSchemePdfSha256: job.documents.ms.sha256,
  })
  if (job.jobId !== expectedId || job.jobKey !== expectedId.slice('sha256:'.length)) {
    throw codedError('PADDLE_REVIEW_JOB_ID_MISMATCH')
  }
  return job
}

function sameSourceDocument(left, right) {
  return Boolean(left && right
    && path.resolve(String(left.path || '')) === path.resolve(String(right.path || ''))
    && normalizedHash(left.sha256) === normalizedHash(right.sha256)
    && Number(left.pageCount) === Number(right.pageCount))
}

function manifestJobsById(manifest) {
  if (manifest?.schemaVersion !== 'stem-paddle-ocr-manifest.v1' || !Array.isArray(manifest.jobs)) {
    throw codedError('PADDLE_MANIFEST_INVALID')
  }
  const jobs = new Map()
  for (const job of manifest.jobs) {
    const jobId = safeText(job?.jobId)
    if (!SHA256_ID.test(jobId) || jobs.has(jobId)) throw codedError('PADDLE_MANIFEST_JOB_ID_INVALID')
    jobs.set(jobId, job)
  }
  return jobs
}

function readTerminalRouteArtifact({ outputRoot, job, route }) {
  const artifactPath = routeArtifactPath({ outputRoot, job, route })
  const stat = fs.statSync(artifactPath, { throwIfNoEntry: false })
  if (!stat) return null
  if (!stat.isFile() || stat.size < 2 || stat.size > 5 * 1024 * 1024) {
    throw codedError('PADDLE_TERMINAL_ARTIFACT_INVALID')
  }
  const artifact = readJsonFile(artifactPath, 'PADDLE_TERMINAL_ARTIFACT_INVALID')
  if (artifact?.schemaVersion !== 'ai-pdf-ingestion.v1'
    || artifact?.artifactId !== job.jobId
    || artifact?.paperId !== job.paperId
    || artifact?.subject !== job.subject
    || artifact?.stage !== route.stage
    || artifact?.syllabusRouteId !== route.routeId
    || artifact?.artifactSuffix !== route.artifactSuffix
    || !TERMINAL_ARTIFACT_STATUSES.has(artifact?.status)) {
    throw codedError('PADDLE_TERMINAL_ARTIFACT_INVALID')
  }
  if (artifact.status === 'ai-verified') {
    if (artifact.storageMode !== 'coordinate-only'
      || normalizedHash(artifact?.source?.questionPdfSha256) !== normalizedHash(job.documents.qp.sha256)
      || normalizedHash(artifact?.source?.markSchemePdfSha256) !== normalizedHash(job.documents.ms.sha256)
      || !hasValidAiStudentStudyRelease(artifact)) {
      throw codedError('PADDLE_STUDENT_RELEASE_INVALID')
    }
  }
  return artifact
}

function routeArtifactPath({ outputRoot, job, route }) {
  const target = path.resolve(outputRoot, job.paperId, `${job.jobKey}--${route.artifactSuffix}.json`)
  return resolveInside(outputRoot, target)
}

function routeLedgerRecord({ artifact, route, outputRoot, job }) {
  return {
    routeId: route.routeId,
    status: artifact.status,
    artifactPath: path.relative(outputRoot, routeArtifactPath({ outputRoot, job, route })).split(path.sep).join('/'),
    reasonCodes: Array.isArray(artifact.reasonCodes) ? artifact.reasonCodes.map(safeText).filter(Boolean).slice(0, 20) : [],
    extractor: safeProviderIdentity(artifact.extractor),
    verifier: safeProviderIdentity(artifact.verifier),
    providerTelemetry: safeProviderTelemetry(artifact.providerTelemetry),
    studentStudyEligible: artifact.status === 'ai-verified' && hasValidAiStudentStudyRelease(artifact),
    formalProgressEligible: false,
  }
}

function safeProviderIdentity(value) {
  return value && typeof value === 'object'
    ? { provider: safeText(value.provider), model: safeText(value.model), schemaName: safeText(value.schemaName) }
    : null
}

function safeProviderTelemetry(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map((entry) => ({
    schemaName: safeText(entry?.schemaName),
    status: safeText(entry?.status),
    provider: safeText(entry?.provider) || null,
    model: safeText(entry?.model) || null,
    errorCode: safeText(entry?.errorCode) || null,
    attempts: Array.isArray(entry?.attempts) ? entry.attempts.slice(0, 10).map((attempt) => ({
      provider: safeText(attempt?.provider),
      model: safeText(attempt?.model),
      timeoutMs: positiveIntegerOrNull(attempt?.timeoutMs),
      providerStatus: safeText(attempt?.providerStatus),
      schemaStatus: safeText(attempt?.schemaStatus),
      durationMs: nonnegativeIntegerOrNull(attempt?.durationMs),
    })) : [],
  }))
}

function readReviewLedger(filePath) {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })) {
    return { schemaVersion: REVIEW_LEDGER_SCHEMA_VERSION, updatedAt: null, entries: [] }
  }
  const ledger = readJsonFile(filePath, 'PADDLE_REVIEW_LEDGER_UNREADABLE')
  if (ledger?.schemaVersion !== REVIEW_LEDGER_SCHEMA_VERSION || !Array.isArray(ledger.entries)) {
    throw codedError('PADDLE_REVIEW_LEDGER_INVALID')
  }
  return ledger
}

function readExistingLock(lockPath) {
  const stat = fs.lstatSync(lockPath, { throwIfNoEntry: false })
  if (!stat) return null
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 4096) return null
  try {
    const value = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    return value?.schemaVersion === 'stem-paddle-ocr-review-consumer-lock.v1'
      && Number.isInteger(Number(value.pid))
      && safeText(value.nonce)
      ? { pid: Number(value.pid), nonce: safeText(value.nonce) }
      : null
  } catch {
    return null
  }
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

function readJsonLines(filePath) {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    throw codedError('PADDLE_REVIEW_QUEUE_UNREADABLE')
  }
  const rows = []
  const seen = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      throw codedError('PADDLE_REVIEW_QUEUE_INVALID')
    }
    const reviewId = safeText(row?.reviewId)
    if (seen.has(reviewId)) throw codedError('PADDLE_REVIEW_QUEUE_DUPLICATE')
    seen.add(reviewId)
    rows.push(row)
  }
  return rows
}

function readJsonFile(filePath, code) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value
  } catch {
    throw codedError(code)
  }
}

function requiredDirectory(value, name) {
  const directory = path.resolve(String(value || ''))
  if (!value) throw new TypeError(`${name} is required`)
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

function resolveInside(root, value) {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, String(value || ''))
  const relative = path.relative(resolvedRoot, target)
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw codedError('PADDLE_PATH_OUTSIDE_ROOT')
  }
  return target
}

function shouldSkipLedgerEntry(entry, { retryFailed, retryBlocked, retryQuarantined, retryCompleted }) {
  if (!TERMINAL_LEDGER_STATUSES.has(entry?.status)) return false
  if (entry.status === 'completed' && retryCompleted) return false
  if (entry.status === 'completed' && retryQuarantined
    && Array.isArray(entry.routes)
    && entry.routes.some((route) => route?.status === 'auto-quarantined')) return false
  if (entry.status === 'failed' && retryFailed) return false
  if (entry.status === 'blocked' && retryBlocked) return false
  return true
}

function normalizedLimit(value) {
  if (value === Number.POSITIVE_INFINITY || value === undefined || value === null) return Number.POSITIVE_INFINITY
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new RangeError('limit must be a positive integer')
  return parsed
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new RangeError(`${name} must be a positive integer`)
  return parsed
}

function normalizeOptionalReviewId(value) {
  if (value === null || value === undefined || value === '') return ''
  const reviewId = safeText(value)
  if (!SHA256_ID.test(reviewId)) throw new RangeError('reviewId must be a canonical SHA-256 id')
  return reviewId
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const fields = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return `{${fields.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function normalizedHash(value) {
  const match = /^(?:sha256:)?([a-f0-9]{64})$/i.exec(safeText(value))
  return match ? match[1].toLowerCase() : ''
}

function isoNow(now) {
  const value = now()
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new TypeError('now must return a valid Date')
  return value.toISOString()
}

function safeReviewId(value) {
  const reviewId = safeText(value)
  return reviewId || 'invalid-review-id'
}

function safeText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}

function safeErrorCode(error) {
  const code = safeText(error?.code)
  return /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code : 'REVIEW_CONSUMER_ERROR'
}

function positiveIntegerOrNull(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function nonnegativeIntegerOrNull(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

export function parseReviewQueueArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--retry-failed' || argument === '--retry-blocked' || argument === '--retry-quarantined' || argument === '--watch') {
      values[argument] = true
      continue
    }
    const next = argv[index + 1]
    if (!argument.startsWith('--') || !next || next.startsWith('--')) throw new RangeError(`invalid argument ${argument}`)
    values[argument] = next
    index += 1
  }
  return {
    workRoot: values['--work-root'],
    outputRoot: values['--output-root'] || path.join(process.cwd(), 'data', 'ai-pdf-ingestion'),
    ledgerPath: values['--ledger-path'] || null,
    reviewId: values['--review-id'] || null,
    limit: values['--limit'] ? Number(values['--limit']) : Number.POSITIVE_INFINITY,
    retryFailed: values['--retry-failed'] === true,
    retryBlocked: values['--retry-blocked'] === true,
    retryQuarantined: values['--retry-quarantined'] === true,
    watch: values['--watch'] === true,
    pollIntervalMs: values['--poll-interval-ms'] ? positiveInteger(values['--poll-interval-ms'], 'pollIntervalMs') : 15000,
    idleExitPolls: values['--idle-exit-polls'] ? positiveInteger(values['--idle-exit-polls'], 'idleExitPolls') : 120,
  }
}

async function main() {
  const options = parseReviewQueueArgs(process.argv.slice(2))
  const { watch, pollIntervalMs, idleExitPolls, ...consumeOptions } = options
  const lock = acquireReviewConsumerLock({ workRoot: consumeOptions.workRoot })
  try {
    const result = watch
      ? await watchPaddleReviewQueue({
        consumeOptions,
        pollIntervalMs,
        idleExitPolls,
        onPoll: (poll) => process.stdout.write(`${JSON.stringify({ status: 'poll', ...poll })}\n`),
      })
      : await consumePaddleReviewQueue(consumeOptions)
    process.stdout.write(`${JSON.stringify({ status: 'completed', ...result })}\n`)
    process.exitCode = !watch && (result.failed || result.blocked) ? 2 : 0
  } finally {
    lock.release()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: 'failed', errorCode: safeErrorCode(error) })}\n`)
    process.exitCode = 1
  })
}
