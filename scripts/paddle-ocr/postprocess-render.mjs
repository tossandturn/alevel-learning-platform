import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCropCommand, buildCropManifest } from '../ai-pdf-ingestion/render.mjs'
import { normalizeRegion } from '../ai-pdf-ingestion/contract.mjs'

const AI_PDF_SCHEMA = 'ai-pdf-ingestion.v1'
const PADDLE_STAGING_SCHEMA = 'stem-paddle-ocr-staging-artifact.v1'
const SAFE_PAPER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const SHA256 = /^(?:sha256:)?([a-fA-F0-9]{64})$/
const MAX_JSON_BYTES = 20 * 1024 * 1024
const MAX_PROCESS_OUTPUT_BYTES = 128 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 300_000
const PAGE_ASPECT_TOLERANCE = 0.005
const PDF_SIZE_TOLERANCE = 0.1
const PDF_INSPECTION_PROGRAM = [
  'import json, sys',
  'from pypdf import PdfReader',
  'reader = PdfReader(sys.argv[1])',
  'pages = []',
  'for page in reader.pages:',
  '    width = float(page.mediabox.width)',
  '    height = float(page.mediabox.height)',
  '    rotation = int(page.get("/Rotate", 0) or 0) % 360',
  '    if rotation in (90, 270): width, height = height, width',
  '    pages.append({"width": width, "height": height})',
  'print(json.dumps({"pages": pages}, separators=(",", ":")))',
].join('\n')

export const POSTPROCESS_SUMMARY_KEYS = Object.freeze([
  'artifacts',
  'questions',
  'questionRegions',
  'diagramRegions',
  'uniqueCrops',
  'outputsChecked',
  'outputsValid',
  'rendered',
])

