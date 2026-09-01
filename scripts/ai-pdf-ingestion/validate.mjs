import {
  AI_PDF_INGESTION_LIFECYCLE,
  assertLifecycleTransition,
  normalizeRegion,
} from './contract.mjs'

const canonicalSha256Pattern = /^(?:sha256:)?([a-fA-F0-9]{64})$/
const controlledTagFields = Object.freeze([
  ['primaryTopicId', 'primaryTopicIds', false, 'TAG_PRIMARY_TOPIC_FORBIDDEN'],
  ['secondaryTopicIds', 'secondaryTopicIds', true, 'TAG_SECONDARY_TOPIC_FORBIDDEN'],
  ['syllabusPointIds', 'syllabusPointIds', true, 'TAG_SYLLABUS_POINT_FORBIDDEN'],
  ['skillTagIds', 'skillTagIds', true, 'TAG_SKILL_FORBIDDEN'],
  ['questionFormatIds', 'questionFormatIds', true, 'TAG_QUESTION_FORMAT_FORBIDDEN'],
])

export function validateCandidate({ candidate, verification, source } = {}) {
  const reasonCodes = new Set()
  const sourceData = asObject(source)
  const candidateData = asObject(candidate)
  const verificationData = asObject(verification)
  const sourceHashes = validateSource(sourceData, reasonCodes)
  const questions = Array.isArray(candidateData?.questions) ? candidateData.questions : null

  if (!candidateData || !questions) {
    reasonCodes.add('CANDIDATE_INVALID')
  } else if (questions.length === 0) {
    reasonCodes.add('QUESTIONS_INVALID')
  }

  const identities = []
  const questionNumbers = new Set()
  for (const question of questions ?? []) {
    const identity = validateQuestion(question, sourceHashes, sourceData?.controlledTags, reasonCodes)
    identities.push(identity)
    if (!identity.questionNumber) {
      reasonCodes.add('QUESTION_NUMBER_INVALID')
      continue
    }
    if (questionNumbers.has(identity.questionNumber)) {
      reasonCodes.add('QUESTION_NUMBER_DUPLICATE')
    }
    questionNumbers.add(identity.questionNumber)
  }

  validateCandidateSource(candidateData?.source, sourceData, reasonCodes)
  validateVerification(identities, verificationData, sourceHashes, reasonCodes)

  const ok = reasonCodes.size === 0
  const status = ok
    ? AI_PDF_INGESTION_LIFECYCLE.AI_VERIFIED
    : AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED

  try {
    assertLifecycleTransition(AI_PDF_INGESTION_LIFECYCLE.AI_VERIFICATION_PENDING, status)
  } catch {
    reasonCodes.add('LIFECYCLE_TRANSITION_INVALID')
  }

  return {
    ok: reasonCodes.size === 0,
    status: reasonCodes.size === 0 ? status : AI_PDF_INGESTION_LIFECYCLE.AUTO_QUARANTINED,
    reasonCodes: [...reasonCodes],
    candidate,
  }
}

function validateSource(source, reasonCodes) {
  if (!source) {
    reasonCodes.add('SOURCE_INVALID')
    return { pageImageHashes: new Map(), markSchemePageHashes: new Map() }
  }

  for (const [field, code] of [
    ['board', 'SOURCE_BOARD_INVALID'],
    ['paperId', 'SOURCE_PAPER_ID_INVALID'],
    ['specificationId', 'SOURCE_SPECIFICATION_ID_INVALID'],
    ['rightsStatus', 'SOURCE_RIGHTS_STATUS_INVALID'],
    ['accessPolicyId', 'SOURCE_ACCESS_POLICY_ID_INVALID'],
  ]) {
    if (!nonemptyString(source[field])) {
      reasonCodes.add(code)
    }
  }

  if (!canonicalSha256(source.questionPdfSha256)) {
    reasonCodes.add('SOURCE_QUESTION_PDF_SHA256_INVALID')
  }
  if (!canonicalSha256(source.markSchemePdfSha256)) {
    reasonCodes.add('SOURCE_MARK_SCHEME_PDF_SHA256_INVALID')
  }

  const pageImageHashes = validatePageHashMap(
    source.pageImageHashes,
    'SOURCE_PAGE_IMAGE_HASHES_INVALID',
    reasonCodes,
  )
  const markSchemePageHashes = validatePageHashMap(
    source.markSchemePageHashes,
    'SOURCE_MARK_SCHEME_PAGE_HASHES_INVALID',
    reasonCodes,
  )

  if (!validControlledTags(source.controlledTags)) {
    reasonCodes.add('SOURCE_CONTROLLED_TAGS_INVALID')
  }
  return { pageImageHashes, markSchemePageHashes }
}

