import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { routeById } from '../../src/data/routeRegistry.js'

const WHOLE_QUESTION_NUMBER = /^[1-9][0-9]*$/
const ZERO_COUNTS = Object.freeze({ questions: 0, parts: 0, marks: 0, topics: 0, points: 0 })
const REQUIRED_REVIEW_CHECKS = Object.freeze([
  'whole_question_boundaries',
  'question_part_structure',
  'qp_ms_question_binding',
  'diagram_region_integrity',
  'official_syllabus_topic_binding',
])
const ELIGIBLE_ROUTE_COMPONENTS = Object.freeze({
  'cie-9702-as-physics': Object.freeze([1, 2]),
  'cie-9702-a2-physics': Object.freeze([4]),
  'cie-9709-as-p1-p2': Object.freeze([1, 2]),
  'cie-9709-as-p1-p4': Object.freeze([1, 4]),
  'cie-9709-as-p1-p5': Object.freeze([1, 5]),
  'cie-9709-a2-after-p1-p5-p3-p4': Object.freeze([3, 4]),
  'cie-9709-a2-after-p1-p5-p3-p6': Object.freeze([3, 6]),
  'cie-9709-a2-after-p1-p4-p3-p5': Object.freeze([3, 5]),
  'cie-0580-igcse-mathematics': Object.freeze([1, 2, 3, 4]),
  'cie-0625-igcse-physics': Object.freeze([2]),
})

export function validateSyllabusBindings({
  extraction,
  verification,
  routeId,
  subjectCode,
  component,
  source,
} = {}) {
  const selectedRouteId = requiredString(routeId, 'REVIEW_ROUTE_INVALID')
  const route = routeById(selectedRouteId)
  if (!route || !Object.hasOwn(ELIGIBLE_ROUTE_COMPONENTS, selectedRouteId)) {
    throw codedError('REVIEW_ROUTE_UNSUPPORTED')
  }
  const paperComponent = requiredPositiveInteger(component, 'PAPER_COMPONENT_INVALID')
  const sourceSubjectCode = requiredString(subjectCode, 'SUBJECT_CODE_INVALID')
  if (String(route.syllabus?.code || '') !== sourceSubjectCode) throw codedError('REVIEW_ROUTE_SUBJECT_MISMATCH')
  if (!ELIGIBLE_ROUTE_COMPONENTS[selectedRouteId].includes(paperComponent)
    || !route.paperComponents.includes(paperComponent)) {
    throw codedError('COMPONENT_ROUTE_NOT_ELIGIBLE')
  }

  assertObject(extraction, 'REVIEW_EXTRACTION_INVALID')
  assertObject(verification, 'REVIEW_VERIFICATION_INVALID')
  assertDeclaredRoute(extraction, selectedRouteId)
  assertDeclaredRoute(verification, selectedRouteId)

  const sourceMetadata = validateSourceMetadata(source)
  assertDraftSource(extraction.source, sourceMetadata)
  if (verification.source !== undefined && verification.source !== null) {
    assertDraftSource(verification.source, sourceMetadata)
  }

  const extractionQuestions = validateQuestionList(extraction.questions, 'extraction')
  const verificationQuestions = validateQuestionList(verification.questions, 'verification')
  const extractionNumbers = extractionQuestions.map((question) => question.questionNumber)
  const verificationNumbers = verificationQuestions.map((question) => question.questionNumber)
  if (!sameArray(extractionNumbers, verificationNumbers)) throw codedError('REVIEW_QUESTION_SET_MISMATCH')
  assertQuestionStarts(verification.questionStarts, verificationQuestions)

  const topicProjection = officialTopicProjection(route, paperComponent)
  const pointProjection = new Map([...topicProjection.values()]
    .flatMap((topic) => Array.isArray(topic.points) ? topic.points : [])
    .map((point) => [point.id, point]))
  if (!topicProjection.size || !pointProjection.size) throw codedError('OFFICIAL_SYLLABUS_PROJECTION_EMPTY')

  const countedTopics = new Set()
  const countedPoints = new Set()
  let partCount = 0
  let totalMarks = 0

  for (let index = 0; index < extractionQuestions.length; index += 1) {
    const candidate = extractionQuestions[index]
    const reviewed = verificationQuestions[index]
    assertQuestionIdentity(candidate, reviewed, sourceMetadata)

    const candidateParts = validateParts(candidate.parts)
    const reviewedParts = validateParts(reviewed.parts)
    if (canonicalJson(candidateParts) !== canonicalJson(reviewedParts)) {
      throw codedError('REVIEW_PARTS_MARKS_MISMATCH')
    }

    const candidateTags = validateTags(candidate.tags, topicProjection, pointProjection)
    const reviewedTags = validateTags(reviewed.tags, topicProjection, pointProjection)
    if (candidateTags.primaryTopicId !== reviewedTags.primaryTopicId
      || !sameSet(candidateTags.secondaryTopicIds, reviewedTags.secondaryTopicIds)) {
      throw codedError('REVIEW_SYLLABUS_TOPICS_MISMATCH')
    }
    if (!sameSet(candidateTags.syllabusPointIds, reviewedTags.syllabusPointIds)) {
      throw codedError('REVIEW_SYLLABUS_POINTS_MISMATCH')
    }

    for (const topicId of [candidateTags.primaryTopicId, ...candidateTags.secondaryTopicIds]) countedTopics.add(topicId)
    for (const pointId of candidateTags.syllabusPointIds) countedPoints.add(pointId)
    partCount += candidateParts.length
    totalMarks += candidateParts.reduce((sum, part) => sum + part.marks, 0)
  }

  return Object.freeze({
    status: 'PASS',
    errorCode: null,
    counts: Object.freeze({
      questions: extractionQuestions.length,
      parts: partCount,
      marks: totalMarks,
      topics: countedTopics.size,
      points: countedPoints.size,
    }),
  })
}