export function buildPostprocessPlan({
  artifact,
  reviewDraft = null,
  artifactPath,
  reviewDraftPath = null,
  outputRoot,
} = {}) {
  const resolvedArtifactPath = absolutePath(artifactPath, 'POSTPROCESS_ARTIFACT_PATH_INVALID')
  const resolvedOutputRoot = absolutePath(outputRoot, 'POSTPROCESS_OUTPUT_ROOT_INVALID')
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw codedError('POSTPROCESS_ARTIFACT_FILE_INVALID')
  }

  const paperId = safeSegment(artifact.paperId)
  if (!paperId) throw codedError('POSTPROCESS_PATH_ESCAPE')

  let source
  let extraction
  let expectedAssets
  if (artifact.schemaVersion === AI_PDF_SCHEMA) {
    if (artifact.storageMode !== 'coordinate-only' || artifact.status !== 'ai-verified') {
      throw codedError('POSTPROCESS_ARTIFACT_NOT_REVIEWED')
    }
    source = sourceFromCoordinateArtifact(artifact.source)
    extraction = artifact.candidate
    expectedAssets = artifact.assets
  } else if (artifact.schemaVersion === PADDLE_STAGING_SCHEMA) {
    if (artifact.status !== 'ocr-complete-pending-review') {
      throw codedError('POSTPROCESS_ARTIFACT_NOT_REVIEWED')
    }
    if (!reviewDraft || typeof reviewDraft !== 'object' || Array.isArray(reviewDraft)) {
      throw codedError('POSTPROCESS_REVIEW_DRAFT_REQUIRED')
    }
    if (!reviewDraftPath) throw codedError('POSTPROCESS_REVIEW_DRAFT_REQUIRED')
    absolutePath(reviewDraftPath, 'POSTPROCESS_REVIEW_DRAFT_PATH_INVALID')
    source = sourceFromPaddleArtifact(artifact)
    extraction = reviewDraft
    expectedAssets = []
  } else {
    throw codedError('POSTPROCESS_SCHEMA_UNSUPPORTED')
  }

  validateExtractionSource(extraction, source)
  if (!Array.isArray(extraction?.questions) || extraction.questions.length === 0) {
    throw codedError('POSTPROCESS_QUESTIONS_INVALID')
  }
  const expectedByQuestion = expectedAssetMap(expectedAssets, resolvedOutputRoot)
  const seenQuestions = new Set()
  const questions = extraction.questions.map((question) => {
    const number = typeof question?.questionNumber === 'string' ? question.questionNumber.trim() : ''
    if (!/^\d{1,4}$/.test(number) || seenQuestions.has(number)) {
      throw codedError('POSTPROCESS_QUESTION_INVALID')
    }
    seenQuestions.add(number)
    if (!Number.isInteger(question.questionStartPage) || question.questionStartPage < 1) {
      throw codedError('POSTPROCESS_QUESTION_INVALID')
    }
    const questionRegions = validateRegions(question.regions, source.qp, 'QP', { required: true })
    const diagramRegions = validateRegions(question.diagramRegions, source.qp, 'QP')
    const renderRegions = nonOverlappingRenderRegions(questionRegions, diagramRegions)
    validateMarkSchemeEvidence(question.markSchemeEvidence, source.ms)
    const questionId = `${paperId}:q${number}`
    let manifest
    try {
      manifest = buildCropManifest({
        paperId,
        questionId,
        sourcePdfPath: source.qp.path,
        sourcePdfSha256: source.qp.sha256,
        regions: renderRegions,
        pageSizes: source.qp.pageSizes,
        outputRoot: resolvedOutputRoot,
      })
    } catch {
      throw codedError('POSTPROCESS_REGION_INVALID')
    }
    assertWithinRoot(resolvedOutputRoot, manifest.questionPdfPath)
    const expected = expectedByQuestion.get(number) || null
    if (expected?.path && path.resolve(expected.path) !== path.resolve(manifest.questionPdfPath)) {
      throw codedError('POSTPROCESS_PATH_ESCAPE')
    }
    return Object.freeze({
      questionNumber: number,
      questionRegions: Object.freeze(questionRegions),
      diagramRegions: Object.freeze(diagramRegions),
      renderRegions: Object.freeze(renderRegions),
      manifest: Object.freeze(manifest),
      expectedOutputSha256: expected?.sha256 || '',
    })
  })

  if ([...expectedByQuestion.keys()].some(number => !seenQuestions.has(number))) {
    throw codedError('POSTPROCESS_OUTPUT_BINDING_INVALID')
  }
  return Object.freeze({
    artifactPath: resolvedArtifactPath,
    reviewDraftPath: reviewDraftPath ? path.resolve(reviewDraftPath) : null,
    outputRoot: resolvedOutputRoot,
    paperId,
    source: Object.freeze(source),
    questions: Object.freeze(questions),
  })
}

export async function postprocessRender({
  artifactPath,
  reviewDraftPath = null,
  outputRoot,
  render = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  adapters = {},
} = {}) {
  const counts = emptyCounts()
  try {
    const timeout = validTimeout(timeoutMs)
    const artifact = readJsonFile(artifactPath, 'POSTPROCESS_ARTIFACT_FILE_INVALID')
    const reviewDraft = reviewDraftPath
      ? readJsonFile(reviewDraftPath, 'POSTPROCESS_REVIEW_DRAFT_INVALID')
      : null
    const plan = buildPostprocessPlan({ artifact, reviewDraft, artifactPath, reviewDraftPath, outputRoot })
    applyPlanCounts(counts, plan)
    assertSafeOutputRoot(plan.outputRoot)
    const runtime = runtimeAdapters(adapters)
    const inspectedSources = await validateSourceDocuments(plan.source, { timeoutMs: timeout, runtime })
    if (render === true) {
      await renderQuestions(plan, inspectedSources, counts, { timeoutMs: timeout, runtime })
    } else {
      await auditQuestionOutputs(plan, inspectedSources, counts, { timeoutMs: timeout, runtime })
    }
    return summary(counts, [])
  } catch (error) {
    return summary(counts, [safeErrorCode(error)])
  }
}

