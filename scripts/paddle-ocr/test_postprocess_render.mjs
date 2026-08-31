import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  POSTPROCESS_SUMMARY_KEYS,
  buildPostprocessPlan,
  postprocessRender,
  runProcessWithTimeout,
} from './postprocess-render.mjs'

const scriptPath = fileURLToPath(new URL('./postprocess-render.mjs', import.meta.url))
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'paddle-postprocess-render-'))
const bundledPython = path.join(
  os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
  'dependencies', 'python', 'python.exe',
)
const python = fs.statSync(bundledPython, { throwIfNoEntry: false })?.isFile()
  ? { command: bundledPython, args: [] }
  : process.platform === 'win32'
    ? { command: 'py', args: ['-3.12'] }
    : { command: 'python3', args: [] }

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function createPdf(filePath, pageSizes) {
  const program = [
    'from pypdf import PdfWriter',
    'import json, sys',
    'writer = PdfWriter()',
    'for width, height in json.loads(sys.argv[2]): writer.add_blank_page(width=width, height=height)',
    'writer.write(sys.argv[1])',
  ].join('\n')
  const result = spawnSync(python.command, [
    ...python.args, '-c', program, filePath, JSON.stringify(pageSizes),
  ], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
}

function pageHash(character) {
  return character.repeat(64)
}

function region(page, hash, bounds) {
  return { page, pageImageSha256: hash, ...bounds }
}

function fixture() {
  const root = path.join(temporaryRoot, `fixture-${crypto.randomUUID()}`)
  const qpPath = path.join(root, 'sources', '9702_s22_qp_41.pdf')
  const msPath = path.join(root, 'sources', '9702_s22_ms_41.pdf')
  fs.mkdirSync(path.dirname(qpPath), { recursive: true })
  createPdf(qpPath, [[400, 800], [400, 800]])
  createPdf(msPath, [[500, 700]])

  const qpHashes = { 1: pageHash('a'), 2: pageHash('b') }
  const msHashes = { 1: pageHash('c') }
  const shared = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.45 }
  const extraction = {
    source: {
      questionPdfSha256: sha256(qpPath),
      markSchemePdfSha256: sha256(msPath),
    },
    questions: [{
      questionNumber: '1',
      questionStartPage: 1,
      regions: [
        region(1, qpHashes[1], shared),
        region(2, qpHashes[2], { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.8 }),
      ],
      diagramRegions: [
        region(1, qpHashes[1], shared),
        region(1, qpHashes[1], { x0: 0.25, y0: 0.2, x1: 0.75, y1: 0.35 }),
      ],
      parts: [{ label: '(a)', marks: 1, ocrText: 'State a law.', math: [], diagramAssociations: [1] }],
      tags: { primaryTopicId: 'physics-9702-topic-12', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 1, pageImageSha256: msHashes[1] }],
    }],
  }
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1',
    artifactId: `sha256:${pageHash('d')}`,
    paperId: 'cie-9702-9702_s22_qp_41',
    subject: '9702',
    stage: 'A2',
    status: 'ai-verified',
    storageMode: 'coordinate-only',
    source: {
      questionPdfPath: qpPath,
      markSchemePdfPath: msPath,
      questionPdfSha256: sha256(qpPath),
      markSchemePdfSha256: sha256(msPath),
      pageImageHashes: qpHashes,
      pageSizes: { 1: { width: 1000, height: 2000 }, 2: { width: 1000, height: 2000 } },
      markSchemePageHashes: msHashes,
      markSchemePageSizes: { 1: { width: 1000, height: 1400 } },
    },
    candidate: extraction,
    assets: [],
  }
  const artifactPath = path.join(root, 'artifact.json')
  const outputRoot = path.join(root, 'postprocess-output')
  writeJson(artifactPath, artifact)
  return { root, qpPath, msPath, extraction, artifact, artifactPath, outputRoot }
}

