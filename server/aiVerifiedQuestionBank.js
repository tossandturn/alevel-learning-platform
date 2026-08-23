import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { artifactId } from '../scripts/ai-pdf-ingestion/contract.mjs'

const A2_ROUTE_ID = 'cie-9702-a2-physics'
const A2_TOPIC_IDS = new Set(Array.from({ length: 14 }, (_value, index) => `physics-9702-topic-${String(index + 12).padStart(2, '0')}`))
const SHA256 = /^[a-f0-9]{64}$/i
const MAX_RUNTIME_ARTIFACTS = 250
const DEFAULT_RENDER_DPI = 180

function asText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedHash(value) {
  const hash = asText(value).replace(/^sha256:/i, '')
  return SHA256.test(hash) ? hash.toLowerCase() : ''
}

function withinRoot(filePath, root) {
  const target = path.resolve(String(filePath || ''))
  const base = path.resolve(String(root || ''))
  const relative = path.relative(base, target)
  return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function paperMetadata(file) {
  const match = /^9702_([msw])(\d{2})_qp_4([1-4])?\.pdf$/i.exec(path.basename(String(file || '')))
  if (!match) return null
  const year = 2000 + Number(match[2])
  if (year < 2021 || year > 2025) return null
  return Object.freeze({
    questionFile: match[0],
    markSchemeFile: match[0].replace(/_qp_/i, '_ms_'),
    paperId: `cie-9702-${match[0].replace(/\.pdf$/i, '')}`,
    markSchemeId: `cie-9702-${match[0].replace(/_qp_/i, '_ms_').replace(/\.pdf$/i, '')}`,
    season: ({ m: 'Mar', s: 'Jun', w: 'Nov' })[match[1].toLowerCase()],
    year,
  })
}

function validRegion(region, pageSizes) {
  const page = Number(region?.page)
  const bounds = ['x0', 'y0', 'x1', 'y1'].map((key) => Number(region?.[key]))
  const size = pageSizes?.[page]
  if (!Number.isInteger(page) || page < 1 || !size || !Number.isInteger(Number(size.width)) || !Number.isInteger(Number(size.height))) return null
  const [x0, y0, x1, y1] = bounds
  if (![x0, y0, x1, y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1 || x0 >= x1 || y0 >= y1) return null
  const pageImageSha256 = normalizedHash(region?.pageImageSha256)
  if (!pageImageSha256) return null
  return Object.freeze({
    page,
    pageImageSha256,
    region: Object.freeze([x0, y0, x1, y1]),
    imageSize: Object.freeze([Number(size.width), Number(size.height)]),
  })
}

function validMarkSchemeEvidence(evidence, pageSizes) {
  const page = Number(evidence?.page)
  if (!Number.isInteger(page) || page < 1 || !pageSizes?.[page] || !normalizedHash(evidence?.pageImageSha256)) return null
  return Object.freeze({ page, pageImageSha256: normalizedHash(evidence.pageImageSha256) })
}

function validRenderDpi(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_RENDER_DPI
  const dpi = Number(value)
  return Number.isInteger(dpi) && dpi >= 72 && dpi <= 300 ? dpi : 0
}

function samePartMarks(candidateParts, verifiedParts) {
  const normalized = (parts) => (Array.isArray(parts) ? parts : []).map((part) => ({ label: asText(part?.label), marks: Number(part?.marks) }))
  const left = normalized(candidateParts)
  const right = normalized(verifiedParts)
  return left.length > 0 && left.length === right.length && left.every((part, index) => part.label && Number.isInteger(part.marks) && part.marks >= 0
    && part.label === right[index].label && part.marks === right[index].marks)
}

function evidenceForRegion(region, sourceHash) {
  return Object.freeze({
    page: region.page,
    documentSha256: sourceHash,
    pageImageSha256: region.pageImageSha256,
    coordinateSpace: 'normalized-xyxy',
    region: region.region,
    imageSize: region.imageSize,
  })
}

function questionFromArtifact(artifact, candidate, verification, metadata) {
  const source = artifact.source || {}
  const sourceHash = normalizedHash(source.questionPdfSha256)
  const markSchemeHash = normalizedHash(source.markSchemePdfSha256)
  const renderDpi = validRenderDpi(source.renderDpi)
  const number = asText(candidate?.questionNumber)
  const topicId = asText(candidate?.tags?.primaryTopicId)
  const regions = [...(candidate?.regions || []), ...(candidate?.diagramRegions || [])]
    .map((region) => validRegion(region, source.pageSizes))
    .filter(Boolean)
  const markSchemeEvidence = (candidate?.markSchemeEvidence || [])
    .map((evidence) => validMarkSchemeEvidence(evidence, source.markSchemePageSizes))
    .filter(Boolean)
  const verifiedEvidence = (verification?.markSchemeEvidence || [])
    .map((evidence) => validMarkSchemeEvidence(evidence, source.markSchemePageSizes))
    .filter(Boolean)
  if (!/^\d+$/.test(number) || !A2_TOPIC_IDS.has(topicId) || !regions.length || !markSchemeEvidence.length || !renderDpi || !samePartMarks(candidate?.parts, verification?.parts)) return null
  if (JSON.stringify(markSchemeEvidence) !== JSON.stringify(verifiedEvidence)) return null
  const questionPages = [...new Set(regions.map((region) => region.page))].sort((left, right) => left - right)
  const verificationPages = [...new Set((verification?.pages || []).map(Number))].sort((left, right) => left - right)
  if (JSON.stringify(questionPages) !== JSON.stringify(verificationPages)) return null
  const questionId = `${metadata.paperId}:q${number}`
  const parts = candidate.parts.map((part) => Object.freeze({
    partId: `${questionId}:part-${asText(part.label)}`,
    label: asText(part.label),
    promptFragment: asText(part.ocrText),
    marks: Number(part.marks),
    questionDeclaredMarks: Number(part.marks),
    markSource: 'ai-verified-qp-ms-v1',
    answerArea: Object.freeze({ type: 'handwritten' }),
    options: Object.freeze([]),
    markSchemePoints: Object.freeze([]),
    answerKey: null,
    answerText: '',
    sourcePage: questionPages[0],
    answerSourcePage: markSchemeEvidence[0].page,
    sourceEvidence: Object.freeze(regions.map((region) => evidenceForRegion(region, sourceHash))),
    markSchemeEvidence: Object.freeze(markSchemeEvidence),
    sourceRegion: null,
    sourceFocus: null,
  }))
  const totalMarks = parts.reduce((sum, part) => sum + part.marks, 0)
  if (!totalMarks) return null
  const sourceRef = Object.freeze({
    paperId: metadata.paperId,
    documentId: metadata.paperId,
    paper: metadata.questionFile,
    question: `Q${number}`,
    localUrl: `/local-pdf/9702/${metadata.questionFile}`,
    pageStart: questionPages[0],
    pageEnd: questionPages.at(-1),
    assetUrls: Object.freeze([]),
    year: metadata.year,
    season: metadata.season,
    component: 4,
    sha256: sourceHash,
    page: questionPages[0],
    renderDpi,
  })
  const answerRef = Object.freeze({
    documentId: metadata.markSchemeId,
    file: metadata.markSchemeFile,
    localUrl: `/local-pdf/9702/${metadata.markSchemeFile}`,
    pageStart: markSchemeEvidence[0].page,
    pageEnd: markSchemeEvidence.at(-1).page,
    assetUrls: Object.freeze([]),
    sha256: markSchemeHash,
    renderDpi,
  })
  const bindingSignature = `ai:${artifact.artifactId}:${number}`
  return Object.freeze({
    examFamilyId: 'cambridge',
    qualificationId: 'cambridge-9702',
    specificationId: 'cambridge-9702-2025-2027',
    subjectId: 'physics',
    subjectCode: '9702',
    knowledgeGroupId: topicId,
    topicId,
    stageTags: Object.freeze(['A2']),
    componentTags: Object.freeze([4]),
    topicTags: Object.freeze([topicId]),
    skillTags: Object.freeze([]),
    answerType: 'handwritten',
    prompt: parts.map((part) => part.promptFragment).filter(Boolean).join('\n'),
    questionId,
    bankId: `${questionId}@${A2_ROUTE_ID}`,
    sourceQuestionId: questionId,
    questionGroupId: questionId,
    questionGroupStatus: 'verified',
    totalMarks,
    marks: totalMarks,
    parts,
    sourceRef,
    answerRef,
    answerBinding: Object.freeze({
      questionId,
      answerId: `${questionId}:answer`,
      verificationStatus: 'ai-verified',
      verificationMethod: 'independent-ai-qp-ms-v1',
      artifactId: artifact.artifactId,
      questionDocumentSha256: sourceHash,
      answerDocumentSha256: markSchemeHash,
    }),
    sourceContent: Object.freeze({
      schemaVersion: 'ai-verified-coordinate-source-v1',
      complete: true,
      fileComplete: true,
      semanticStatus: 'ai-verified',
      reasons: Object.freeze([]),
      sourcePages: Object.freeze(questionPages),
      sourcePageStart: questionPages[0],
      sourcePageEnd: questionPages.at(-1),
      assetUrls: Object.freeze([]),
      assetPages: Object.freeze([]),
      bindingSignature,
      audit: Object.freeze({ complete: true, fileComplete: true, semanticStatus: 'ai-verified', reasons: Object.freeze([]), bindingSignature }),
    }),
    routeId: A2_ROUTE_ID,
    qualification: 'A-Level',
    stage: 'A2',
    subject: 'Physics',
    paperComponent: 4,
    syllabusTopic: topicId,
    sourceKnowledgeGroupId: topicId,
    sourcePaper: metadata.questionFile,
    sourceKind: 'past-paper',
    provenance: Object.freeze({
      source: 'Official question paper and exact paired mark scheme',
      licenseStatus: 'Official exam material; personal study library',
      paperRef: metadata.questionFile,
      indexedAt: artifact.generatedAt || null,
    }),
    syllabusMapping: Object.freeze({
      specificationId: 'cambridge-9702-2025-2027',
      syllabusUrl: 'https://www.cambridgeinternational.org/Images/664565-2025-2027-syllabus.pdf',
      knowledgeGroupId: topicId,
      mappingStatus: 'ai-verified',
    }),
  })
}

export function questionGroupsFromAiArtifacts(artifacts = [], { libraryRoot } = {}) {
  const groups = []
  const seen = new Set()
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    if (artifact?.schemaVersion !== 'ai-pdf-ingestion.v1' || artifact?.status !== 'ai-verified' || artifact?.storageMode !== 'coordinate-only' || artifact?.subject !== '9702') continue
    const source = artifact.source || {}
    const sourceHash = normalizedHash(source.questionPdfSha256)
    const markSchemeHash = normalizedHash(source.markSchemePdfSha256)
    const metadata = paperMetadata(source.questionPdfPath)
    if (!sourceHash || !markSchemeHash || !metadata || !withinRoot(source.questionPdfPath, libraryRoot) || !withinRoot(source.markSchemePdfPath, libraryRoot)) continue
    if (path.basename(source.questionPdfPath) !== metadata.questionFile || path.basename(source.markSchemePdfPath) !== metadata.markSchemeFile) continue
    if (asText(artifact.paperId) !== metadata.paperId) continue
    const verificationByNumber = new Map((artifact.verification?.questions || []).map((question) => [asText(question?.questionNumber), question]))
    for (const candidate of artifact.candidate?.questions || []) {
      const group = questionFromArtifact(artifact, candidate, verificationByNumber.get(asText(candidate?.questionNumber)), metadata)
      if (!group || seen.has(group.sourceQuestionId)) continue
      seen.add(group.sourceQuestionId)
      groups.push(group)
    }
  }
  return Object.freeze(groups.sort((left, right) => left.sourceRef.year - right.sourceRef.year
    || left.sourceRef.paper.localeCompare(right.sourceRef.paper)
    || left.sourceRef.question.localeCompare(right.sourceRef.question, undefined, { numeric: true })))
}

function artifactPaths(root) {
  const resolvedRoot = path.resolve(String(root || ''))
  if (!fs.statSync(resolvedRoot, { throwIfNoEntry: false })?.isDirectory()) return []
  const paths = []
  for (const paperDirectory of fs.readdirSync(resolvedRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const directory = path.join(resolvedRoot, paperDirectory.name)
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith('.json')).sort((left, right) => left.name.localeCompare(right.name))) {
      paths.push(path.join(directory, entry.name))
      if (paths.length >= MAX_RUNTIME_ARTIFACTS) return paths
    }
  }
  return paths
}