export function runProcessWithTimeout(command, args, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES,
} = {}) {
  const timeout = validTimeout(timeoutMs)
  if (typeof command !== 'string' || !command.trim() || !Array.isArray(args)
    || args.some(argument => typeof argument !== 'string')) {
    return Promise.reject(codedError('POSTPROCESS_PROCESS_INVALID'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let outputBytes = 0
    const stdout = []
    const stderr = []
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const capture = (target) => (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > maxOutputBytes) {
        child.kill('SIGKILL')
        finish(codedError('POSTPROCESS_PROCESS_OUTPUT_LIMIT'))
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', capture(stdout))
    child.stderr.on('data', capture(stderr))
    child.once('error', () => finish(codedError('POSTPROCESS_PROCESS_FAILED')))
    child.once('exit', (code) => {
      if (code !== 0) {
        finish(codedError('POSTPROCESS_PROCESS_FAILED'))
        return
      }
      finish(null, {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(codedError('POSTPROCESS_TIMEOUT'))
    }, timeout)
    timer.unref?.()
  })
}

function sourceFromCoordinateArtifact(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('POSTPROCESS_SOURCE_METADATA_INVALID')
  }
  return {
    qp: documentMetadata({
      pathValue: value.questionPdfPath,
      hashValue: value.questionPdfSha256,
      pageHashes: value.pageImageHashes,
      pageSizes: value.pageSizes,
      kind: 'QP',
    }),
    ms: documentMetadata({
      pathValue: value.markSchemePdfPath,
      hashValue: value.markSchemePdfSha256,
      pageHashes: value.markSchemePageHashes,
      pageSizes: value.markSchemePageSizes,
      kind: 'MS',
    }),
  }
}

function sourceFromPaddleArtifact(artifact) {
  const sourcePair = artifact.sourcePair
  const documents = artifact.ocr?.documents
  return {
    qp: paddleDocumentMetadata(sourcePair?.questionPaper, documents?.qp, 'QP'),
    ms: paddleDocumentMetadata(sourcePair?.markScheme, documents?.ms, 'MS'),
  }
}

function paddleDocumentMetadata(source, document, kind) {
  if (!source || !document || !Number.isInteger(Number(source.pageCount)) || Number(source.pageCount) < 1) {
    throw codedError(`POSTPROCESS_${kind}_PAGE_COUNT_INVALID`)
  }
  if (document.status !== 'completed'
    || Number(document.pageCount) !== Number(source.pageCount)
    || normalizedSha256(document.sourceSha256, `POSTPROCESS_${kind}_SOURCE_HASH_INVALID`)
      !== normalizedSha256(source.sha256, `POSTPROCESS_${kind}_SOURCE_HASH_INVALID`)) {
    throw codedError(`POSTPROCESS_${kind}_SOURCE_METADATA_INVALID`)
  }
  const pageHashes = {}
  const pageSizes = {}
  for (let page = 1; page <= Number(source.pageCount); page += 1) {
    const record = document.pages?.[String(page)] ?? document.pages?.[page]
    if (record?.status !== 'completed' || Number(record?.sourcePage?.page) !== page) {
      throw codedError(`POSTPROCESS_${kind}_PAGE_METADATA_INVALID`)
    }
    pageHashes[page] = record?.sourcePage?.sha256
    pageSizes[page] = {
      width: Number(record?.sourcePage?.width),
      height: Number(record?.sourcePage?.height),
    }
  }
  return documentMetadata({
    pathValue: source.path,
    hashValue: source.sha256,
    pageHashes,
    pageSizes,
    pageCount: Number(source.pageCount),
    kind,
  })
}

function documentMetadata({ pathValue, hashValue, pageHashes, pageSizes, pageCount = null, kind }) {
  const sourcePath = absolutePath(pathValue, `POSTPROCESS_${kind}_SOURCE_PATH_INVALID`)
  const sha256 = normalizedSha256(hashValue, `POSTPROCESS_${kind}_SOURCE_HASH_INVALID`)
  if (!pageHashes || typeof pageHashes !== 'object' || Array.isArray(pageHashes)
    || !pageSizes || typeof pageSizes !== 'object' || Array.isArray(pageSizes)) {
    throw codedError(`POSTPROCESS_${kind}_PAGE_METADATA_INVALID`)
  }
  const hashPages = pageNumbers(pageHashes)
  const sizePages = pageNumbers(pageSizes)
  const resolvedCount = pageCount ?? Math.max(0, ...hashPages, ...sizePages)
  const expectedPages = Array.from({ length: resolvedCount }, (_, index) => index + 1)
  if (resolvedCount < 1
    || Object.keys(pageHashes).length !== hashPages.length
    || Object.keys(pageSizes).length !== sizePages.length
    || JSON.stringify(hashPages) !== JSON.stringify(expectedPages)
    || JSON.stringify(sizePages) !== JSON.stringify(expectedPages)) {
    throw codedError(`POSTPROCESS_${kind}_PAGE_COUNT_INVALID`)
  }
  const normalizedHashes = {}
  const normalizedSizes = {}
  for (const page of expectedPages) {
    normalizedHashes[page] = normalizedSha256(pageHashes[page], `POSTPROCESS_${kind}_PAGE_IMAGE_HASH_INVALID`)
    const width = Number(pageSizes[page]?.width)
    const height = Number(pageSizes[page]?.height)
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw codedError(`POSTPROCESS_${kind}_PAGE_SIZE_INVALID`)
    }
    normalizedSizes[page] = Object.freeze({ width, height })
  }
  return Object.freeze({
    kind,
    path: sourcePath,
    sha256,
    pageCount: resolvedCount,
    pageHashes: Object.freeze(normalizedHashes),
    pageSizes: Object.freeze(normalizedSizes),
  })
}

function validateExtractionSource(extraction, source) {
  if (!extraction || typeof extraction !== 'object' || Array.isArray(extraction)) {
    throw codedError('POSTPROCESS_REVIEW_DRAFT_INVALID')
  }
  let qpHash
  let msHash
  try {
    qpHash = normalizedSha256(extraction.source?.questionPdfSha256, 'POSTPROCESS_DRAFT_SOURCE_HASH_MISMATCH')
    msHash = normalizedSha256(extraction.source?.markSchemePdfSha256, 'POSTPROCESS_DRAFT_SOURCE_HASH_MISMATCH')
  } catch {
    throw codedError('POSTPROCESS_DRAFT_SOURCE_HASH_MISMATCH')
  }
  if (qpHash !== source.qp.sha256 || msHash !== source.ms.sha256) {
    throw codedError('POSTPROCESS_DRAFT_SOURCE_HASH_MISMATCH')
  }
}

function validateRegions(entries, source, kind, { required = false } = {}) {
  if (!Array.isArray(entries) || (required && entries.length === 0)) {
    throw codedError('POSTPROCESS_REGION_INVALID')
  }
  return entries.map((entry) => {
    const page = Number(entry?.page)
    if (!Number.isInteger(page) || page < 1 || page > source.pageCount) {
      throw codedError(`POSTPROCESS_${kind}_PAGE_OUT_OF_BOUNDS`)
    }
    const suppliedHash = normalizedSha256(entry?.pageImageSha256, `POSTPROCESS_${kind}_PAGE_IMAGE_HASH_MISMATCH`)
    if (suppliedHash !== source.pageHashes[page]) {
      throw codedError(`POSTPROCESS_${kind}_PAGE_IMAGE_HASH_MISMATCH`)
    }
    let normalized
    try {
      normalized = normalizeRegion(entry)
    } catch {
      throw codedError('POSTPROCESS_REGION_INVALID')
    }
    return Object.freeze({ page, pageImageSha256: suppliedHash, ...normalized })
  })
}

function regionContains(outer, inner) {
  return outer.page === inner.page
    && outer.x0 <= inner.x0
    && outer.y0 <= inner.y0
    && outer.x1 >= inner.x1
    && outer.y1 >= inner.y1
}

function sameRegion(left, right) {
  return left.page === right.page
    && left.x0 === right.x0
    && left.y0 === right.y0
    && left.x1 === right.x1
    && left.y1 === right.y1
}

function nonOverlappingRenderRegions(questionRegions, diagramRegions) {
  const result = [...questionRegions]
  for (const diagram of diagramRegions) {
    if (questionRegions.some(questionRegion => regionContains(questionRegion, diagram))) continue
    if (!result.some(region => sameRegion(region, diagram))) result.push(diagram)
  }
  return result
}

function validateMarkSchemeEvidence(entries, source) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw codedError('POSTPROCESS_MS_EVIDENCE_INVALID')
  }
  for (const entry of entries) {
    const page = Number(entry?.page)
    if (!Number.isInteger(page) || page < 1 || page > source.pageCount) {
      throw codedError('POSTPROCESS_MS_PAGE_OUT_OF_BOUNDS')
    }
    const suppliedHash = normalizedSha256(entry?.pageImageSha256, 'POSTPROCESS_MS_PAGE_IMAGE_HASH_MISMATCH')
    if (suppliedHash !== source.pageHashes[page]) {
      throw codedError('POSTPROCESS_MS_PAGE_IMAGE_HASH_MISMATCH')
    }
  }
}

