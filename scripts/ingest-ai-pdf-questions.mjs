import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import { CAMBRIDGE_0580_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0580-igcse-2025-2027.js'
import { CAMBRIDGE_0625_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0625-igcse-2026-2028.js'
import { CAMBRIDGE_9709_AS_P1_S1_SYLLABUS } from '../src/data/syllabus/cambridge-9709-as-p1-s1-2026-2027.js'
import { mergeRuntimeEnv } from '../src/lib/runtimeEnv.js'
import { AI_PDF_INGESTION_SCHEMA_VERSION, artifactId } from './ai-pdf-ingestion/contract.mjs'
import { callStructuredWithFallback, providersFromEnvironment } from './ai-pdf-ingestion/provider-fallback.mjs'
import {
  buildCropCommand,
  buildCropManifest,
  buildRenderArgs,
  imageSha256,
  resolvePopplerExecutable,
} from './ai-pdf-ingestion/render.mjs'
import { validateCandidate } from './ai-pdf-ingestion/validate.mjs'

const DEFAULT_OUTPUT_ROOT = 'data/ai-pdf-ingestion'
const DEFAULT_RENDER_DPI = 180
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_OPENAI_TIMEOUT_MS = 120000
const DEFAULT_PAPER_TIMEOUT_MS = 900000
const PAGE_WINDOW_OWNED_PAGE_COUNT = 4
const PAGE_WINDOW_TRAILING_CONTEXT_PAGE_COUNT = 4
const MAX_PDF_TEXT_BYTES = 2 * 1024 * 1024
const NO_EXTRACTABLE_TEXT_PAGE_MARKER = '[No extractable text on this page.]'
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const PDF_VALIDATION_PROGRAM = 'from pypdf import PdfReader; import sys; reader = PdfReader(sys.argv[1]); expected = int(sys.argv[2]); assert expected > 0 and len(reader.pages) == expected'
const SUPPORTED_SYLLABUSES = Object.freeze({
  '0580': CAMBRIDGE_0580_IGCSE_SYLLABUS,
  '0625': CAMBRIDGE_0625_IGCSE_SYLLABUS,
  '9702': CAMBRIDGE_9702_AS_SYLLABUS,
  '9709': CAMBRIDGE_9709_AS_P1_S1_SYLLABUS,
})

const extractorSchema = {
  type: 'object', additionalProperties: false, required: ['source', 'questions'], properties: {
    source: {
      type: 'object', additionalProperties: false, required: ['questionPdfSha256', 'markSchemePdfSha256'], properties: {
        questionPdfSha256: { type: 'string' }, markSchemePdfSha256: { type: 'string' },
      },
    },
    questions: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['questionNumber', 'questionStartPage', 'regions', 'diagramRegions', 'parts', 'tags', 'markSchemeEvidence'], properties: {
          questionNumber: { type: 'string' }, questionStartPage: { type: 'integer', minimum: 1 },
          regions: { type: 'array', items: regionSchema() },
          diagramRegions: { type: 'array', items: regionSchema() },
          parts: {
            type: 'array', items: {
              type: 'object', additionalProperties: false,
              required: ['label', 'marks', 'ocrText', 'math', 'diagramAssociations'], properties: {
                label: { type: 'string' }, marks: { type: 'integer', minimum: 0 }, ocrText: { type: 'string' },
                math: { type: 'array', items: { type: 'string' } },
                diagramAssociations: { type: 'array', items: { type: 'integer', minimum: 0 } },
              },
            },
          },
          tags: tagSchema(),
          markSchemeEvidence: { type: 'array', items: markSchemeEvidenceSchema() },
        },
      },
    },
  },
}

const verifierSchema = {
  type: 'object', additionalProperties: false, required: ['questionStarts', 'questions'], properties: {
    questionStarts: {
      type: 'array', items: questionStartSchema(),
    },
    questions: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['questionNumber', 'questionStartPage', 'pages', 'parts', 'diagramRegionCount', 'markSchemeEvidence'], properties: {
          questionNumber: { type: 'string' }, questionStartPage: { type: 'integer', minimum: 1 },
          pages: { type: 'array', items: { type: 'integer', minimum: 1 } },
          parts: {
            type: 'array', items: {
              type: 'object', additionalProperties: false, required: ['label', 'marks'], properties: {
                label: { type: 'string' }, marks: { type: 'integer', minimum: 0 },
              },
            },
          },
          diagramRegionCount: { type: 'integer', minimum: 0 },
          markSchemeEvidence: { type: 'array', items: markSchemeEvidenceSchema() },
        },
      },
    },
  },
}

export function parseArgs(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const runtimeEnv = mergeRuntimeEnv({ cwd, env })
  const values = {}
  const flags = new Set(['--dry-run', '--retry', '--coordinate-only', '--page-windowed'])
  const options = new Set([
    '--paper-id', '--question-pdf', '--mark-scheme-pdf', '--subject', '--output-root', '--model', '--base-url', '--render-dpi', '--max-attempts', '--timeout-ms', '--paper-timeout-ms',
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (flags.has(argument)) {
      const flagName = argument === '--dry-run'
        ? 'dryRun'
        : argument === '--retry'
          ? 'retry'
          : argument === '--coordinate-only'
            ? 'coordinateOnly'
            : 'pageWindowed'
      if (values[flagName]) throw new RangeError(`${argument} may only be provided once.`)
      values[flagName] = true
      continue
    }
    if (!options.has(argument)) throw new RangeError(`Unknown argument: ${String(argument)}`)
    if (Object.hasOwn(values, argument)) throw new RangeError(`${argument} may only be provided once.`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new RangeError(`${argument} requires a value.`)
    values[argument] = value
    index += 1
  }

  for (const required of ['--paper-id', '--question-pdf', '--mark-scheme-pdf', '--subject']) {
    if (!values[required]) throw new RangeError(`${required} is required.`)
  }
  if (!SAFE_SEGMENT.test(values['--paper-id'])) throw new RangeError('--paper-id must be a single safe path segment.')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values['--subject'])) throw new RangeError('--subject must be a safe identifier.')
  if (!supportedSubject(values['--subject'])) throw codedError('UNSUPPORTED_SUBJECT')

  const renderDpi = positiveInteger(values['--render-dpi'] ?? DEFAULT_RENDER_DPI, '--render-dpi')
  const maxAttempts = positiveInteger(values['--max-attempts'] ?? DEFAULT_MAX_ATTEMPTS, '--max-attempts')
  const timeoutMs = positiveInteger(values['--timeout-ms'] ?? runtimeEnv.AI_PDF_INGESTION_TIMEOUT_MS ?? DEFAULT_OPENAI_TIMEOUT_MS, '--timeout-ms')
  const paperTimeoutMs = positiveInteger(values['--paper-timeout-ms'] ?? runtimeEnv.AI_PDF_INGESTION_PAPER_TIMEOUT_MS ?? DEFAULT_PAPER_TIMEOUT_MS, '--paper-timeout-ms')
  const outputRoot = path.resolve(cwd, values['--output-root'] ?? runtimeEnv.AI_PDF_INGESTION_ROOT ?? DEFAULT_OUTPUT_ROOT)

  return Object.freeze({
    paperId: values['--paper-id'],
    questionPdf: resolveExistingFile(values['--question-pdf'], '--question-pdf', cwd),
    markSchemePdf: resolveExistingFile(values['--mark-scheme-pdf'], '--mark-scheme-pdf', cwd),
    subject: values['--subject'],
    outputRoot,
    model: nonemptyString(values['--model'] ?? runtimeEnv.AI_PDF_INGESTION_MODEL) ?? 'gpt-5.6',
    baseUrl: nonemptyString(values['--base-url'] ?? runtimeEnv.OPENAI_BASE_URL),
    dryRun: values.dryRun === true,
    retry: values.retry === true,
    coordinateOnly: values.coordinateOnly === true,
    pageWindowed: values.pageWindowed === true,
    renderDpi,
    maxAttempts,
    timeoutMs,
    paperTimeoutMs,
  })
}