function fileSnapshot(filePath) {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false })
  return stat?.isFile() ? `${filePath}:${stat.size}:${stat.mtimeMs}` : `${filePath}:missing`
}

function fileSha256(filePath) {
  const hash = crypto.createHash('sha256')
  const bytes = fs.readFileSync(filePath)
  return hash.update(bytes).digest('hex')
}

function readVerifiedCoordinateArtifact(artifactPath, libraryRoot) {
  let artifact
  try {
    const stat = fs.statSync(artifactPath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 5 * 1024 * 1024) return null
    artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  } catch {
    return null
  }

  const source = artifact?.source || {}
  const metadata = paperMetadata(source.questionPdfPath)
  const questionHash = normalizedHash(source.questionPdfSha256)
  const markSchemeHash = normalizedHash(source.markSchemePdfSha256)
  if (
    artifact?.schemaVersion !== 'ai-pdf-ingestion.v1'
    || artifact?.status !== 'ai-verified'
    || artifact?.storageMode !== 'coordinate-only'
    || artifact?.subject !== '9702'
    || !metadata
    || !questionHash
    || !markSchemeHash
    || !withinRoot(source.questionPdfPath, libraryRoot)
    || !withinRoot(source.markSchemePdfPath, libraryRoot)
    || path.basename(source.questionPdfPath) !== metadata.questionFile
    || path.basename(source.markSchemePdfPath) !== metadata.markSchemeFile
    || artifact.paperId !== metadata.paperId
  ) return null

  let expectedArtifactId
  try {
    expectedArtifactId = artifactId({ paperId: metadata.paperId, questionPdfSha256: questionHash, markSchemePdfSha256: markSchemeHash })
  } catch {
    return null
  }
  if (artifact.artifactId !== expectedArtifactId) return null

  const questionPath = path.resolve(source.questionPdfPath)
  const markSchemePath = path.resolve(source.markSchemePdfPath)
  const questionStat = fs.statSync(questionPath, { throwIfNoEntry: false })
  const markSchemeStat = fs.statSync(markSchemePath, { throwIfNoEntry: false })
  if (!questionStat?.isFile() || !markSchemeStat?.isFile() || questionStat.size <= 0 || markSchemeStat.size <= 0) return null
  try {
    if (fileSha256(questionPath) !== questionHash || fileSha256(markSchemePath) !== markSchemeHash) return null
  } catch {
    return null
  }
  return Object.freeze({
    artifact,
    metadata,
    sourcePaths: Object.freeze([questionPath, markSchemePath]),
    documents: Object.freeze([
      Object.freeze({ subject: '9702', file: metadata.questionFile, sha256: questionHash, bytes: questionStat.size, component: 4, year: metadata.year }),
      Object.freeze({ subject: '9702', file: metadata.markSchemeFile, sha256: markSchemeHash, bytes: markSchemeStat.size, component: 4, year: metadata.year }),
    ]),
  })
}