function expectedAssetMap(value, outputRoot) {
  const result = new Map()
  if (value === undefined || value === null) return result
  if (!Array.isArray(value)) throw codedError('POSTPROCESS_OUTPUT_BINDING_INVALID')
  for (const asset of value) {
    const number = typeof asset?.questionNumber === 'string' ? asset.questionNumber.trim() : ''
    if (!/^\d{1,4}$/.test(number) || result.has(number)) {
      throw codedError('POSTPROCESS_OUTPUT_BINDING_INVALID')
    }
    const sha256 = normalizedSha256(asset.questionPdfSha256, 'POSTPROCESS_OUTPUT_BINDING_INVALID')
    const recordedPath = absolutePath(asset.questionPdfPath, 'POSTPROCESS_PATH_ESCAPE')
    assertWithinRoot(outputRoot, recordedPath)
    result.set(number, Object.freeze({ sha256, path: recordedPath }))
  }
  return result
}

async function validateSourceDocuments(source, { timeoutMs, runtime }) {
  const inspected = {}
  for (const document of [source.qp, source.ms]) {
    assertRegularFile(document.path, `POSTPROCESS_${document.kind}_SOURCE_MISSING`)
    if (fileSha256(document.path) !== document.sha256) {
      throw codedError(`POSTPROCESS_${document.kind}_HASH_MISMATCH`)
    }
    const info = await inspectPdf(document.path, { timeoutMs, runtime })
    if (info.pages.length !== document.pageCount) {
      throw codedError(`POSTPROCESS_${document.kind}_PAGE_COUNT_MISMATCH`)
    }
    for (let index = 0; index < info.pages.length; index += 1) {
      const actual = info.pages[index]
      const expected = document.pageSizes[index + 1]
      if (!positiveSize(actual) || !sameAspectRatio(actual, expected)) {
        throw codedError(`POSTPROCESS_${document.kind}_PAGE_SIZE_MISMATCH`)
      }
    }
    inspected[document.kind.toLowerCase()] = info
  }
  return Object.freeze(inspected)
}

