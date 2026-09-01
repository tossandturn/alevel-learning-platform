import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  buildDryRunPlan,
  extractPdfTextPages,
  markSchemeEvidenceByQuestionFromText,
  mergePageWindowExtractions,
  mergePageWindowVerifications,
  parseArgs,
  runCli,
} from './ingest-ai-pdf-questions.mjs'
import { listAiPdfIngestionCandidates } from '../server/aiPdfIngestionCandidates.js'

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'ai-pdf-ingestion-cli-'))
const fakeApiKey = 'fake-openai-key-must-never-appear'

try {
  const questionPdf = path.join(temporaryRoot, 'question.pdf')
  const markSchemePdf = path.join(temporaryRoot, 'mark-scheme.pdf')
  const outputRoot = path.join(temporaryRoot, 'artifacts')
  writeFileSync(questionPdf, Buffer.from('%PDF-question-fixture', 'utf8'))
  writeFileSync(markSchemePdf, Buffer.from('%PDF-mark-scheme-fixture', 'utf8'))

  const mergeSource = { questionPdfSha256: 'a'.repeat(64), markSchemePdfSha256: 'b'.repeat(64) }
  const deterministicMarkSchemeEvidence = markSchemeEvidenceByQuestionFromText({
    8: 'Question Answer Marks\n1(a) first point',
    9: 'Question Answer Marks\n1(b) continuation\n2(a)(i) next question',
    10: 'Question Answer Marks\n2(b) continuation',
  }, {
    8: '8'.repeat(64),
    9: '9'.repeat(64),
    10: 'a'.repeat(64),
  })
  assert.deepEqual(deterministicMarkSchemeEvidence, {
    1: [{ page: 8, pageImageSha256: '8'.repeat(64) }, { page: 9, pageImageSha256: '9'.repeat(64) }],
    2: [{ page: 9, pageImageSha256: '9'.repeat(64) }, { page: 10, pageImageSha256: 'a'.repeat(64) }],
  })
  const extractionQuestion = (questionNumber, questionStartPage) => ({ questionNumber, questionStartPage })
  const verificationQuestion = (questionNumber, questionStartPage) => ({ questionNumber, questionStartPage })

  assert.throws(
    () => mergePageWindowExtractions([
      { extraction: { source: mergeSource, questions: [extractionQuestion('1', 1), extractionQuestion('1', 1)] } },
    ]),
    /PAGE_WINDOW_QUESTION_DUPLICATE/,
  )
  const extractionFragment = ({ page, parts, primaryTopicId = 'physics-9702-topic-17', evidencePage }) => ({
    questionNumber: '4',
    questionStartPage: 10,
    regions: [{ page, pageImageSha256: 'c'.repeat(64), x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
    diagramRegions: [{ page, pageImageSha256: 'd'.repeat(64), x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }],
    parts: parts.map(({ label, marks }) => ({ label, marks, ocrText: label, math: [], diagramAssociations: [0] })),
    tags: { primaryTopicId, secondaryTopicIds: [], syllabusPointIds: [] },
    markSchemeEvidence: [{ page: evidencePage, pageImageSha256: 'e'.repeat(64) }],
  })
  const mergedFragments = mergePageWindowExtractions([{
    extraction: {
      source: mergeSource,
      questions: [
        extractionFragment({ page: 10, parts: [{ label: 'a', marks: 1 }, { label: 'b(i)', marks: 2 }], evidencePage: 4 }),
        extractionFragment({ page: 11, parts: [{ label: 'b(ii)', marks: 3 }], evidencePage: 5 }),
      ],
    },
    verification: {
      questions: [{
        questionNumber: '4', questionStartPage: 10, pages: [10, 11],
        parts: [{ label: 'a', marks: 1 }, { label: 'b(i)', marks: 2 }, { label: 'b(ii)', marks: 3 }],
        diagramRegionCount: 2,
        markSchemeEvidence: [
          { page: 4, pageImageSha256: 'e'.repeat(64) },
          { page: 5, pageImageSha256: 'e'.repeat(64) },
        ],
      }],
    },
  }]).questions
  assert.equal(mergedFragments.length, 1, 'same-question page fragments must merge into one whole question')
  assert.deepEqual(mergedFragments[0].regions.map((region) => region.page), [10, 11])
  assert.deepEqual(mergedFragments[0].diagramRegions.map((region) => region.page), [10, 11])
  assert.deepEqual(mergedFragments[0].parts.map((part) => part.label), ['a', 'b(i)', 'b(ii)'])
  assert.deepEqual(mergedFragments[0].parts.map((part) => part.diagramAssociations), [[0], [0], [1]])
  assert.deepEqual(mergedFragments[0].markSchemeEvidence.map((evidence) => evidence.page), [4, 5])
  assert.throws(
    () => mergePageWindowExtractions([{
      extraction: {
        source: mergeSource,
        questions: [
          extractionFragment({ page: 10, parts: [{ label: 'a', marks: 1 }], evidencePage: 4 }),
          extractionFragment({ page: 11, parts: [{ label: 'b', marks: 3 }], primaryTopicId: 'physics-9702-topic-18', evidencePage: 5 }),
        ],
      },
      verification: {
        questions: [{
          questionNumber: '4', questionStartPage: 10, pages: [10, 11],
          parts: [{ label: 'a', marks: 1 }, { label: 'b', marks: 3 }],
          diagramRegionCount: 2,
          markSchemeEvidence: [],
        }],
      },
    }]),
    /PAGE_WINDOW_QUESTION_TAG_DISAGREEMENT/,
  )
  assert.deepEqual(
    mergePageWindowExtractions([
      { extraction: { source: mergeSource, questions: [extractionQuestion('1', 1)] } },
      { extraction: { source: mergeSource, questions: [extractionQuestion('1', 2), extractionQuestion('2', 5)] } },
    ]).questions.map((question) => ({ questionNumber: question.questionNumber, questionStartPage: question.questionStartPage })),
    [{ questionNumber: '1', questionStartPage: 1 }, { questionNumber: '2', questionStartPage: 5 }],
  )
  assert.throws(
    () => mergePageWindowExtractions([
      { extraction: { source: mergeSource, questions: [extractionQuestion('2', 5)] } },
      { extraction: { source: mergeSource, questions: [extractionQuestion('2', 4)] } },
    ]),
    /PAGE_WINDOW_QUESTION_START_REGRESSION/,
  )

  assert.throws(
    () => mergePageWindowVerifications([
      { verification: { questionStarts: [{ questionNumber: '1', questionStartPage: 1 }, { questionNumber: '1', questionStartPage: 1 }], questions: [] } },
    ]),
    /PAGE_WINDOW_QUESTION_START_DUPLICATE/,
  )
  assert.deepEqual(
    mergePageWindowVerifications([
      { verification: { questionStarts: [{ questionNumber: '1', questionStartPage: 1 }], questions: [verificationQuestion('1', 1)] } },
      { verification: { questionStarts: [{ questionNumber: '1', questionStartPage: 2 }, { questionNumber: '2', questionStartPage: 5 }], questions: [verificationQuestion('1', 2), verificationQuestion('2', 5)] } },
    ]).questions.map((question) => ({ questionNumber: question.questionNumber, questionStartPage: question.questionStartPage })),
    [{ questionNumber: '1', questionStartPage: 1 }, { questionNumber: '2', questionStartPage: 5 }],
  )
  assert.throws(
    () => mergePageWindowVerifications([
      { verification: { questionStarts: [], questions: [verificationQuestion('1', 1), verificationQuestion('1', 1)] } },
    ]),
    /PAGE_WINDOW_VERIFICATION_DUPLICATE/,
  )
  assert.throws(
    () => mergePageWindowVerifications([
      { verification: { questionStarts: [{ questionNumber: '2', questionStartPage: 5 }], questions: [verificationQuestion('2', 5)] } },
      { verification: { questionStarts: [{ questionNumber: '2', questionStartPage: 4 }], questions: [verificationQuestion('2', 4)] } },
    ]),
    /PAGE_WINDOW_QUESTION_START_REGRESSION/,
  )

  assert.throws(
    () => parseArgs(['--paper-id', 'cie-9702-9702_m25_qp_22'], { cwd: temporaryRoot }),
    /--question-pdf is required/,
  )
  assert.throws(
    () => parseArgs([
      '--paper-id', 'cie-9702-9702_m25_qp_22',
      '--question-pdf', questionPdf,
      '--mark-scheme-pdf', markSchemePdf,
      '--subject', '9702',
      '--render-dpi', '0',
    ], { cwd: temporaryRoot }),
    /--render-dpi must be a positive integer/,
  )
  assert.throws(
    () => parseArgs([
      '--paper-id', 'cie-9702-9702_m25_qp_22',
      '--question-pdf', questionPdf,
      '--mark-scheme-pdf', markSchemePdf,
      '--subject', '9702',
      '--unknown', 'value',
    ], { cwd: temporaryRoot }),
    /Unknown argument: --unknown/,
  )
  assert.throws(
    () => parseArgs([
      '--paper-id', 'unsupported-paper',
      '--question-pdf', questionPdf,
      '--mark-scheme-pdf', markSchemePdf,
      '--subject', '9999',
    ], { cwd: temporaryRoot }),
    /UNSUPPORTED_SUBJECT/,
  )

  const options = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
    '--output-root', outputRoot,
    '--base-url', 'https://ai.ieltsist.com/v1',
    '--dry-run',
  ], {
    cwd: temporaryRoot,
    env: { OPENAI_API_KEY: fakeApiKey },
  })

  assert.equal(options.model, 'gpt-5.6')
  assert.equal(options.baseUrl, 'https://ai.ieltsist.com/v1')
  assert.equal(options.renderDpi, 180)
  assert.equal(options.maxAttempts, 3)
  assert.equal(options.timeoutMs, 120000)
  assert.equal(options.paperTimeoutMs, 900000)
  assert.equal(options.dryRun, true)
  const mathOptions = parseArgs([
    '--paper-id', 'cie-9709-9709_m25_qp_52',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9709',
    '--output-root', outputRoot,
    '--dry-run',
  ], {
    cwd: temporaryRoot,
    env: { OPENAI_API_KEY: fakeApiKey },
  })
  assert.equal(mathOptions.subject, '9709')
  assert.equal(buildDryRunPlan(mathOptions).paperId, 'cie-9709-9709_m25_qp_52')
  assert.equal(parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
  ], {
    cwd: temporaryRoot,
    env: { AI_PDF_INGESTION_MODEL: '   ', OPENAI_API_KEY: fakeApiKey },
  }).model, 'gpt-5.6')
  const envTimeoutOptions = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
  ], {
    cwd: temporaryRoot,
    env: { OPENAI_BASE_URL: ' https://ai.ieltsist.com/ ', OPENAI_API_KEY: fakeApiKey, AI_PDF_INGESTION_TIMEOUT_MS: '90000' },
  })
  assert.equal(envTimeoutOptions.baseUrl, 'https://ai.ieltsist.com/')
  assert.equal(envTimeoutOptions.timeoutMs, 90000)

  const workerReleaseCwd = path.join(temporaryRoot, 'releases', '20260823-worker')
  const sharedWorkerEnvPath = path.join(temporaryRoot, 'shared', '.env')
  mkdirSync(path.dirname(sharedWorkerEnvPath), { recursive: true })
  writeFileSync(sharedWorkerEnvPath, [
    'OPENAI_API_KEY=worker-shared-openai-provider-value',
    'DASHSCOPE_API_KEY=worker-shared-qwen-provider-value',
    'AI_PDF_INGESTION_MODEL=gpt-5.6-shared-worker',
    'OPENAI_BASE_URL=https://ai.example.test/v1',
    'AI_PDF_INGESTION_TIMEOUT_MS=65000',
    '',
  ].join('\n'), 'utf8')
  const sharedWorkerOptions = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
    '--output-root', path.join(temporaryRoot, 'shared-worker-artifacts'),
    '--coordinate-only',
  ], { cwd: workerReleaseCwd, env: {} })
  assert.equal(sharedWorkerOptions.model, 'gpt-5.6-shared-worker')
  assert.equal(sharedWorkerOptions.baseUrl, 'https://ai.example.test/v1')
  assert.equal(sharedWorkerOptions.timeoutMs, 65000)
  assert.equal(parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
    '--timeout-ms', '180000',
  ], {
    cwd: temporaryRoot,
    env: { OPENAI_API_KEY: fakeApiKey, AI_PDF_INGESTION_TIMEOUT_MS: '90000' },
  }).timeoutMs, 180000)
  assert.throws(
    () => parseArgs([
      '--paper-id', 'cie-9702-9702_m25_qp_22',
      '--question-pdf', questionPdf,
      '--mark-scheme-pdf', markSchemePdf,
      '--subject', '9702',
      '--timeout-ms', '0',
    ], { cwd: temporaryRoot, env: { OPENAI_API_KEY: fakeApiKey } }),
    /--timeout-ms must be a positive integer/,
  )
  const retryOptions = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
    '--output-root', outputRoot,
    '--retry',
  ], { cwd: temporaryRoot, env: { OPENAI_API_KEY: fakeApiKey } })
  assert.equal(retryOptions.retry, true)

  const coordinateOnlyOptions = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
    '--output-root', outputRoot,
    '--coordinate-only',
  ], { cwd: temporaryRoot, env: { OPENAI_API_KEY: fakeApiKey } })
  assert.equal(coordinateOnlyOptions.coordinateOnly, true)

  const pageWindowedOptions = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
    '--output-root', outputRoot,
    '--coordinate-only',
    '--page-windowed',
  ], { cwd: temporaryRoot, env: { OPENAI_API_KEY: fakeApiKey } })
  assert.equal(pageWindowedOptions.pageWindowed, true)

  const compactPageWindowedOptions = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_22',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702',
    '--output-root', outputRoot,
    '--coordinate-only',
    '--page-windowed',
    '--page-window-owned-pages', '1',
    '--page-window-trailing-pages', '1',
  ], { cwd: temporaryRoot, env: { OPENAI_API_KEY: fakeApiKey } })
  assert.equal(compactPageWindowedOptions.pageWindowOwnedPages, 1)
  assert.equal(compactPageWindowedOptions.pageWindowTrailingPages, 1)
  assert.equal(buildDryRunPlan(compactPageWindowedOptions).pageWindowOwnedPages, 1)
  assert.equal(buildDryRunPlan(compactPageWindowedOptions).pageWindowTrailingPages, 1)
  assert.throws(
    () => parseArgs([
      '--paper-id', 'cie-9702-9702_m25_qp_22',
      '--question-pdf', questionPdf,
      '--mark-scheme-pdf', markSchemePdf,
      '--subject', '9702',
      '--page-window-owned-pages', '0',
    ], { cwd: temporaryRoot, env: { OPENAI_API_KEY: fakeApiKey } }),
    /--page-window-owned-pages must be between 1 and 8/,
  )

  const currentRelease = path.join(temporaryRoot, 'current')
  symlinkSync(path.resolve(import.meta.dirname, '..'), currentRelease, process.platform === 'win32' ? 'junction' : 'dir')
  const linkedCli = spawnSync(process.execPath, [
    path.join(currentRelease, 'scripts', 'ingest-ai-pdf-questions.mjs'),
    '--unknown', 'value',
  ], {
    cwd: currentRelease,
    encoding: 'utf8',
  })
  assert.equal(linkedCli.status, 1)
  assert.match(linkedCli.stderr, /^INGESTION_FAILED\s*$/)

  const plan = buildDryRunPlan(options)
  assert.equal(plan.mode, 'dry-run')
  assert.match(plan.artifactId, /^sha256:[a-f0-9]{64}$/)
  assert.equal(plan.immutableInputs.questionPdf.sha256, createHash('sha256').update(readFileSync(questionPdf)).digest('hex'))
  assert.equal(plan.immutableInputs.markSchemePdf.sha256, createHash('sha256').update(readFileSync(markSchemePdf)).digest('hex'))
  assert.equal(plan.outputArtifactPath, path.join(outputRoot, 'cie-9702-9702_m25_qp_22', `${plan.artifactId.slice('sha256:'.length)}.json`))
  assert.equal(path.basename(plan.outputArtifactPath).includes(':'), false)
  assert.equal(existsSync(outputRoot), false)
  assert.doesNotMatch(JSON.stringify(plan), new RegExp(fakeApiKey))

  const imageOnlyPages = await extractPdfTextPages(
    questionPdf,
    { 1: 'a'.repeat(64), 2: 'b'.repeat(64) },
    {},
    { runText: async () => { throw Object.assign(new Error('image-only PDF'), { code: 'PDF_TEXT_EXTRACTION_FAILED' }) } },
  )
  assert.deepEqual(
    imageOnlyPages,
    { 1: '[No extractable text on this page.]', 2: '[No extractable text on this page.]' },
    'a rendered scanned PDF must continue through vision OCR when its text layer is unavailable',
  )

  let dryRunCalls = 0
  const dryRunResult = await runCli(options, {
    renderPdf: async () => { dryRunCalls += 1 },
    callStructured: async () => { dryRunCalls += 1 },
    runCropCommand: async () => { dryRunCalls += 1 },
    writeArtifact: () => { dryRunCalls += 1 },
  })
  assert.equal(dryRunResult.mode, 'dry-run')
  assert.equal(dryRunCalls, 0)
  assert.equal(existsSync(outputRoot), false)

  const liveOptions = { ...options, dryRun: false }
  const pageHashes = { 1: 'c'.repeat(64), 2: 'd'.repeat(64) }
  const markSchemePageHashes = { 1: 'e'.repeat(64) }
  const extraction = validExtraction({ plan, pageHashes, markSchemePageHashes })
  const verification = validVerification(pageHashes, markSchemePageHashes)
  const cropCalls = []
  const cropValidationCalls = []
  const structuredInputs = []
  let structuredCalls = 0
  const verifiedResult = await runCli(liveOptions, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes, markSchemePageHashes }),
    callStructured: async input => {
      structuredInputs.push(input)
      return structuredCalls++ === 0 ? extraction : verification
    },
    runCropCommand: async (command, manifest) => {
      cropCalls.push({ command, manifest })
      mkdirSync(path.dirname(manifest.questionPdfPath), { recursive: true })
      writeFileSync(manifest.questionPdfPath, singlePagePdfFixture())
    },
    validateCropOutput: async (questionPdfPath, manifest) => {
      cropValidationCalls.push({ questionPdfPath, manifest })
      assert.equal(existsSync(questionPdfPath), true)
      assert.equal(manifest.crops.length, manifest.questionId.endsWith(':q1') ? 3 : 1)
    },
  })

  assert.equal(verifiedResult.status, 'ai-verified', JSON.stringify(verifiedResult))
  assert.equal(verifiedResult.source.questionPdfPath, questionPdf)
  assert.equal(verifiedResult.source.markSchemePdfPath, markSchemePdf)
  assert.equal(verifiedResult.source.questionPdfRelativePath, '9702/question.pdf')
  assert.equal(verifiedResult.source.markSchemePdfRelativePath, '9702/mark-scheme.pdf')
  assert.deepEqual(verifiedResult.source.pageSizes, { 1: { width: 1200, height: 1600 }, 2: { width: 1200, height: 1600 } })
  assert.deepEqual(verifiedResult.source.markSchemePageSizes, { 1: { width: 1200, height: 1600 } })
  assert.ok(verifiedResult.source.controlledTopicCatalog.some((topic) => topic.id === 'physics-9702-topic-01'))
  assert.equal(cropCalls.length, 2)
  assert.deepEqual(cropCalls.map(call => call.manifest.crops.length), [3, 1])
  assert.equal(cropValidationCalls.length, 2)
  assert.equal(cropCalls[0].manifest.crops[0].page, 1)
  assert.equal(cropCalls[0].manifest.crops[1].page, 1)
  assert.equal(cropCalls[0].manifest.crops[2].page, 2)
  assert.ok(cropCalls.every(call => call.command.args.includes('--region')))
  assert.equal(verifiedResult.assets.length, 2)
  assert.ok(verifiedResult.assets.every(asset => existsSync(asset.questionPdfPath)))
  const expectedAssetsRoot = path.join(outputRoot, 'cie-9702-9702_m25_qp_22', `${plan.artifactId.slice('sha256:'.length)}.assets`)
  assert.equal(path.basename(expectedAssetsRoot).includes(':'), false)
  assert.ok(verifiedResult.assets.every(asset => asset.questionPdfPath.startsWith(`${expectedAssetsRoot}${path.sep}`)))
  assert.ok(existsSync(plan.outputArtifactPath))
  assert.deepEqual(JSON.parse(readFileSync(plan.outputArtifactPath, 'utf8')).assets, verifiedResult.assets)
  assert.equal(structuredInputs.length, 2)
  assert.ok(structuredInputs.every((input) => Number.isInteger(input.timeoutMs) && input.timeoutMs > 0 && input.timeoutMs <= options.timeoutMs))
  assert.ok(structuredInputs.every((input) => Number.isFinite(input.deadlineAt)))
  const verifierUserText = structuredInputs[1].input[1].content[0].text
  assert.doesNotMatch(verifierUserText, /extraction|Part a|x0/)
  assert.match(verifierUserText, /controlledTopicCatalog/)
  assert.match(JSON.stringify(structuredInputs[1].schema), /primaryTopicId/)
  assert.doesNotMatch(JSON.stringify(structuredInputs[1].schema), /skillTagIds|questionFormatIds/)

  const coordinateOutputRoot = path.join(temporaryRoot, 'coordinate-artifacts')
  const coordinateOptions = { ...liveOptions, outputRoot: coordinateOutputRoot, coordinateOnly: true }
  const coordinatePlan = buildDryRunPlan(coordinateOptions)
  const coordinateLibraryRoot = path.join(temporaryRoot, 'coordinate-library')
  mkdirSync(path.join(coordinateLibraryRoot, '9702'), { recursive: true })
  writeFileSync(path.join(coordinateLibraryRoot, '9702', 'question.pdf'), readFileSync(questionPdf))
  writeFileSync(path.join(coordinateLibraryRoot, '9702', 'mark-scheme.pdf'), readFileSync(markSchemePdf))
  structuredCalls = 0
  const coordinateResult = await runCli(coordinateOptions, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes, markSchemePageHashes }),
    callStructured: async () => structuredCalls++ === 0 ? extraction : verification,
    runCropCommand: async () => { throw new Error('coordinate-only ingestion must not crop question PDFs') },
    validateCropOutput: async () => { throw new Error('coordinate-only ingestion must not validate cropped PDFs') },
  })
  assert.equal(coordinatePlan.coordinateOnly, true)
  assert.equal(coordinateResult.status, 'ai-verified', JSON.stringify(coordinateResult.reasonCodes))
  assert.equal(coordinateResult.storageMode, 'coordinate-only')
  assert.deepEqual(coordinateResult.assets, [])
  assert.equal(existsSync(path.join(path.dirname(coordinatePlan.outputArtifactPath), `${coordinatePlan.artifactId.slice('sha256:'.length)}.assets`)), false)

  const mismatchedMappingVerification = structuredClone(verification)
  for (const question of mismatchedMappingVerification.questions) question.tags.primaryTopicId = 'physics-9702-topic-02'
  let mismatchedMappingCalls = 0
  const mismatchedMappingResult = await runCli({ ...coordinateOptions, outputRoot: path.join(temporaryRoot, 'mapping-mismatch-artifacts') }, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes, markSchemePageHashes }),
    callStructured: async () => mismatchedMappingCalls++ === 0 ? extraction : mismatchedMappingVerification,
  })
  assert.equal(mismatchedMappingResult.status, 'auto-quarantined')
  assert.deepEqual(mismatchedMappingResult.reasonCodes, ['SYLLABUS_MAPPING_UNVERIFIED'])

  const fallbackOutputRoot = path.join(temporaryRoot, 'fallback-artifacts')
  const fallbackOptions = { ...liveOptions, outputRoot: fallbackOutputRoot, coordinateOnly: true }
  const fallbackProvider = { name: 'qwen', apiKey: 'qwen-test-key', model: 'qwen3-vl-plus', baseUrl: 'https://dashscope.example.test/v1' }
  const fallbackStages = []
  let fallbackStructuredCalls = 0
  const fallbackResult = await runCli(fallbackOptions, {
    env: { QWEN_VISION_API_KEY: fallbackProvider.apiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes, markSchemePageHashes }),
    providerChain: () => [fallbackProvider],
    callWithFallback: async ({ providers, request }) => {
      fallbackStages.push(request.schemaName)
      assert.equal(providers[0], fallbackProvider)
      return { provider: fallbackProvider, value: fallbackStructuredCalls++ === 0 ? extraction : verification }
    },
    runCropCommand: async () => { throw new Error('fallback coordinate-only ingestion must not crop question PDFs') },
    validateCropOutput: async () => { throw new Error('fallback coordinate-only ingestion must not validate cropped PDFs') },
  })
  assert.equal(fallbackResult.status, 'ai-verified', JSON.stringify(fallbackResult.reasonCodes))
  assert.equal(fallbackResult.extractor.provider, 'qwen')
  assert.equal(fallbackResult.extractor.model, 'qwen3-vl-plus')
  assert.equal(fallbackResult.verifier.provider, 'qwen')
  assert.equal(fallbackResult.verifier.model, 'qwen3-vl-plus')
  assert.deepEqual(fallbackStages, ['ai_pdf_question_extraction_v1', 'ai_pdf_question_verification_v1'])

  const windowedPageHashes = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1, `${index + 1}`.repeat(64)]))
  const windowedMarkSchemePageHashes = { 1: 'a'.repeat(64), 2: 'b'.repeat(64) }
  const windowedOutputRoot = path.join(temporaryRoot, 'windowed-artifacts')
  const windowedOptions = { ...liveOptions, outputRoot: windowedOutputRoot, coordinateOnly: true, pageWindowed: true }
  const windowedPlan = buildDryRunPlan(windowedOptions)
  const windowedQuestions = [
    { questionNumber: '1', page: 1, markSchemePage: 1 },
    { questionNumber: '2', page: 5, markSchemePage: 1 },
    { questionNumber: '3', page: 9, markSchemePage: 2 },
  ]
  const windowedRequests = []
  let windowedExtractionIndex = 0
  let windowedVerificationIndex = 0
  const windowedResult = await runCli(windowedOptions, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes }),
    extractPdfText: async (pdfPath, pageHashes) => Object.fromEntries(Object.keys(pageHashes).map((page) => [
      page,
      (pdfPath === questionPdf && page === '4') || (pdfPath === markSchemePdf && page === '2')
        ? ''
        : `text for page ${page}`,
    ])),
    callStructured: async request => {
      windowedRequests.push(request)
      if (request.schemaName === 'ai_pdf_question_extraction_v1') {
        const question = windowedQuestions[windowedExtractionIndex++]
        const response = windowedExtraction({ plan: windowedPlan, pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes, ...question })
        if (question.questionNumber === '1') {
          response.questions.push(windowedExtraction({ plan: windowedPlan, pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes, ...windowedQuestions[1] }).questions[0])
        }
        return response
      }
      const question = windowedQuestions[windowedVerificationIndex++]
      const response = windowedVerification({ pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes, ...question })
      if (question.questionNumber === '1') {
        response.questions.push(windowedVerification({ pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes, ...windowedQuestions[1] }).questions[0])
      }
      return response
    },
    runCropCommand: async () => { throw new Error('page-windowed coordinate-only ingestion must not crop question PDFs') },
    validateCropOutput: async () => { throw new Error('page-windowed coordinate-only ingestion must not validate cropped PDFs') },
  })
  assert.equal(windowedResult.status, 'ai-verified', JSON.stringify(windowedResult.reasonCodes))
  assert.equal(windowedResult.ingestionStrategy.id, 'page-windowed-v1')
  assert.deepEqual(windowedResult.candidate.questions.map(question => question.questionNumber), ['1', '2', '3'])
  assert.equal(windowedExtractionIndex, 3)
  assert.equal(windowedVerificationIndex, 3)
  assert.ok(windowedRequests.every((request) => {
    const content = request.input[1].content
    const imageCount = content.filter(item => item.type === 'input_image').length
    const questionPaperImageCount = content.filter((item, index) => item.type === 'input_image'
      && String(content[index - 1]?.text || '').startsWith('Question-paper page ')).length
    const markSchemeImageCount = content.filter((item, index) => item.type === 'input_image'
      && String(content[index - 1]?.text || '').startsWith('Mark-scheme page ')).length
    return imageCount <= 7 && questionPaperImageCount <= 5 && markSchemeImageCount <= 2
  }))
  assert.ok(windowedRequests.filter((request) => request.schemaName === 'ai_pdf_question_extraction_v1').every((request) => request.input[0].content[0].text.includes('at least one region for every page in its full page span')))
  assert.ok(windowedRequests.every((request) => request.input[1].content.some(item => item.type === 'input_text' && item.text.startsWith('Mark-scheme text by page:'))))
  assert.ok(windowedRequests.every((request) => request.input[1].content.filter(item => item.type === 'input_text' && item.text.startsWith('Question-paper text by page:')).every(item => (item.text.match(/Question-paper page \d+;/g) || []).length <= 5)))
  assert.ok(windowedRequests.some((request) => request.input[1].content.some(item => item.type === 'input_text' && item.text.includes('Question-paper page 4;') && item.text.includes('[No extractable text on this page.]'))))
  assert.ok(windowedRequests.every((request) => request.input[1].content.some(item => item.type === 'input_text' && item.text.includes('Mark-scheme page 2;') && item.text.includes('[No extractable text on this page.]'))))

  const boundaryPageHashes = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1, `${index + 1}`.repeat(64)]))
  const boundaryMarkSchemePageHashes = { 1: 'a'.repeat(64), 2: 'b'.repeat(64) }
  const boundaryOutputRoot = path.join(temporaryRoot, 'boundary-recovery-artifacts')
  const boundaryOptions = { ...liveOptions, outputRoot: boundaryOutputRoot, coordinateOnly: true, pageWindowed: true }
  const boundaryQuestion = windowedExtraction({
    plan: windowedPlan,
    pageHashes: boundaryPageHashes,
    markSchemePageHashes: boundaryMarkSchemePageHashes,
    questionNumber: '1',
    page: 4,
    markSchemePage: 1,
  })
  boundaryQuestion.questions[0].regions.push({ page: 9, pageImageSha256: boundaryPageHashes[9], x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 })
  const boundaryVerification = windowedVerification({
    pageHashes: boundaryPageHashes,
    markSchemePageHashes: boundaryMarkSchemePageHashes,
    questionNumber: '1',
    page: 4,
    markSchemePage: 1,
  })
  boundaryVerification.questions[0].pages.push(9)
  boundaryVerification.questions[0].regions.push({ page: 9, pageImageSha256: boundaryPageHashes[9], x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 })
  const boundaryRequests = []
  const boundaryResult = await runCli(boundaryOptions, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes: boundaryPageHashes, markSchemePageHashes: boundaryMarkSchemePageHashes }),
    extractPdfText: async (_pdfPath, pageHashes) => Object.fromEntries(Object.keys(pageHashes).map(page => [page, `text for page ${page}`])),
    callStructured: async request => {
      boundaryRequests.push(request)
      const pageWindow = JSON.parse(request.input[1].content[0].text).pageWindow
      const isRecovery = pageWindow.recovery === true
      const ownsFirstBasePage = pageWindow.ownedQuestionPaperPages.includes(1)
      if (request.schemaName === 'ai_pdf_question_extraction_v1') {
        return isRecovery || ownsFirstBasePage ? boundaryQuestion : { ...boundaryQuestion, questions: [] }
      }
      return isRecovery || ownsFirstBasePage ? boundaryVerification : { ...boundaryVerification, questionStarts: [], questions: [] }
    },
  })
  assert.equal(boundaryResult.status, 'ai-verified', JSON.stringify(boundaryResult.reasonCodes))
  assert.deepEqual(boundaryResult.candidate.questions.map(question => question.questionNumber), ['1'])
  assert.equal(boundaryResult.candidate.questions[0].regions.at(-1).page, 9)
  assert.ok(boundaryRequests.some(request => JSON.parse(request.input[1].content[0].text).pageWindow.recovery === true))

  const unresolvedOutputRoot = path.join(temporaryRoot, 'unresolved-ownership-artifacts')
  const unresolvedOptions = { ...windowedOptions, outputRoot: unresolvedOutputRoot }
  let unresolvedExtractionCalls = 0
  let unresolvedVerificationCalls = 0
  const unresolvedResult = await runCli(unresolvedOptions, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes }),
    extractPdfText: async (_pdfPath, pageHashes) => Object.fromEntries(Object.keys(pageHashes).map(page => [page, `text for page ${page}`])),
    callStructured: async request => {
      const pageWindow = JSON.parse(request.input[1].content[0].text).pageWindow
      const owned = new Set(pageWindow.ownedQuestionPaperPages)
      if (request.schemaName === 'ai_pdf_question_extraction_v1') {
        unresolvedExtractionCalls += 1
        if (owned.has(1)) {
          const response = windowedExtraction({ plan: windowedPlan, pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes, ...windowedQuestions[0] })
          return response
        }
        if (owned.has(9)) return windowedExtraction({ plan: windowedPlan, pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes, ...windowedQuestions[2] })
        return { source: { questionPdfSha256: windowedPlan.immutableInputs.questionPdf.sha256, markSchemePdfSha256: windowedPlan.immutableInputs.markSchemePdf.sha256 }, questions: [] }
      }
      unresolvedVerificationCalls += 1
      if (owned.has(1)) {
        const response = windowedVerification({ pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes, ...windowedQuestions[0] })
        response.questionStarts.push({ questionNumber: '2', questionStartPage: 5 })
        return response
      }
      if (owned.has(9)) return windowedVerification({ pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes, ...windowedQuestions[2] })
      return { questionStarts: [], questions: [] }
    },
  })
  assert.equal(unresolvedResult.status, 'auto-quarantined')
  assert.deepEqual(unresolvedResult.reasonCodes, ['PAGE_WINDOW_QUESTION_OWNERSHIP_UNRESOLVED'])
  assert.equal(unresolvedExtractionCalls, 4)
  assert.equal(unresolvedVerificationCalls, 4)

  const noTextOutputRoot = path.join(temporaryRoot, 'no-text-artifacts')
  const noTextResult = await runCli({ ...liveOptions, outputRoot: noTextOutputRoot, coordinateOnly: true, pageWindowed: true }, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes: windowedPageHashes, markSchemePageHashes: windowedMarkSchemePageHashes }),
    extractPdfText: async (_pdfPath, pageHashes) => Object.fromEntries(Object.keys(pageHashes).map(page => [page, ''])),
    callStructured: async () => { throw new Error('all-empty PDF text must stop before an AI request') },
  })
  assert.equal(noTextResult.status, 'auto-quarantined')
  assert.deepEqual(noTextResult.reasonCodes, ['PDF_TEXT_EXTRACTION_FAILED'])

  const sharedWorkerPlan = buildDryRunPlan({ ...sharedWorkerOptions, dryRun: false })
  let sharedWorkerCalls = 0
  const sharedWorkerProviderNames = []
  const sharedWorkerResult = await runCli({ ...sharedWorkerOptions, dryRun: false }, {
    cwd: workerReleaseCwd,
    env: {},
    renderPdf: fakeRenderer({ questionPdf, pageHashes, markSchemePageHashes }),
    callWithFallback: async ({ providers, request }) => {
      sharedWorkerProviderNames.push(providers.map(provider => provider.name))
      assert.equal(request.model, 'gpt-5.6-shared-worker')
      return {
        provider: providers[0],
        value: sharedWorkerCalls++ === 0
          ? validExtraction({ plan: sharedWorkerPlan, pageHashes, markSchemePageHashes })
          : validVerification(pageHashes, markSchemePageHashes),
      }
    },
    runCropCommand: async () => { throw new Error('shared-worker coordinate-only ingestion must not crop question PDFs') },
    validateCropOutput: async () => { throw new Error('shared-worker coordinate-only ingestion must not validate cropped PDFs') },
  })
  assert.equal(sharedWorkerResult.status, 'ai-verified', JSON.stringify(sharedWorkerResult.reasonCodes))
  assert.deepEqual(sharedWorkerProviderNames, [['openai', 'qwen'], ['openai', 'qwen']])
  assert.equal(sharedWorkerResult.extractor.provider, 'openai')
  assert.doesNotMatch(JSON.stringify(sharedWorkerResult), /worker-shared-(?:openai|qwen)-provider-value/)

  const mcqOutputRoot = path.join(temporaryRoot, 'mcq-artifacts')
  const mcqOptions = { ...liveOptions, outputRoot: mcqOutputRoot }
  const mcqPlan = buildDryRunPlan(mcqOptions)
  const mcqExtraction = validExtraction({ plan: mcqPlan, pageHashes, markSchemePageHashes })
  mcqExtraction.questions = mcqExtraction.questions.map(question => ({
    ...question,
    parts: question.parts.map(part => ({ ...part, label: '' })),
    markSchemeEvidence: [],
  }))
  const mcqVerification = validVerification(pageHashes, markSchemePageHashes)
  mcqVerification.questions = mcqVerification.questions.map(question => ({
    ...question,
    parts: question.parts.map(part => ({ ...part, label: '' })),
  }))
  structuredCalls = 0
  const mcqResult = await runCli(mcqOptions, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes, markSchemePageHashes }),
    callStructured: async () => structuredCalls++ === 0 ? mcqExtraction : mcqVerification,
    runCropCommand: async (_command, manifest) => {
      mkdirSync(path.dirname(manifest.questionPdfPath), { recursive: true })
      writeFileSync(manifest.questionPdfPath, singlePagePdfFixture())
    },
    validateCropOutput: async () => {},
  })
  assert.equal(mcqResult.status, 'ai-verified', JSON.stringify(mcqResult.reasonCodes))
  assert.ok(mcqResult.candidate.questions.every(question => question.parts[0].label === 'answer'))
  assert.ok(mcqResult.verification.questions.every(question => question.parts[0].label === 'answer'))
  assert.ok(mcqResult.candidate.questions.every(question => question.markSchemeEvidence.length === 1))

  const artifactBytes = readFileSync(plan.outputArtifactPath)
  const assetBytes = verifiedResult.assets.map(asset => readFileSync(asset.questionPdfPath))
  let rerunCalls = 0
  const rerunResult = await runCli(liveOptions, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: async () => { rerunCalls += 1; throw new Error('rerun-render-should-not-run') },
    callStructured: async () => { rerunCalls += 1; throw new Error('rerun-openai-should-not-run') },
    runCropCommand: async () => { rerunCalls += 1; throw new Error('rerun-crop-should-not-run') },
    writeArtifact: async () => { rerunCalls += 1; throw new Error('rerun-write-should-not-run') },
  })
  assert.equal(rerunResult.status, 'ai-verified')
  assert.equal(rerunCalls, 0)
  assert.deepEqual(readFileSync(plan.outputArtifactPath), artifactBytes)
  assert.deepEqual(verifiedResult.assets.map(asset => readFileSync(asset.questionPdfPath)), assetBytes)

  unlinkSync(verifiedResult.assets[0].questionPdfPath)
  let staleArtifactCalls = 0
  const staleArtifactResult = await runCli(liveOptions, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: async () => { staleArtifactCalls += 1; throw new Error('stale artifact must not render') },
    callStructured: async () => { staleArtifactCalls += 1; throw new Error('stale artifact must not call OpenAI') },
    runCropCommand: async () => { staleArtifactCalls += 1; throw new Error('stale artifact must not crop') },
  })
  assert.equal(staleArtifactResult.status, 'auto-quarantined')
  assert.deepEqual(staleArtifactResult.reasonCodes, ['EXISTING_ARTIFACT_ASSET_MISSING'])
  assert.equal(staleArtifactCalls, 0)
  assert.equal(JSON.parse(readFileSync(plan.outputArtifactPath, 'utf8')).status, 'auto-quarantined')

  const failureOutputRoot = path.join(temporaryRoot, 'failure-artifacts')
  const failureOptions = { ...liveOptions, outputRoot: failureOutputRoot }
  const failurePlan = buildDryRunPlan(failureOptions)
  let failedCropCalls = 0
  structuredCalls = 0
  const quarantinedResult = await runCli(failureOptions, {
    env: { OPENAI_API_KEY: fakeApiKey },
    renderPdf: fakeRenderer({ questionPdf, pageHashes, markSchemePageHashes }),
    callStructured: async () => structuredCalls++ === 0 ? extraction : verification,
    runCropCommand: async (_command, manifest) => {
      failedCropCalls += 1
      mkdirSync(path.dirname(manifest.questionPdfPath), { recursive: true })
      writeFileSync(manifest.questionPdfPath, Buffer.from('partial', 'utf8'))
      if (failedCropCalls === 2) throw new Error('sensitive crop failure')
    },
  })

  assert.equal(quarantinedResult.status, 'auto-quarantined')
  assert.deepEqual(quarantinedResult.reasonCodes, ['CROP_FAILED'])
  assert.equal(existsSync(path.join(path.dirname(failurePlan.outputArtifactPath), `${failurePlan.artifactId.slice('sha256:'.length)}.assets`)), false)
  assert.equal(JSON.parse(readFileSync(failurePlan.outputArtifactPath, 'utf8')).status, 'auto-quarantined')
  assert.equal(JSON.stringify(quarantinedResult).includes('sensitive crop failure'), false)

  const coordinateListing = listAiPdfIngestionCandidates({ root: coordinateOutputRoot, libraryRoot: coordinateLibraryRoot })
  assert.equal(coordinateListing.candidates.length, 1)
  assert.equal(coordinateListing.candidates[0].status, 'ai-verified', 'coordinate-only artifacts must not require cropped PDF assets')
  assert.equal(coordinateListing.candidates[0].studentEligibility, 'study-released', 'a valid checksum-bound AI release must be reported as student study-ready')
  assert.equal(coordinateListing.candidates[0].assetCount, 0)
  assert.deepEqual(coordinateListing.candidates[0].reasonCodes, [])

  const portableLibraryRoot = path.join(temporaryRoot, 'portable-library')
  const portableSubjectRoot = path.join(portableLibraryRoot, '9702')
  const portableQuestionPath = path.join(portableSubjectRoot, '9702_m25_qp_22.pdf')
  const portableMarkSchemePath = path.join(portableSubjectRoot, '9702_m25_ms_22.pdf')
  mkdirSync(portableSubjectRoot, { recursive: true })
  writeFileSync(portableQuestionPath, readFileSync(questionPdf))
  writeFileSync(portableMarkSchemePath, readFileSync(markSchemePdf))
  const portableCoordinateArtifact = JSON.parse(readFileSync(coordinatePlan.outputArtifactPath, 'utf8'))
  portableCoordinateArtifact.source.questionPdfPath = 'D:\\CodexWork\\cie-fraft-fetcher\\output\\pdf\\9702\\9702_m25_qp_22.pdf'
  portableCoordinateArtifact.source.markSchemePdfPath = 'D:\\CodexWork\\cie-fraft-fetcher\\output\\pdf\\9702\\9702_m25_ms_22.pdf'
  portableCoordinateArtifact.source.questionPdfRelativePath = '9702/9702_m25_qp_22.pdf'
  portableCoordinateArtifact.source.markSchemePdfRelativePath = '9702/9702_m25_ms_22.pdf'
  writeFileSync(coordinatePlan.outputArtifactPath, JSON.stringify(portableCoordinateArtifact), 'utf8')
  const portableCoordinateListing = listAiPdfIngestionCandidates({
    root: coordinateOutputRoot,
    libraryRoot: portableLibraryRoot,
  })
  assert.equal(portableCoordinateListing.candidates[0].status, 'ai-verified', 'portable source paths must be validated against the configured library root')
  assert.deepEqual(portableCoordinateListing.candidates[0].reasonCodes, [])

  writeFileSync(portableMarkSchemePath, Buffer.from('%PDF-coordinate-source-tampered', 'utf8'))
  const staleCoordinateListing = listAiPdfIngestionCandidates({ root: coordinateOutputRoot, libraryRoot: portableLibraryRoot })
  assert.equal(staleCoordinateListing.candidates[0].status, 'auto-quarantined')
  assert.ok(staleCoordinateListing.candidates[0].reasonCodes.includes('COORDINATE_SOURCE_SHA256_MISMATCH'))

  console.log(JSON.stringify({ status: 'passed', checks: 90 }))
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}

