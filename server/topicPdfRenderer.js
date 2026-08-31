import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { routeById } from '../src/data/routeRegistry.js'
import { supportsSyllabusPracticeRoute, syllabusPracticeComponentsForRoute } from '../src/lib/syllabusPracticeRoutes.js'
import {
  AI_PDF_INGESTION_SCHEMA_VERSION,
  artifactId,
  hasValidAiStudentStudyRelease,
  resolveArtifactSourcePdfPath,
} from '../scripts/ai-pdf-ingestion/contract.mjs'
import { buildCropCommand, buildCropManifest } from '../scripts/ai-pdf-ingestion/render.mjs'

export const TOPIC_PDF_RENDER_SCHEMA_VERSION = 'stem-topic-pdf-render.v1'

const SHA256 = /^[a-f0-9]{64}$/i
const SAFE_ROUTE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_ARTIFACTS = 4000
const MIN_YEAR = 2021
const MAX_YEAR = 2025
const DEFAULT_TIMEOUT_MS = 45_000
const MAX_TIMEOUT_MS = 55_000
const SESSION_ORDER = Object.freeze({ m: 1, s: 2, w: 3 })
const PDF_MERGE_PROGRAM = [
  'from pypdf import PdfReader, PdfWriter',
  'import sys',
  'out = sys.argv[1]',
  'inputs = sys.argv[2:]',
  'writer = PdfWriter()',
  'for item in inputs:',
  '    reader = PdfReader(item)',
  '    for page in reader.pages:',
  '        writer.add_page(page)',
  'with open(out, "wb") as stream:',
  '    writer.write(stream)',
].join('\n')

function text(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function hash(value) {
  const candidate = text(value).replace(/^sha256:/i, '')
  return SHA256.test(candidate) ? candidate.toLowerCase() : ''
}

function codedError(code, message = code, statusCode = 422) {
  return Object.assign(new Error(message), { code, statusCode })
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function fileIsPdf(filePath) {
  const handle = fs.openSync(filePath, 'r')
  try {
    const bytes = Buffer.alloc(5)
    const read = fs.readSync(handle, bytes, 0, bytes.length, 0)
    return read === 5 && bytes.toString('ascii') === '%PDF-'
  } finally {
    fs.closeSync(handle)
  }
}

function withinRoot(filePath, root) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath))
  return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function safeSourcePath(source, absoluteField, relativeField, libraryRoot, subjectCode) {
  const resolved = resolveArtifactSourcePdfPath({
    source,
    absoluteField,
    relativeField,
    libraryRoot,
    subjectCode,
  })
  if (!resolved || !path.isAbsolute(resolved)) return null
  const root = path.resolve(String(libraryRoot || ''))
  const subjectRoot = path.basename(root).toLowerCase() === String(subjectCode).toLowerCase()
    ? root
    : path.join(root, String(subjectCode))
  if (!withinRoot(resolved, subjectRoot)) return null
  const realSubjectRoot = fs.realpathSync(subjectRoot, { throwIfNoEntry: false })
  const realPath = fs.realpathSync(resolved, { throwIfNoEntry: false })
  if (!realSubjectRoot || !realPath || !withinRoot(realPath, realSubjectRoot)) return null
  return realPath
}

function paperMetadata(fileName) {
  const base = path.basename(String(fileName || '').replaceAll('\\', '/'))
  const match = /^(\d{4})_([msw])(\d{2})_(qp|ms)_([1-6])(\d)\.pdf$/i.exec(base)
  if (!match) return null
  const year = 2000 + Number(match[3])
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  const session = match[2].toLowerCase()
  const component = Number(match[5])
  const variant = Number(match[6])
  const questionFile = `${match[1]}_${session}${match[3]}_qp_${component}${variant}.pdf`
  const markSchemeFile = `${match[1]}_${session}${match[3]}_ms_${component}${variant}.pdf`
  return Object.freeze({
    subjectCode: match[1],
    year,
    session,
    season: ({ m: 'Mar', s: 'Jun', w: 'Nov' })[session],
    component,
    variant,
    kind: match[4].toLowerCase(),
    questionFile,
    markSchemeFile,
    paperId: `cie-${match[1]}-${questionFile.replace(/\.pdf$/i, '')}`,
    markSchemeId: `cie-${match[1]}-${markSchemeFile.replace(/\.pdf$/i, '')}`,
  })
}

function numericMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    const page = Number(key)
    if (!Number.isInteger(page) || page < 1 || !item || typeof item !== 'object' || Array.isArray(item)) return null
    result[page] = item
  }
  return result
}

