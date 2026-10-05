import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { STEM_AI_PART_EVIDENCE_BINDING_SCHEMA_VERSION } from '../src/lib/sourceContentContract.js'

export const TRANSFORMATIONS_BINDING_V2_SOURCE_ROOT = 'D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260927/math-0580-transformations'
export const TRANSFORMATIONS_BINDING_V2_OUTPUT_ROOT = 'data/ai-pdf-ingestion/chapter-ready-0580-transformations-written-binding-v2-20261005'
export const TRANSFORMATIONS_BINDING_V2_EVIDENCE_ROOT = '.candidate-evidence/0580-transformations-written-binding-v2-20261005'
export const TRANSFORMATIONS_BINDING_V2_MANIFEST = 'binding-v2-manifest.json'

const BASE_COMMIT = '692402f97ce3543b8f278de74b425dc5141dbf32'
const LIBRARY_ROOT = 'D:/CodexWork/cie-fraft-fetcher/output/pdf'
const SOURCE_GEOMETRY_SHA256 = 'f4fe3989c417d33ce5af05841b92ee52b1c6406c69dd5dd208635e49555effe0'
const SOURCE_REVIEW_SHA256 = '34f9358870afdd4c4dce398fe46f607e7545c5a1e90b05ea200d382e9308d346'
const SOURCE_ADJUDICATIONS_SHA256 = '9492ba4d75e5ce5d629f5789ceafd23cc390cb1afb349fae803e46734b78a403'
const SOURCE_ARTIFACT_SHA256 = Object.freeze({
  'cie-0580-0580_s25_qp_33:q17': '9234b42a7e706b5ba7c411bb1f49b920f62efc732ca26c8aaa43779fea34a69a',
  'cie-0580-0580_w25_qp_11:q21': 'ed92729c8a1e58e9299149f9e4940f25f7f69090c1fccd05ae114e2970dc6535',
  'cie-0580-0580_w25_qp_12:q19': '085c8ee3037988184a6b680849a4320a89712c58e790dffc25f9ada10acb1b93',
  'cie-0580-0580_w25_qp_13:q22': '206cb3969499f2d902cf4f68f60cfe1210ccb2ed8c17a2b159bac4d3469f10f3',
  'cie-0580-0580_w25_qp_31:q15': '4e65495e5bd01d32f2b668fcc20d1d517c048e2e34a71b02324e348e636972ca',
  'cie-0580-0580_w25_qp_33:q21': 'a7236891b79a612d219e3e76f0cc72c27317c898d9d502de3a0c2a47ac22128e',
})

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file))
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function artifactFiles(root) {
  const artifactRoot = path.join(root, 'reviewed-artifacts')
  return fs.readdirSync(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => fs.readdirSync(path.join(artifactRoot, entry.name), { withFileTypes: true })
      .filter((item) => item.isFile() && item.name.endsWith('.json'))
      .map((item) => path.join(artifactRoot, entry.name, item.name)))
    .sort((left, right) => left.localeCompare(right))
}

function exactRegion(region, page) {
  assert.ok(page, `missing pinned page ${region.pageKey}`)
  assert.deepEqual(region.partLabels, [...new Set(region.partLabels)], `duplicate part labels in ${region.pageKey}`)
  return {
    page: Number(region.page),
    pageImageSha256: page.sha256,
    x0: Number(region.region.x0),
    y0: Number(region.region.y0),
    x1: Number(region.region.x1),
    y1: Number(region.region.y1),
    partLabels: [...region.partLabels],
  }
}

