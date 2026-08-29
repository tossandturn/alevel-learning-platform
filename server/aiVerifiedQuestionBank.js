import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  artifactId,
  hasValidAiStudentStudyRelease,
  resolveArtifactSourcePdfPath,
} from '../scripts/ai-pdf-ingestion/contract.mjs'
import { routeById } from '../src/data/routeRegistry.js'

const RUNTIME_ROUTE_COMPONENTS = Object.freeze({
  'cie-0580-igcse-mathematics': Object.freeze([1, 2, 3, 4]),
  'cie-0625-igcse-physics': Object.freeze([2]),
  'cie-9702-as-physics': Object.freeze([1, 2]),
  'cie-9702-a2-physics': Object.freeze([4]),
  'cie-9709-as-p1-p2': Object.freeze([1, 2]),
  'cie-9709-as-p1-p4': Object.freeze([1, 4]),
  'cie-9709-as-p1-p5': Object.freeze([1, 5]),
  'cie-9709-a2-after-p1-p5-p3-p4': Object.freeze([3, 4]),
  'cie-9709-a2-after-p1-p5-p3-p6': Object.freeze([3, 6]),
  'cie-9709-a2-after-p1-p4-p3-p5': Object.freeze([3, 5]),
})
const MIN_RUNTIME_YEAR = 2021
const MAX_RUNTIME_YEAR = 2025
const SHA256 = /^[a-f0-9]{64}$/i
const MAX_RUNTIME_ARTIFACTS = 2000
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

function withinSubjectLibrary(filePath, libraryRoot, subjectCode) {
  const resolvedRoot = path.resolve(String(libraryRoot || ''))
  const subject = String(subjectCode || '').trim()
  if (!subject) return false
  const subjectRoot = path.basename(resolvedRoot).toLowerCase() === subject.toLowerCase()
    ? resolvedRoot
    : path.join(resolvedRoot, subject)
  return withinRoot(filePath, subjectRoot)
}

function sourceFileReference(source, absoluteField, relativeField) {
  if (Object.hasOwn(source || {}, relativeField)) return source[relativeField]
  return source?.[absoluteField]
}

function sourcePdfPaths(source, libraryRoot, subjectCode) {
  const questionPath = resolveArtifactSourcePdfPath({
    source,
    absoluteField: 'questionPdfPath',
    relativeField: 'questionPdfRelativePath',
    libraryRoot,
    subjectCode,
  })
  const markSchemePath = resolveArtifactSourcePdfPath({
    source,
    absoluteField: 'markSchemePdfPath',
    relativeField: 'markSchemePdfRelativePath',
    libraryRoot,
    subjectCode,
  })
  return questionPath && markSchemePath ? Object.freeze({ questionPath, markSchemePath }) : null
}

function portableFileName(value) {
  return String(value || '').trim().replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || ''
}

function paperMetadata(file) {
  const match = /^(\d{4})_([msw])(\d{2})_(qp|ms)_([1-6])(\d)\.pdf$/i.exec(portableFileName(file))
  if (!match) return null
  const year = 2000 + Number(match[3])
  const subjectCode = match[1]
  const component = Number(match[5])
  if (year < MIN_RUNTIME_YEAR || year > MAX_RUNTIME_YEAR) return null
  return Object.freeze({
    questionFile: match[0],
    markSchemeFile: match[0].replace(/_qp_/i, '_ms_'),
    paperId: `cie-${subjectCode}-${match[0].replace(/\.pdf$/i, '')}`,
    markSchemeId: `cie-${subjectCode}-${match[0].replace(/_qp_/i, '_ms_').replace(/\.pdf$/i, '')}`,
    subjectCode,
    kind: match[4].toLowerCase(),
    component,
    variant: Number(match[6]),
    season: ({ m: 'Mar', s: 'Jun', w: 'Nov' })[match[2].toLowerCase()],
    year,
  })
}

function runtimeRouteConfig(routeId) {
  const route = routeById(String(routeId || ''))
  const components = RUNTIME_ROUTE_COMPONENTS[route?.routeId]
  if (!route || !components?.length) return null
  return Object.freeze({
    route,
    routeId: route.routeId,
    subjectCode: route.subjectCode,
    stage: route.stage,
    components,
    topicIds: new Set((route.syllabus?.topics || []).map((topic) => String(topic.id || '').trim()).filter(Boolean)),
    specificationId: `cambridge-${route.subjectCode}-${route.syllabus?.version || 'current'}`,
  })
}