export function buildDryRunPlan(options) {
  const questionPdfSha256 = fileSha256(options.questionPdf)
  const markSchemePdfSha256 = fileSha256(options.markSchemePdf)
  const id = artifactId({ paperId: options.paperId, questionPdfSha256, markSchemePdfSha256 })
  const outputArtifactPath = artifactPath(options.outputRoot, options.paperId, id)
  return Object.freeze({
    schemaVersion: AI_PDF_INGESTION_SCHEMA_VERSION,
    mode: 'dry-run',
    paperId: options.paperId,
    subject: options.subject,
    model: options.model,
    renderDpi: options.renderDpi,
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    paperTimeoutMs: options.paperTimeoutMs,
    retry: options.retry,
    coordinateOnly: options.coordinateOnly === true,
    pageWindowed: options.pageWindowed === true,
    artifactId: id,
    immutableInputs: {
      questionPdf: { path: options.questionPdf, sha256: questionPdfSha256 },
      markSchemePdf: { path: options.markSchemePdf, sha256: markSchemePdfSha256 },
    },
    outputArtifactPath,
  })
}

export async function runCli(options, {
  cwd = process.cwd(),
  env = process.env,
  callStructured = null,
  callWithFallback = callStructuredWithFallback,
  providerChain = providersFromEnvironment,
  renderPdf = renderPdfPages,
  extractPdfText = extractPdfTextPages,
  runCropCommand = runCropCommandWithBundledPython,
  validateCropOutput = validateCropOutputWithBundledPython,
  writeArtifact = writeArtifactSafely,
} = {}) {
  const runtimeEnv = mergeRuntimeEnv({ cwd, env })
  const plan = buildDryRunPlan(options)
  if (options.dryRun) return plan

  const priorArtifact = readExistingArtifact(plan.outputArtifactPath)
  if (priorArtifact?.status === 'auto-quarantined' && !options.retry) return priorArtifact
  if (priorArtifact?.status === 'ai-verified') {
    const fresh = priorArtifact.storageMode === 'coordinate-only'
      ? coordinateOnlyArtifactSourcesFresh(priorArtifact)
      : verifiedArtifactAssetsFresh(priorArtifact, plan.outputArtifactPath)
    if (fresh) return priorArtifact
    if (!options.retry) {
      return writeArtifact(plan.outputArtifactPath, {
        schemaVersion: AI_PDF_INGESTION_SCHEMA_VERSION,
        artifactId: plan.artifactId,
        paperId: plan.paperId,
        subject: plan.subject,
        status: 'auto-quarantined',
        source: priorArtifact.source || sourceMetadata(plan, options),
        model: plan.model,
        reasonCodes: [priorArtifact.storageMode === 'coordinate-only' ? 'EXISTING_ARTIFACT_SOURCE_MISSING' : 'EXISTING_ARTIFACT_ASSET_MISSING'],
      })
    }
  }
  if (priorArtifact && options.retry) {
    fs.rmSync(assetsRootFor(plan.outputArtifactPath, plan.artifactId), { recursive: true, force: true })
  }

  const source = sourceMetadata(plan, options)
  const paperDeadlineAt = Date.now() + (options.paperTimeoutMs || DEFAULT_PAPER_TIMEOUT_MS)
  let temporaryDirectory
  let createdAssetsRoot = null
  try {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pdf-ingestion-'))
    const questionRenderDirectory = path.join(temporaryDirectory, 'question-paper')
    const markSchemeRenderDirectory = path.join(temporaryDirectory, 'mark-scheme')
    fs.mkdirSync(questionRenderDirectory)
    fs.mkdirSync(markSchemeRenderDirectory)
    const questionRender = normalizeRenderResult(await renderPdf(options.questionPdf, questionRenderDirectory, options.renderDpi, runtimeEnv))
    const markSchemeRender = normalizeRenderResult(await renderPdf(options.markSchemePdf, markSchemeRenderDirectory, options.renderDpi, runtimeEnv))
    source.pageImageHashes = questionRender.pageImageHashes
    source.pageSizes = questionRender.pageSizes
    source.markSchemePageHashes = markSchemeRender.pageImageHashes
    source.markSchemePageSizes = markSchemeRender.pageSizes

    const providers = callStructured ? [] : providerChain(runtimeEnv, { model: options.model, baseUrl: options.baseUrl })
    if (!callStructured && providers.length === 0) {
      return await writeQuarantine({ plan, source, writeArtifact, reasonCodes: ['OPENAI_CONFIGURATION_INVALID'] })
    }

    const requestStructured = async ({ schemaName, schema, input }) => {
      const remainingMs = Math.floor(paperDeadlineAt - Date.now())
      if (remainingMs < 1) throw codedError('AI_PAPER_TIMEOUT')
      const request = {
        apiKey: runtimeEnv.OPENAI_API_KEY,
        model: options.model,
        baseUrl: options.baseUrl,
        schemaName,
        schema,
        input,
        maxAttempts: options.maxAttempts,
        timeoutMs: Math.min(options.timeoutMs, remainingMs),
        deadlineAt: paperDeadlineAt,
      }
      if (callStructured) {
        return { provider: { name: 'injected' }, value: await withDeadline(callStructured(request), paperDeadlineAt) }
      }
      return callWithFallback({ providers, request })
    }
    const ingestion = options.pageWindowed
      ? await extractAndVerifyPageWindows({
        source,
        options,
        questionRenderDirectory,
        markSchemeRenderDirectory,
        requestStructured,
        extractPdfText,
        runtimeEnv,
      })
      : await extractAndVerifyWholePaper({
        source,
        questionRenderDirectory,
        markSchemeRenderDirectory,
        requestStructured,
      })
    if (options.pageWindowed) assertPageWindowAgreement(ingestion.extraction, ingestion.verification)
    const extraction = ingestion.extraction
    const verification = ingestion.verification
    const normalizedVerification = normalizeVerificationForValidation(verification)
    const validationCandidate = normalizeExtractionForValidation(extraction, normalizedVerification)
    const validation = validateCandidate({ candidate: validationCandidate, verification: normalizedVerification, source })
    let assets = []
    if (validation.status === 'ai-verified' && !options.coordinateOnly) {
      createdAssetsRoot = assetsRootFor(plan.outputArtifactPath, plan.artifactId)
      fs.mkdirSync(path.dirname(createdAssetsRoot), { recursive: true })
      fs.mkdirSync(createdAssetsRoot)
      try {
        assets = await cropVerifiedQuestions({
          extraction,
          options,
          plan,
          pageSizes: questionRender.pageSizes,
          assetsRoot: createdAssetsRoot,
          runCropCommand,
          validateCropOutput,
        })
      } catch {
        throw codedError('CROP_FAILED')
      }
    }
    return writeArtifact(plan.outputArtifactPath, artifactForResult(plan, source, options, validation, validationCandidate, normalizedVerification, assets, {
      extractorProvider: ingestion.extractorProvider,
      verifierProvider: ingestion.verifierProvider,
    }))
  } catch (error) {
    if (createdAssetsRoot) fs.rmSync(createdAssetsRoot, { recursive: true, force: true })
    return writeQuarantine({
      plan,
      source,
      writeArtifact,
      reasonCodes: [safeFailureCode(error)],
    })
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

async function extractAndVerifyWholePaper({ source, questionRenderDirectory, markSchemeRenderDirectory, requestStructured }) {
  const extractionResult = await requestStructured({
    schemaName: 'ai_pdf_question_extraction_v1',
    schema: extractionSchemaFor(source.controlledTags),
    input: buildExtractionInput(source, questionRenderDirectory, markSchemeRenderDirectory),
  })
  const verificationResult = await requestStructured({
    schemaName: 'ai_pdf_question_verification_v1',
    schema: verifierSchema,
    input: buildVerificationInput(source, extractionResult.value, questionRenderDirectory, markSchemeRenderDirectory),
  })
  return {
    extraction: extractionResult.value,
    verification: verificationResult.value,
    extractorProvider: extractionResult.provider?.name || null,
    verifierProvider: verificationResult.provider?.name || null,
  }
}

async function extractAndVerifyPageWindows({
  source,
  options,
  questionRenderDirectory,
  requestStructured,
  extractPdfText,
  runtimeEnv,
}) {
  const pageText = {
    questionPaper: normalizePdfTextPages(
      await extractPdfText(options.questionPdf, source.pageImageHashes, runtimeEnv),
      source.pageImageHashes,
    ),
    markScheme: normalizePdfTextPages(
      await extractPdfText(options.markSchemePdf, source.markSchemePageHashes, runtimeEnv),
      source.markSchemePageHashes,
    ),
  }
  const chunks = []
  const observations = new Map()
  for (const pageWindow of questionPaperPageWindows(source.pageImageHashes)) {
    const chunk = await extractAndVerifyPageWindow({
      source,
      questionRenderDirectory,
      pageText,
      pageWindow,
      requestStructured,
    })
    chunks.push(chunk)
    for (const observation of [...chunk.extractionObservations, ...chunk.verificationObservations]) {
      observations.set(observation.questionNumber, observation)
    }
  }

  const ownedQuestionNumbers = ownedQuestionNumbersFromChunks(chunks)
  const unresolved = [...observations.values()].filter(({ questionNumber }) => !ownedQuestionNumbers.has(questionNumber))
  if (unresolved.length) {
    const recoveryWindow = recoveryPageWindow(source.pageImageHashes, unresolved)
    const recoveryChunk = await extractAndVerifyPageWindow({
      source,
      questionRenderDirectory,
      pageText,
      pageWindow: recoveryWindow,
      requestStructured,
    })
    chunks.push(recoveryChunk)
    const recoveredQuestionNumbers = ownedQuestionNumbersFromChunks(chunks)
    const stillUnresolved = unresolved.filter(({ questionNumber }) => !recoveredQuestionNumbers.has(questionNumber))
    if (stillUnresolved.length) throw codedError('PAGE_WINDOW_QUESTION_OWNERSHIP_UNRESOLVED')
  }
  return {
    extraction: mergePageWindowExtractions(chunks),
    verification: mergePageWindowVerifications(chunks),
    extractorProvider: providerLabel(chunks.map(chunk => chunk.extractionProvider)),
    verifierProvider: providerLabel(chunks.map(chunk => chunk.verificationProvider)),
  }
}

async function extractAndVerifyPageWindow({ source, questionRenderDirectory, pageText, pageWindow, requestStructured }) {
  const extractionResult = await requestStructured({
    schemaName: 'ai_pdf_question_extraction_v1',
    schema: extractionSchemaFor(source.controlledTags),
    input: buildPageWindowedExtractionInput(source, questionRenderDirectory, pageWindow, pageText),
  })
  const extractionFilter = filterPageWindowQuestions(
    extractionResult.value?.questions,
    pageWindow,
    'PAGE_WINDOW_EXTRACTION',
    { sourcePages: source.pageImageHashes },
  )
  const extraction = { ...(extractionResult.value || {}), questions: extractionFilter.questions }

  const verificationResult = await requestStructured({
    schemaName: 'ai_pdf_question_verification_v1',
    schema: verifierSchema,
    input: buildPageWindowedVerificationInput(source, questionRenderDirectory, pageWindow, pageText),
  })
  const verificationFilter = filterPageWindowQuestions(
    verificationResult.value?.questions,
    pageWindow,
    'PAGE_WINDOW_VERIFICATION',
    { verification: true, sourcePages: source.pageImageHashes },
  )
  const startFilter = filterPageWindowStarts(
    verificationResult.value?.questionStarts,
    pageWindow,
    'PAGE_WINDOW_VERIFICATION',
    { sourcePages: source.pageImageHashes },
  )
  const verification = { ...(verificationResult.value || {}), questions: verificationFilter.questions }
  return {
    pageWindow,
    extraction,
    verification,
    extractionObservations: extractionFilter.observations,
    verificationObservations: [...verificationFilter.observations, ...startFilter.observations],
    extractionProvider: extractionResult.provider?.name || null,
    verificationProvider: verificationResult.provider?.name || null,
  }
}

function questionPaperPageWindows(pageHashes) {
  const pages = sortedPageNumbers(pageHashes)
  if (!pages.length) throw codedError('PAGE_WINDOW_SOURCE_PAGES_INVALID')
  const windows = []
  for (let index = 0; index < pages.length; index += PAGE_WINDOW_OWNED_PAGE_COUNT) {
    const ownedQuestionPaperPages = pages.slice(index, index + PAGE_WINDOW_OWNED_PAGE_COUNT)
    const visibleQuestionPaperPages = pages.slice(index, index + PAGE_WINDOW_OWNED_PAGE_COUNT + PAGE_WINDOW_TRAILING_CONTEXT_PAGE_COUNT)
    windows.push(Object.freeze({ ownedQuestionPaperPages, visibleQuestionPaperPages }))
  }
  return windows
}

function recoveryPageWindow(pageHashes, observations) {
  const pages = sortedPageNumbers(pageHashes)
  const startPages = [...new Set(observations.map(observation => observation.questionStartPage))]
    .filter(page => pages.includes(page))
    .sort((left, right) => left - right)
  if (!startPages.length) throw codedError('PAGE_WINDOW_QUESTION_START_PAGE_INVALID')
  const firstStartIndex = pages.indexOf(startPages[0])
  return Object.freeze({
    ownedQuestionPaperPages: startPages,
    visibleQuestionPaperPages: pages.slice(firstStartIndex),
    recovery: true,
  })
}

function normalizePdfTextPages(value, pageHashes) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError('PDF_TEXT_EXTRACTION_FAILED')
  const normalized = {}
  let pagesWithText = 0
  for (const page of sortedPageNumbers(pageHashes)) {
    const text = typeof value[page] === 'string' ? value[page].trim() : ''
    if (text) pagesWithText += 1
    normalized[page] = text || NO_EXTRACTABLE_TEXT_PAGE_MARKER
  }
  if (!pagesWithText) throw codedError('PDF_TEXT_EXTRACTION_FAILED')
  return Object.freeze(normalized)
}

function filterPageWindowQuestions(questions, pageWindow, prefix, { verification = false, sourcePages = {} } = {}) {
  if (!Array.isArray(questions)) throw codedError(`${prefix}_QUESTIONS_INVALID`)
  const ownedPages = new Set(pageWindow.ownedQuestionPaperPages)
  const visiblePages = new Set(pageWindow.visibleQuestionPaperPages)
  const allPages = new Set(sortedPageNumbers(sourcePages))
  const ownedQuestions = []
  const observations = []
  for (const question of questions) {
    const pages = verification
      ? Array.isArray(question?.pages) ? question.pages : []
      : [
        ...(Array.isArray(question?.regions) ? question.regions : []),
        ...(Array.isArray(question?.diagramRegions) ? question.diagramRegions : []),
      ].map(region => region?.page)
    const questionNumber = nonemptyString(question?.questionNumber)
    const questionStartPage = question?.questionStartPage
    if (!questionNumber) throw codedError(`${prefix}_QUESTION_NUMBER_INVALID`)
    if (!pages.length || pages.some(page => !Number.isInteger(page))) throw codedError(`${prefix}_PAGES_INVALID`)
    if (!Number.isInteger(questionStartPage) || !allPages.has(questionStartPage) || !pages.includes(questionStartPage)) {
      throw codedError(`${prefix}_START_PAGE_INVALID`)
    }
    if (pages.some(page => !allPages.has(page))) throw codedError(`${prefix}_PAGE_OUTSIDE_SOURCE`)
    if (!visiblePages.has(questionStartPage) || pages.some(page => !visiblePages.has(page)) || !ownedPages.has(questionStartPage)) {
      observations.push({ questionNumber, questionStartPage, pages: [...new Set(pages)].sort((left, right) => left - right) })
      continue
    }
    ownedQuestions.push(question)
  }
  return { questions: ownedQuestions, observations }
}

function filterPageWindowStarts(questionStarts, pageWindow, prefix, { sourcePages = {} } = {}) {
  if (!Array.isArray(questionStarts)) throw codedError(`${prefix}_QUESTION_STARTS_INVALID`)
  const visiblePages = new Set(pageWindow.visibleQuestionPaperPages)
  const allPages = new Set(sortedPageNumbers(sourcePages))
  const observations = []
  for (const questionStart of questionStarts) {
    const questionNumber = nonemptyString(questionStart?.questionNumber)
    const questionStartPage = questionStart?.questionStartPage
    if (!questionNumber || !Number.isInteger(questionStartPage) || !allPages.has(questionStartPage)) {
      throw codedError(`${prefix}_START_PAGE_INVALID`)
    }
    if (!visiblePages.has(questionStartPage)) throw codedError(`${prefix}_START_PAGE_OUTSIDE_CONTEXT`)
    observations.push({ questionNumber, questionStartPage, pages: [questionStartPage] })
  }
  return { observations }
}

function ownedQuestionNumbersFromChunks(chunks) {
  return new Set(chunks.flatMap(chunk => [
    ...(chunk.extraction?.questions || []),
    ...(chunk.verification?.questions || []),
  ]).map(question => question?.questionNumber).filter(Boolean))
}

function mergePageWindowExtractions(chunks) {
  const source = chunks[0]?.extraction?.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw codedError('PAGE_WINDOW_CANDIDATE_SOURCE_INVALID')
  const questions = []
  const seen = new Set()
  for (const chunk of chunks) {
    const extraction = chunk.extraction
    if (!sameCandidateSource(source, extraction?.source) || !Array.isArray(extraction?.questions)) throw codedError('PAGE_WINDOW_CANDIDATE_SOURCE_DISAGREEMENT')
    for (const question of extraction.questions) {
      const questionNumber = nonemptyString(question?.questionNumber)
      if (!questionNumber) throw codedError('PAGE_WINDOW_QUESTION_NUMBER_INVALID')
      if (seen.has(questionNumber)) throw codedError('PAGE_WINDOW_QUESTION_DUPLICATE')
      seen.add(questionNumber)
      questions.push(question)
    }
  }
  return { source, questions: sortQuestions(questions) }
}

function mergePageWindowVerifications(chunks) {
  const questions = []
  const seen = new Set()
  const questionStarts = []
  const startsByQuestion = new Map()
  for (const chunk of chunks) {
    const verification = chunk.verification
    if (!Array.isArray(verification?.questions)) throw codedError('PAGE_WINDOW_VERIFICATION_QUESTIONS_INVALID')
    if (!Array.isArray(verification?.questionStarts)) throw codedError('PAGE_WINDOW_QUESTION_STARTS_INVALID')
    for (const questionStart of verification.questionStarts) {
      const questionNumber = nonemptyString(questionStart?.questionNumber)
      if (!questionNumber || !Number.isInteger(questionStart?.questionStartPage)) throw codedError('PAGE_WINDOW_QUESTION_START_INVALID')
      const existingStart = startsByQuestion.get(questionNumber)
      if (existingStart && existingStart !== questionStart.questionStartPage) throw codedError('PAGE_WINDOW_QUESTION_START_DISAGREEMENT')
      if (!existingStart) {
        startsByQuestion.set(questionNumber, questionStart.questionStartPage)
        questionStarts.push(questionStart)
      }
    }
    for (const question of verification.questions) {
      const questionNumber = nonemptyString(question?.questionNumber)
      if (!questionNumber) throw codedError('PAGE_WINDOW_QUESTION_NUMBER_INVALID')
      if (seen.has(questionNumber)) throw codedError('PAGE_WINDOW_VERIFICATION_DUPLICATE')
      seen.add(questionNumber)
      questions.push(question)
    }
  }
  return { questionStarts: sortQuestionStarts(questionStarts), questions: sortQuestions(questions) }
}

function sortQuestionStarts(questionStarts) {
  return [...questionStarts].sort((left, right) => String(left.questionNumber).localeCompare(String(right.questionNumber), undefined, { numeric: true }))
}

function sameCandidateSource(left, right) {
  return left && right
    && left.questionPdfSha256 === right.questionPdfSha256
    && left.markSchemePdfSha256 === right.markSchemePdfSha256
}

function sortQuestions(questions) {
  return [...questions].sort((left, right) => String(left.questionNumber).localeCompare(String(right.questionNumber), undefined, { numeric: true }))
}

function providerLabel(providers) {
  const names = [...new Set(providers.filter(name => typeof name === 'string' && name))]
  return names.length ? names.join('+') : null
}

async function renderPdfPages(pdfPath, outputDirectory, dpi, env) {
  const prefix = path.join(outputDirectory, 'page')
  const executable = resolvePopplerExecutable('pdftoppm', { env })
  await runProcess(executable, buildRenderArgs({ pdfPath, outputPrefix: prefix, dpi }))
  const pages = fs.readdirSync(outputDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .map(name => ({ name, match: /^page-(\d+)\.jpg$/i.exec(name) }))
    .filter(entry => entry.match)
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]))
  if (pages.length === 0) throw codedError('RENDER_NO_PAGES')
  return {
    pageImageHashes: Object.fromEntries(pages.map(({ name, match }) => [String(Number(match[1])), imageSha256(path.join(outputDirectory, name))])),
    pageSizes: Object.fromEntries(pages.map(({ name, match }) => [String(Number(match[1])), jpegDimensions(path.join(outputDirectory, name))])),
  }
}