function exactQuestionDocument({ document, geometry, pageByKey }) {
  const question = document.questions.find((entry) => (
    entry.sourceQuestionId === geometry.sourceQuestionId
    || String(entry.questionNumber) === String(geometry.questionNumber)
  ))
  assert.ok(question, `missing question ${geometry.sourceQuestionId}`)
  const partByLabel = new Map(question.parts.map((part) => [part.label, part]))
  assert.equal(partByLabel.size, geometry.parts.length, `part count drift for ${geometry.sourceQuestionId}`)
  const originalMarkSchemeEvidence = Array.isArray(question.markSchemeEvidence) ? question.markSchemeEvidence : []
  question.partEvidenceSchemaVersion = STEM_AI_PART_EVIDENCE_BINDING_SCHEMA_VERSION
  question.regions = geometry.qpRegions.map((region) => ({
    ...exactRegion(region, pageByKey.get(region.pageKey)),
    containsQuestionStem: region.containsQuestionStem === true,
  }))
  question.diagramRegions = geometry.diagramRegions.map((region) => ({
    ...exactRegion(region, pageByKey.get(region.pageKey)),
    evidenceRole: 'shared-diagram',
  }))
  question.markSchemeEvidence = geometry.msRegions.map((region) => {
    const original = originalMarkSchemeEvidence.filter((entry) => (
      Number(entry.page) === Number(region.page)
      && Array.isArray(entry.partLabels)
      && entry.partLabels.length === 1
      && entry.partLabels[0] === region.partLabels[0]
    ))
    assert.equal(original.length, 1, `ambiguous original MS evidence for ${geometry.sourceQuestionId}:${region.partLabels.join(',')}`)
    return {
      ...original[0],
      ...exactRegion(region, pageByKey.get(region.pageKey)),
      marks: Number(region.marks),
      evidenceRole: 'mark-scheme-part',
    }
  })
  question.parts = geometry.parts.map((geometryPart) => {
    const part = partByLabel.get(geometryPart.label)
    assert.ok(part, `missing part ${geometry.sourceQuestionId}:${geometryPart.label}`)
    assert.equal(Number(part.marks), Number(geometryPart.marks), `mark drift for ${geometry.sourceQuestionId}:${geometryPart.label}`)
    return {
      ...part,
      partPageBinding: cloneJson(geometryPart.partPageBinding),
    }
  })
  return question
}

function assertPinnedSourceFiles(geometry) {
  const seenPdfs = new Set()
  for (const page of geometry.pages) {
    const pagePath = path.resolve(String(page.path).replaceAll('/', path.sep))
    assert.equal(sha256File(pagePath), page.sha256, `source page hash drift: ${pagePath}`)
    const pdfPath = path.resolve(page.pdf.path)
    if (seenPdfs.has(pdfPath)) continue
    seenPdfs.add(pdfPath)
    assert.equal(sha256File(pdfPath), page.pdf.sha256, `source PDF hash drift: ${pdfPath}`)
  }
  return Object.freeze({ pageCount: geometry.pages.length, pdfCount: seenPdfs.size })
}

export function buildTransformationsBindingV2Artifact({ sourceArtifact, sourceArtifactPath, geometry, pageByKey, generatedAt }) {
  const sourceQuestionId = sourceArtifact.candidate.questions[0]?.sourceQuestionId
  assert.ok(SOURCE_ARTIFACT_SHA256[sourceQuestionId], `unexpected source artifact ${sourceQuestionId}`)
  assert.equal(sha256File(sourceArtifactPath), SOURCE_ARTIFACT_SHA256[sourceQuestionId], `source artifact hash drift for ${sourceQuestionId}`)
  const questionGeometry = geometry.questions.find((question) => question.sourceQuestionId === sourceQuestionId)
  assert.ok(questionGeometry, `missing source geometry for ${sourceQuestionId}`)

  const artifact = cloneJson(sourceArtifact)
  const priorSourceReview = cloneJson(artifact.sourceReview)
  delete artifact.sourceReview
  delete artifact.studentRelease
  artifact.studentStudyEligible = false
  artifact.formalProgressEligible = false
  artifact.generatedAt = generatedAt
  artifact.bindingPreparation = {
    schemaVersion: 'chapter-ready-written-part-binding-preparation.v2',
    status: 'PREPARED_UNPUBLISHED_PENDING_INDEPENDENT_REVIEW',
    baseCommit: BASE_COMMIT,
    sourceArtifactSha256: SOURCE_ARTIFACT_SHA256[sourceQuestionId],
    sourceGeometrySha256: SOURCE_GEOMETRY_SHA256,
    sourceReviewSha256: SOURCE_REVIEW_SHA256,
    sourceAdjudicationsSha256: SOURCE_ADJUDICATIONS_SHA256,
    providerCalls: 0,
    studentStudyEligible: false,
    formalProgressEligible: false,
  }
  artifact.priorSourceReview = {
    ...priorSourceReview,
    status: 'HISTORICAL_V1_REVIEW_NOT_AUTHORITY_FOR_V2_CONTENT_BINDING',
  }
  for (const document of [artifact.candidate, artifact.verification]) {
    document.reviewSummary = {
      status: 'binding-v2-prepared-pending_independent_review',
      studentStudyEligible: false,
      studentRelease: false,
      scope: 'Exact per-part QP/MS coordinates prepared locally. No independent written-response review or publication authority exists.',
    }
    exactQuestionDocument({ document, geometry: questionGeometry, pageByKey })
  }
  return artifact
}