function fakeRenderer({ questionPdf, pageHashes, markSchemePageHashes }) {
  return async (pdfPath, outputDirectory) => {
    const hashes = pdfPath === questionPdf ? pageHashes : markSchemePageHashes
    mkdirSync(outputDirectory, { recursive: true })
    const paddedNames = pdfPath === questionPdf && Object.keys(hashes).length >= 2
    for (const page of Object.keys(hashes)) {
      const filename = paddedNames ? `page-${String(page).padStart(2, '0')}.jpg` : `page-${page}.jpg`
      writeFileSync(path.join(outputDirectory, filename), Buffer.from(`page-${page}`, 'utf8'))
    }
    return {
      pageImageHashes: hashes,
      pageSizes: Object.fromEntries(Object.keys(hashes).map(page => [page, { width: 1200, height: 1600 }])),
    }
  }
}

function validExtraction({ plan, pageHashes, markSchemePageHashes }) {
  const tags = {
    primaryTopicId: 'physics-9702-topic-01',
    secondaryTopicIds: [],
    syllabusPointIds: ['physics-9702-point-1-1-01'],
  }
  const part = label => ({ label, marks: 2, ocrText: `Part ${label}`, math: [], diagramAssociations: [] })
  return {
    source: {
      questionPdfSha256: plan.immutableInputs.questionPdf.sha256,
      markSchemePdfSha256: plan.immutableInputs.markSchemePdf.sha256,
    },
    questions: [
      {
        questionNumber: '1',
        questionStartPage: 1,
        regions: [
          { page: 2, pageImageSha256: pageHashes[2], x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.4 },
          { page: 1, pageImageSha256: pageHashes[1], x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.95 },
        ],
        diagramRegions: [
          { page: 1, pageImageSha256: pageHashes[1], x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.95 },
          { page: 1, pageImageSha256: pageHashes[1], x0: 0.2, y0: 0.3, x1: 0.8, y1: 0.5 },
        ], parts: [part('a')], tags,
        markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageHashes[1] }],
      },
      {
        questionNumber: '2',
        questionStartPage: 2,
        regions: [{ page: 2, pageImageSha256: pageHashes[2], x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.9 }],
        diagramRegions: [], parts: [part('a')], tags,
        markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageHashes[1] }],
      },
    ],
  }
}