export function validateReviewFromWorkRoot({ workRoot, reviewId, routeId } = {}) {
  const root = requiredExistingDirectory(workRoot)
  const canonicalReviewId = normalizeReviewId(reviewId)
  const jobKey = canonicalReviewId.slice('sha256:'.length)
  const selectedRouteId = requiredString(routeId, 'REVIEW_ROUTE_INVALID')
  if (!routeById(selectedRouteId)) throw codedError('REVIEW_ROUTE_UNSUPPORTED')

  const manifest = readJsonFile(resolveInside(root, 'manifest/manifest.json'), 'PADDLE_MANIFEST_INVALID', 256 * 1024 * 1024)
  if (manifest.schemaVersion !== 'stem-paddle-ocr-manifest.v1' || !Array.isArray(manifest.jobs)) {
    throw codedError('PADDLE_MANIFEST_INVALID')
  }
  const matchingJobs = manifest.jobs.filter((job) => job?.jobId === canonicalReviewId)
  if (matchingJobs.length !== 1) throw codedError(matchingJobs.length ? 'PADDLE_MANIFEST_JOB_DUPLICATE' : 'PADDLE_MANIFEST_JOB_MISSING')
  const job = matchingJobs[0]
  validateJobIdentity(job, { canonicalReviewId, jobKey })

  const queueRows = readJsonLines(resolveInside(root, 'queue/structure-review.jsonl'))
  const matchingRows = queueRows.filter((row) => row?.reviewId === canonicalReviewId)
  if (matchingRows.length !== 1) throw codedError(matchingRows.length ? 'PADDLE_REVIEW_QUEUE_DUPLICATE' : 'PADDLE_REVIEW_QUEUE_JOB_MISSING')
  const queueRow = matchingRows[0]
  validateQueueRow(queueRow, job)

  const expectedStatePath = `state/jobs/${jobKey}.json`
  if (normalizeRelativePath(job.statePath) !== expectedStatePath) throw codedError('PADDLE_STATE_PATH_MISMATCH')
  const state = readJsonFile(resolveInside(root, expectedStatePath), 'PADDLE_STATE_INVALID')
  validateCompletedState(state, job)

  const artifactPath = normalizeRelativePath(job.stagingArtifactPath)
  if (!artifactPath || normalizeRelativePath(queueRow.artifactPath) !== artifactPath) {
    throw codedError('PADDLE_REVIEW_ARTIFACT_PATH_MISMATCH')
  }
  const artifact = readJsonFile(resolveInside(root, artifactPath), 'PADDLE_STAGING_ARTIFACT_INVALID')
  validateStagingArtifact(artifact, job, selectedRouteId)

  const draftRoot = resolveInside(root, path.join('review-drafts', jobKey, selectedRouteId))
  const extraction = readJsonFile(resolveInside(draftRoot, 'extraction.json'), 'REVIEW_EXTRACTION_INVALID')
  const verification = readJsonFile(resolveInside(draftRoot, 'verification.json'), 'REVIEW_VERIFICATION_INVALID')
  const source = sourceMetadataFromState(state, job)

  return validateSyllabusBindings({
    extraction,
    verification,
    routeId: selectedRouteId,
    subjectCode: job.subject,
    component: job.component,
    source,
  })
}

