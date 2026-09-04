import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { renderPdfPages as defaultRenderPdf, runCli as defaultRunCli } from './ingest-ai-pdf-questions.mjs'

const PADDLE_ENGINE = 'PaddleOCR-VL-1.6'
const PADDLE_PROVIDER = 'PaddleOCR official API'
const DEFAULT_RENDER_DPI = 180
const SHA256 = /^[a-f0-9]{64}$/i
const SAFE_SUFFIX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,96}$/

// Keep this list aligned with the queue runner. A shared 9709 component is
// deliberately expanded into every registered route context so one route
// cannot overwrite another route's reviewed artifact.
const ROUTE_CANDIDATES = Object.freeze({
  '0580:1': [['IGCSE', 'cie-0580-igcse-mathematics', [1, 2, 3, 4]]],
  '0580:2': [['IGCSE', 'cie-0580-igcse-mathematics', [1, 2, 3, 4]]],
  '0580:3': [['IGCSE', 'cie-0580-igcse-mathematics', [1, 2, 3, 4]]],
  '0580:4': [['IGCSE', 'cie-0580-igcse-mathematics', [1, 2, 3, 4]]],
  '0625:2': [['IGCSE', 'cie-0625-igcse-physics', [2]]],
  '9702:1': [['AS', 'cie-9702-as-physics', [1, 2]]],
  '9702:2': [['AS', 'cie-9702-as-physics', [1, 2]]],
  '9702:4': [['A2', 'cie-9702-a2-physics', [4]]],
  '9709:1': [
    ['AS', 'cie-9709-as-p1-p2', [1, 2]],
    ['AS', 'cie-9709-as-p1-p4', [1, 4]],
    ['AS', 'cie-9709-as-p1-p5', [1, 5]],
  ],
  '9709:2': [['AS', 'cie-9709-as-p1-p2', [1, 2]]],
  '9709:3': [
    ['A2', 'cie-9709-a2-after-p1-p5-p3-p4', [3, 4]],
    ['A2', 'cie-9709-a2-after-p1-p5-p3-p6', [3, 6]],
    ['A2', 'cie-9709-a2-after-p1-p4-p3-p5', [3, 5]],
  ],
  '9709:4': [
    ['AS', 'cie-9709-as-p1-p4', [1, 4]],
    ['A2', 'cie-9709-a2-after-p1-p5-p3-p4', [3, 4]],
  ],
  '9709:5': [
    ['AS', 'cie-9709-as-p1-p5', [1, 5]],
    ['A2', 'cie-9709-a2-after-p1-p4-p3-p5', [3, 5]],
  ],
  '9709:6': [['A2', 'cie-9709-a2-after-p1-p5-p3-p6', [3, 6]]],
})

export function routePlansForJob(job) {
  const subject = String(job?.subject || '').trim()
  const component = Number(job?.component)
  const candidates = ROUTE_CANDIDATES[`${subject}:${component}`]
  if (!candidates) throw paddleError('PADDLE_ROUTE_UNSUPPORTED', `unsupported route ${subject}:${component}`)

  const bindings = Array.isArray(job?.routeBindings) ? job.routeBindings : []
  const declared = bindings
    .map((binding) => String(binding?.routeCandidateId || binding?.routeHint || '').trim())
    .filter(Boolean)
  const expected = candidates.map(([, routeId]) => routeId)
  if (bindings.length && (declared.length !== bindings.length
    || new Set(declared).size !== declared.length
    || declared.length !== expected.length
    || declared.some((routeId) => !expected.includes(routeId)))) {
    throw paddleError('PADDLE_ROUTE_BINDING_MISMATCH', `queue route bindings do not match ${subject}:${component}`)
  }

  return Object.freeze(candidates.map(([stage, routeId, components]) => Object.freeze({
    routeId,
    stage,
    subject,
    component,
    components: Object.freeze([...components]),
    artifactSuffix: artifactSuffixForRoute(routeId),
  })))
}

export function artifactSuffixForRoute(routeId) {
  const value = String(routeId || '').trim()
  if (!SAFE_SUFFIX.test(value)) throw paddleError('PADDLE_ARTIFACT_SUFFIX_INVALID', 'route id is not a safe artifact suffix')
  return `route-${value}`
}