async function extractPdfTextPages(pdfPath, pageHashes, env) {
  const executable = resolvePopplerExecutable('pdftotext', { env })
  const text = await runTextProcess(executable, ['-layout', pdfPath, '-'])
  const extractedPages = text.replaceAll('\r\n', '\n').split('\f')
  const pages = sortedPageNumbers(pageHashes)
  return Object.fromEntries(pages.map((page, index) => [page, String(extractedPages[index] || '').trim()]))
}

async function cropVerifiedQuestions({ extraction, options, plan, pageSizes, assetsRoot, runCropCommand, validateCropOutput }) {
  const assets = []
  for (const question of extraction.questions) {
    const questionId = `${options.paperId}:q${question.questionNumber}`
    const manifest = buildCropManifest({
      paperId: options.paperId,
      questionId,
      sourcePdfPath: options.questionPdf,
      sourcePdfSha256: plan.immutableInputs.questionPdf.sha256,
      regions: [...question.regions, ...question.diagramRegions],
      pageSizes,
      outputRoot: assetsRoot,
    })
    const command = buildCropCommand(manifest)
    await runCropCommand(command, manifest)
    if (!fs.statSync(manifest.questionPdfPath, { throwIfNoEntry: false })?.isFile()) throw codedError('CROP_FAILED')
    await validateCropOutput(manifest.questionPdfPath, manifest)
    assets.push({
      questionId,
      questionNumber: question.questionNumber,
      questionPdfPath: manifest.questionPdfPath,
      questionPdfSha256: imageSha256(manifest.questionPdfPath),
      pages: [...new Set(manifest.crops.map(crop => crop.page))],
      regionCount: manifest.crops.length,
    })
  }
  return assets
}