function validVerification(pageHashes, markSchemePageHashes) {
  const tags = {
    primaryTopicId: 'physics-9702-topic-01',
    secondaryTopicIds: [],
    syllabusPointIds: ['physics-9702-point-1-1-01'],
  }
  return {
    questionStarts: [
      { questionNumber: '1', questionStartPage: 1 },
      { questionNumber: '2', questionStartPage: 2 },
    ],
    questions: [
       { questionNumber: '1', questionStartPage: 1, pages: [1, 2], regions: [
         { page: 2, pageImageSha256: pageHashes[2], x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.4 },
         { page: 1, pageImageSha256: pageHashes[1], x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.95 },
       ], diagramRegions: [
         { page: 1, pageImageSha256: pageHashes[1], x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.95 },
         { page: 1, pageImageSha256: pageHashes[1], x0: 0.2, y0: 0.3, x1: 0.8, y1: 0.5 },
       ], parts: [{ label: 'a', marks: 2 }], diagramRegionCount: 2, tags, markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageHashes[1] }] },
      { questionNumber: '2', questionStartPage: 2, pages: [2], regions: [
        { page: 2, pageImageSha256: pageHashes[2], x0: 0.1, y0: 0.45, x1: 0.9, y1: 0.9 },
      ], diagramRegions: [], parts: [{ label: 'a', marks: 2 }], diagramRegionCount: 0, tags, markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageHashes[1] }] },
    ],
  }
}