function validateJobIdentity(job, { canonicalReviewId, jobKey }) {
  if (!job || typeof job !== 'object' || Array.isArray(job)
    || job.schemaVersion !== 'stem-paddle-ocr-job.v1'
    || job.jobId !== canonicalReviewId
    || job.jobKey !== jobKey
    || !requiredString(job.paperId, 'PADDLE_JOB_INVALID')
    || !requiredString(job.subject, 'PADDLE_JOB_INVALID')
    || !Number.isInteger(job.component)
    || !Array.isArray(job.routeBindings)) {
    throw codedError('PADDLE_JOB_INVALID')
  }
  for (const documentType of ['qp', 'ms']) {
    const document = job.documents?.[documentType]
    if (!normalizedHash(document?.sha256) || !Number.isInteger(document?.pageCount) || document.pageCount < 1) {
      throw codedError('PADDLE_JOB_SOURCE_INVALID')
    }
  }
}

function validateQueueRow(row, job) {
  if (row?.schemaVersion !== 'stem-paddle-ocr-structure-review.v1'
    || row.reviewId !== job.jobId
    || row.paperId !== job.paperId
    || row.status !== 'pending_provider_review'
    || row.studentStudyEligible !== false
    || !Array.isArray(row.requiredChecks)
    || !REQUIRED_REVIEW_CHECKS.every((check) => row.requiredChecks.includes(check))) {
    throw codedError('PADDLE_REVIEW_QUEUE_INVALID')
  }
}

function validateCompletedState(state, job) {
  if (state?.schemaVersion !== 'stem-paddle-ocr-job-state.v1'
    || state.jobId !== job.jobId
    || state.paperId !== job.paperId
    || state.status !== 'completed') {
    throw codedError('PADDLE_STATE_INVALID')
  }
  for (const documentType of ['qp', 'ms']) {
    const stateDocument = state.documents?.[documentType]
    const jobDocument = job.documents[documentType]
    if (stateDocument?.status !== 'completed'
      || normalizedHash(stateDocument.sourceSha256) !== normalizedHash(jobDocument.sha256)
      || stateDocument.pageCount !== jobDocument.pageCount
      || !stateDocument.pages || typeof stateDocument.pages !== 'object') {
      throw codedError('PADDLE_STATE_SOURCE_MISMATCH')
    }
  }
}

function validateStagingArtifact(artifact, job, routeId) {
  if (artifact?.schemaVersion !== 'stem-paddle-ocr-staging-artifact.v1'
    || artifact.artifactId !== job.jobId
    || artifact.paperId !== job.paperId
    || String(artifact.subject || '') !== String(job.subject)
    || artifact.component !== job.component
    || artifact.status !== 'ocr-complete-pending-review'
    || artifact.reviewStatus !== 'pending_ai_structure_review'
    || artifact.syllabusBinding?.status !== 'pending_official_review'
    || artifact.studentStudyEligible !== false
    || artifact.formalProgressEligible !== false
    || !Array.isArray(artifact.questionGroups)
    || artifact.questionGroups.length !== 0) {
    throw codedError('PADDLE_STAGING_ARTIFACT_INVALID')
  }
  if (artifact.sourcePair?.bindingMethod !== 'exact_filename_substitution_and_sha256') {
    throw codedError('PADDLE_SOURCE_BINDING_INVALID')
  }
  for (const [documentType, sourcePairKey] of [['qp', 'questionPaper'], ['ms', 'markScheme']]) {
    const staged = artifact.sourcePair?.[sourcePairKey]
    const expected = job.documents[documentType]
    if (normalizedHash(staged?.sha256) !== normalizedHash(expected.sha256) || staged?.pageCount !== expected.pageCount) {
      throw codedError('PADDLE_SOURCE_BINDING_MISMATCH')
    }
  }
  assertCandidateRoute(job.routeBindings, routeId, job.component, routeById(routeId)?.stage)
  assertCandidateRoute(artifact.syllabusBinding.routeBindings, routeId, job.component, routeById(routeId)?.stage)
}