async function runCropCommandWithBundledPython(command, manifest) {
  fs.mkdirSync(manifest.outputDirectory, { recursive: true })
  const bundledPython = bundledPythonPath()
  const useBundledPython = fs.statSync(bundledPython, { throwIfNoEntry: false })?.isFile()
  const executable = useBundledPython ? bundledPython : command.command
  const args = useBundledPython && command.args[0] === '-3.12' ? command.args.slice(1) : command.args
  await runProcess(executable, args)
}

async function validateCropOutputWithBundledPython(questionPdfPath, manifest) {
  const bundledPython = bundledPythonPath()
  const useBundledPython = fs.statSync(bundledPython, { throwIfNoEntry: false })?.isFile()
  const executable = useBundledPython ? bundledPython : (process.platform === 'win32' ? 'py' : 'python3')
  const args = useBundledPython
    ? ['-c', PDF_VALIDATION_PROGRAM, questionPdfPath, String(manifest.crops.length)]
    : (process.platform === 'win32'
      ? ['-3.12', '-c', PDF_VALIDATION_PROGRAM, questionPdfPath, String(manifest.crops.length)]
      : ['-c', PDF_VALIDATION_PROGRAM, questionPdfPath, String(manifest.crops.length)])
  try {
    await runProcess(executable, args)
  } catch {
    throw codedError('CROP_OUTPUT_INVALID')
  }
}