function windowedExtraction({ plan, pageHashes, markSchemePageHashes, questionNumber, page, markSchemePage }) {
  return {
    source: {
      questionPdfSha256: plan.immutableInputs.questionPdf.sha256,
      markSchemePdfSha256: plan.immutableInputs.markSchemePdf.sha256,
    },
    questions: [{
      questionNumber,
      questionStartPage: page,
      regions: [{ page, pageImageSha256: pageHashes[page], x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
      diagramRegions: [],
      parts: [{ label: 'a', marks: 2, ocrText: `Question ${questionNumber}`, math: [], diagramAssociations: [] }],
      tags: {
        primaryTopicId: 'physics-9702-topic-01',
        secondaryTopicIds: [],
        syllabusPointIds: ['physics-9702-point-1-1-01'],
      },
      markSchemeEvidence: [{ page: markSchemePage, pageImageSha256: markSchemePageHashes[markSchemePage] }],
    }],
  }
}

function windowedVerification({ pageHashes, markSchemePageHashes, questionNumber, page, markSchemePage }) {
  return {
    questionStarts: [{ questionNumber, questionStartPage: page }],
    questions: [{
      questionNumber,
      questionStartPage: page,
      pages: [page],
      regions: [{ page, pageImageSha256: pageHashes[page], x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
      diagramRegions: [],
      parts: [{ label: 'a', marks: 2 }],
      diagramRegionCount: 0,
      tags: {
        primaryTopicId: 'physics-9702-topic-01',
        secondaryTopicIds: [],
        syllabusPointIds: ['physics-9702-point-1-1-01'],
      },
      markSchemeEvidence: [{ page: markSchemePage, pageImageSha256: markSchemePageHashes[markSchemePage] }],
    }],
  }
}

function singlePagePdfFixture() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\n',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += object
  }
  const startXref = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index < offsets.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`
  return Buffer.from(pdf, 'utf8')
}
