import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import { AI_PDF_INGESTION_SCHEMA_VERSION, artifactId } from './ai-pdf-ingestion/contract.mjs'
import { callOpenAiStructured } from './ai-pdf-ingestion/openai-structured.mjs'
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
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const PDF_VALIDATION_PROGRAM = 'from pypdf import PdfReader; import sys; reader = PdfReader(sys.argv[1]); expected = int(sys.argv[2]); assert expected > 0 and len(reader.pages) == expected'

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
        required: ['questionNumber', 'regions', 'diagramRegions', 'parts', 'tags', 'markSchemeEvidence'], properties: {
          questionNumber: { type: 'string' },
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
  type: 'object', additionalProperties: false, required: ['questions'], properties: {
    questions: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['questionNumber', 'pages', 'parts', 'diagramRegionCount', 'markSchemeEvidence'], properties: {
          questionNumber: { type: 'string' },
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
  const values = {}
  const flags = new Set(['--dry-run', '--retry'])
  const options = new Set([
    '--paper-id', '--question-pdf', '--mark-scheme-pdf', '--subject', '--output-root', '--model', '--base-url', '--render-dpi', '--max-attempts',
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (flags.has(argument)) {
      const flagName = argument === '--dry-run' ? 'dryRun' : 'retry'
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
  const outputRoot = path.resolve(cwd, values['--output-root'] ?? env.AI_PDF_INGESTION_ROOT ?? DEFAULT_OUTPUT_ROOT)

  return Object.freeze({
    paperId: values['--paper-id'],
    questionPdf: resolveExistingFile(values['--question-pdf'], '--question-pdf', cwd),
    markSchemePdf: resolveExistingFile(values['--mark-scheme-pdf'], '--mark-scheme-pdf', cwd),
    subject: values['--subject'],
    outputRoot,
    model: nonemptyString(values['--model'] ?? env.AI_PDF_INGESTION_MODEL) ?? 'gpt-5.6',
    baseUrl: nonemptyString(values['--base-url'] ?? env.OPENAI_BASE_URL),
    dryRun: values.dryRun === true,
    retry: values.retry === true,
    renderDpi,
    maxAttempts,
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
    retry: options.retry,
    artifactId: id,
    immutableInputs: {
      questionPdf: { path: options.questionPdf, sha256: questionPdfSha256 },
      markSchemePdf: { path: options.markSchemePdf, sha256: markSchemePdfSha256 },
    },
    outputArtifactPath,
  })
}

export async function runCli(options, {
  env = process.env,
  callStructured = callOpenAiStructured,
  renderPdf = renderPdfPages,
  runCropCommand = runCropCommandWithBundledPython,
  validateCropOutput = validateCropOutputWithBundledPython,
  writeArtifact = writeArtifactSafely,
} = {}) {
  const plan = buildDryRunPlan(options)
  if (options.dryRun) return plan

  const priorArtifact = readExistingArtifact(plan.outputArtifactPath)
  if (priorArtifact?.status === 'auto-quarantined' && !options.retry) return priorArtifact
  if (priorArtifact?.status === 'ai-verified') {
    if (verifiedArtifactAssetsFresh(priorArtifact, plan.outputArtifactPath)) return priorArtifact
    if (!options.retry) {
      return writeArtifact(plan.outputArtifactPath, {
        schemaVersion: AI_PDF_INGESTION_SCHEMA_VERSION,
        artifactId: plan.artifactId,
        paperId: plan.paperId,
        subject: plan.subject,
        status: 'auto-quarantined',
        source: priorArtifact.source || sourceMetadata(plan, options),
        model: plan.model,
        reasonCodes: ['EXISTING_ARTIFACT_ASSET_MISSING'],
      })
    }
  }
  if (priorArtifact && options.retry) {
    fs.rmSync(assetsRootFor(plan.outputArtifactPath, plan.artifactId), { recursive: true, force: true })
  }

  const source = sourceMetadata(plan, options)
  let temporaryDirectory
  let createdAssetsRoot = null
  try {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pdf-ingestion-'))
    const questionRenderDirectory = path.join(temporaryDirectory, 'question-paper')
    const markSchemeRenderDirectory = path.join(temporaryDirectory, 'mark-scheme')
    fs.mkdirSync(questionRenderDirectory)
    fs.mkdirSync(markSchemeRenderDirectory)
    const questionRender = normalizeRenderResult(await renderPdf(options.questionPdf, questionRenderDirectory, options.renderDpi, env))
    const markSchemeRender = normalizeRenderResult(await renderPdf(options.markSchemePdf, markSchemeRenderDirectory, options.renderDpi, env))
    source.pageImageHashes = questionRender.pageImageHashes
    source.markSchemePageHashes = markSchemeRender.pageImageHashes

    const apiKey = env.OPENAI_API_KEY
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return await writeQuarantine({ plan, source, writeArtifact, reasonCodes: ['OPENAI_CONFIGURATION_INVALID'] })
    }

    const extraction = await callStructured({
      apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
      schemaName: 'ai_pdf_question_extraction_v1',
      schema: extractionSchemaFor(source.controlledTags),
      input: buildExtractionInput(source, questionRenderDirectory, markSchemeRenderDirectory),
      maxAttempts: options.maxAttempts,
    })
    const verification = await callStructured({
      apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
      schemaName: 'ai_pdf_question_verification_v1',
      schema: verifierSchema,
      input: buildVerificationInput(source, extraction, questionRenderDirectory, markSchemeRenderDirectory),
      maxAttempts: options.maxAttempts,
    })
    const validationCandidate = normalizeExtractionForValidation(extraction)
    const validation = validateCandidate({ candidate: validationCandidate, verification, source })
    let assets = []
    if (validation.status === 'ai-verified') {
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
    return writeArtifact(plan.outputArtifactPath, artifactForResult(plan, source, options, validation, validationCandidate, verification, assets))
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
    pageImageHashes: Object.fromEntries(pages.map(({ name, match }) => [match[1], imageSha256(path.join(outputDirectory, name))])),
    pageSizes: Object.fromEntries(pages.map(({ name, match }) => [match[1], jpegDimensions(path.join(outputDirectory, name))])),
  }
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
  const executable = useBundledPython ? bundledPython : 'py'
  const args = useBundledPython
    ? ['-c', PDF_VALIDATION_PROGRAM, questionPdfPath, String(manifest.crops.length)]
    : ['-3.12', '-c', PDF_VALIDATION_PROGRAM, questionPdfPath, String(manifest.crops.length)]
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

function sourceMetadata(plan, options) {
  return {
    board: 'CIE',
    paperId: options.paperId,
    specificationId: `cambridge-${options.subject}-current`,
    rightsStatus: 'unverified-restricted',
    accessPolicyId: 'personal-study-restricted-v1',
    questionPdfSha256: plan.immutableInputs.questionPdf.sha256,
    markSchemePdfSha256: plan.immutableInputs.markSchemePdf.sha256,
    pageImageHashes: {},
    markSchemePageHashes: {},
    controlledTags: controlledTagsForSubject(options.subject),
  }
}

function controlledTagsForSubject(subject) {
  if (subject !== '9702') throw codedError('UNSUPPORTED_SUBJECT')
  const topics = CAMBRIDGE_9702_AS_SYLLABUS.topics
  const topicIds = new Set(topics.map(topic => topic.id))
  return {
    primaryTopicIds: topicIds,
    secondaryTopicIds: new Set(topicIds),
    syllabusPointIds: new Set(CAMBRIDGE_9702_AS_SYLLABUS.points.map(point => point.id)),
    // These legacy validator fields stay empty because the platform has no canonical registry yet.
    skillTagIds: new Set(),
    questionFormatIds: new Set(),
  }
}

function buildExtractionInput(source, questionDirectory, markSchemeDirectory) {
  return [
    { role: 'system', content: [{ type: 'input_text', text: 'Extract every printed question from the question paper. Use only the supplied tag IDs. Preserve question regions, part OCR, mathematical expressions, diagrams, and mark-scheme page evidence. Do not invent page hashes.' }] },
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
    { role: 'system', content: [{ type: 'input_text', text: 'Independently verify the extraction against the supplied pages. Return only question identity, page span, parts, diagram count, and mark-scheme evidence. Do not repeat OCR or tags.' }] },
    { role: 'user', content: [
      { type: 'input_text', text: JSON.stringify({ source: verificationSource, instruction: 'Independently locate and verify each question directly from these pages.' }) },
      ...imageInputs(questionDirectory, 'question-paper', source.pageImageHashes),
      ...imageInputs(markSchemeDirectory, 'mark-scheme', source.markSchemePageHashes),
    ] },
  ]
}

function imageInputs(directory, label, pageHashes) {
  return Object.keys(pageHashes).map(Number).sort((left, right) => left - right).flatMap((page) => {
    const imagePath = path.join(directory, `page-${page}.jpg`)
    return [
      { type: 'input_text', text: `${label} page ${page}; sha256:${pageHashes[page]}` },
      { type: 'input_image', image_url: `data:image/jpeg;base64,${fs.readFileSync(imagePath).toString('base64')}` },
    ]
  })
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

function artifactForResult(plan, source, options, validation, extraction, verification, assets) {
  return {
    schemaVersion: AI_PDF_INGESTION_SCHEMA_VERSION,
    artifactId: plan.artifactId,
    paperId: plan.paperId,
    subject: options.subject,
    generatedAt: new Date().toISOString(),
    status: validation.status,
    source: serializableSource(source),
    extractor: { provider: 'openai', model: options.model, schemaName: 'ai_pdf_question_extraction_v1' },
    verifier: { provider: 'openai', model: options.model, schemaName: 'ai_pdf_question_verification_v1' },
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
  return subject === '9702'
}

function normalizeExtractionForValidation(extraction) {
  if (!extraction || typeof extraction !== 'object' || !Array.isArray(extraction.questions)) return extraction
  return {
    ...extraction,
    questions: extraction.questions.map(question => ({
      ...question,
      tags: {
        ...question.tags,
        skillTagIds: [],
        questionFormatIds: [],
      },
    })),
  }
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
    const options = parseArgs(process.argv.slice(2))
    const result = await runCli(options)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = result.status === 'auto-quarantined' ? 2 : 0
  } catch (error) {
    process.stderr.write(`${safeFailureCode(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