async function auditQuestionOutputs(plan, inspectedSources, counts, context) {
  for (const question of plan.questions) {
    const outputPath = question.manifest.questionPdfPath
    const stat = fs.lstatSync(outputPath, { throwIfNoEntry: false })
    if (!stat) {
      if (question.expectedOutputSha256) throw codedError('POSTPROCESS_OUTPUT_MISSING')
      continue
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw codedError('POSTPROCESS_PATH_ESCAPE')
    counts.outputsChecked += 1
    await validateOutputPdf(outputPath, question, inspectedSources.qp, context)
    counts.outputsValid += 1
  }
}

async function renderQuestions(plan, inspectedSources, counts, { timeoutMs, runtime }) {
  assertSafeOutputRoot(plan.outputRoot)
  fs.mkdirSync(plan.outputRoot, { recursive: true })
  assertSafeOutputRoot(plan.outputRoot)
  const stagingRoot = path.join(plan.outputRoot, `.postprocess-${randomUUID()}`)
  assertWithinRoot(plan.outputRoot, stagingRoot)
  fs.mkdirSync(stagingRoot, { recursive: false })
  const prepared = []
  try {
    for (const question of plan.questions) {
      const temporaryManifest = buildCropManifest({
        paperId: plan.paperId,
        questionId: `${plan.paperId}:q${question.questionNumber}`,
        sourcePdfPath: plan.source.qp.path,
        sourcePdfSha256: plan.source.qp.sha256,
        regions: question.renderRegions,
        pageSizes: plan.source.qp.pageSizes,
        outputRoot: stagingRoot,
      })
      const launcher = runtime.pythonLauncher()
      const command = buildCropCommand(temporaryManifest, {
        pythonPath: launcher.command,
        pythonArgs: launcher.args,
      })
      fs.mkdirSync(temporaryManifest.outputDirectory, { recursive: true })
      try {
        await runtime.runProcess(command.command, command.args, { timeoutMs })
      } catch (error) {
        if (error?.code === 'POSTPROCESS_TIMEOUT') throw error
        throw codedError('POSTPROCESS_RENDER_FAILED')
      }
      assertRegularFile(temporaryManifest.questionPdfPath, 'POSTPROCESS_OUTPUT_MISSING')
      const temporaryQuestion = { ...question, manifest: temporaryManifest }
      const outputHash = await validateOutputPdf(
        temporaryManifest.questionPdfPath,
        temporaryQuestion,
        inspectedSources.qp,
        { timeoutMs, runtime },
      )
      prepared.push({
        sourcePath: temporaryManifest.questionPdfPath,
        destinationPath: question.manifest.questionPdfPath,
        outputHash,
      })
    }

    for (const item of prepared) {
      assertWithinRoot(plan.outputRoot, item.destinationPath)
      const destinationDirectory = path.dirname(item.destinationPath)
      assertSafeOutputRoot(destinationDirectory)
      fs.mkdirSync(destinationDirectory, { recursive: true })
      assertSafeOutputRoot(destinationDirectory)
      const existing = fs.lstatSync(item.destinationPath, { throwIfNoEntry: false })
      if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
        throw codedError('POSTPROCESS_PATH_ESCAPE')
      }
      const candidate = path.join(destinationDirectory, `.question.pdf.${randomUUID()}.tmp`)
      assertWithinRoot(destinationDirectory, candidate)
      fs.copyFileSync(item.sourcePath, candidate, fs.constants.COPYFILE_EXCL)
      if (fileSha256(candidate) !== item.outputHash) {
        fs.rmSync(candidate, { force: true })
        throw codedError('POSTPROCESS_OUTPUT_HASH_MISMATCH')
      }
      fs.renameSync(candidate, item.destinationPath)
    }
    counts.rendered = prepared.length
    counts.outputsChecked += prepared.length
    counts.outputsValid += prepared.length
  } finally {
    assertWithinRoot(plan.outputRoot, stagingRoot)
    fs.rmSync(stagingRoot, { recursive: true, force: true })
  }
}