function stagingFixture(base) {
  const staging = {
    schemaVersion: 'stem-paddle-ocr-staging-artifact.v1',
    artifactId: `sha256:${pageHash('e')}`,
    paperId: base.artifact.paperId,
    status: 'ocr-complete-pending-review',
    reviewStatus: 'pending_ai_structure_review',
    studentStudyEligible: false,
    sourcePair: {
      questionPaper: { path: base.qpPath, sha256: sha256(base.qpPath), pageCount: 2 },
      markScheme: { path: base.msPath, sha256: sha256(base.msPath), pageCount: 1 },
    },
    ocr: {
      documents: {
        qp: {
          status: 'completed',
          sourceSha256: sha256(base.qpPath),
          pageCount: 2,
          pages: {
            1: { status: 'completed', sourcePage: { page: 1, sha256: pageHash('a'), width: 1000, height: 2000 } },
            2: { status: 'completed', sourcePage: { page: 2, sha256: pageHash('b'), width: 1000, height: 2000 } },
          },
        },
        ms: {
          status: 'completed',
          sourceSha256: sha256(base.msPath),
          pageCount: 1,
          pages: {
            1: { status: 'completed', sourcePage: { page: 1, sha256: pageHash('c'), width: 1000, height: 1400 } },
          },
        },
      },
    },
  }
  const artifactPath = path.join(base.root, 'staging', 'artifact.json')
  const reviewDraftPath = path.join(base.root, 'review-drafts', 'extraction.json')
  writeJson(artifactPath, staging)
  writeJson(reviewDraftPath, base.extraction)
  return { staging, artifactPath, reviewDraftPath }
}

function assertSummaryShape(summary) {
  assert.deepEqual(Object.keys(summary).sort(), ['counts', 'errorCodes'])
  assert.deepEqual(Object.keys(summary.counts).sort(), [...POSTPROCESS_SUMMARY_KEYS].sort())
  assert.ok(summary.errorCodes.every(code => /^[A-Z][A-Z0-9_]+$/.test(code)))
}