/**
 * Returns only the coordinate-bound, five-year A2 Physics P4 records that
 * still match their local QP/MS source PDFs. The caller may cache this loader
 * safely; artifact or source file changes invalidate its snapshot.
 */
export function createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot } = {}) {
  const resolvedArtifactRoot = path.resolve(String(artifactRoot || ''))
  const resolvedLibraryRoot = path.resolve(String(libraryRoot || ''))
  let cached = null

  return function loadAiVerifiedQuestionBank({ refresh = false } = {}) {
    const paths = artifactPaths(resolvedArtifactRoot)
    const artifactSnapshot = paths.map(fileSnapshot).join('|')
    const sourceSnapshot = cached?.sourcePaths?.map(fileSnapshot).join('|') || ''
    if (!refresh && cached && cached.artifactSnapshot === artifactSnapshot && cached.sourceSnapshot === sourceSnapshot) return cached.value

    const records = paths.map((artifactPath) => readVerifiedCoordinateArtifact(artifactPath, resolvedLibraryRoot)).filter(Boolean)
    const groups = questionGroupsFromAiArtifacts(records.map((record) => record.artifact), { libraryRoot: resolvedLibraryRoot })
    const documents = [...new Map(records
      .filter((record) => groups.some((group) => group.sourceRef?.paper === record.metadata.questionFile))
      .flatMap((record) => record.documents)
      .map((document) => [`${document.subject}/${document.file}`, document]))
      .values()]
      .sort((left, right) => left.file.localeCompare(right.file))
    const value = Object.freeze({ groups, documents: Object.freeze(documents) })
    cached = {
      artifactSnapshot,
      sourcePaths: Object.freeze(records.flatMap((record) => record.sourcePaths)),
      sourceSnapshot: records.flatMap((record) => record.sourcePaths).map(fileSnapshot).join('|'),
      value,
    }
    return value
  }
}