async function validateOutputPdf(filePath, question, sourceInfo, { timeoutMs, runtime }) {
  const bytes = fs.readFileSync(filePath)
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw codedError('POSTPROCESS_OUTPUT_INVALID')
  }
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (question.expectedOutputSha256 && hash !== question.expectedOutputSha256) {
    throw codedError('POSTPROCESS_OUTPUT_HASH_MISMATCH')
  }
  const info = await inspectPdf(filePath, { timeoutMs, runtime, output: true })
  const crops = question.manifest.crops
  if (info.pages.length !== crops.length) {
    throw codedError('POSTPROCESS_OUTPUT_PAGE_COUNT_MISMATCH')
  }
  for (let index = 0; index < crops.length; index += 1) {
    const crop = crops[index]
    const sourcePage = sourceInfo.pages[crop.page - 1]
    const region = crop.normalizedRegion
    const expected = {
      width: sourcePage.width * (region.x1 - region.x0),
      height: sourcePage.height * (region.y1 - region.y0),
    }
    if (!samePdfSize(info.pages[index], expected)) {
      throw codedError('POSTPROCESS_OUTPUT_PAGE_SIZE_MISMATCH')
    }
  }
  return hash
}

async function inspectPdf(filePath, { timeoutMs, runtime, output = false }) {
  const launcher = runtime.pythonLauncher()
  let result
  try {
    result = await runtime.runProcess(
      launcher.command,
      [...launcher.args, '-c', PDF_INSPECTION_PROGRAM, filePath],
      { timeoutMs },
    )
  } catch (error) {
    if (error?.code === 'POSTPROCESS_TIMEOUT') throw error
    throw codedError(output ? 'POSTPROCESS_OUTPUT_INVALID' : 'POSTPROCESS_SOURCE_PDF_INVALID')
  }
  try {
    const parsed = JSON.parse(result.stdout)
    if (!Array.isArray(parsed?.pages) || parsed.pages.some(page => !positiveSize(page))) throw new Error('invalid')
    return parsed
  } catch {
    throw codedError(output ? 'POSTPROCESS_OUTPUT_INVALID' : 'POSTPROCESS_SOURCE_PDF_INVALID')
  }
}