function assertCandidateRoute(bindings, routeId, component, stage) {
  if (!Array.isArray(bindings)) throw codedError('PADDLE_ROUTE_BINDING_INVALID')
  const matches = bindings.filter((binding) => binding?.routeCandidateId === routeId)
  if (matches.length !== 1) throw codedError(matches.length ? 'PADDLE_ROUTE_BINDING_DUPLICATE' : 'PADDLE_ROUTE_BINDING_MISSING')
  const binding = matches[0]
  if (binding.component !== component
    || binding.paper !== `P${component}`
    || binding.qualificationStage !== stage
    || binding.routeResolutionStatus !== 'candidate_requires_adapter_validation'
    || binding.reviewStatus !== 'pending_official_review') {
    throw codedError('PADDLE_ROUTE_BINDING_INVALID')
  }
}

function sourceMetadataFromState(state, job) {
  return validateSourceMetadata({
    questionPdfSha256: job.documents.qp.sha256,
    markSchemePdfSha256: job.documents.ms.sha256,
    questionPageHashes: pageHashMap(state.documents.qp.pages),
    markSchemePageHashes: pageHashMap(state.documents.ms.pages),
  })
}

function pageHashMap(pages) {
  const hashes = {}
  for (const [key, value] of Object.entries(pages || {})) {
    const page = Number(key)
    if (!Number.isInteger(page) || page < 1 || value?.sourcePage?.page !== page || !normalizedHash(value?.sourcePage?.sha256)) {
      throw codedError('PADDLE_STATE_PAGE_SOURCE_INVALID')
    }
    hashes[page] = normalizedHash(value.sourcePage.sha256)
  }
  if (!Object.keys(hashes).length) throw codedError('PADDLE_STATE_PAGE_SOURCE_INVALID')
  return hashes
}

function validateSourceMetadata(source) {
  assertObject(source, 'REVIEW_SOURCE_INVALID')
  const questionPdfSha256 = normalizedHash(source.questionPdfSha256)
  const markSchemePdfSha256 = normalizedHash(source.markSchemePdfSha256)
  const questionPageHashes = normalizedPageHashes(source.questionPageHashes)
  const markSchemePageHashes = normalizedPageHashes(source.markSchemePageHashes)
  if (!questionPdfSha256 || !markSchemePdfSha256 || !questionPageHashes.size || !markSchemePageHashes.size) {
    throw codedError('REVIEW_SOURCE_INVALID')
  }
  return { questionPdfSha256, markSchemePdfSha256, questionPageHashes, markSchemePageHashes }
}