function artifactRouteConfig(artifact, metadata) {
  const config = runtimeRouteConfig(artifact?.syllabusRouteId)
  if (!config
    || String(artifact?.subject || '') !== config.subjectCode
    || String(artifact?.stage || '').toUpperCase() !== config.stage
    || metadata?.subjectCode !== config.subjectCode
    || metadata?.kind !== 'qp'
    || !config.components.includes(metadata.component)) return null
  return config
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

function questionFromArtifact(artifact, candidate, verification, metadata, routeConfig) {
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
  const verifiedTopicId = asText(verification?.tags?.primaryTopicId)
  if (!/^\d+$/.test(number)
    || !routeConfig?.topicIds.has(topicId)
    || (verifiedTopicId && verifiedTopicId !== topicId)
    || !regions.length
    || !markSchemeEvidence.length
    || !renderDpi
    || !samePartMarks(candidate?.parts, verification?.parts)) return null
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
    localUrl: `/local-pdf/${metadata.subjectCode}/${metadata.questionFile}`,
    pageStart: questionPages[0],
    pageEnd: questionPages.at(-1),
    assetUrls: Object.freeze([]),
    year: metadata.year,
    season: metadata.season,
    component: metadata.component,
    sha256: sourceHash,
    page: questionPages[0],
    renderDpi,
  })
  const answerRef = Object.freeze({
    documentId: metadata.markSchemeId,
    file: metadata.markSchemeFile,
    localUrl: `/local-pdf/${metadata.subjectCode}/${metadata.markSchemeFile}`,
    pageStart: markSchemeEvidence[0].page,
    pageEnd: markSchemeEvidence.at(-1).page,
    assetUrls: Object.freeze([]),
    sha256: markSchemeHash,
    renderDpi,
  })
  const bindingSignature = `ai:${artifact.artifactId}:${routeConfig.routeId}:${number}`
  const studentStudyEligible = hasValidAiStudentStudyRelease(artifact)
  return Object.freeze({
    examFamilyId: 'cambridge',
    qualificationId: `cambridge-${routeConfig.subjectCode}`,
    specificationId: routeConfig.specificationId,
    subjectId: routeConfig.route.subjectId,
    subjectCode: routeConfig.subjectCode,
    knowledgeGroupId: topicId,
    topicId,
    stageTags: Object.freeze([routeConfig.stage]),
    componentTags: Object.freeze([metadata.component]),
    topicTags: Object.freeze([topicId]),
    skillTags: Object.freeze([]),
    answerType: 'handwritten',
    prompt: parts.map((part) => part.promptFragment).filter(Boolean).join('\n'),
    questionId,
    bankId: `${questionId}@${routeConfig.routeId}`,
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
    routeId: routeConfig.routeId,
    qualification: routeConfig.route.qualification,
    stage: routeConfig.stage,
    subject: routeConfig.route.subject,
    paperComponent: metadata.component,
    syllabusTopic: topicId,
    sourceKnowledgeGroupId: topicId,
    sourcePaper: metadata.questionFile,
    sourceKind: 'past-paper',
    studentStudyEligible,
    formalProgressEligible: false,
    studentRelease: studentStudyEligible ? artifact.studentRelease : null,
    provenance: Object.freeze({
      source: 'Official question paper and exact paired mark scheme',
      licenseStatus: 'Official exam material; personal study library',
      paperRef: metadata.questionFile,
      indexedAt: artifact.generatedAt || null,
    }),
    syllabusMapping: Object.freeze({
      specificationId: routeConfig.specificationId,
      syllabusUrl: routeConfig.route.syllabus?.url || '',
      primaryTopicId: topicId,
      knowledgeGroupId: topicId,
      mappingStatus: 'ai-verified',
    }),
  })
}