function runtimeAdapters(adapters) {
  return {
    runProcess: typeof adapters.runProcess === 'function' ? adapters.runProcess : runProcessWithTimeout,
    pythonLauncher: typeof adapters.pythonLauncher === 'function' ? adapters.pythonLauncher : defaultPythonLauncher,
  }
}

function defaultPythonLauncher() {
  const bundled = path.join(
    os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
    'dependencies', 'python', 'python.exe',
  )
  if (fs.statSync(bundled, { throwIfNoEntry: false })?.isFile()) {
    return { command: bundled, args: [] }
  }
  return process.platform === 'win32'
    ? { command: 'py', args: ['-3.12'] }
    : { command: 'python3', args: [] }
}

function readJsonFile(filePath, code) {
  const resolved = absolutePath(filePath, code)
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_JSON_BYTES) {
    throw codedError(code)
  }
  try {
    const value = JSON.parse(fs.readFileSync(resolved, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value
  } catch {
    throw codedError(code)
  }
}

function assertRegularFile(filePath, code) {
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size <= 0) throw codedError(code)
}

function assertSafeOutputRoot(target) {
  const resolved = path.resolve(target)
  const parsed = path.parse(resolved)
  let cursor = parsed.root
  const rootStat = fs.lstatSync(cursor, { throwIfNoEntry: false })
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw codedError('POSTPROCESS_PATH_ESCAPE')
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)
  for (const segment of segments) {
    cursor = path.join(cursor, segment)
    const stat = fs.lstatSync(cursor, { throwIfNoEntry: false })
    if (!stat) break
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw codedError('POSTPROCESS_PATH_ESCAPE')
  }
}

function assertWithinRoot(root, target) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw codedError('POSTPROCESS_PATH_ESCAPE')
  }
}