function normalizedPageHashes(value) {
  if (value instanceof Map) {
    const hashes = new Map()
    for (const [page, rawHash] of value) {
      const hash = normalizedHash(rawHash)
      if (!Number.isInteger(page) || page < 1 || !hash || hashes.has(page)) throw codedError('REVIEW_SOURCE_PAGE_HASH_INVALID')
      hashes.set(page, hash)
    }
    return hashes
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map()
  const hashes = new Map()
  for (const [key, rawHash] of Object.entries(value)) {
    const page = Number(key)
    const hash = normalizedHash(rawHash)
    if (!Number.isInteger(page) || page < 1 || !hash || hashes.has(page)) throw codedError('REVIEW_SOURCE_PAGE_HASH_INVALID')
    hashes.set(page, hash)
  }
  return hashes
}

function assertDraftSource(draftSource, source) {
  assertObject(draftSource, 'REVIEW_SOURCE_BINDING_MISSING')
  if (normalizedHash(draftSource.questionPdfSha256) !== source.questionPdfSha256
    || normalizedHash(draftSource.markSchemePdfSha256) !== source.markSchemePdfSha256) {
    throw codedError('REVIEW_SOURCE_BINDING_MISMATCH')
  }
}

function officialTopicProjection(route, component) {
  const routeTopics = Array.isArray(route.syllabus?.topics) ? route.syllabus.topics : []
  const projectedTopics = String(route.syllabus?.code || '') === '9709'
    ? routeTopics.filter((topic) => topic?.component === component)
    : routeTopics
  return new Map(projectedTopics.map((topic) => [topic.id, topic]))
}

function validateQuestionList(questions, sourceName) {
  if (!Array.isArray(questions) || questions.length < 1) throw codedError(`REVIEW_${sourceName.toUpperCase()}_QUESTIONS_INVALID`)
  const seen = new Set()
  let previousNumber = 0
  for (const question of questions) {
    if (!question || typeof question !== 'object' || Array.isArray(question)
      || typeof question.questionNumber !== 'string'
      || !WHOLE_QUESTION_NUMBER.test(question.questionNumber)) {
      throw codedError('REVIEW_QUESTION_ID_INVALID')
    }
    if (seen.has(question.questionNumber)) throw codedError('REVIEW_QUESTION_DUPLICATE')
    const numericNumber = Number(question.questionNumber)
    if (numericNumber <= previousNumber) throw codedError('REVIEW_QUESTION_ORDER_INVALID')
    seen.add(question.questionNumber)
    previousNumber = numericNumber
  }
  return questions
}

function assertQuestionStarts(questionStarts, questions) {
  if (!Array.isArray(questionStarts) || questionStarts.length !== questions.length) {
    throw codedError('REVIEW_QUESTION_STARTS_MISMATCH')
  }
  const seen = new Set()
  for (let index = 0; index < questions.length; index += 1) {
    const questionStart = questionStarts[index]
    const question = questions[index]
    if (!questionStart || typeof questionStart !== 'object' || Array.isArray(questionStart)
      || seen.has(questionStart.questionNumber)
      || questionStart.questionNumber !== question.questionNumber
      || questionStart.questionStartPage !== question.questionStartPage) {
      throw codedError('REVIEW_QUESTION_STARTS_MISMATCH')
    }
    seen.add(questionStart.questionNumber)
  }
}

function assertQuestionIdentity(candidate, reviewed, source) {
  if (candidate.questionNumber !== reviewed.questionNumber
    || !Number.isInteger(candidate.questionStartPage)
    || candidate.questionStartPage < 1
    || candidate.questionStartPage !== reviewed.questionStartPage) {
    throw codedError('REVIEW_QUESTION_IDENTITY_MISMATCH')
  }
  const candidatePages = validateRegions(candidate.regions, source.questionPageHashes)
  const reviewedPages = validatePageList(reviewed.pages, source.questionPageHashes)
  if (!sameArray(candidatePages, reviewedPages)) throw codedError('REVIEW_QUESTION_PAGES_MISMATCH')

  if (!Array.isArray(candidate.diagramRegions) || !Number.isInteger(reviewed.diagramRegionCount)
    || reviewed.diagramRegionCount < 0 || candidate.diagramRegions.length !== reviewed.diagramRegionCount) {
    throw codedError('REVIEW_DIAGRAM_COUNT_MISMATCH')
  }
  for (const region of candidate.diagramRegions) validateRegion(region, source.questionPageHashes)
  assertMarkSchemeEvidence(candidate.markSchemeEvidence, reviewed.markSchemeEvidence, source.markSchemePageHashes)
}

function validateRegions(regions, pageHashes) {
  if (!Array.isArray(regions) || !regions.length) throw codedError('REVIEW_QUESTION_REGIONS_INVALID')
  const pages = []
  for (const region of regions) {
    validateRegion(region, pageHashes)
    if (!pages.includes(region.page)) pages.push(region.page)
  }
  if (pages[0] === undefined || pages.some((page, index) => index > 0 && page <= pages[index - 1])) {
    throw codedError('REVIEW_QUESTION_REGIONS_INVALID')
  }
  return pages
}

function validateRegion(region, pageHashes) {
  if (!region || typeof region !== 'object' || Array.isArray(region)
    || !Number.isInteger(region.page) || !pageHashes.has(region.page)
    || normalizedHash(region.pageImageSha256) !== pageHashes.get(region.page)
    || !normalizedCoordinate(region.x0) || !normalizedCoordinate(region.y0)
    || !normalizedCoordinate(region.x1) || !normalizedCoordinate(region.y1)
    || region.x0 >= region.x1 || region.y0 >= region.y1) {
    throw codedError('REVIEW_REGION_SOURCE_INVALID')
  }
}

function validatePageList(pages, pageHashes) {
  if (!Array.isArray(pages) || !pages.length) throw codedError('REVIEW_QUESTION_PAGES_INVALID')
  const seen = new Set()
  for (const page of pages) {
    if (!Number.isInteger(page) || !pageHashes.has(page) || seen.has(page)) throw codedError('REVIEW_QUESTION_PAGES_INVALID')
    seen.add(page)
  }
  return pages
}

function assertMarkSchemeEvidence(candidateEvidence, reviewedEvidence, pageHashes) {
  const candidate = normalizeEvidence(candidateEvidence, pageHashes)
  const reviewed = normalizeEvidence(reviewedEvidence, pageHashes)
  if (canonicalJson(candidate) !== canonicalJson(reviewed)) throw codedError('REVIEW_MARK_SCHEME_EVIDENCE_MISMATCH')
}

function normalizeEvidence(evidence, pageHashes) {
  if (!Array.isArray(evidence) || !evidence.length) throw codedError('REVIEW_MARK_SCHEME_EVIDENCE_INVALID')
  const seen = new Set()
  return evidence.map((item) => {
    const hash = normalizedHash(item?.pageImageSha256)
    if (!Number.isInteger(item?.page) || !pageHashes.has(item.page) || hash !== pageHashes.get(item.page)) {
      throw codedError('REVIEW_MARK_SCHEME_EVIDENCE_INVALID')
    }
    const key = `${item.page}:${hash}`
    if (seen.has(key)) throw codedError('REVIEW_MARK_SCHEME_EVIDENCE_DUPLICATE')
    seen.add(key)
    return { page: item.page, pageImageSha256: hash }
  })
}

function validateParts(parts) {
  if (!Array.isArray(parts) || !parts.length) throw codedError('REVIEW_PARTS_INVALID')
  const seen = new Set()
  return parts.map((part) => {
    const label = requiredString(part?.label, 'REVIEW_PART_INVALID')
    if (seen.has(label)) throw codedError('REVIEW_PART_DUPLICATE')
    if (!Number.isInteger(part?.marks) || part.marks < 1) throw codedError('REVIEW_PART_MARKS_INVALID')
    seen.add(label)
    return { label, marks: part.marks }
  })
}

function validateTags(tags, topicProjection, pointProjection) {
  assertObject(tags, 'REVIEW_SYLLABUS_TAGS_INVALID')
  const primaryTopicId = requiredString(tags.primaryTopicId, 'REVIEW_SYLLABUS_TOPIC_REQUIRED')
  const secondaryTopicIds = uniqueStringArray(tags.secondaryTopicIds, 'REVIEW_SYLLABUS_TOPICS_INVALID')
  const syllabusPointIds = uniqueStringArray(tags.syllabusPointIds, 'REVIEW_SYLLABUS_POINTS_INVALID')
  if (!syllabusPointIds.length) throw codedError('REVIEW_SYLLABUS_POINT_REQUIRED')
  const topicIds = [primaryTopicId, ...secondaryTopicIds]
  if (new Set(topicIds).size !== topicIds.length) throw codedError('REVIEW_SYLLABUS_TOPIC_DUPLICATE')
  for (const topicId of topicIds) {
    if (!topicProjection.has(topicId)) {
      throw codedError(topicExistsOutsideProjection(topicId) ? 'SYLLABUS_TOPIC_NOT_IN_COMPONENT' : 'SYLLABUS_TOPIC_ID_UNKNOWN')
    }
  }
  for (const pointId of syllabusPointIds) {
    const point = pointProjection.get(pointId)
    if (!point) throw codedError(pointExistsOutsideProjection(pointId) ? 'SYLLABUS_POINT_NOT_IN_COMPONENT' : 'SYLLABUS_POINT_ID_UNKNOWN')
    if (!topicIds.includes(point.topicId)) throw codedError('SYLLABUS_POINT_TOPIC_MISMATCH')
  }
  return { primaryTopicId, secondaryTopicIds, syllabusPointIds }
}

function topicExistsOutsideProjection(topicId) {
  for (const routeId of Object.keys(ELIGIBLE_ROUTE_COMPONENTS)) {
    const route = routeById(routeId)
    if (route?.syllabus?.topics?.some((topic) => topic.id === topicId)) return true
  }
  return false
}

function pointExistsOutsideProjection(pointId) {
  for (const routeId of Object.keys(ELIGIBLE_ROUTE_COMPONENTS)) {
    const route = routeById(routeId)
    if (route?.syllabus?.topics?.some((topic) => topic.points?.some((point) => point.id === pointId))) return true
  }
  return false
}

function assertDeclaredRoute(document, routeId) {
  const declarations = [document.routeId, document.syllabusRouteId, document.source?.routeId, document.source?.syllabusRouteId]
    .filter((value) => value !== undefined && value !== null)
  for (const declaration of declarations) {
    if (typeof declaration !== 'string' || declaration.trim() !== routeId) throw codedError('REVIEW_ROUTE_MISMATCH')
  }
}

function uniqueStringArray(value, code) {
  if (!Array.isArray(value)) throw codedError(code)
  const normalized = value.map((item) => requiredString(item, code))
  if (new Set(normalized).size !== normalized.length) throw codedError(code)
  return normalized
}

function readJsonLines(filePath) {
  const text = readTextFile(filePath, 'PADDLE_REVIEW_QUEUE_INVALID', 128 * 1024 * 1024)
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('invalid row')
      rows.push(row)
    } catch {
      throw codedError('PADDLE_REVIEW_QUEUE_INVALID')
    }
  }
  return rows
}