export function loadCompletedPaddleJob({ workRoot, job } = {}) {
  const root = resolveDirectory(workRoot, 'workRoot')
  assertJobShape(job)
  const state = stateForJob(root, job)
  if (state.jobId !== job.jobId) throw paddleError('PADDLE_STATE_JOB_ID_MISMATCH', 'OCR state jobId does not match the queue job')
  if (state.paperId && state.paperId !== job.paperId) throw paddleError('PADDLE_STATE_PAPER_ID_MISMATCH', 'OCR state paperId does not match the queue job')
  if (state.status !== 'completed') throw paddleError('PADDLE_JOB_INCOMPLETE', 'both OCR documents must be completed')

  const documents = {}
  for (const kind of ['qp', 'ms']) {
    const sourceDocument = job.documents[kind]
    validateSourceDocument(sourceDocument, kind)
    const documentState = state.documents?.[kind]
    if (!documentState || documentState.status !== 'completed') {
      throw paddleError('PADDLE_DOCUMENT_INCOMPLETE', `${kind} OCR document is not completed`)
    }
    if (Number(documentState.pageCount) !== Number(sourceDocument.pageCount)) {
      throw paddleError('PADDLE_PAGE_COUNT_MISMATCH', `${kind} OCR page count does not match the source PDF`)
    }
    const pages = normalizePageRecords(root, documentState.pages, Number(sourceDocument.pageCount), kind)
    documents[kind] = Object.freeze({
      source: Object.freeze({ ...sourceDocument, path: path.resolve(String(sourceDocument.path)) }),
      pages: Object.freeze(pages),
    })
  }

  return Object.freeze({
    job,
    state,
    workRoot: root,
    documents: Object.freeze(documents),
    ocrMetadata: Object.freeze({
      engine: PADDLE_ENGINE,
      provider: PADDLE_PROVIDER,
      model: PADDLE_ENGINE,
      executionMode: 'remote_api',
      statePath: safeRelative(root, statePathForJob(root, job)),
    }),
  })
}