function pageSizeFor(pageSizes, page) {
  const size = pageSizes?.[page]
  if (!size || !Number.isInteger(Number(size.width)) || Number(size.width) <= 0
    || !Number.isInteger(Number(size.height)) || Number(size.height) <= 0) return null
  return { width: Number(size.width), height: Number(size.height) }
}

function normalizeRegion(region, pageSizes, pageImageHashes) {
  const page = Number(region?.page)
  const size = pageSizeFor(pageSizes, page)
  const pageImageSha256 = hash(region?.pageImageSha256)
  const coordinates = ['x0', 'y0', 'x1', 'y1'].map((field) => Number(region?.[field]))
  if (!Number.isInteger(page) || page < 1 || !size || !pageImageSha256
    || !coordinates.every(Number.isFinite)
    || coordinates[0] < 0 || coordinates[1] < 0 || coordinates[2] > 1 || coordinates[3] > 1
    || coordinates[0] >= coordinates[2] || coordinates[1] >= coordinates[3]) return null
  const expectedPageHash = hash(pageImageHashes?.[page])
  if (!expectedPageHash || expectedPageHash !== pageImageSha256) return null
  if (region.imageSize !== undefined) {
    const imageWidth = Number(region.imageSize?.width ?? region.imageSize?.[0])
    const imageHeight = Number(region.imageSize?.height ?? region.imageSize?.[1])
    if (imageWidth !== size.width || imageHeight !== size.height) return null
  }
  return Object.freeze({
    page,
    x0: coordinates[0],
    y0: coordinates[1],
    x1: coordinates[2],
    y1: coordinates[3],
    pageImageSha256,
  })
}

function regionKey(region) {
  return [region.page, region.x0, region.y0, region.x1, region.y1].join(':')
}

function sameRegion(left, right) {
  return Boolean(left && right) && regionKey(left) === regionKey(right)
}

function regionContains(outer, inner) {
  return outer?.page === inner?.page
    && outer.x0 <= inner.x0
    && outer.y0 <= inner.y0
    && outer.x1 >= inner.x1
    && outer.y1 >= inner.y1
}

function renderRegions(questionRegions, diagramRegions) {
  const result = [...questionRegions]
  for (const diagram of diagramRegions) {
    if (questionRegions.some((region) => regionContains(region, diagram))) continue
    if (!result.some((region) => sameRegion(region, diagram))) result.push(diagram)
  }
  return result.sort((left, right) => left.page - right.page
    || left.y0 - right.y0
    || left.x0 - right.x0
    || left.y1 - right.y1
    || left.x1 - right.x1)
}

function uniqueRegions(regions) {
  return [...new Map(regions.map((region) => [regionKey(region), region])).values()]
}

function sortedIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item, 240))
    .filter(Boolean))].sort()
}

function sameIdSet(left, right) {
  return JSON.stringify(sortedIds(left)) === JSON.stringify(sortedIds(right))
}

