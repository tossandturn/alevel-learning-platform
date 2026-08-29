import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runCli } from './ingest-ai-pdf-questions.mjs'
import { ingestPaddleJob } from './ingest-paddle-ocr-queue.mjs'
import {
  acquireReviewConsumerLock,
  consumePaddleReviewQueue,
} from './review-paddle-ocr-queue.mjs'

const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$/
const DRAFT_SCHEMAS = Object.freeze({
  ai_pdf_question_extraction_v1: Object.freeze({
    file: 'extraction.json',
    provider: 'codex-independent-extraction',
  }),
  ai_pdf_question_verification_v1: Object.freeze({
    file: 'verification.json',
    provider: 'codex-independent-verification',
  }),
})

export function createCodexDraftRunCli({
  draftRoot,
  job,
  model = 'gpt-5.6',
  runCliImpl = runCli,
  now = () => Date.now(),
} = {}) {
  const root = requiredDirectory(draftRoot, 'draftRoot')
  const jobKey = safeComponent(job?.jobKey, 'CODEX_DRAFT_JOB_KEY_INVALID')
  const selectedModel = safeText(model)
  if (!selectedModel) throw codedError('CODEX_DRAFT_MODEL_INVALID')
  if (typeof runCliImpl !== 'function') throw new TypeError('runCliImpl must be a function')

  return async function runCodexDraftCli(options, adapters) {
    const routeId = safeComponent(options?.routeId, 'CODEX_DRAFT_ROUTE_INVALID')
    const routeDirectory = resolveInside(root, path.join(root, jobKey, routeId))
    const providerChain = () => [{ name: 'codex-draft', model: selectedModel }]
    const callWithFallback = async ({ request } = {}) => {
      const draftConfig = DRAFT_SCHEMAS[request?.schemaName]
      if (!draftConfig) throw codedError('CODEX_DRAFT_SCHEMA_UNSUPPORTED')
      const startedAt = now()
      const draftPath = resolveInside(routeDirectory, path.join(routeDirectory, draftConfig.file))
      const { value, sha256 } = readDraft(draftPath)
      const durationMs = Math.max(0, Number(now()) - Number(startedAt))
      const provider = { name: draftConfig.provider, model: selectedModel }
      return Object.freeze({
        provider: Object.freeze(provider),
        value,
        telemetry: Object.freeze({
          attempts: Object.freeze([Object.freeze({
            provider: provider.name,
            model: provider.model,
            timeoutMs: null,
            providerStatus: 'success',
            schemaStatus: 'parsed',
            durationMs: Number.isFinite(durationMs) ? durationMs : 0,
            reviewMode: 'independent-codex-draft',
            draftSha256: sha256,
          })]),
        }),
      })
    }
    return runCliImpl({
      ...options,
      model: selectedModel,
      pageWindowed: false,
      retry: true,
      forceReprocess: true,
    }, {
      ...(adapters || {}),
      providerChain,
      callWithFallback,
    })
  }
}

export function importCodexPaddleReview({
  workRoot,
  outputRoot,
  draftRoot = null,
  ledgerPath = null,
  reviewId,
  model = 'gpt-5.6',
  consumeImpl = consumePaddleReviewQueue,
  ingestPaddleJobImpl = ingestPaddleJob,
} = {}) {
  const root = requiredDirectory(workRoot, 'workRoot')
  const resolvedDraftRoot = resolveInside(root, draftRoot || path.join(root, 'review-drafts'))
  const selectedReviewId = safeText(reviewId)
  if (!/^sha256:[a-f0-9]{64}$/.test(selectedReviewId)) throw codedError('CODEX_DRAFT_REVIEW_ID_INVALID')
  return consumeImpl({
    workRoot: root,
    outputRoot,
    ledgerPath,
    reviewId: selectedReviewId,
    retryQuarantined: true,
    retryCompleted: true,
    ingestJobImpl: async (options) => ingestPaddleJobImpl({
      ...options,
      retry: true,
      runCliImpl: createCodexDraftRunCli({
        draftRoot: resolvedDraftRoot,
        job: options.job,
        model,
      }),
    }),
  })
}

function readDraft(filePath) {
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 5 * 1024 * 1024) {
    throw codedError('CODEX_DRAFT_FILE_INVALID')
  }
  const bytes = fs.readFileSync(filePath)
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw codedError('CODEX_DRAFT_JSON_INVALID')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError('CODEX_DRAFT_JSON_INVALID')
  return {
    value,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }
}

function requiredDirectory(value, name) {
  if (!value) throw new TypeError(`${name} is required`)
  const directory = path.resolve(String(value))
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

function resolveInside(root, value) {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(String(value || ''))
  const relative = path.relative(resolvedRoot, target)
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw codedError('CODEX_DRAFT_PATH_OUTSIDE_ROOT')
  }
  return target
}

function safeComponent(value, code) {
  const component = safeText(value)
  if (!SAFE_COMPONENT.test(component)) throw codedError(code)
  return component
}

function safeText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}

function safeErrorCode(error) {
  const code = safeText(error?.code)
  return /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code : 'CODEX_DRAFT_IMPORT_ERROR'
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = argv[index + 1]
    if (!argument.startsWith('--') || !next || next.startsWith('--')) throw new RangeError(`invalid argument ${argument}`)
    values[argument] = next
    index += 1
  }
  return {
    workRoot: values['--work-root'],
    outputRoot: values['--output-root'] || path.join(process.cwd(), 'data', 'ai-pdf-ingestion'),
    draftRoot: values['--draft-root'] || null,
    ledgerPath: values['--ledger-path'] || null,
    reviewId: values['--review-id'],
    model: values['--model'] || 'gpt-5.6',
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const lock = acquireReviewConsumerLock({ workRoot: options.workRoot })
  try {
    const result = await importCodexPaddleReview(options)
    process.stdout.write(`${JSON.stringify({ status: 'completed', ...result })}\n`)
    process.exitCode = result.failed || result.blocked || result.releasedRoutes < 1 ? 2 : 0
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