function validateCandidateSource(candidateSource, source, reasonCodes) {
  if (!isPlainObject(candidateSource)) {
    reasonCodes.add('CANDIDATE_SOURCE_INVALID')
    return
  }

  for (const [field, code] of [
    ['questionPdfSha256', 'SOURCE_QUESTION_PDF_HASH_MISMATCH'],
    ['markSchemePdfSha256', 'SOURCE_MARK_SCHEME_PDF_HASH_MISMATCH'],
  ]) {
    if (!canonicalSha256(candidateSource[field])
      || !canonicalSha256(source?.[field])
      || normalizeHash(candidateSource[field]) !== normalizeHash(source[field])) {
      reasonCodes.add(code)
    }
  }
}

function validateQuestion(question, sourceHashes, controlledTags, reasonCodes) {
  const data = asObject(question)
  if (!data) {
    reasonCodes.add('QUESTION_INVALID')
    return emptyIdentity()
  }

  const questionNumber = nonemptyString(data.questionNumber)
  const regions = validateRegions(data.regions, sourceHashes.pageImageHashes, reasonCodes, 'REGION')
  const diagramRegions = validateRegions(data.diagramRegions, sourceHashes.pageImageHashes, reasonCodes, 'DIAGRAM_REGION', false)
  const markSchemeEvidence = validateMarkSchemeEvidence(
    data.markSchemeEvidence,
    sourceHashes.markSchemePageHashes,
    'CANDIDATE',
    reasonCodes,
  )
  const parts = validateParts(data.parts, reasonCodes)
  validateTags(data.tags, controlledTags, reasonCodes)

  return {
    questionNumber,
    pages: [...new Set([...regions, ...diagramRegions].map(region => region.page))].sort((left, right) => left - right),
    regions,
    diagramRegions,
    parts,
    diagramRegionCount: diagramRegions.length,
    markSchemeEvidence,
  }
}

function validatePageHashMap(value, reasonCode, reasonCodes) {
  const pageHashes = new Map()
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    reasonCodes.add(reasonCode)
    return pageHashes
  }
  for (const [page, hash] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(page) || !canonicalSha256(hash)) {
      reasonCodes.add(reasonCode)
      continue
    }
    pageHashes.set(Number(page), normalizeHash(hash))
  }
  return pageHashes
}

function validateRegions(value, pageImageHashes, reasonCodes, prefix, required = true) {
  if (!Array.isArray(value) || value.length === 0) {
    if (required || !Array.isArray(value)) {
      reasonCodes.add(`${prefix}S_INVALID`)
    }
    return []
  }

  const validRegions = []
  for (const region of value) {
    const data = asObject(region)
    if (!data) {
      reasonCodes.add(`${prefix}_INVALID`)
      continue
    }

    const page = data.page
    const sourceHash = pageImageHashes.get(page)
    if (!Number.isInteger(page) || page < 1 || !sourceHash) {
      reasonCodes.add(`${prefix}_PAGE_MISSING`)
      continue
    }
    if (!canonicalSha256(data.pageImageSha256) || normalizeHash(data.pageImageSha256) !== sourceHash) {
      reasonCodes.add(`${prefix}_PAGE_HASH_MISMATCH`)
      continue
    }
    try {
      const normalized = normalizeRegion(data)
      validRegions.push({ page, pageImageSha256: sourceHash, ...normalized })
    } catch {
      reasonCodes.add(`${prefix}_GEOMETRY_INVALID`)
    }
  }
  return validRegions
}

function validateParts(value, reasonCodes) {
  if (!Array.isArray(value) || value.length === 0) {
    reasonCodes.add('PARTS_INVALID')
    return []
  }

  const labels = new Set()
  const parts = []
  for (const part of value) {
    const data = asObject(part)
    const label = nonemptyString(data?.label)
    if (!label) {
      reasonCodes.add('PART_LABEL_INVALID')
    } else if (labels.has(label)) {
      reasonCodes.add('PART_LABEL_DUPLICATE')
    } else {
      labels.add(label)
    }
    if (!Number.isInteger(data?.marks) || data.marks <= 0) {
      reasonCodes.add('PART_MARKS_INVALID')
    }
    if (label && Number.isInteger(data?.marks) && data.marks > 0) {
      parts.push({ label, marks: data.marks })
    }
  }
  return parts
}

function validateTags(value, controlledTags, reasonCodes) {
  const tags = asObject(value)
  if (!tags || !validControlledTags(controlledTags)) {
    reasonCodes.add('TAGS_INVALID')
    return
  }

  for (const [field, setField, isArray, code] of controlledTagFields) {
    const ids = isArray ? tags[field] : [tags[field]]
    if (!Array.isArray(ids) || ids.some(id => !nonemptyString(id) || !controlledTags[setField].has(id))) {
      reasonCodes.add(code)
    }
  }
}