function normalizeEvidence(value, pageSizes, pageHashes) {
  if (!Array.isArray(value) || !value.length) return null
  const result = []
  for (const entry of value) {
    const page = Number(entry?.page)
    const pageImageSha256 = hash(entry?.pageImageSha256)
    if (!Number.isInteger(page) || page < 1 || !pageSizeFor(pageSizes, page) || !pageImageSha256
      || hash(pageHashes?.[page]) !== pageImageSha256) return null
    result.push({ page, pageImageSha256 })
  }
  const seen = new Set()
  return result.every((entry) => {
    const key = `${entry.page}:${entry.pageImageSha256}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }) ? result : null
}

function normalizeParts(value, questionId) {
  if (!Array.isArray(value) || !value.length) return null
  const seen = new Set()
  const result = []
  for (const part of value) {
    const label = text(part?.label, 80)
    const marks = Number(part?.marks)
    if (!label || !Number.isInteger(marks) || marks <= 0 || seen.has(label)) return null
    seen.add(label)
    const canonicalPartId = `${questionId}:part-${label}`
    const suppliedPartId = text(part?.partId || part?.questionPartId, 360)
    if (suppliedPartId && suppliedPartId !== canonicalPartId) return null
    result.push({
      partId: canonicalPartId,
      label,
      marks,
      ocrText: text(part?.ocrText || part?.prompt || part?.questionText, 6000),
    })
  }
  return result
}

function componentNumbers(value) {
  return [...String(value || '').matchAll(/(?:^|\D)([1-6])(?:\D|$)/g)].map((match) => Number(match[1]))
}

function topicMatchesComponent(topic, component) {
  const numbers = componentNumbers(topic?.component)
  return !numbers.length || numbers.includes(Number(component))
}

function sourceProvenanceMatchesRoute(source, route) {
  const sourceSpecificationId = text(source?.specificationId, 160)
  const canonicalSpecificationId = `cambridge-${route.subjectCode}-${route.syllabus.version}`
  const specificationMatches = sourceSpecificationId === route.routeId
    || sourceSpecificationId === canonicalSpecificationId
  const expectedBoard = text(route.syllabus.board, 160).toLowerCase()
  const sourceBoard = text(source?.board, 160).toLowerCase()
  const boardMatches = sourceBoard === expectedBoard
    || (expectedBoard === 'cambridge international' && sourceBoard === 'cie')
  return specificationMatches
    && boardMatches
    && Boolean(text(source?.rightsStatus, 120))
    && Boolean(text(source?.accessPolicyId, 120))
}

function exactPages(regions) {
  return [...new Set(regions.map((region) => region.page))].sort((left, right) => left - right)
}

function contiguousPages(pages) {
  if (!pages.length) return false
  return pages.every((page, index) => index === 0 || page === pages[index - 1] + 1)
}

function canonicalQuestionNumber(value) {
  const rawNumber = text(value, 40)
  return /^[1-9]\d*$/.test(rawNumber) ? rawNumber : ''
}

function canonicalQuestionNumberSet(questions) {
  if (!Array.isArray(questions)) return null
  const numbers = []
  const seen = new Set()
  for (const question of questions) {
    const number = canonicalQuestionNumber(question?.questionNumber)
    if (!number || seen.has(number)) return null
    seen.add(number)
    numbers.push(number)
  }
  return numbers
}

function questionEntry({ artifact, candidate, verification, metadata, route, topic, source, pageSizes, markSchemePageSizes, pageImageHashes, markSchemePageHashes }) {
  const rawNumber = text(candidate?.questionNumber, 40)
  const questionNumber = canonicalQuestionNumber(rawNumber)
  if (!questionNumber) return null
  const questionId = `${metadata.paperId}:q${questionNumber}`
  if (text(candidate?.sourceQuestionId, 360) && text(candidate.sourceQuestionId, 360) !== questionId) return null
  if (text(verification?.sourceQuestionId, 360) && text(verification.sourceQuestionId, 360) !== questionId) return null

  const candidateRegions = (Array.isArray(candidate?.regions) ? candidate.regions : [])
    .map((region) => normalizeRegion(region, pageSizes, pageImageHashes))
  const candidateDiagrams = (Array.isArray(candidate?.diagramRegions) ? candidate.diagramRegions : [])
    .map((region) => normalizeRegion(region, pageSizes, pageImageHashes))
  if (candidateRegions.some((region) => !region) || candidateDiagrams.some((region) => !region)) return null
  const regions = uniqueRegions(renderRegions(candidateRegions, candidateDiagrams))
  if (!regions.length) return null
  const pages = exactPages(regions)
  if (!contiguousPages(pages)) return null

  const questionStartPage = Number(candidate?.questionStartPage)
  const verifiedQuestionStartPage = Number(verification?.questionStartPage)
  if (!Number.isInteger(questionStartPage) || questionStartPage !== pages[0]
    || !Number.isInteger(verifiedQuestionStartPage) || verifiedQuestionStartPage !== questionStartPage) return null

  const verifiedPages = exactPages((Array.isArray(verification?.pages) ? verification.pages : [])
    .map((page) => ({ page: Number(page) }))
    .filter((entry) => Number.isInteger(entry.page) && entry.page > 0))
  if (JSON.stringify(verifiedPages) !== JSON.stringify(pages)) return null

  const candidateParts = normalizeParts(candidate?.parts, questionId)
  const verifiedParts = normalizeParts(verification?.parts, questionId)
  if (!candidateParts || !verifiedParts
    || JSON.stringify(candidateParts.map(({ label, marks }) => ({ label, marks })))
      !== JSON.stringify(verifiedParts.map(({ label, marks }) => ({ label, marks })))) return null

  const candidateTags = candidate?.tags && typeof candidate.tags === 'object' ? candidate.tags : null
  const verifiedTags = verification?.tags && typeof verification.tags === 'object' ? verification.tags : null
  const primaryTopicId = text(candidateTags?.primaryTopicId, 240)
  if (!candidateTags || !verifiedTags
    || !primaryTopicId
    || text(verifiedTags.primaryTopicId, 240) !== primaryTopicId
    || !sameIdSet(candidateTags.secondaryTopicIds, verifiedTags.secondaryTopicIds)
    || !sameIdSet(candidateTags.syllabusPointIds, verifiedTags.syllabusPointIds)) return null
  const secondaryTopicIds = sortedIds(candidateTags.secondaryTopicIds)
  const officialTopicsById = new Map((route.syllabus?.topics || []).map((item) => [item.id, item]))
  const primaryTopic = officialTopicsById.get(primaryTopicId)
  if (!primaryTopic
    || secondaryTopicIds.some((id) => id === primaryTopicId || !officialTopicsById.has(id))) return null
  const syllabusPointIds = sortedIds(candidateTags.syllabusPointIds)
  const taggedTopics = [primaryTopic, ...secondaryTopicIds.map((id) => officialTopicsById.get(id))]
  const officialPointsById = new Map(taggedTopics.flatMap((taggedTopic) => taggedTopic?.points || [])
    .map((point) => [point.id, point]))
  const officialPointIds = new Set(officialPointsById.keys())
  if (!officialPointIds.size || !syllabusPointIds.length || syllabusPointIds.some((id) => !officialPointIds.has(id))) return null

  const markSchemeEvidence = normalizeEvidence(candidate?.markSchemeEvidence, markSchemePageSizes, markSchemePageHashes)
  const verifiedMarkSchemeEvidence = normalizeEvidence(verification?.markSchemeEvidence, markSchemePageSizes, markSchemePageHashes)
  if (!markSchemeEvidence || !verifiedMarkSchemeEvidence
    || JSON.stringify(markSchemeEvidence) !== JSON.stringify(verifiedMarkSchemeEvidence)) return null

  const diagramRegions = uniqueRegions(candidateDiagrams)
  const verifiedDiagramCount = Number(verification?.diagramRegionCount)
  if (diagramRegions.length && (!Number.isInteger(verifiedDiagramCount) || verifiedDiagramCount !== diagramRegions.length)) return null
  if (!diagramRegions.length && verification?.diagramRegionCount !== undefined
    && (!Number.isInteger(verifiedDiagramCount) || verifiedDiagramCount !== 0)) return null
  if (Array.isArray(verification?.diagramRegions)) {
    const verifiedDiagrams = verification.diagramRegions.map((region) => normalizeRegion(region, pageSizes, pageImageHashes))
    if (verifiedDiagrams.some((region) => !region)
      || JSON.stringify(uniqueRegions(verifiedDiagrams).map(regionKey).sort()) !== JSON.stringify(diagramRegions.map(regionKey).sort())) return null
  }
  if (!topicMatchesComponent(primaryTopic, metadata.component)) return null

  const totalMarks = candidateParts.reduce((total, part) => total + part.marks, 0)
  const bindingSignature = `ai:${artifact.artifactId}:${route.routeId}:${questionNumber}`
  return Object.freeze({
    artifactId: artifact.artifactId,
    questionId,
    sourceQuestionId: questionId,
    questionNumber,
    paperId: metadata.paperId,
    paperFile: metadata.questionFile,
    markSchemeFile: metadata.markSchemeFile,
    year: metadata.year,
    session: metadata.session,
    season: metadata.season,
    component: metadata.component,
    variant: metadata.variant,
    pages,
    questionStartPage,
    regions,
    pageSizes: Object.freeze(Object.fromEntries(Object.entries(pageSizes).map(([page, size]) => [page, { width: size.width, height: size.height }]))),
    diagramRegions,
    parts: candidateParts,
    totalMarks,
    tags: Object.freeze({
      primaryTopicId,
      secondaryTopicIds: Object.freeze(secondaryTopicIds),
      syllabusPointIds: Object.freeze(syllabusPointIds),
    }),
    markSchemeEvidence: Object.freeze(markSchemeEvidence),
    bindingSignature,
    source: Object.freeze({
      questionPdfSha256: hash(source.questionPdfSha256),
      markSchemePdfSha256: hash(source.markSchemePdfSha256),
      questionFile: metadata.questionFile,
      markSchemeFile: metadata.markSchemeFile,
      pages: Object.freeze(pages),
      pageImageSha256: Object.freeze(Object.fromEntries(pages.map((page) => [page, hash(pageImageHashes[page])]))),
    }),
    syllabus: Object.freeze({
      routeId: route.routeId,
      specificationId: route.syllabus.version ? `cambridge-${route.subjectCode}-${route.syllabus.version}` : '',
      version: text(route.syllabus.version, 80),
      officialUrl: text(route.syllabus.url, 500),
      topic: Object.freeze({
        id: topic.id,
        code: text(topic.code, 40),
        name: text(topic.name, 300),
        order: Number(topic.order) || null,
        officialPage: Number(topic.officialPage) || null,
      }),
      points: Object.freeze(syllabusPointIds
        .map((pointId) => officialPointsById.get(pointId))
        .filter(Boolean)
        .map((point) => ({ id: point.id, sectionCode: text(point.sectionCode, 80), outcomeNumber: Number(point.outcomeNumber) || null, officialText: text(point.officialText, 2000) }))),
    }),
  })
}

function validateArtifact({ artifact, artifactPath, route, topic, allowedComponents, libraryRoot }) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return { reason: 'invalid-artifact' }
  const source = artifact.source && typeof artifact.source === 'object' ? artifact.source : null
  const questionFile = path.basename(String(source?.questionPdfRelativePath || source?.questionPdfPath || ''))
  const metadata = paperMetadata(questionFile)
  if (artifact.schemaVersion !== AI_PDF_INGESTION_SCHEMA_VERSION
    || artifact.status !== 'ai-verified'
    || artifact.storageMode !== 'coordinate-only'
    || !hasValidAiStudentStudyRelease(artifact)
    || text(artifact.subject, 40) !== route.subjectCode
    || text(artifact.stage, 40).toUpperCase() !== route.stage
    || text(artifact.syllabusRouteId, 160) !== route.routeId
    || !source) return { reason: 'artifact-not-released-or-route-bound' }
  if (metadata?.kind === 'qp' && !allowedComponents.includes(metadata.component)) {
    return { reason: 'invalid-paper-component', disallowedComponent: metadata.component }
  }
  const markSchemeFile = path.basename(String(source.markSchemePdfRelativePath || source.markSchemePdfPath || ''))
  const markMetadata = paperMetadata(markSchemeFile)
  if (!metadata || metadata.kind !== 'qp' || !markMetadata || markMetadata.kind !== 'ms'
    || metadata.subjectCode !== route.subjectCode
    || markMetadata.subjectCode !== metadata.subjectCode
    || markMetadata.year !== metadata.year
    || markMetadata.session !== metadata.session
    || markMetadata.component !== metadata.component
    || markMetadata.variant !== metadata.variant
    || markMetadata.markSchemeFile !== metadata.markSchemeFile
    || text(artifact.paperId, 240) !== metadata.paperId
    || !allowedComponents.includes(metadata.component)) return { reason: 'paper-binding-invalid' }
  const questionHash = hash(source.questionPdfSha256)
  const markSchemeHash = hash(source.markSchemePdfSha256)
  if (!questionHash || !markSchemeHash || artifact.artifactId !== artifactId({
    paperId: metadata.paperId,
    questionPdfSha256: questionHash,
    markSchemePdfSha256: markSchemeHash,
  })) return { reason: 'artifact-hash-binding-invalid' }
  if (!sourceProvenanceMatchesRoute(source, route)) return { reason: 'source-provenance-invalid' }

  const questionPdfPath = safeSourcePath(source, 'questionPdfPath', 'questionPdfRelativePath', libraryRoot, route.subjectCode)
  const markSchemePdfPath = safeSourcePath(source, 'markSchemePdfPath', 'markSchemePdfRelativePath', libraryRoot, route.subjectCode)
  if (!questionPdfPath || !markSchemePdfPath
    || path.basename(questionPdfPath) !== metadata.questionFile
    || path.basename(markSchemePdfPath) !== metadata.markSchemeFile) return { reason: 'source-path-invalid' }
  try {
    if (!fs.statSync(questionPdfPath).isFile() || !fs.statSync(markSchemePdfPath).isFile()
      || !fileIsPdf(questionPdfPath) || !fileIsPdf(markSchemePdfPath)
      || fileHash(questionPdfPath) !== questionHash || fileHash(markSchemePdfPath) !== markSchemeHash) return { reason: 'source-checksum-invalid' }
  } catch {
    return { reason: 'source-checksum-invalid' }
  }

  const pageSizes = numericMap(source.pageSizes)
  const markSchemePageSizes = numericMap(source.markSchemePageSizes)
  const pageImageHashes = source.pageImageHashes && typeof source.pageImageHashes === 'object' ? source.pageImageHashes : null
  const markSchemePageHashes = source.markSchemePageHashes && typeof source.markSchemePageHashes === 'object' ? source.markSchemePageHashes : null
  if (!pageSizes || !markSchemePageSizes || !pageImageHashes || !markSchemePageHashes || !Number.isInteger(Number(source.renderDpi))) return { reason: 'render-metadata-invalid' }

  const candidateQuestions = Array.isArray(artifact.candidate?.questions) ? artifact.candidate.questions : []
  const verificationQuestions = Array.isArray(artifact.verification?.questions) ? artifact.verification.questions : []
  const candidateNumbers = canonicalQuestionNumberSet(candidateQuestions)
  const verificationNumbers = canonicalQuestionNumberSet(verificationQuestions)
  if (!candidateNumbers || !verificationNumbers
    || candidateNumbers.length !== verificationNumbers.length
    || candidateNumbers.some((number) => !verificationNumbers.includes(number))) {
    return { reason: 'question-set-mismatch' }
  }
  const verificationByNumber = new Map(verificationQuestions.map((verification) => [
    canonicalQuestionNumber(verification?.questionNumber),
    verification,
  ]))
  const entries = []
  for (const candidate of candidateQuestions) {
    const entry = questionEntry({
      artifact,
      candidate,
      verification: verificationByNumber.get(canonicalQuestionNumber(candidate?.questionNumber)),
      metadata,
      route,
      topic,
      source,
      pageSizes,
      markSchemePageSizes,
      pageImageHashes,
      markSchemePageHashes,
    })
    if (!entry) return { reason: 'question-entry-invalid' }
    if (entry.tags.primaryTopicId === topic.id || entry.tags.secondaryTopicIds.includes(topic.id)) {
      entries.push({ ...entry, questionPdfPath, markSchemePdfPath, artifactPath })
    }
  }
  return { entries }
}

function discoverArtifactPaths(root) {
  const resolvedRoot = path.resolve(String(root || ''))
  if (!fs.statSync(resolvedRoot, { throwIfNoEntry: false })?.isDirectory()) return []
  const paths = []
  const stack = [resolvedRoot]
  while (stack.length && paths.length <= MAX_ARTIFACTS) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(fullPath)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) paths.push(fullPath)
    }
  }
  return paths.slice(0, MAX_ARTIFACTS)
}

function questionSort(left, right) {
  return right.year - left.year
    || (SESSION_ORDER[right.session] || 0) - (SESSION_ORDER[left.session] || 0)
    || right.component - left.component
    || right.variant - left.variant
    || Number(left.questionNumber) - Number(right.questionNumber)
    || left.questionId.localeCompare(right.questionId)
}

function safeManifestQuestion(entry) {
  return {
    questionId: entry.questionId,
    sourceQuestionId: entry.sourceQuestionId,
    paperId: entry.paperId,
    artifactId: entry.artifactId,
    questionNumber: entry.questionNumber,
    year: entry.year,
    session: entry.session,
    season: entry.season,
    component: entry.component,
    variant: entry.variant,
    pages: [...entry.pages],
    questionStartPage: entry.questionStartPage,
    regions: entry.regions.map(({ page, x0, y0, x1, y1, pageImageSha256 }) => ({ page, x0, y0, x1, y1, pageImageSha256 })),
    diagramRegions: entry.diagramRegions.map(({ page, x0, y0, x1, y1, pageImageSha256 }) => ({ page, x0, y0, x1, y1, pageImageSha256 })),
    parts: entry.parts.map(({ partId, label, marks, ocrText }) => ({ partId, label, marks, ocrText })),
    tags: {
      primaryTopicId: entry.tags.primaryTopicId,
      secondaryTopicIds: [...entry.tags.secondaryTopicIds],
      syllabusPointIds: [...entry.tags.syllabusPointIds],
    },
    markSchemeEvidence: entry.markSchemeEvidence.map(({ page, pageImageSha256 }) => ({ page, pageImageSha256 })),
    binding: {
      bindingSignature: entry.bindingSignature,
      questionPdfSha256: entry.source.questionPdfSha256,
      markSchemePdfSha256: entry.source.markSchemePdfSha256,
      pageImageSha256: { ...entry.source.pageImageSha256 },
    },
    source: {
      questionFile: entry.source.questionFile,
      markSchemeFile: entry.source.markSchemeFile,
      questionPdfSha256: entry.source.questionPdfSha256,
      markSchemePdfSha256: entry.source.markSchemePdfSha256,
      pages: [...entry.source.pages],
    },
    syllabus: {
      routeId: entry.syllabus.routeId,
      specificationId: entry.syllabus.specificationId,
      version: entry.syllabus.version,
      officialUrl: entry.syllabus.officialUrl,
      topic: { ...entry.syllabus.topic },
      points: entry.syllabus.points.map((point) => ({ ...point })),
    },
  }
}

function assertPdfOutput(filePath, code) {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.size < 5 || !fileIsPdf(filePath)) throw codedError(code)
}

function bounded(operation, timeoutMs, timeoutCode, failureCode) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(codedError(timeoutCode))
    }, timeoutMs)
    Promise.resolve()
      .then(operation)
      .then((value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error?.code ? error : codedError(failureCode, error?.message || failureCode))
      })
  })
}

function runProcess(command, args, { timeoutMs, code = 'topic_pdf_render_failed' } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* The process may already have exited. */ }
      finish(codedError('topic_pdf_timeout'))
    }, timeoutMs)
    child.once('error', () => finish(codedError(code)))
    child.once('exit', (exitCode) => finish(exitCode === 0 ? null : codedError(code)))
  })
}

async function runCropProcess(command, manifest, timeoutMs) {
  fs.mkdirSync(manifest.outputDirectory, { recursive: true })
  await runProcess(command.command, command.args, { timeoutMs })
}

async function mergePdfFiles(outputPath, inputPaths, timeoutMs) {
  if (!inputPaths.length) throw codedError('topic_pdf_empty')
  const executable = process.platform === 'win32' ? 'py' : 'python3'
  const args = process.platform === 'win32'
    ? ['-3.12', '-c', PDF_MERGE_PROGRAM, outputPath, ...inputPaths]
    : ['-c', PDF_MERGE_PROGRAM, outputPath, ...inputPaths]
  await runProcess(executable, args, { timeoutMs, code: 'topic_pdf_merge_failed' })
}

function resolveTimeout(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(250, Math.floor(numeric)))
}

/**
 * Build a topic PDF only for the current request. Source pages and coordinate
 * bindings stay in the artifact; derived question/topic PDFs live only in a
 * bounded temporary directory and are removed in finally.
 */
export function createTopicPdfRenderer({
  artifactRoot,
  libraryRoot,
  artifactPaths = discoverArtifactPaths,
  runCropCommand = (command, manifest, options) => runCropProcess(command, manifest, options?.timeoutMs || DEFAULT_TIMEOUT_MS),
  mergePdfs = (outputPath, inputPaths, options) => mergePdfFiles(outputPath, inputPaths, options?.timeoutMs || DEFAULT_TIMEOUT_MS),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pythonPath,
  pythonArgs,
} = {}) {
  const resolvedArtifactRoot = path.resolve(String(artifactRoot || ''))
  const resolvedLibraryRoot = path.resolve(String(libraryRoot || ''))
  const boundedTimeoutMs = resolveTimeout(timeoutMs)
  return async function renderTopicPdf({ routeId, topicId } = {}) {
    const requestedRouteId = text(routeId, 160).toLowerCase()
    const requestedTopicId = text(topicId, 240)
    if (!SAFE_ROUTE.test(requestedRouteId) || !supportsSyllabusPracticeRoute(requestedRouteId)) throw codedError('invalid_route', 'A supported syllabus route is required.', 400)
    const route = routeById(requestedRouteId)
    const topic = route?.syllabus?.topics?.find((candidate) => candidate.id === requestedTopicId)
    if (!route || !topic) throw codedError('invalid_topic', 'An exact official syllabus topic is required.', 400)
    const allowedComponents = syllabusPracticeComponentsForRoute(requestedRouteId).map(Number)
    if (!allowedComponents.length) throw codedError('invalid_paper_component', 'This route has no Topic Drill paper component.', 400)

    const entries = []
    let disallowedComponent = null
    let paths
    try {
      paths = artifactPaths === discoverArtifactPaths
        ? artifactPaths(resolvedArtifactRoot)
        : artifactPaths(resolvedArtifactRoot)
    } catch {
      paths = []
    }
    const boundedPaths = Array.isArray(paths) ? paths.slice(0, MAX_ARTIFACTS) : []
    for (const artifactPath of boundedPaths) {
      if (typeof artifactPath !== 'string' || !path.isAbsolute(artifactPath)) continue
      let artifact
      try {
        artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
      } catch {
        continue
      }
      const result = validateArtifact({ artifact, artifactPath, route, topic, allowedComponents, libraryRoot: resolvedLibraryRoot })
      if (result.disallowedComponent) {
        disallowedComponent = result.disallowedComponent
        continue
      }
      if (result.entries?.length) entries.push(...result.entries)
    }
    if (!entries.length) {
      if (disallowedComponent !== null) throw codedError('invalid_paper_component', 'This paper component is not eligible for Topic Drill.', 400)
      throw codedError('topic_pdf_empty', 'No released, syllabus-bound questions are available for this topic.', 404)
    }

    const byQuestion = new Map()
    for (const entry of entries) {
      const existing = byQuestion.get(entry.questionId)
      if (!existing) {
        byQuestion.set(entry.questionId, entry)
        continue
      }
      const comparable = JSON.stringify({
        artifactId: entry.artifactId,
        paperId: entry.paperId,
        pages: entry.pages,
        regions: entry.regions,
        diagramRegions: entry.diagramRegions,
        parts: entry.parts,
        tags: entry.tags,
        markSchemeEvidence: entry.markSchemeEvidence,
      })
      const previous = JSON.stringify({
        artifactId: existing.artifactId,
        paperId: existing.paperId,
        pages: existing.pages,
        regions: existing.regions,
        diagramRegions: existing.diagramRegions,
        parts: existing.parts,
        tags: existing.tags,
        markSchemeEvidence: existing.markSchemeEvidence,
      })
      if (comparable !== previous) throw codedError('topic_pdf_binding_mismatch', 'Duplicate source questions have conflicting bindings.', 409)
    }
    const orderedEntries = [...byQuestion.values()].sort(questionSort)
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-topic-pdf-'))
    try {
      const questionPdfs = []
      for (const entry of orderedEntries) {
        const cropManifest = buildCropManifest({
          paperId: entry.paperId,
          questionId: entry.questionId,
          sourcePdfPath: entry.questionPdfPath,
          sourcePdfSha256: entry.source.questionPdfSha256,
          regions: entry.regions,
          pageSizes: entry.pageSizes,
          outputRoot: temporaryRoot,
        })
        const command = buildCropCommand(cropManifest, { pythonPath, pythonArgs })
        const result = await bounded(
          () => runCropCommand(command, cropManifest, { timeoutMs: boundedTimeoutMs }),
          boundedTimeoutMs,
          'topic_pdf_timeout',
          'topic_pdf_render_failed',
        )
        if (Buffer.isBuffer(result)) {
          fs.mkdirSync(path.dirname(cropManifest.questionPdfPath), { recursive: true })
          fs.writeFileSync(cropManifest.questionPdfPath, result)
        }
        try { assertPdfOutput(cropManifest.questionPdfPath, 'topic_pdf_render_failed') } catch (error) {
          if (error?.code === 'topic_pdf_timeout') throw error
          throw codedError('topic_pdf_render_failed')
        }
        questionPdfs.push(cropManifest.questionPdfPath)
      }
      const outputPath = path.join(temporaryRoot, 'topic.pdf')
      const mergeResult = await bounded(
        () => mergePdfs(outputPath, questionPdfs, { timeoutMs: boundedTimeoutMs }),
        boundedTimeoutMs,
        'topic_pdf_timeout',
        'topic_pdf_merge_failed',
      )
      if (Buffer.isBuffer(mergeResult)) fs.writeFileSync(outputPath, mergeResult)
      assertPdfOutput(outputPath, 'topic_pdf_merge_failed')
      const pdf = fs.readFileSync(outputPath)
      const manifest = {
        schemaVersion: TOPIC_PDF_RENDER_SCHEMA_VERSION,
        routeId: route.routeId,
        subject: route.subjectCode,
        stage: route.stage,
        renderMode: 'on-demand-coordinate-only',
        generatedAt: new Date().toISOString(),
        topic: {
          id: topic.id,
          code: text(topic.code, 40),
          name: text(topic.name, 300),
          order: Number(topic.order) || null,
          officialPage: Number(topic.officialPage) || null,
          syllabusVersion: text(route.syllabus.version, 80),
          officialUrl: text(route.syllabus.url, 500),
        },
        questionCount: orderedEntries.length,
        pdfSha256: fileHash(outputPath),
        questions: orderedEntries.map(safeManifestQuestion),
      }
      return Object.freeze({ pdf, manifest: Object.freeze(manifest), contentType: 'application/pdf' })
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  }
}