export function questionGroupsFromAiArtifacts(artifacts = [], { libraryRoot } = {}) {
  const groups = []
  const seen = new Set()
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    if (artifact?.schemaVersion !== 'ai-pdf-ingestion.v1' || artifact?.status !== 'ai-verified' || artifact?.storageMode !== 'coordinate-only') continue
    const source = artifact.source || {}
    const sourceHash = normalizedHash(source.questionPdfSha256)
    const markSchemeHash = normalizedHash(source.markSchemePdfSha256)
    const metadata = paperMetadata(sourceFileReference(source, 'questionPdfPath', 'questionPdfRelativePath'))
    const markSchemeMetadata = paperMetadata(sourceFileReference(source, 'markSchemePdfPath', 'markSchemePdfRelativePath'))
    const routeConfig = artifactRouteConfig(artifact, metadata)
    const resolvedSources = metadata ? sourcePdfPaths(source, libraryRoot, metadata.subjectCode) : null
    if (!sourceHash || !markSchemeHash || !metadata || !markSchemeMetadata || !routeConfig
      || markSchemeMetadata.kind !== 'ms'
      || markSchemeMetadata.paperId !== metadata.markSchemeId
      || markSchemeMetadata.subjectCode !== metadata.subjectCode
      || markSchemeMetadata.component !== metadata.component
      || markSchemeMetadata.variant !== metadata.variant
      || !resolvedSources
      || !withinSubjectLibrary(resolvedSources.questionPath, libraryRoot, metadata.subjectCode)
      || !withinSubjectLibrary(resolvedSources.markSchemePath, libraryRoot, metadata.subjectCode)) continue
    if (path.basename(resolvedSources.questionPath) !== metadata.questionFile || path.basename(resolvedSources.markSchemePath) !== metadata.markSchemeFile) continue
    if (asText(artifact.paperId) !== metadata.paperId) continue
    const verificationByNumber = new Map((artifact.verification?.questions || []).map((question) => [asText(question?.questionNumber), question]))
    for (const candidate of artifact.candidate?.questions || []) {
      const group = questionFromArtifact(artifact, candidate, verificationByNumber.get(asText(candidate?.questionNumber)), metadata, routeConfig)
      const deduplicationKey = group ? `${group.routeId}:${group.sourceQuestionId}` : ''
      if (!group || seen.has(deduplicationKey)) continue
      seen.add(deduplicationKey)
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
  const metadata = paperMetadata(sourceFileReference(source, 'questionPdfPath', 'questionPdfRelativePath'))
  const markSchemeMetadata = paperMetadata(sourceFileReference(source, 'markSchemePdfPath', 'markSchemePdfRelativePath'))
  const questionHash = normalizedHash(source.questionPdfSha256)
  const markSchemeHash = normalizedHash(source.markSchemePdfSha256)
  const routeConfig = artifactRouteConfig(artifact, metadata)
  const resolvedSources = metadata ? sourcePdfPaths(source, libraryRoot, metadata.subjectCode) : null
  if (
    artifact?.schemaVersion !== 'ai-pdf-ingestion.v1'
    || artifact?.status !== 'ai-verified'
    || artifact?.storageMode !== 'coordinate-only'
    || !metadata
    || !markSchemeMetadata
    || !routeConfig
    || markSchemeMetadata.kind !== 'ms'
    || markSchemeMetadata.paperId !== metadata.markSchemeId
    || markSchemeMetadata.subjectCode !== metadata.subjectCode
    || markSchemeMetadata.component !== metadata.component
    || markSchemeMetadata.variant !== metadata.variant
    || !questionHash
    || !markSchemeHash
    || !resolvedSources
    || !withinSubjectLibrary(resolvedSources.questionPath, libraryRoot, metadata.subjectCode)
    || !withinSubjectLibrary(resolvedSources.markSchemePath, libraryRoot, metadata.subjectCode)
    || path.basename(resolvedSources.questionPath) !== metadata.questionFile
    || path.basename(resolvedSources.markSchemePath) !== metadata.markSchemeFile
    || artifact.paperId !== metadata.paperId
  ) return null

  let expectedArtifactId
  try {
    expectedArtifactId = artifactId({ paperId: metadata.paperId, questionPdfSha256: questionHash, markSchemePdfSha256: markSchemeHash })
  } catch {
    return null
  }
  if (artifact.artifactId !== expectedArtifactId) return null

  const questionPath = resolvedSources.questionPath
  const markSchemePath = resolvedSources.markSchemePath
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
      Object.freeze({ subject: metadata.subjectCode, file: metadata.questionFile, sha256: questionHash, bytes: questionStat.size, component: metadata.component, year: metadata.year }),
      Object.freeze({ subject: metadata.subjectCode, file: metadata.markSchemeFile, sha256: markSchemeHash, bytes: markSchemeStat.size, component: metadata.component, year: metadata.year }),
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