function validateVerification(identities, verification, sourceHashes, reasonCodes) {
  const verifiedQuestions = Array.isArray(verification?.questions) ? verification.questions : null
  if (!verifiedQuestions || verifiedQuestions.length !== identities.length) {
    reasonCodes.add('VERIFICATION_IDENTITY_DISAGREEMENT')
    return
  }

  const verificationByQuestionNumber = new Map()
  for (const question of verifiedQuestions) {
    const data = asObject(question)
    const questionNumber = nonemptyString(data?.questionNumber)
    if (!questionNumber || verificationByQuestionNumber.has(questionNumber)) {
      reasonCodes.add('VERIFICATION_IDENTITY_DISAGREEMENT')
      return
    }
    const regions = validateRegions(data?.regions, sourceHashes.pageImageHashes, reasonCodes, 'VERIFICATION_REGION')
    const diagramRegions = validateRegions(data?.diagramRegions, sourceHashes.pageImageHashes, reasonCodes, 'VERIFICATION_DIAGRAM_REGION', false)
    const markSchemeEvidence = validateMarkSchemeEvidence(
      data?.markSchemeEvidence,
      sourceHashes.markSchemePageHashes,
      'VERIFICATION',
      reasonCodes,
    )
    verificationByQuestionNumber.set(questionNumber, { ...data, regions, diagramRegions, markSchemeEvidence })
  }

  for (const identity of identities) {
    const verified = verificationByQuestionNumber.get(identity.questionNumber)
    if (!verified
      || !sameArray(verified.pages, identity.pages)
      || !sameParts(verified.parts, identity.parts)
      || !sameDiagramPresence(verified.diagramRegionCount, identity.diagramRegionCount)) {
      reasonCodes.add('VERIFICATION_IDENTITY_DISAGREEMENT')
      return
    }
    if (!sameRegionCollection(verified.regions, identity.regions)) {
      reasonCodes.add('VERIFICATION_REGION_DISAGREEMENT')
      return
    }
    if (!sameRegionCollection(verified.diagramRegions, identity.diagramRegions)) {
      reasonCodes.add('VERIFICATION_DIAGRAM_REGION_DISAGREEMENT')
      return
    }
    if (!sameMarkSchemeEvidence(verified.markSchemeEvidence, identity.markSchemeEvidence)) {
      reasonCodes.add('VERIFICATION_MARK_SCHEME_EVIDENCE_DISAGREEMENT')
      return
    }
  }
}

function validateMarkSchemeEvidence(value, markSchemePageHashes, prefix, reasonCodes) {
  if (!Array.isArray(value) || value.length === 0) {
    reasonCodes.add(`${prefix}_MARK_SCHEME_EVIDENCE_INVALID`)
    return []
  }

  const validEvidence = []
  let hasInvalidEvidence = false
  for (const evidence of value) {
    const data = asObject(evidence)
    const page = data?.page
    const sourceHash = markSchemePageHashes.get(page)
    if (!Number.isInteger(page) || page < 1 || !sourceHash) {
      reasonCodes.add(`${prefix}_MARK_SCHEME_EVIDENCE_PAGE_MISSING`)
      hasInvalidEvidence = true
      continue
    }
    if (!canonicalSha256(data.pageImageSha256) || normalizeHash(data.pageImageSha256) !== sourceHash) {
      reasonCodes.add(`${prefix}_MARK_SCHEME_EVIDENCE_PAGE_HASH_MISMATCH`)
      hasInvalidEvidence = true
      continue
    }
    validEvidence.push({ page, pageImageSha256: sourceHash })
  }
  if (hasInvalidEvidence) {
    reasonCodes.add(`${prefix}_MARK_SCHEME_EVIDENCE_INVALID`)
  }
  return validEvidence
}

function validControlledTags(value) {
  return isPlainObject(value) && controlledTagFields.every(([, setField]) => value[setField] instanceof Set)
}

function canonicalSha256(value) {
  return typeof value === 'string' && canonicalSha256Pattern.test(value)
}

function normalizeHash(value) {
  return canonicalSha256Pattern.exec(value)[1].toLowerCase()
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asObject(value) {
  return isPlainObject(value) ? value : null
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sameArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function sameParts(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((part, index) => isPlainObject(part)
      && part.label === right[index].label
      && part.marks === right[index].marks)
}

function sameDiagramPresence(leftCount, rightCount) {
  if (!Number.isInteger(leftCount) || leftCount < 0
    || !Number.isInteger(rightCount) || rightCount < 0) return false
  return (leftCount > 0) === (rightCount > 0)
}

function sameMarkSchemeEvidence(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((evidence, index) => isPlainObject(evidence)
      && evidence.page === right[index].page
      && evidence.pageImageSha256 === right[index].pageImageSha256)
}

function sameRegionCollection(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  const normalize = (region) => ({
    page: region?.page,
    pageImageSha256: region?.pageImageSha256,
    x0: region?.x0,
    y0: region?.y0,
    x1: region?.x1,
    y1: region?.y1,
  })
  const leftKeys = left.map((region) => JSON.stringify(normalize(region))).sort()
  const rightKeys = right.map((region) => JSON.stringify(normalize(region))).sort()
  return leftKeys.every((value, index) => value === rightKeys[index])
}

function emptyIdentity() {
  return { questionNumber: null, pages: [], regions: [], diagramRegions: [], parts: [], diagramRegionCount: 0, markSchemeEvidence: [] }
}