function bundledPythonPath() {
  return path.join(
    os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
    'dependencies', 'python', 'python.exe',
  )
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
    child.once('error', () => reject(codedError('RENDER_FAILED')))
    child.once('exit', code => code === 0 ? resolve() : reject(codedError('RENDER_FAILED')))
  })
}

function runTextProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let byteLength = 0
    let exceededLimit = false
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    child.stdout.on('data', (chunk) => {
      byteLength += chunk.length
      if (byteLength > MAX_PDF_TEXT_BYTES) {
        exceededLimit = true
        child.kill()
        return
      }
      chunks.push(chunk)
    })
    child.once('error', () => reject(codedError('PDF_TEXT_EXTRACTION_FAILED')))
    child.once('exit', (code) => {
      if (exceededLimit || code !== 0) {
        reject(codedError('PDF_TEXT_EXTRACTION_FAILED'))
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

function sortedPageNumbers(pageHashes) {
  return Object.keys(pageHashes || {})
    .map(Number)
    .filter(page => Number.isInteger(page) && page > 0)
    .sort((left, right) => left - right)
}

function sourceMetadata(plan, options) {
  return {
    board: 'CIE',
    paperId: options.paperId,
    specificationId: `cambridge-${options.subject}-current`,
    rightsStatus: 'unverified-restricted',
    accessPolicyId: 'personal-study-restricted-v1',
    questionPdfSha256: plan.immutableInputs.questionPdf.sha256,
    markSchemePdfSha256: plan.immutableInputs.markSchemePdf.sha256,
    questionPdfPath: options.questionPdf,
    markSchemePdfPath: options.markSchemePdf,
    renderDpi: options.renderDpi,
    pageImageHashes: {},
    pageSizes: {},
    markSchemePageHashes: {},
    markSchemePageSizes: {},
    controlledTags: controlledTagsForSubject(options.subject),
    controlledTopicCatalog: controlledTopicCatalogForSubject(options.subject),
  }
}

function controlledTagsForSubject(subject) {
  const syllabus = SUPPORTED_SYLLABUSES[subject]
  if (!syllabus) throw codedError('UNSUPPORTED_SUBJECT')
  const topics = syllabus.topics
  const topicIds = new Set(topics.map(topic => topic.id))
  return {
    primaryTopicIds: topicIds,
    secondaryTopicIds: new Set(topicIds),
    syllabusPointIds: new Set(syllabus.points.map(point => point.id)),
    // These legacy validator fields stay empty because the platform has no canonical registry yet.
    skillTagIds: new Set(),
    questionFormatIds: new Set(),
  }
}

function controlledTopicCatalogForSubject(subject) {
  const syllabus = SUPPORTED_SYLLABUSES[subject]
  if (!syllabus) throw codedError('UNSUPPORTED_SUBJECT')
  return syllabus.topics.map((topic) => ({
    id: topic.id,
    code: topic.code,
    name: topic.name,
    component: topic.component || null,
  }))
}

function buildExtractionInput(source, questionDirectory, markSchemeDirectory) {
  return [
    { role: 'system', content: [{ type: 'input_text', text: 'Extract every printed question from the question paper. Include questionStartPage, the page where each printed question heading begins. Use only the supplied tag IDs. Preserve question regions, part OCR, mathematical expressions, diagrams, and mark-scheme page evidence. Do not invent page hashes.' }] },
    { role: 'user', content: [
      { type: 'input_text', text: JSON.stringify({ source: serializableSource(source), instruction: 'Question-paper pages come first; mark-scheme pages follow.' }) },
      ...imageInputs(questionDirectory, 'question-paper', source.pageImageHashes),
      ...imageInputs(markSchemeDirectory, 'mark-scheme', source.markSchemePageHashes),
    ] },
  ]
}

function buildVerificationInput(source, extraction, questionDirectory, markSchemeDirectory) {
  const { controlledTags: _controlledTags, ...verificationSource } = serializableSource(source)
  return [
    { role: 'system', content: [{ type: 'input_text', text: 'Independently verify the extraction against the supplied pages. Return questionStarts for every printed question heading you can see, plus detailed question identity, questionStartPage (the page where each printed question heading begins), page span, parts, diagram count, and mark-scheme evidence. Do not repeat OCR or tags.' }] },
    { role: 'user', content: [
      { type: 'input_text', text: JSON.stringify({ source: verificationSource, instruction: 'Independently locate and verify each question directly from these pages.' }) },
      ...imageInputs(questionDirectory, 'question-paper', source.pageImageHashes),
      ...imageInputs(markSchemeDirectory, 'mark-scheme', source.markSchemePageHashes),
    ] },
  ]
}

function buildPageWindowedExtractionInput(source, questionDirectory, pageWindow, pageText) {
  return [
    { role: 'system', content: [{ type: 'input_text', text: 'Extract only questions whose printed question heading begins on an owned question-paper page. Always return questionStartPage as the page where that printed heading begins. Use the supplied question-paper images for regions, diagrams, OCR and mathematics. Use the page-addressed mark-scheme text for marks and evidence. The explicit no-extractable-text marker means that PDF page has no text layer; it is not a missing page. Do not emit a question that begins outside the owned pages, invent a page hash, or emit an incomplete question.' }] },
    { role: 'user', content: [
      { type: 'input_text', text: JSON.stringify({
        source: serializableSource(source),
        pageWindow,
        instruction: 'The owned pages are the only question starts to emit. Visible pages include trailing context for questions that continue. The page-addressed text covers the visible question-paper context and complete mark scheme for navigation and matching.',
      }) },
      { type: 'input_text', text: pageTextByPage('Question-paper', pageText.questionPaper, source.pageImageHashes, pageWindow.visibleQuestionPaperPages) },
      { type: 'input_text', text: pageTextByPage('Mark-scheme', pageText.markScheme, source.markSchemePageHashes) },
      ...imageInputs(questionDirectory, 'question-paper', source.pageImageHashes, pageWindow.visibleQuestionPaperPages),
    ] },
  ]
}

function buildPageWindowedVerificationInput(source, questionDirectory, pageWindow, pageText) {
  const { controlledTags: _controlledTags, ...verificationSource } = serializableSource(source)
  return [
    { role: 'system', content: [{ type: 'input_text', text: 'Independently verify the window. Return questionStarts for every printed question heading visible in the supplied pages, including trailing context, with questionStartPage. For detailed questions, only return questions whose printed heading begins on an owned page; always include questionStartPage. Use the supplied question-paper images and page-addressed mark-scheme text. The explicit no-extractable-text marker means that PDF page has no text layer; it is not a missing page. Return complete visible page spans, parts, diagram counts and mark-scheme evidence for detailed questions. Do not invent a heading or emit a detailed question outside the owned pages.' }] },
    { role: 'user', content: [
      { type: 'input_text', text: JSON.stringify({
        source: verificationSource,
        pageWindow,
        instruction: 'The owned pages are the only question starts to return. Visible pages include trailing context. Page-addressed text covers the visible question-paper context and complete mark scheme for navigation and matching.',
      }) },
      { type: 'input_text', text: pageTextByPage('Question-paper', pageText.questionPaper, source.pageImageHashes, pageWindow.visibleQuestionPaperPages) },
      { type: 'input_text', text: pageTextByPage('Mark-scheme', pageText.markScheme, source.markSchemePageHashes) },
      ...imageInputs(questionDirectory, 'question-paper', source.pageImageHashes, pageWindow.visibleQuestionPaperPages),
    ] },
  ]
}

function pageTextByPage(label, textByPage, pageHashes, selectedPages = null) {
  const availablePages = sortedPageNumbers(pageHashes)
  const pages = selectedPages === null
    ? availablePages
    : selectedPages.filter((page) => availablePages.includes(page))
  if (selectedPages !== null && pages.length !== selectedPages.length) throw codedError('PAGE_WINDOW_SOURCE_PAGES_INVALID')
  const entries = pages.map((page) => {
    const text = typeof textByPage?.[page] === 'string' ? textByPage[page].trim() : ''
    if (!text) throw codedError('PDF_TEXT_EXTRACTION_FAILED')
    return `${label} page ${page}; sha256:${pageHashes[page]}\n${text}`
  })
  return `${label} text by page:\n${entries.join('\n\n')}`
}

function imageInputs(directory, label, pageHashes, selectedPages = null) {
  const availablePages = sortedPageNumbers(pageHashes)
  const pages = selectedPages === null
    ? availablePages
    : selectedPages.filter((page) => availablePages.includes(page))
  if (selectedPages !== null && pages.length !== selectedPages.length) throw codedError('PAGE_WINDOW_SOURCE_PAGES_INVALID')
  return pages.flatMap((page) => {
    const imagePath = renderedPageImagePath(directory, page)
    return [
      { type: 'input_text', text: `${label} page ${page}; sha256:${pageHashes[page]}` },
      { type: 'input_image', image_url: `data:image/jpeg;base64,${fs.readFileSync(imagePath).toString('base64')}` },
    ]
  })
}

function renderedPageImagePath(directory, page) {
  const exactPath = path.join(directory, `page-${page}.jpg`)
  if (fs.statSync(exactPath, { throwIfNoEntry: false })?.isFile()) return exactPath
  const match = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .find(name => {
      const parsed = /^page-(\d+)\.jpg$/i.exec(name)
      return parsed && Number(parsed[1]) === page
    })
  if (!match) throw codedError('RENDER_PAGE_IMAGE_MISSING')
  return path.join(directory, match)
}

async function writeQuarantine({ plan, source, writeArtifact, reasonCodes }) {
  return writeArtifact(plan.outputArtifactPath, {
    schemaVersion: AI_PDF_INGESTION_SCHEMA_VERSION,
    artifactId: plan.artifactId,
    paperId: plan.paperId,
    subject: plan.subject,
    status: 'auto-quarantined',
    source: serializableSource(source),
    model: plan.model,
    reasonCodes: [...new Set(reasonCodes)].sort(),
  })
}

function artifactForResult(plan, source, options, validation, extraction, verification, assets, { extractorProvider = null, verifierProvider = null } = {}) {
  return {
    schemaVersion: AI_PDF_INGESTION_SCHEMA_VERSION,
    artifactId: plan.artifactId,
    paperId: plan.paperId,
    subject: options.subject,
    generatedAt: new Date().toISOString(),
    status: validation.status,
    storageMode: options.coordinateOnly ? 'coordinate-only' : 'cropped-question-pdfs',
    ingestionStrategy: options.pageWindowed
      ? {
        id: 'page-windowed-v1',
        ownedQuestionPaperPageCount: PAGE_WINDOW_OWNED_PAGE_COUNT,
        trailingQuestionPaperContextPageCount: PAGE_WINDOW_TRAILING_CONTEXT_PAGE_COUNT,
        markSchemeEvidenceMode: 'page-addressed-pdf-text',
        ownershipReconciliation: 'boundary-recovery-v1',
      }
      : { id: 'whole-paper-v1' },
    source: serializableSource(source),
    extractor: { provider: extractorProvider || 'openai', model: options.model, schemaName: 'ai_pdf_question_extraction_v1' },
    verifier: { provider: verifierProvider || 'openai', model: options.model, schemaName: 'ai_pdf_question_verification_v1' },
    reasonCodes: validation.reasonCodes.sort(),
    assets,
    candidate: extraction,
    verification,
  }
}

function normalizeRenderResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || !result.pageImageHashes || !result.pageSizes) throw codedError('RENDER_FAILED')
  return result
}

function assetsRootFor(outputArtifactPath, id) {
  const root = path.dirname(path.resolve(outputArtifactPath))
  const target = path.resolve(root, `${safeArtifactFilename(id)}.assets`)
  assertPathWithinRoot(root, target)
  return target
}

function jpegDimensions(filePath) {
  const bytes = fs.readFileSync(filePath)
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw codedError('RENDER_PAGE_DIMENSIONS_INVALID')
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) break
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      if (width > 0 && height > 0) return { width, height }
      break
    }
    offset += length
  }
  throw codedError('RENDER_PAGE_DIMENSIONS_INVALID')
}