export function prepareTransformationsBindingV2({
  sourceRoot = TRANSFORMATIONS_BINDING_V2_SOURCE_ROOT,
  outputRoot = TRANSFORMATIONS_BINDING_V2_OUTPUT_ROOT,
  evidenceRoot = TRANSFORMATIONS_BINDING_V2_EVIDENCE_ROOT,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedSourceRoot = path.resolve(sourceRoot)
  const resolvedOutputRoot = path.resolve(outputRoot)
  const resolvedEvidenceRoot = path.resolve(evidenceRoot)
  if (fs.existsSync(resolvedOutputRoot)) throw new Error(`Refuse to overwrite v2 artifact root: ${resolvedOutputRoot}`)
  if (fs.existsSync(resolvedEvidenceRoot)) throw new Error(`Refuse to overwrite v2 evidence root: ${resolvedEvidenceRoot}`)

  const geometryPath = path.join(resolvedSourceRoot, 'source-geometry.json')
  const sourceReviewPath = path.join(resolvedSourceRoot, 'source-review.json')
  const adjudicationsPath = path.join(resolvedSourceRoot, 'source-adjudications.json')
  assert.equal(sha256File(geometryPath), SOURCE_GEOMETRY_SHA256, 'source geometry pin drift')
  assert.equal(sha256File(sourceReviewPath), SOURCE_REVIEW_SHA256, 'source review pin drift')
  assert.equal(sha256File(adjudicationsPath), SOURCE_ADJUDICATIONS_SHA256, 'source adjudication pin drift')
  const geometry = readJson(geometryPath)
  const sourceFileCounts = assertPinnedSourceFiles(geometry)
  const pageByKey = new Map(geometry.pages.map((page) => [page.key, page]))
  const sourceFiles = artifactFiles(resolvedSourceRoot)
  assert.equal(sourceFiles.length, 6)

  fs.mkdirSync(resolvedOutputRoot, { recursive: true })
  fs.mkdirSync(resolvedEvidenceRoot, { recursive: true })
  const artifacts = []
  const outputs = []
  for (const sourceArtifactPath of sourceFiles) {
    const sourceArtifact = readJson(sourceArtifactPath)
    const artifact = buildTransformationsBindingV2Artifact({
      sourceArtifact,
      sourceArtifactPath,
      geometry,
      pageByKey,
      generatedAt,
    })
    const sourceQuestionId = artifact.candidate.questions[0].sourceQuestionId
    const paperDirectory = path.join(resolvedOutputRoot, artifact.paperId)
    fs.mkdirSync(paperDirectory, { recursive: true })
    const outputPath = path.join(paperDirectory, path.basename(sourceArtifactPath))
    fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    const questionGeometry = geometry.questions.find((question) => question.sourceQuestionId === sourceQuestionId)
    outputs.push({
      sourceQuestionId,
      component: Number(questionGeometry.component),
      parts: questionGeometry.parts.length,
      marks: questionGeometry.totalMarks,
      sourceArtifact: sourceArtifactPath.replaceAll('\\', '/'),
      sourceArtifactSha256: SOURCE_ARTIFACT_SHA256[sourceQuestionId],
      artifact: outputPath.replaceAll('\\', '/'),
      artifactSha256: sha256File(outputPath),
      partBindings: questionGeometry.parts.map((part) => {
        const qp = questionGeometry.qpRegions.find((region) => region.partLabels.length === 1 && region.partLabels[0] === part.label)
        const ms = questionGeometry.msRegions.find((region) => region.partLabels.length === 1 && region.partLabels[0] === part.label)
        assert.ok(qp && ms, `missing exact part region for ${sourceQuestionId}:${part.label}`)
        return {
          label: part.label,
          marks: Number(part.marks),
          questionPage: part.partPageBinding.questionPage,
          questionPageImageSha256: pageByKey.get(qp.pageKey).sha256,
          questionRegion: [qp.region.x0, qp.region.y0, qp.region.x1, qp.region.y1],
          sharedDiagramRegions: questionGeometry.diagramRegions.filter((region) => region.partLabels.includes(part.label)).map((region) => ({
            page: region.page,
            pageImageSha256: pageByKey.get(region.pageKey).sha256,
            region: [region.region.x0, region.region.y0, region.region.x1, region.region.y1],
          })),
          markSchemePage: part.partPageBinding.markSchemePage,
          markSchemePageImageSha256: pageByKey.get(ms.pageKey).sha256,
          markSchemeRegion: [ms.region.x0, ms.region.y0, ms.region.x1, ms.region.y1],
        }
      }),
    })
    artifacts.push(artifact)
  }

  const groups = questionGroupsFromAiArtifacts(artifacts, { libraryRoot: LIBRARY_ROOT })
  assert.equal(groups.length, 6)
  assert.equal(groups.reduce((sum, group) => sum + group.parts.length, 0), 13)
  assert.equal(groups.reduce((sum, group) => sum + group.totalMarks, 0), 30)
  assert.ok(groups.every((group) => group.studentStudyEligible === false && group.formalProgressEligible === false))

  const manifest = {
    schemaVersion: 'chapter-ready-written-part-binding-manifest.v2',
    status: 'PREPARED_UNPUBLISHED_PENDING_INDEPENDENT_REVIEW',
    generatedAt,
    baseCommit: BASE_COMMIT,
    routeId: 'cie-0580-igcse-mathematics',
    topicId: '0580-igcse-topic-07',
    syllabusPointIds: ['math-0580-point-C7-1'],
    partEvidenceSchemaVersion: STEM_AI_PART_EVIDENCE_BINDING_SCHEMA_VERSION,
    sourceRoot: resolvedSourceRoot.replaceAll('\\', '/'),
    outputRoot: resolvedOutputRoot.replaceAll('\\', '/'),
    sourcePins: {
      sourceGeometrySha256: SOURCE_GEOMETRY_SHA256,
      sourceReviewSha256: SOURCE_REVIEW_SHA256,
      sourceAdjudicationsSha256: SOURCE_ADJUDICATIONS_SHA256,
    },
    counts: {
      questions: 6,
      parts: 13,
      marks: 30,
      components: { 1: 3, 3: 3 },
      sourcePdfs: sourceFileCounts.pdfCount,
      sourcePages: sourceFileCounts.pageCount,
    },
    providerCalls: 0,
    studentStudyEligible: false,
    formalProgressEligible: false,
    published: false,
    productionModified: false,
    sourceAdjudication: {
      id: 'w25-33-q21b-reflection-sign',
      status: 'PINNED_LOCAL_NONOFFICIAL',
      officialErrataClaimed: false,
    },
    outputs: outputs.sort((left, right) => left.sourceQuestionId.localeCompare(right.sourceQuestionId)),
  }
  const manifestPath = path.join(resolvedEvidenceRoot, TRANSFORMATIONS_BINDING_V2_MANIFEST)
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const manifestSha256 = sha256File(manifestPath)
  fs.writeFileSync(path.join(resolvedEvidenceRoot, `${TRANSFORMATIONS_BINDING_V2_MANIFEST}.sha256`), `${manifestSha256}  ${TRANSFORMATIONS_BINDING_V2_MANIFEST}\n`, { encoding: 'utf8', flag: 'wx' })
  return Object.freeze({ manifest, manifestPath, manifestSha256, artifacts: Object.freeze(artifacts), groups })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prepareTransformationsBindingV2()
  console.log(JSON.stringify({
    status: result.manifest.status,
    manifest: result.manifestPath.replaceAll('\\', '/'),
    manifestSha256: result.manifestSha256,
    counts: result.manifest.counts,
    providerCalls: 0,
    published: false,
  }))
}