export function createPaddleAdapters({ workRoot, job, completed, renderPdfImpl = defaultRenderPdf } = {}) {
  const loaded = completed || loadCompletedPaddleJob({ workRoot, job })
  const root = resolveDirectory(workRoot || loaded.workRoot, 'workRoot')
  const resolvedJob = loaded.job || job
  if (!resolvedJob) throw paddleError('PADDLE_JOB_INVALID', 'job is required')
  if (typeof renderPdfImpl !== 'function') throw new TypeError('renderPdfImpl must be a function')
  const documentKinds = new Map([
    [path.resolve(String(resolvedJob.documents.qp.path)), 'qp'],
    [path.resolve(String(resolvedJob.documents.ms.path)), 'ms'],
  ])
  const canonicalRenders = new Map()

  const findDocument = (pdfPath) => {
    const resolved = path.resolve(String(pdfPath || ''))
    const kind = documentKinds.get(resolved)
    if (!kind) throw paddleError('PADDLE_SOURCE_DOCUMENT_UNKNOWN', `source document is not part of the completed job: ${resolved}`)
    return { kind, document: loaded.documents[kind] }
  }

  const renderPdf = async (pdfPath, outputDirectory, dpi = DEFAULT_RENDER_DPI, env = process.env) => {
    const { kind, document } = findDocument(pdfPath)
    if (!Number.isInteger(Number(dpi)) || Number(dpi) < 1 || Number(dpi) > 300) {
      throw paddleError('PADDLE_RENDER_DPI_INVALID', 'render DPI is outside the supported range')
    }
    const directory = path.resolve(String(outputDirectory || ''))
    if (!directory) throw paddleError('PADDLE_RENDER_DIRECTORY_INVALID', 'render directory is required')
    fs.mkdirSync(directory, { recursive: true })
    const rendered = await renderPdfImpl(document.source.path, directory, Number(dpi), env)
    const { pageImageHashes, pageSizes } = canonicalRenderResult(rendered, document, kind)
    canonicalRenders.set(kind, Object.freeze({ pageImageHashes, pageSizes }))
    return {
      pageImageHashes,
      pageSizes,
      ocr: loaded.ocrMetadata,
    }
  }

  const extractPdfText = async (pdfPath, pageImageHashes) => {
    const { kind, document } = findDocument(pdfPath)
    const canonical = canonicalRenders.get(kind)
    if (!canonical) throw paddleError('PADDLE_CANONICAL_RENDER_REQUIRED', `${kind} must be rendered before OCR text is read`)
    const pages = {}
    const requestedPages = Object.keys(pageImageHashes || {}).map(Number).sort((left, right) => left - right)
    if (requestedPages.length !== Object.keys(document.pages).length) {
      throw paddleError('PADDLE_PAGE_HASH_SET_MISMATCH', `${kind} text request does not cover every page`)
    }
    for (const page of requestedPages) {
      const record = document.pages[String(page)]
      if (!record || normalizedHash(pageImageHashes[page]) !== canonical.pageImageHashes[String(page)]) {
        throw paddleError('PADDLE_PAGE_HASH_SET_MISMATCH', `${kind} page ${page} hash is not bound to the canonical render`)
      }
      const sourcePath = checkedWorkFile(root, record.sourcePage?.path, 'PADDLE_SOURCE_PAGE_PATH_INVALID')
      assertFileHash(sourcePath, record.sourcePage?.sha256, 'PADDLE_SOURCE_PAGE_HASH_MISMATCH')
      const markdownPath = checkedWorkFile(root, record.markdownPath, 'PADDLE_MARKDOWN_PATH_INVALID')
      const layoutPath = checkedWorkFile(root, record.layoutBlocksPath, 'PADDLE_LAYOUT_BLOCKS_PATH_INVALID')
      assertFileHash(markdownPath, record.markdownSha256, 'PADDLE_MARKDOWN_HASH_MISMATCH')
      assertFileHash(layoutPath, record.layoutBlocksSha256, 'PADDLE_LAYOUT_BLOCKS_HASH_MISMATCH')
      let layout
      try {
        layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'))
      } catch {
        throw paddleError('PADDLE_LAYOUT_BLOCKS_INVALID', `${kind} page ${page} layout blocks are not valid JSON`)
      }
      const markdown = fs.readFileSync(markdownPath, 'utf8').trim()
      pages[page] = `${markdown}\n\n[layout-blocks]\n${JSON.stringify(layout)}`.trim()
    }
    return pages
  }

  const transformStructuredResult = ({ schemaName, value } = {}) => {
    if (!['ai_pdf_question_extraction_v1', 'ai_pdf_question_verification_v1'].includes(schemaName)) return value
    if (!canonicalRenders.has('qp') || !canonicalRenders.has('ms')) {
      throw paddleError('PADDLE_CANONICAL_RENDER_REQUIRED', 'both source documents must be rendered before structured review')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw paddleError('PADDLE_REVIEW_RESULT_INVALID', 'structured review result is invalid')
    const rebound = structuredClone(value)
    for (const question of Array.isArray(rebound.questions) ? rebound.questions : []) {
      rebindPageEvidence(question?.regions, loaded.documents.qp, canonicalRenders.get('qp'), 'PADDLE_QP_REVIEW_HASH_MISMATCH')
      rebindPageEvidence(question?.diagramRegions, loaded.documents.qp, canonicalRenders.get('qp'), 'PADDLE_QP_REVIEW_HASH_MISMATCH')
      rebindPageEvidence(question?.markSchemeEvidence, loaded.documents.ms, canonicalRenders.get('ms'), 'PADDLE_MS_REVIEW_HASH_MISMATCH')
    }
    return rebound
  }

  return Object.freeze({
    renderPdf,
    extractPdfText,
    transformStructuredResult,
    ocrMetadata: loaded.ocrMetadata,
  })
}

export async function ingestPaddleJob({
  workRoot,
  job,
  outputRoot,
  env = process.env,
  runCliImpl = defaultRunCli,
  renderPdfImpl = defaultRenderPdf,
  completed = null,
  retry = false,
} = {}) {
  if (typeof runCliImpl !== 'function') throw new TypeError('runCliImpl must be a function')
  const loaded = completed || loadCompletedPaddleJob({ workRoot, job })
  const adapters = createPaddleAdapters({ workRoot: loaded.workRoot, job: loaded.job, completed: loaded, renderPdfImpl })
  const routes = routePlansForJob(loaded.job)
  const resolvedOutputRoot = path.resolve(String(outputRoot || ''))
  if (!resolvedOutputRoot) throw paddleError('PADDLE_OUTPUT_ROOT_INVALID', 'outputRoot is required')
  const results = []

  for (const route of routes) {
    const options = buildRouteOptions({
      job: loaded.job,
      route,
      outputRoot: resolvedOutputRoot,
      env,
      ocrMetadata: adapters.ocrMetadata,
      retry,
    })
    const result = await runCliImpl(options, {
      renderPdf: adapters.renderPdf,
      extractPdfText: adapters.extractPdfText,
      transformStructuredResult: adapters.transformStructuredResult,
    })
    results.push({
      ...(result && typeof result === 'object' ? result : { result }),
      routeId: route.routeId,
      artifactSuffix: route.artifactSuffix,
    })
  }
  return results
}

function canonicalRenderResult(value, document, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw paddleError('PADDLE_CANONICAL_RENDER_INVALID', `${kind} canonical render is invalid`)
  const pageImageHashes = {}
  const pageSizes = {}
  const expectedPages = Object.keys(document.pages).map(Number).sort((left, right) => left - right)
  const actualPages = Object.keys(value.pageImageHashes || {}).map(Number).sort((left, right) => left - right)
  if (JSON.stringify(actualPages) !== JSON.stringify(expectedPages)) {
    throw paddleError('PADDLE_CANONICAL_PAGE_COUNT_MISMATCH', `${kind} canonical render page set is incomplete`)
  }
  for (const page of expectedPages) {
    const hash = normalizedHash(value.pageImageHashes?.[page])
    const width = Number(value.pageSizes?.[page]?.width)
    const height = Number(value.pageSizes?.[page]?.height)
    const sourceWidth = Number(document.pages[String(page)]?.sourcePage?.width)
    const sourceHeight = Number(document.pages[String(page)]?.sourcePage?.height)
    if (!hash) throw paddleError('PADDLE_CANONICAL_PAGE_HASH_INVALID', `${kind} canonical page ${page} hash is invalid`)
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw paddleError('PADDLE_CANONICAL_PAGE_SIZE_INVALID', `${kind} canonical page ${page} size is invalid`)
    }
    if (width !== sourceWidth || height !== sourceHeight) {
      throw paddleError('PADDLE_CANONICAL_PAGE_SIZE_MISMATCH', `${kind} canonical page ${page} does not match the OCR coordinate space`)
    }
    pageImageHashes[String(page)] = hash
    pageSizes[String(page)] = Object.freeze({ width, height })
  }
  return Object.freeze({ pageImageHashes: Object.freeze(pageImageHashes), pageSizes: Object.freeze(pageSizes) })
}