function writeArtifactSafely(outputPath, artifact) {
  const absoluteOutputPath = path.resolve(outputPath)
  const outputRoot = path.resolve(path.dirname(path.dirname(absoluteOutputPath)))
  assertPathWithinRoot(outputRoot, absoluteOutputPath)
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true })
  const existing = fs.lstatSync(absoluteOutputPath, { throwIfNoEntry: false })
  if (existing?.isSymbolicLink()) throw codedError('ARTIFACT_PATH_INVALID')
  const temporaryPath = path.join(path.dirname(absoluteOutputPath), `.${path.basename(absoluteOutputPath)}.${process.pid}.tmp`)
  fs.writeFileSync(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
  fs.renameSync(temporaryPath, absoluteOutputPath)
  return artifact
}

function readExistingArtifact(outputPath) {
  const existing = fs.statSync(outputPath, { throwIfNoEntry: false })
  if (!existing?.isFile()) return null
  try {
    const artifact = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    return artifact?.status === 'ai-verified' || artifact?.status === 'auto-quarantined' ? artifact : null
  } catch {
    return null
  }
}

function verifiedArtifactAssetsFresh(artifact, artifactPath) {
  const assets = Array.isArray(artifact?.assets) ? artifact.assets : []
  if (!assets.length) return false
  const artifactRoot = path.dirname(path.resolve(artifactPath))
  const assetRoot = path.resolve(artifactRoot, `${safeArtifactFilename(artifact.artifactId)}.assets`)
  const seen = new Set()
  return assets.every((asset) => {
    const recordedPath = typeof asset?.questionPdfPath === 'string' ? path.resolve(asset.questionPdfPath) : ''
    const relative = recordedPath ? path.relative(assetRoot, recordedPath) : '..'
    if (!recordedPath || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`) || seen.has(recordedPath)) return false
    seen.add(recordedPath)
    const stat = fs.statSync(recordedPath, { throwIfNoEntry: false })
    if (!stat?.isFile() || stat.size <= 0) return false
    const bytes = fs.readFileSync(recordedPath)
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return false
    const expectedHash = normalizeSha256(asset.questionPdfSha256)
    return expectedHash && createHash('sha256').update(bytes).digest('hex') === expectedHash
  })
}

function coordinateOnlyArtifactSourcesFresh(artifact) {
  const source = artifact?.source || {}
  const questionPath = typeof source.questionPdfPath === 'string' ? source.questionPdfPath : ''
  const markSchemePath = typeof source.markSchemePdfPath === 'string' ? source.markSchemePdfPath : ''
  const questionHash = normalizeSha256(source.questionPdfSha256)
  const markSchemeHash = normalizeSha256(source.markSchemePdfSha256)
  return Boolean(
    questionPath
    && markSchemePath
    && questionHash
    && markSchemeHash
    && fs.statSync(questionPath, { throwIfNoEntry: false })?.isFile()
    && fs.statSync(markSchemePath, { throwIfNoEntry: false })?.isFile()
    && fileSha256(questionPath) === questionHash
    && fileSha256(markSchemePath) === markSchemeHash,
  )
}

function serializableSource(source) {
  return { ...source, controlledTags: Object.fromEntries(Object.entries(source.controlledTags).map(([name, values]) => [name, [...values].sort()])) }
}

function artifactPath(outputRoot, paperId, id) {
  const root = path.resolve(outputRoot)
  const target = path.resolve(root, paperId, `${safeArtifactFilename(id)}.json`)
  assertPathWithinRoot(root, target)
  return target
}

function safeArtifactFilename(id) {
  return typeof id === 'string' && id.startsWith('sha256:') ? id.slice('sha256:'.length) : id
}

function supportedSubject(subject) {
  return Boolean(SUPPORTED_SYLLABUSES[subject])
}

function normalizeExtractionForValidation(extraction, verification) {
  if (!extraction || typeof extraction !== 'object' || !Array.isArray(extraction.questions)) return extraction
  const verificationEvidenceByQuestion = new Map((verification?.questions || [])
    .filter(question => typeof question?.questionNumber === 'string')
    .map(question => [question.questionNumber, Array.isArray(question.markSchemeEvidence) ? question.markSchemeEvidence : []]))
  return {
    ...extraction,
    questions: extraction.questions.map(question => ({
      ...question,
      parts: normalizeSingleAnswerParts(question.parts),
      markSchemeEvidence: Array.isArray(question.markSchemeEvidence) && question.markSchemeEvidence.length
        ? question.markSchemeEvidence
        : verificationEvidenceByQuestion.get(question.questionNumber) || question.markSchemeEvidence,
      tags: {
        ...question.tags,
        skillTagIds: [],
        questionFormatIds: [],
      },
    })),
  }
}

function assertPageWindowAgreement(extraction, verification) {
  const extractionQuestions = Array.isArray(extraction?.questions) ? extraction.questions : []
  const verificationByQuestion = new Map((Array.isArray(verification?.questions) ? verification.questions : [])
    .map(question => [question?.questionNumber, question]))
  for (const question of extractionQuestions) {
    const verified = verificationByQuestion.get(question?.questionNumber)
    if (!verified || verified.questionStartPage !== question.questionStartPage) {
      throw codedError('PAGE_WINDOW_START_PAGE_DISAGREEMENT')
    }
  }
}

function normalizeVerificationForValidation(verification) {
  if (!verification || typeof verification !== 'object' || !Array.isArray(verification.questions)) return verification
  return {
    ...verification,
    questions: verification.questions.map(question => ({
      ...question,
      parts: normalizeSingleAnswerParts(question.parts),
    })),
  }
}

function normalizeSingleAnswerParts(parts) {
  if (!Array.isArray(parts)) return parts
  if (parts.length !== 1) return parts
  const [part] = parts
  if (!part || typeof part !== 'object' || Array.isArray(part)) return parts
  if (typeof part.label === 'string' && part.label.trim()) return parts
  return [{ ...part, label: 'answer' }]
}

function assertPathWithinRoot(root, target) {
  const relative = path.relative(root, target)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new RangeError('Output artifact path must remain below --output-root.')
}

function fileSha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function normalizeSha256(value) {
  const match = typeof value === 'string' ? /^(?:sha256:)?([a-fA-F0-9]{64})$/.exec(value) : null
  return match ? match[1].toLowerCase() : null
}

function resolveExistingFile(value, name, cwd) {
  const absolutePath = path.resolve(cwd, value)
  if (!fs.statSync(absolutePath, { throwIfNoEntry: false })?.isFile()) throw new RangeError(`${name} must reference an existing file.`)
  return absolutePath
}

function positiveInteger(value, name) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new RangeError(`${name} must be a positive integer.`)
  return parsed
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function withDeadline(promise, deadlineAt) {
  if (!Number.isFinite(deadlineAt)) return promise
  const remainingMs = Math.floor(deadlineAt - Date.now())
  if (remainingMs < 1) return Promise.reject(codedError('AI_PAPER_TIMEOUT'))
  let timer
  const deadlinePromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(codedError('AI_PAPER_TIMEOUT')), remainingMs)
  })
  return Promise.race([promise, deadlinePromise]).finally(() => clearTimeout(timer))
}

function safeFailureCode(error) {
  return typeof error?.code === 'string' && /^([A-Z][A-Z0-9_]{2,})$/.test(error.code) ? error.code : 'INGESTION_FAILED'
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function regionSchema() {
  return {
    type: 'object', additionalProperties: false,
    required: ['page', 'pageImageSha256', 'x0', 'y0', 'x1', 'y1'], properties: {
      page: { type: 'integer', minimum: 1 }, pageImageSha256: { type: 'string' },
      x0: { type: 'number', minimum: 0, maximum: 1 }, y0: { type: 'number', minimum: 0, maximum: 1 },
      x1: { type: 'number', minimum: 0, maximum: 1 }, y1: { type: 'number', minimum: 0, maximum: 1 },
    },
  }
}

function questionStartSchema() {
  return {
    type: 'object', additionalProperties: false,
    required: ['questionNumber', 'questionStartPage'],
    properties: {
      questionNumber: { type: 'string' },
      questionStartPage: { type: 'integer', minimum: 1 },
    },
  }
}

function markSchemeEvidenceSchema() {
  return { type: 'object', additionalProperties: false, required: ['page', 'pageImageSha256'], properties: { page: { type: 'integer', minimum: 1 }, pageImageSha256: { type: 'string' } } }
}

function extractionSchemaFor(controlledTags) {
  const schema = structuredClone(extractorSchema)
  schema.properties.questions.items.properties.tags = tagSchema(controlledTags)
  return schema
}

function tagSchema(controlledTags = null) {
  const allowed = (field) => controlledTags instanceof Object && controlledTags[field] instanceof Set
    ? [...controlledTags[field]].sort()
    : null
  const stringSchema = (field) => allowed(field) ? { type: 'string', enum: allowed(field) } : { type: 'string' }
  return {
    type: 'object', additionalProperties: false,
    required: ['primaryTopicId', 'secondaryTopicIds', 'syllabusPointIds'], properties: {
      primaryTopicId: stringSchema('primaryTopicIds'), secondaryTopicIds: { type: 'array', items: stringSchema('secondaryTopicIds') },
      syllabusPointIds: { type: 'array', items: stringSchema('syllabusPointIds') },
    },
  }
}

async function main() {
  try {
    const cwd = process.cwd()
    const env = mergeRuntimeEnv({ cwd, env: process.env })
    const options = parseArgs(process.argv.slice(2), { cwd, env })
    const result = await runCli(options, { cwd, env })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = result.status === 'auto-quarantined' ? 2 : 0
  } catch (error) {
    process.stderr.write(`${safeFailureCode(error)}\n`)
    process.exitCode = 1
  }
}

function isDirectExecution() {
  if (!process.argv[1]) return false
  const modulePath = fileURLToPath(import.meta.url)
  try {
    return fs.realpathSync(modulePath) === fs.realpathSync(path.resolve(process.argv[1]))
  } catch {
    return path.resolve(process.argv[1]) === modulePath
  }
}

if (isDirectExecution()) {
  await main()
}