try {
  const base = fixture()
  const sourceArtifactBytes = fs.readFileSync(base.artifactPath)

  const plan = buildPostprocessPlan({
    artifact: base.artifact,
    artifactPath: base.artifactPath,
    outputRoot: base.outputRoot,
  })
  assert.equal(plan.questions.length, 1)
  assert.equal(plan.questions[0].questionRegions.length, 2)
  assert.equal(plan.questions[0].diagramRegions.length, 2, 'diagram bindings must be retained')
  assert.equal(plan.questions[0].manifest.crops.length, 2, 'diagrams already contained by a whole-question region must not be cropped twice')
  assert.deepEqual(plan.questions[0].manifest.crops.map(crop => crop.page), [1, 2])

  const dryRun = await postprocessRender({
    artifactPath: base.artifactPath,
    outputRoot: base.outputRoot,
  })
  assertSummaryShape(dryRun)
  assert.deepEqual(dryRun.errorCodes, [])
  assert.equal(dryRun.counts.artifacts, 1)
  assert.equal(dryRun.counts.questions, 1)
  assert.equal(dryRun.counts.questionRegions, 2)
  assert.equal(dryRun.counts.diagramRegions, 2)
  assert.equal(dryRun.counts.uniqueCrops, 2)
  assert.equal(dryRun.counts.rendered, 0)
  assert.equal(fs.existsSync(base.outputRoot), false, 'default audit must not create output directories')
  assert.deepEqual(fs.readFileSync(base.artifactPath), sourceArtifactBytes, 'audit must not mutate the artifact')

  const rendered = await postprocessRender({
    artifactPath: base.artifactPath,
    outputRoot: base.outputRoot,
    render: true,
    timeoutMs: 10_000,
  })
  assertSummaryShape(rendered)
  assert.deepEqual(rendered.errorCodes, [])
  assert.equal(rendered.counts.rendered, 1)
  assert.equal(rendered.counts.outputsValid, 1)
  const questionPdf = plan.questions[0].manifest.questionPdfPath
  assert.equal(fs.readFileSync(questionPdf).subarray(0, 5).toString('ascii'), '%PDF-')
  const inspect = spawnSync(python.command, [
    ...python.args,
    '-c',
    'from pypdf import PdfReader; import sys; print(len(PdfReader(sys.argv[1]).pages))',
    questionPdf,
  ], { encoding: 'utf8', windowsHide: true })
  assert.equal(inspect.status, 0, inspect.stderr)
  assert.equal(inspect.stdout.trim(), '2', 'whole-question regions must render once without nested diagram duplication')

  const auditExisting = await postprocessRender({
    artifactPath: base.artifactPath,
    outputRoot: base.outputRoot,
  })
  assert.deepEqual(auditExisting.errorCodes, [])
  assert.equal(auditExisting.counts.outputsChecked, 1)
  assert.equal(auditExisting.counts.outputsValid, 1)

  const rerendered = await postprocessRender({
    artifactPath: base.artifactPath,
    outputRoot: base.outputRoot,
    render: true,
    timeoutMs: 10_000,
  })
  assert.deepEqual(rerendered.errorCodes, [])
  assert.equal(rerendered.counts.rendered, 1, 'an existing question.pdf must be replaceable on explicit rerender')
  assert.equal(rerendered.counts.outputsValid, 1)

  const expectedHashArtifact = structuredClone(base.artifact)
  expectedHashArtifact.assets = [{
    questionNumber: '1',
    questionPdfPath: questionPdf,
    questionPdfSha256: sha256(questionPdf),
  }]
  writeJson(base.artifactPath, expectedHashArtifact)
  fs.appendFileSync(questionPdf, 'tampered')
  const outputHashFailure = await postprocessRender({
    artifactPath: base.artifactPath,
    outputRoot: base.outputRoot,
  })
  assert.deepEqual(outputHashFailure.errorCodes, ['POSTPROCESS_OUTPUT_HASH_MISMATCH'])
  assert.equal(outputHashFailure.counts.outputsValid, 0)

  const hashMismatch = fixture()
  hashMismatch.artifact.source.questionPdfSha256 = pageHash('f')
  hashMismatch.artifact.candidate.source.questionPdfSha256 = pageHash('f')
  writeJson(hashMismatch.artifactPath, hashMismatch.artifact)
  const failClosed = await postprocessRender({
    artifactPath: hashMismatch.artifactPath,
    outputRoot: hashMismatch.outputRoot,
    render: true,
  })
  assert.deepEqual(failClosed.errorCodes, ['POSTPROCESS_QP_HASH_MISMATCH'])
  assert.equal(failClosed.counts.rendered, 0)
  assert.equal(fs.existsSync(hashMismatch.outputRoot), false, 'preflight failure must not write output')

  const outOfBounds = fixture()
  outOfBounds.artifact.candidate.questions[0].regions[1].page = 3
  writeJson(outOfBounds.artifactPath, outOfBounds.artifact)
  const pageFailure = await postprocessRender({ artifactPath: outOfBounds.artifactPath, outputRoot: outOfBounds.outputRoot })
  assert.deepEqual(pageFailure.errorCodes, ['POSTPROCESS_QP_PAGE_OUT_OF_BOUNDS'])

  const pageSizeMismatch = fixture()
  pageSizeMismatch.artifact.source.pageSizes[1] = { width: 1000, height: 1000 }
  writeJson(pageSizeMismatch.artifactPath, pageSizeMismatch.artifact)
  const sizeFailure = await postprocessRender({ artifactPath: pageSizeMismatch.artifactPath, outputRoot: pageSizeMismatch.outputRoot })
  assert.deepEqual(sizeFailure.errorCodes, ['POSTPROCESS_QP_PAGE_SIZE_MISMATCH'])

  const badPageHash = fixture()
  badPageHash.artifact.candidate.questions[0].diagramRegions[0].pageImageSha256 = pageHash('9')
  writeJson(badPageHash.artifactPath, badPageHash.artifact)
  const pageHashFailure = await postprocessRender({ artifactPath: badPageHash.artifactPath, outputRoot: badPageHash.outputRoot })
  assert.deepEqual(pageHashFailure.errorCodes, ['POSTPROCESS_QP_PAGE_IMAGE_HASH_MISMATCH'])

  const escaped = fixture()
  escaped.artifact.paperId = '../escape'
  writeJson(escaped.artifactPath, escaped.artifact)
  const escapeFailure = await postprocessRender({ artifactPath: escaped.artifactPath, outputRoot: escaped.outputRoot })
  assert.deepEqual(escapeFailure.errorCodes, ['POSTPROCESS_PATH_ESCAPE'])

  const stagedBase = fixture()
  const staged = stagingFixture(stagedBase)
  const stagedPlan = buildPostprocessPlan({
    artifact: staged.staging,
    reviewDraft: stagedBase.extraction,
    artifactPath: staged.artifactPath,
    reviewDraftPath: staged.reviewDraftPath,
    outputRoot: stagedBase.outputRoot,
  })
  assert.equal(stagedPlan.questions[0].manifest.crops.length, 2)
  const stagedAudit = await postprocessRender({
    artifactPath: staged.artifactPath,
    reviewDraftPath: staged.reviewDraftPath,
    outputRoot: stagedBase.outputRoot,
  })
  assert.deepEqual(stagedAudit.errorCodes, [])

  const wrongDraft = structuredClone(stagedBase.extraction)
  wrongDraft.source.markSchemePdfSha256 = pageHash('0')
  writeJson(staged.reviewDraftPath, wrongDraft)
  const draftFailure = await postprocessRender({
    artifactPath: staged.artifactPath,
    reviewDraftPath: staged.reviewDraftPath,
    outputRoot: stagedBase.outputRoot,
  })
  assert.deepEqual(draftFailure.errorCodes, ['POSTPROCESS_DRAFT_SOURCE_HASH_MISMATCH'])

  await assert.rejects(
    runProcessWithTimeout(process.execPath, ['-e', 'setTimeout(() => {}, 1200)'], { timeoutMs: 60 }),
    error => error?.code === 'POSTPROCESS_TIMEOUT',
  )

  const cliBase = fixture()
  const cli = spawnSync(process.execPath, [
    scriptPath,
    '--artifact', cliBase.artifactPath,
    '--output-root', cliBase.outputRoot,
  ], { encoding: 'utf8', windowsHide: true })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(cli.stderr, '')
  const cliSummary = JSON.parse(cli.stdout)
  assertSummaryShape(cliSummary)
  assert.equal(/path|hash|status|eligible/i.test(cli.stdout), false, 'CLI output must contain only counts and error codes')

  const cliFailureBase = fixture()
  cliFailureBase.artifact.source.markSchemePdfSha256 = pageHash('1')
  cliFailureBase.artifact.candidate.source.markSchemePdfSha256 = pageHash('1')
  writeJson(cliFailureBase.artifactPath, cliFailureBase.artifact)
  const cliFailure = spawnSync(process.execPath, [
    scriptPath,
    '--artifact', cliFailureBase.artifactPath,
    '--output-root', cliFailureBase.outputRoot,
  ], { encoding: 'utf8', windowsHide: true })
  assert.equal(cliFailure.status, 2)
  assert.equal(cliFailure.stderr, '')
  const cliFailureSummary = JSON.parse(cliFailure.stdout)
  assertSummaryShape(cliFailureSummary)
  assert.deepEqual(cliFailureSummary.errorCodes, ['POSTPROCESS_MS_HASH_MISMATCH'])

  console.log(JSON.stringify({ status: 'passed', checks: 49 }))
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