function rebindPageEvidence(entries, document, canonical, code) {
  if (!Array.isArray(entries)) return
  for (const entry of entries) {
    const page = Number(entry?.page)
    const record = Number.isInteger(page) ? document.pages[String(page)] : null
    const canonicalHash = Number.isInteger(page) ? canonical.pageImageHashes[String(page)] : ''
    const suppliedHash = normalizedHash(entry?.pageImageSha256)
    const stagingHash = normalizedHash(record?.sourcePage?.sha256)
    if (!record || !canonicalHash || !suppliedHash || (suppliedHash !== stagingHash && suppliedHash !== canonicalHash)) {
      throw paddleError(code, `review page ${String(entry?.page)} is not bound to the staged or canonical source image`)
    }
    entry.pageImageSha256 = canonicalHash
  }
}

function buildRouteOptions({ job, route, outputRoot, env, ocrMetadata, retry }) {
  const model = safeModel(env?.AI_PDF_INGESTION_MODEL) || 'gpt-5.6'
  return {
    paperId: String(job.paperId),
    questionPdf: path.resolve(String(job.documents.qp.path)),
    markSchemePdf: path.resolve(String(job.documents.ms.path)),
    subject: String(job.subject),
    stage: route.stage,
    routeId: route.routeId,
    paperComponent: Number(job.component),
    outputRoot,
    model,
    baseUrl: safeModel(env?.OPENAI_BASE_URL),
    dryRun: false,
    retry: retry === true,
    coordinateOnly: true,
    pageWindowed: true,
    renderDpi: positiveInteger(job.renderDpi, DEFAULT_RENDER_DPI),
    maxAttempts: positiveInteger(job.maxAttempts, 2),
    timeoutMs: positiveInteger(job.timeoutMs, 120000),
    paperTimeoutMs: positiveInteger(job.paperTimeoutMs, 900000),
    pageWindowOwnedPages: positiveInteger(job.pageWindowOwnedPages, 4),
    pageWindowTrailingPages: positiveInteger(job.pageWindowTrailingPages, 1),
    artifactSuffix: route.artifactSuffix,
    ocrMetadata,
  }
}

function stateForJob(root, job) {
  if (job.state && typeof job.state === 'object' && !Array.isArray(job.state)) return job.state
  const statePath = statePathForJob(root, job)
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('not an object')
    return state
  } catch (error) {
    throw paddleError('PADDLE_STATE_UNREADABLE', `cannot read OCR state ${statePath}: ${error.message}`)
  }
}

function statePathForJob(root, job) {
  if (typeof job?.statePath === 'string' && job.statePath.trim()) {
    return checkedWorkFile(root, job.statePath, 'PADDLE_STATE_PATH_INVALID', { allowMissing: true })
  }
  if (typeof job?.jobKey === 'string' && SAFE_SUFFIX.test(job.jobKey)) return path.join(root, 'state', 'jobs', `${job.jobKey}.json`)
  throw paddleError('PADDLE_STATE_PATH_INVALID', 'job state path is missing')
}