function readJsonFile(filePath, code, maxBytes = 10 * 1024 * 1024) {
  try {
    const value = JSON.parse(readTextFile(filePath, code, maxBytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object')
    return value
  } catch (error) {
    if (error?.code === code) throw error
    throw codedError(code)
  }
}

function readTextFile(filePath, code, maxBytes) {
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maxBytes) throw codedError(code)
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    throw codedError(code)
  }
}

function requiredExistingDirectory(value) {
  const root = path.resolve(requiredString(value, 'WORK_ROOT_INVALID'))
  const stat = fs.lstatSync(root, { throwIfNoEntry: false })
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw codedError('WORK_ROOT_INVALID')
  return root
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, String(relativePath || ''))
  const relative = path.relative(root, target)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw codedError('REVIEW_PATH_OUTSIDE_WORK_ROOT')
  }
  return target
}

function normalizeRelativePath(value) {
  const text = typeof value === 'string' ? value.trim().replaceAll('\\', '/') : ''
  if (!text || text.startsWith('/') || /^[A-Za-z]:/.test(text) || text.split('/').includes('..')) return ''
  return text
}

function normalizeReviewId(value) {
  const text = requiredString(value, 'REVIEW_ID_INVALID').toLowerCase()
  const match = /^(?:sha256:)?([a-f0-9]{64})$/.exec(text)
  if (!match) throw codedError('REVIEW_ID_INVALID')
  return `sha256:${match[1]}`
}