function fileSha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function normalizedSha256(value, code) {
  const match = typeof value === 'string' ? SHA256.exec(value.trim()) : null
  if (!match) throw codedError(code)
  return match[1].toLowerCase()
}

function absolutePath(value, code) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) throw codedError(code)
  return path.resolve(value)
}

function safeSegment(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return SAFE_PAPER_ID.test(text) ? text : ''
}

function pageNumbers(value) {
  return Object.keys(value)
    .filter(key => /^\d+$/.test(key))
    .map(Number)
    .sort((left, right) => left - right)
}

function positiveSize(value) {
  return Number.isFinite(Number(value?.width)) && Number(value.width) > 0
    && Number.isFinite(Number(value?.height)) && Number(value.height) > 0
}

function sameAspectRatio(actual, expected) {
  const actualRatio = Number(actual.width) / Number(actual.height)
  const expectedRatio = Number(expected.width) / Number(expected.height)
  return Math.abs(actualRatio - expectedRatio) <= Math.max(actualRatio, expectedRatio) * PAGE_ASPECT_TOLERANCE
}

function samePdfSize(actual, expected) {
  return positiveSize(actual) && positiveSize(expected)
    && Math.abs(Number(actual.width) - Number(expected.width)) <= PDF_SIZE_TOLERANCE
    && Math.abs(Number(actual.height) - Number(expected.height)) <= PDF_SIZE_TOLERANCE
}

function validTimeout(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
    throw codedError('POSTPROCESS_TIMEOUT_INVALID')
  }
  return parsed
}

function emptyCounts() {
  return Object.fromEntries(POSTPROCESS_SUMMARY_KEYS.map(key => [key, 0]))
}

function applyPlanCounts(counts, plan) {
  counts.artifacts = 1
  counts.questions = plan.questions.length
  counts.questionRegions = plan.questions.reduce((total, question) => total + question.questionRegions.length, 0)
  counts.diagramRegions = plan.questions.reduce((total, question) => total + question.diagramRegions.length, 0)
  counts.uniqueCrops = plan.questions.reduce((total, question) => total + question.manifest.crops.length, 0)
}

function summary(counts, errorCodes) {
  return Object.freeze({
    counts: Object.freeze({ ...counts }),
    errorCodes: Object.freeze([...new Set(errorCodes)].sort()),
  })
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^POSTPROCESS_[A-Z0-9_]{2,100}$/.test(error.code)
    ? error.code
    : 'POSTPROCESS_FAILED'
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function parseCliArgs(argv) {
  const values = { render: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--render') {
      if (values.render) throw codedError('POSTPROCESS_ARGUMENT_INVALID')
      values.render = true
      continue
    }
    if (!['--artifact', '--review-draft', '--output-root', '--timeout-ms'].includes(argument)) {
      throw codedError('POSTPROCESS_ARGUMENT_INVALID')
    }
    const next = argv[index + 1]
    if (!next || next.startsWith('--') || values[argument] !== undefined) {
      throw codedError('POSTPROCESS_ARGUMENT_INVALID')
    }
    values[argument] = next
    index += 1
  }
  if (!values['--artifact'] || !values['--output-root']) {
    throw codedError('POSTPROCESS_ARGUMENT_INVALID')
  }
  return {
    artifactPath: values['--artifact'],
    reviewDraftPath: values['--review-draft'] || null,
    outputRoot: values['--output-root'],
    timeoutMs: values['--timeout-ms'] === undefined ? DEFAULT_TIMEOUT_MS : Number(values['--timeout-ms']),
    render: values.render,
  }
}

async function cliMain(argv) {
  let result
  try {
    result = await postprocessRender(parseCliArgs(argv))
  } catch (error) {
    result = summary(emptyCounts(), [safeErrorCode(error)])
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.errorCodes.length ? 2 : 0
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) await cliMain(process.argv.slice(2))