function validateSourceDocument(document, kind) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw paddleError('PADDLE_SOURCE_DOCUMENT_INVALID', `${kind} source document is invalid`)
  if (!Number.isInteger(Number(document.pageCount)) || Number(document.pageCount) < 1) throw paddleError('PADDLE_PAGE_COUNT_INVALID', `${kind} source page count is invalid`)
  const sourcePath = path.resolve(String(document.path || ''))
  if (!fs.statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) throw paddleError('PADDLE_SOURCE_DOCUMENT_MISSING', `${kind} source PDF is missing`)
  assertFileHash(sourcePath, document.sha256, kind === 'qp' ? 'PADDLE_QP_HASH_MISMATCH' : 'PADDLE_MS_HASH_MISMATCH')
}

function normalizePageRecords(root, value, pageCount, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw paddleError('PADDLE_PAGE_RECORDS_INVALID', `${kind} page records are invalid`)
  const pages = {}
  for (let page = 1; page <= pageCount; page += 1) {
    const record = value[String(page)] ?? value[page]
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.status !== 'completed') {
      throw paddleError('PADDLE_PAGE_RECORD_INCOMPLETE', `${kind} page ${page} is not completed`)
    }
    validatePageRecord(root, record, kind, page)
    pages[String(page)] = Object.freeze({ ...record })
  }
  const extra = Object.keys(value).some((key) => !/^\d+$/.test(key) || Number(key) < 1 || Number(key) > pageCount)
  if (extra) throw paddleError('PADDLE_PAGE_RECORDS_INVALID', `${kind} page records contain an out-of-range page`)
  return pages
}

function validatePageRecord(root, record, kind, page) {
  const sourcePath = checkedWorkFile(root, record.sourcePage?.path, 'PADDLE_SOURCE_PAGE_PATH_INVALID')
  assertFileHash(sourcePath, record.sourcePage?.sha256, 'PADDLE_SOURCE_PAGE_HASH_MISMATCH')
  for (const [pathKey, hashKey, code] of [
    ['rawResultPath', 'rawResultSha256', 'PADDLE_RAW_RESULT_HASH_MISMATCH'],
    ['markdownPath', 'markdownSha256', 'PADDLE_MARKDOWN_HASH_MISMATCH'],
    ['layoutBlocksPath', 'layoutBlocksSha256', 'PADDLE_LAYOUT_BLOCKS_HASH_MISMATCH'],
  ]) {
    const filePath = checkedWorkFile(root, record[pathKey], `${code}_PATH`)
    assertFileHash(filePath, record[hashKey], code)
  }
  if (record.sourcePage?.page !== undefined && Number(record.sourcePage.page) !== page) {
    throw paddleError('PADDLE_SOURCE_PAGE_NUMBER_MISMATCH', `${kind} source page number is inconsistent`)
  }
}

function checkedWorkFile(root, value, code, { allowMissing = false } = {}) {
  const candidate = path.resolve(root, String(value || ''))
  const relative = path.relative(root, candidate)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw paddleError(code, 'persisted OCR path escapes the work root')
  }
  if (allowMissing) return candidate
  if (!fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) throw paddleError(code, `persisted OCR file is missing: ${relative}`)
  return candidate
}

function assertFileHash(filePath, expected, code) {
  const normalized = normalizedHash(expected)
  if (!normalized) throw paddleError(code, `invalid expected SHA-256 for ${filePath}`)
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  if (actual !== normalized) throw paddleError(code, `SHA-256 mismatch for ${filePath}`)
  return actual
}

function normalizedHash(value) {
  const normalized = String(value || '').replace(/^sha256:/i, '').trim().toLowerCase()
  return SHA256.test(normalized) ? normalized : ''
}

function resolveDirectory(value, name) {
  const directory = path.resolve(String(value || ''))
  if (!directory) throw new TypeError(`${name} is required`)
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) fs.mkdirSync(directory, { recursive: true })
  return directory
}

function safeRelative(root, value) {
  const relative = path.relative(root, value)
  return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    ? relative.split(path.sep).join('/')
    : null
}

function assertJobShape(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw paddleError('PADDLE_JOB_INVALID', 'job must be an object')
  if (!String(job.jobId || '').startsWith('sha256:') || !String(job.paperId || '').trim()) throw paddleError('PADDLE_JOB_INVALID', 'job identity is invalid')
  if (!job.documents?.qp || !job.documents?.ms) throw paddleError('PADDLE_JOB_INVALID', 'job must contain QP and MS documents')
}

function safeModel(value) {
  const model = typeof value === 'string' ? value.trim() : ''
  return model && model.length <= 160 ? model : null
}

function positiveInteger(value, fallback) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function paddleError(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}