function normalizedHash(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const match = /^(?:sha256:)?([a-f0-9]{64})$/.exec(text)
  return match ? match[1] : ''
}

function requiredString(value, code) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) throw codedError(code)
  return value.trim()
}

function requiredPositiveInteger(value, code) {
  if (!Number.isInteger(value) || value < 1) throw codedError(code)
  return value
}

function assertObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError(code)
}

function normalizedCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code)
    ? error.code
    : 'SYLLABUS_BINDING_VALIDATION_ERROR'
}

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index]
    const next = argv[index + 1]
    if (!['--work-root', '--review-id', '--route'].includes(argument)
      || typeof next !== 'string' || next.startsWith('--') || values.has(argument)) {
      throw codedError('CLI_ARGUMENT_INVALID')
    }
    values.set(argument, next)
  }
  if (values.size !== 3) throw codedError('CLI_ARGUMENT_INVALID')
  return {
    workRoot: values.get('--work-root'),
    reviewId: values.get('--review-id'),
    routeId: values.get('--route'),
  }
}

function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function main() {
  try {
    emit(validateReviewFromWorkRoot(parseArgs(process.argv.slice(2))))
    process.exitCode = 0
  } catch (error) {
    emit({ status: 'BLOCKED', errorCode: safeErrorCode(error), counts: { ...ZERO_COUNTS } })
    process.exitCode = 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
