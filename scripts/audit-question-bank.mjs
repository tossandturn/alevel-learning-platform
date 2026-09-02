import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { normaliseQuestionGroup } from '../src/data/questionParts.js'
import {
  SOURCE_CONTENT_AUDIT_SCHEMA_VERSION,
  documentPageFromAssetUrl,
  requiredMarkSchemeAssetEvidence,
  requiredSourceAssetEvidence,
  sourceBindingStatus,
  sourcePageFromAssetUrl,
  sourceQuestionId,
} from '../src/lib/sourceContentContract.js'
import { HIGH_PRIORITY_SOURCE_RANGE_REVIEW_IDS, RESOLVED_NON_CONTENT_PAGE_GAPS, resolvedNonContentPageGapIssues, sourceRangeReviewCandidates, sourceSemanticVerificationStatus, sourceStructuralConsistencyIssues } from '../src/lib/sourceSemanticContract.js'
import { MIN_VERIFIED_GROUPS_FOR_PRACTICE } from '../src/lib/practiceConstants.js'
import { canonicalTextSha256, canonicalTextFileSha256, canonicalUtf8LfText } from './canonical-text.mjs'

const root = path.resolve(process.env.SOURCE_AUDIT_ROOT || path.join(import.meta.dirname, '..'))
const indexPath = path.join(root, 'src', 'data', 'importedQuestionIndex.json')
const manifestPath = path.join(root, 'src', 'data', 'sourceContentManifest.json')
const manifestIdentityPath = path.join(root, 'src', 'data', 'sourceContentIdentity.js')
const reportPath = path.join(root, 'artifacts', 'source-content-audit.json')
const assetRoot = path.resolve(process.env.SOURCE_AUDIT_ASSET_ROOT || path.join(root, 'public', 'question-assets'))
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const writeManifest = process.argv.includes('--write-manifest')
const writeReport = process.argv.includes('--write-report')

if (index.schemaVersion !== 2 || !Array.isArray(index.questions) || !Array.isArray(index.answers) || !Array.isArray(index.bindings)) {
  throw new Error('Question index must use schema v2 with questions, answers and bindings.')
}

const answers = new Map(index.answers.map((answer) => [answer.answerId, answer]))
const bindings = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
const duplicateBindings = new Set()
const seenBindings = new Set()
const inventory = new Map()
const errors = []
const sourceContentItems = {}

const rangeGapObservations = sourceRangeReviewCandidates(index.questions)
const rangeGapByQuestionId = new Map(rangeGapObservations.map((candidate) => [candidate.questionId, candidate]))
const highPriorityRangeCandidateIds = new Set(HIGH_PRIORITY_SOURCE_RANGE_REVIEW_IDS)
const highPriorityRangeCandidates = rangeGapObservations.filter((candidate) => highPriorityRangeCandidateIds.has(candidate.questionId))
const resolvedNonContentRangeCandidates = rangeGapObservations
  .filter((candidate) => RESOLVED_NON_CONTENT_PAGE_GAPS[candidate.questionId])
  .map((candidate) => ({ ...candidate, resolution: RESOLVED_NON_CONTENT_PAGE_GAPS[candidate.questionId] }))
const unresolvedRangeCandidates = rangeGapObservations
  .filter((candidate) => !RESOLVED_NON_CONTENT_PAGE_GAPS[candidate.questionId])
const unresolvedRangeReasons = new Map(unresolvedRangeCandidates.map((candidate) => [candidate.questionId, candidate.reason]))

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeAssetPath(url) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(String(url || ''), 'https://source.audit.invalid').pathname)
  } catch {
    return null
  }
  const prefix = '/question-assets/'
  if (!pathname.startsWith(prefix)) return null
  const parts = pathname.slice(prefix.length).split('/')
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) return null
  const resolved = path.resolve(assetRoot, ...parts)
  const relative = path.relative(assetRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return resolved
}

function inspectPng(buffer) {
  const signature = '89504e470d0a1a0a'
  if (buffer.length < 45 || buffer.subarray(0, 8).toString('hex') !== signature) return null
  let offset = 8
  let width = 0
  let height = 0
  let sawIhdr = false
  let sawIend = false
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > buffer.length) return null
    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13) return null
      width = buffer.readUInt32BE(offset + 8)
      height = buffer.readUInt32BE(offset + 12)
      sawIhdr = width > 0 && height > 0
    }
    if (type === 'IEND') {
      if (length !== 0 || end !== buffer.length) return null
      sawIend = true
      break
    }
    offset = end
  }
  return sawIhdr && sawIend ? { mimeType: 'image/png', width, height } : null
}

function inspectJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) return null
  let offset = 2
  let dimensions = null
  while (offset + 8 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) break
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isSof && length >= 8) {
      const height = buffer.readUInt16BE(offset + 3)
      const width = buffer.readUInt16BE(offset + 5)
      if (!width || !height) return null
      dimensions = { mimeType: 'image/jpeg', width, height }
    }
    if (marker === 0xda) return dimensions
    offset += length
  }
  return dimensions
}

function inspectWebp(buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) return null
  let offset = 12
  let dimensions = null
  let sawImageChunk = false
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    const end = dataOffset + length
    const paddedEnd = end + (length % 2)
    if (end > buffer.length || paddedEnd > buffer.length) return null
    if (type === 'VP8L' && length >= 5 && buffer[dataOffset] === 0x2f) {
      const bits = buffer.readUInt32LE(dataOffset + 1)
      const width = 1 + (bits & 0x3fff)
      const height = 1 + ((bits >> 14) & 0x3fff)
      if (!width || !height) return null
      dimensions = { mimeType: 'image/webp', width, height }
      sawImageChunk = true
    } else if (type === 'VP8 ' && length >= 10 && buffer[dataOffset + 3] === 0x9d && buffer[dataOffset + 4] === 0x01 && buffer[dataOffset + 5] === 0x2a) {
      const width = buffer.readUInt16LE(dataOffset + 6) & 0x3fff
      const height = buffer.readUInt16LE(dataOffset + 8) & 0x3fff
      if (!width || !height) return null
      dimensions = { mimeType: 'image/webp', width, height }
      sawImageChunk = true
    } else if (type === 'VP8X' && length >= 10) {
      const width = 1 + buffer.readUIntLE(dataOffset + 4, 3)
      const height = 1 + buffer.readUIntLE(dataOffset + 7, 3)
      if (!width || !height) return null
    }
    offset = paddedEnd
  }
  return offset === buffer.length && sawImageChunk && dimensions ? dimensions : null
}

function inspectImageBuffer(buffer) {
  if (!buffer.length) return { valid: false, reason: 'asset-empty' }
  const details = inspectPng(buffer) || inspectJpeg(buffer) || inspectWebp(buffer)
  return details
    ? { valid: true, byteLength: buffer.length, sha256: digest(buffer), ...details }
    : { valid: false, byteLength: buffer.length, reason: 'asset-not-decodable' }
}

function inspectImage(filePath) {
  return inspectImageBuffer(fs.readFileSync(filePath))
}

function assetExtensionMatches(filePath, mimeType) {
  const extension = path.extname(filePath).toLowerCase()
  const expectedMimeType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : ''
  return expectedMimeType === mimeType
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write(type, 4, 4, 'ascii')
  data.copy(chunk, 8)
  return chunk
}

function assertImageInspectionFixtures() {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9])
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00])),
    pngChunk('IEND'),
  ])
  if (!inspectImageBuffer(jpeg).valid || !inspectImageBuffer(png).valid) throw new Error('image inspection fixture should accept complete JPEG and PNG containers')
  if (inspectImageBuffer(jpeg.subarray(0, -2)).valid) throw new Error('image inspection must reject a JPEG truncated after SOF without EOI')
  if (inspectImageBuffer(png.subarray(0, -12)).valid) throw new Error('image inspection must reject a PNG truncated before IEND')
  if (assetExtensionMatches('qp-01.jpg', 'image/png')) throw new Error('image inspection must reject a PNG payload served from a JPEG source asset path')
}

assertImageInspectionFixtures()

function assetChecksumErrors({ parts, assetByPage, evidenceForPart, label, required }) {
  const reasons = []
  for (const part of parts || []) {
    const partId = String(part?.partId || part?.questionPartId || part?.id || part?.label || 'unknown')
    const evidence = evidenceForPart(part)
    if (required && !evidence.length) {
      reasons.push(`${label}-evidence-missing:${partId}`)
      continue
    }
    for (const item of evidence) {
      const asset = assetByPage.get(item.page)
      if (!asset) {
        reasons.push(`${label}-asset-missing:${partId}:${item.page}`)
      } else if (asset.sha256 !== item.assetSha256) {
        reasons.push(`${label}-asset-mismatch:${partId}:${item.page}`)
      }
    }
  }
  return reasons
}

function assertChecksumEvidenceFixtures() {
  const expectedSha256 = 'a'.repeat(64)
  const alteredSha256 = 'b'.repeat(64)
  const q1StylePart = {
    partId: 'fixture:q1:part-a',
    sourcePage: 3,
    sourceEvidence: [{ page: 3, assetUrl: '/question-assets/fixture/qp-03.jpg', assetSha256: expectedSha256 }],
  }
  const q10StylePart = {
    partId: 'fixture:q10:part-a',
    sourcePage: 6,
    sourceRegion: { assetSha256: expectedSha256 },
  }
  const msStylePart = {
    partId: 'fixture:q10:part-a',
    answerSourcePage: 7,
    markSchemeEvidence: [{ sourcePage: 7, assetSha256: expectedSha256 }],
  }
  const matchingAssets = new Map([[3, { sha256: expectedSha256 }], [6, { sha256: expectedSha256 }], [7, { sha256: expectedSha256 }]])
  if (assetChecksumErrors({ parts: [q1StylePart, q10StylePart], assetByPage: matchingAssets, evidenceForPart: requiredSourceAssetEvidence, label: 'qp', required: true }).length) {
    throw new Error('source checksum fixture should accept both raw sourceEvidence and sourceRegion forms')
  }
  if (assetChecksumErrors({ parts: [msStylePart], assetByPage: matchingAssets, evidenceForPart: requiredMarkSchemeAssetEvidence, label: 'ms', required: true }).length) {
    throw new Error('mark-scheme checksum fixture should accept reviewed markSchemeEvidence')
  }
  const tamperedAssets = new Map([[3, { sha256: alteredSha256 }], [6, { sha256: alteredSha256 }], [7, { sha256: alteredSha256 }]])
  const reasons = [
    ...assetChecksumErrors({ parts: [q1StylePart, q10StylePart], assetByPage: tamperedAssets, evidenceForPart: requiredSourceAssetEvidence, label: 'qp', required: true }),
    ...assetChecksumErrors({ parts: [msStylePart], assetByPage: tamperedAssets, evidenceForPart: requiredMarkSchemeAssetEvidence, label: 'ms', required: true }),
  ]
  if (!reasons.some((reason) => reason === 'qp-asset-mismatch:fixture:q1:part-a:3')
    || !reasons.some((reason) => reason === 'qp-asset-mismatch:fixture:q10:part-a:6')
    || !reasons.some((reason) => reason === 'ms-asset-mismatch:fixture:q10:part-a:7')) {
    throw new Error('source checksum fixture must fail closed when a same-URL asset has different bytes')
  }
}

assertChecksumEvidenceFixtures()

function auditSourceContent(question, binding, answer) {
  const sourceQuestion = { ...question, answerBinding: binding, answerParts: answer?.answerParts || question.answerParts, answerRef: answer?.answerRef || question.answerRef }
  const declared = sourceBindingStatus(sourceQuestion)
  const fileReasons = [...declared.reasons]
  const assets = declared.assetUrls.map((url) => {
    const filePath = safeAssetPath(url)
    const page = sourcePageFromAssetUrl(url)
    const basename = path.basename(String(url))
    if (!filePath || !fs.existsSync(filePath)) {
      fileReasons.push(`asset-not-found:${basename}`)
      return { url, page, exists: false, valid: false }
    }
    let inspection
    try {
      inspection = inspectImage(filePath)
    } catch {
      fileReasons.push(`asset-unreadable:${basename}`)
      return { url, page, exists: true, valid: false }
    }
    if (!inspection.valid) fileReasons.push(`${inspection.reason}:${basename}`)
    if (inspection.valid && !assetExtensionMatches(filePath, inspection.mimeType)) fileReasons.push(`asset-extension-mismatch:${basename}`)
    return { url, page, exists: true, ...inspection }
  })
  const expectedPages = new Set(declared.sourcePages)
  const decodedPages = new Set(assets.filter((asset) => asset.valid).map((asset) => asset.page).filter(Number.isFinite))
  for (const page of expectedPages) {
    if (!decodedPages.has(page)) fileReasons.push(`decoded-page-missing:${page}`)
  }
  for (const part of declared.partPages) {
    if (part.page && !decodedPages.has(part.page)) fileReasons.push(`decoded-part-page-missing:${part.partId || 'unknown'}:${part.page}`)
  }
  const assetByPage = new Map(assets.filter((asset) => asset.valid && Number.isFinite(asset.page)).map((asset) => [asset.page, asset]))
  const markSchemeAssets = (answer?.answerRef?.assetUrls || [])
    .map((url) => {
      const filePath = safeAssetPath(url)
      const page = documentPageFromAssetUrl(url)
      const basename = path.basename(String(url))
      if (!filePath || !fs.existsSync(filePath)) {
        fileReasons.push(`mark-scheme-asset-not-found:${basename}`)
        return { url, page, exists: false, valid: false }
      }
      let inspection
      try {
        inspection = inspectImage(filePath)
      } catch {
        fileReasons.push(`mark-scheme-asset-unreadable:${basename}`)
        return { url, page, exists: true, valid: false }
      }
      if (!inspection.valid) fileReasons.push(`mark-scheme-${inspection.reason}:${basename}`)
      if (inspection.valid && !assetExtensionMatches(filePath, inspection.mimeType)) fileReasons.push(`mark-scheme-asset-extension-mismatch:${basename}`)
      return { url, page, exists: true, ...inspection }
    })
  const markSchemeByPage = new Map(markSchemeAssets
    .filter((asset) => asset.valid && Number.isFinite(asset.page))
    .map((asset) => [asset.page, asset]))
  const answerPartsById = new Map((answer?.answerParts || []).map((part) => [String(part?.partId || ''), part]))
  const reviewed = binding?.verificationStatus === 'reviewed'
  fileReasons.push(...assetChecksumErrors({
    parts: question.parts || [],
    assetByPage,
    evidenceForPart: requiredSourceAssetEvidence,
    label: 'qp',
    required: reviewed,
  }))
  fileReasons.push(...assetChecksumErrors({
    parts: (question.parts || []).map((part) => answerPartsById.get(String(part?.partId || '')) || {}),
    assetByPage: markSchemeByPage,
    evidenceForPart: requiredMarkSchemeAssetEvidence,
    label: 'ms',
    required: reviewed,
  }))
  const semantic = sourceSemanticVerificationStatus(sourceQuestion, { binding, answer })
  const resolvedRange = RESOLVED_NON_CONTENT_PAGE_GAPS[question.questionId]
  const resolvedRangeIssues = resolvedRange
    ? resolvedNonContentPageGapIssues(question, rangeGapByQuestionId.get(question.questionId), resolvedRange)
    : []
  fileReasons.push(...resolvedRangeIssues)
  // A candidate is fail-closed for machine-indexed/study records. A binding
  // that already carries the strict paired QP/MS reviewed evidence has an
  // explicit semantic decision and is allowed to use that decision.
  const rangeReason = binding?.verificationStatus === 'reviewed'
    ? null
    : unresolvedRangeReasons.get(question.questionId)
  const semanticStatus = rangeReason ? 'semantic-quarantined' : semantic.status
  const semanticReasons = rangeReason ? [...semantic.reasons, rangeReason] : semantic.reasons
  const structuralIssues = sourceStructuralConsistencyIssues(sourceQuestion, answer)
  const uniqueFileReasons = [...new Set(fileReasons)].sort()
  const reasons = [...new Set([...uniqueFileReasons, ...semanticReasons])].sort()
  return {
    complete: uniqueFileReasons.length === 0 && semanticStatus === 'verified-complete',
    fileComplete: uniqueFileReasons.length === 0,
    fileReasons: uniqueFileReasons,
    semanticStatus,
    structuralIssues,
    reasons,
    sourcePages: declared.sourcePages,
    assetPages: declared.assetPages,
    bindingSignature: declared.bindingSignature,
    assets,
    markSchemeAssets,
  }
}

function reviewedPartEvidenceErrors(question, answer, binding, label) {
  if (binding.verificationStatus !== 'reviewed') return []
  const evidence = binding.reviewEvidence
  const reviewErrors = []
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(binding.reviewedAt || ''))) reviewErrors.push(`${label}: reviewed binding is missing reviewedAt`)
  if (!String(binding.reviewedBy || '').trim()) reviewErrors.push(`${label}: reviewed binding is missing reviewedBy`)
  if (!evidence || evidence.method !== 'paired-qp-ms-page-review') reviewErrors.push(`${label}: reviewed binding is missing paired QP/MS review evidence`)
  if (evidence?.questionPaper?.sha256 !== question.sourceRef?.sha256) reviewErrors.push(`${label}: reviewed QP checksum does not match source`)
  if (evidence?.markScheme?.sha256 !== answer?.answerRef?.sha256) reviewErrors.push(`${label}: reviewed MS checksum does not match source`)
  const allocations = new Map((evidence?.partAllocations || []).map((allocation) => [allocation.partId, allocation]))
  const group = normaliseQuestionGroup(question, answer)
  for (const part of group.parts || []) {
    const allocation = allocations.get(part.partId)
    const answerPart = answer?.answerParts?.find((candidate) => candidate.partId === part.partId)
    const expectedMarkSchemePage = Number(answerPart?.sourcePage || answer?.answerRef?.pageStart)
    if (!allocation) {
      reviewErrors.push(`${label}: reviewed binding is missing allocation evidence for ${part.partId}`)
      continue
    }
    if (Number(allocation.marks) !== Number(part.marks)) reviewErrors.push(`${label}: reviewed allocation marks do not match ${part.partId}`)
    if (Number(allocation.questionPage) !== Number(part.sourcePage)) reviewErrors.push(`${label}: reviewed QP page does not match ${part.partId}`)
    if (Number(allocation.markSchemePage) !== expectedMarkSchemePage) reviewErrors.push(`${label}: reviewed MS page does not match ${part.partId}`)
    if (!Number.isInteger(Number(allocation.markPointCount)) || Number(allocation.markPointCount) < 1) reviewErrors.push(`${label}: reviewed allocation has no mark-point evidence for ${part.partId}`)
    const answerEvidence = (answerPart?.markSchemeEvidence || []).map((item) => String(item?.text || '').trim()).filter(Boolean)
    const allocationEvidence = (allocation.markSchemeEvidence || []).map((item) => String(item || '').trim()).filter(Boolean)
    if (!answerEvidence.length) reviewErrors.push(`${label}: reviewed answer part is missing quoted mark-scheme evidence for ${part.partId}`)
    if (Number(allocation.markPointCount) !== answerEvidence.length) reviewErrors.push(`${label}: reviewed allocation evidence count does not match ${part.partId}`)
    if (JSON.stringify(allocationEvidence) !== JSON.stringify(answerEvidence)) reviewErrors.push(`${label}: reviewed allocation evidence does not match answer evidence for ${part.partId}`)
  }
  if (allocations.size !== (group.parts || []).length) reviewErrors.push(`${label}: reviewed binding has extra allocation evidence`)
  return reviewErrors
}

function auditedTopicIds(question, binding) {
  const mapping = question?.syllabusMapping || {}
  const primaryTopicId = String(mapping.primaryTopicId || question?.knowledgeGroupId || question?.topicId || '').trim()
  const reviewed = binding?.verificationStatus === 'reviewed'
    && String(mapping.reviewStatus || '').toLowerCase() === 'reviewed'
  const secondaryTopicIds = reviewed && Array.isArray(question?.syllabusMapping?.secondaryTopicIds)
    ? mapping.secondaryTopicIds.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  return [...new Set([primaryTopicId, ...secondaryTopicIds].filter(Boolean))]
}

for (const binding of index.bindings) {
  if (seenBindings.has(binding.questionId)) duplicateBindings.add(binding.questionId)
  seenBindings.add(binding.questionId)
}

for (const question of index.questions) {
  const binding = bindings.get(question.questionId)
  const answer = answers.get(binding?.answerId)
  const label = `${question.subjectCode || question.qualificationId} ${question.questionId}`
  const sourceContent = auditSourceContent(question, binding, answer)
  sourceContentItems[sourceQuestionId(question)] = sourceContent
  if (!binding || !answer) errors.push(`${label}: missing answer binding`)
  if (!question.prompt?.trim()) errors.push(`${label}: missing question text`)
  if (!question.qualificationId || !question.knowledgeGroupId || !question.stageTags?.length) errors.push(`${label}: missing syllabus tags`)
  if (!question.sourceRef?.paper || !question.sourceRef?.question || !question.sourceRef?.sha256) errors.push(`${label}: missing question provenance`)
  if (!answer?.answerRef?.file || !answer.answerRef?.sha256) errors.push(`${label}: missing answer provenance`)
  if (binding && !['machine-indexed', 'reviewed', 'quarantined'].includes(binding.verificationStatus)) errors.push(`${label}: unknown verification status`)
  if (binding && question.sourceRef?.sha256 !== binding.questionDocumentSha256) errors.push(`${label}: question SHA does not match binding`)
  if (binding && answer?.answerRef?.sha256 !== binding.answerDocumentSha256) errors.push(`${label}: answer SHA does not match binding`)
  if (question.sourceRef?.sha256 && answer?.answerRef?.sha256 && question.sourceRef.sha256 === answer.answerRef.sha256) errors.push(`${label}: QP and MS cannot share a document SHA`)
  if (binding?.verificationStatus !== 'quarantined' && normaliseQuestionGroup(question, answer).status !== 'verified') errors.push(`${label}: question parts do not reconcile with total marks`)
  if (binding) errors.push(...reviewedPartEvidenceErrors(question, answer, binding, label))
  if (binding?.verificationStatus !== 'quarantined' && sourceContent.complete) {
    for (const topicId of auditedTopicIds(question, binding)) {
      const key = [question.qualificationId, question.stageTags.join('+'), topicId].join(' | ')
      inventory.set(key, (inventory.get(key) || 0) + 1)
    }
  }
}

for (const questionId of duplicateBindings) errors.push(`${questionId}: duplicate answer binding`)
for (const questionId of HIGH_PRIORITY_SOURCE_RANGE_REVIEW_IDS) {
  if (!rangeGapObservations.some((candidate) => candidate.questionId === questionId)) errors.push(`${questionId}: high-priority range-review fixture no longer matches a declared page gap`)
}
for (const questionId of Object.keys(RESOLVED_NON_CONTENT_PAGE_GAPS)) {
  if (!rangeGapObservations.some((candidate) => candidate.questionId === questionId)) errors.push(`${questionId}: resolved non-content page-gap fixture no longer matches a declared page gap`)
}
for (const answer of index.answers) {
  if (!index.bindings.some((binding) => binding.answerId === answer.answerId)) errors.push(`${answer.answerId}: unbound answer`)
}

function runtimeAssetEvidence(assets = []) {
  return assets
    .filter((asset) => asset.valid && Number.isInteger(asset.page) && asset.page > 0 && /^[a-f0-9]{64}$/.test(String(asset.sha256 || '')))
    .map((asset) => ({ page: asset.page, assetUrl: asset.url, assetSha256: asset.sha256 }))
    .toSorted((left, right) => left.page - right.page || left.assetUrl.localeCompare(right.assetUrl))
}

const runtimeItems = Object.fromEntries(Object.entries(sourceContentItems).map(([questionId, item]) => [questionId, {
  complete: item.complete,
  fileComplete: item.fileComplete,
  semanticStatus: item.semanticStatus,
  reasons: item.reasons,
  bindingSignature: item.bindingSignature,
  questionAssets: runtimeAssetEvidence(item.assets),
  markSchemeAssets: runtimeAssetEvidence(item.markSchemeAssets),
}]))
const manifestPayload = {
  schemaVersion: SOURCE_CONTENT_AUDIT_SCHEMA_VERSION,
  sourceIndexSha256: canonicalTextFileSha256(indexPath),
  items: runtimeItems,
}
const manifest = {
  ...manifestPayload,
  checksum: canonicalTextSha256(JSON.stringify(manifestPayload)),
}

if (writeManifest) {
  fs.writeFileSync(manifestPath, canonicalUtf8LfText(`${JSON.stringify(manifest, null, 2)}\n`), 'utf8')
  fs.writeFileSync(manifestIdentityPath, canonicalUtf8LfText([
    '// Generated by scripts/audit-question-bank.mjs. Do not edit by hand.',
    `export const SOURCE_INDEX_SHA256 = '${manifest.sourceIndexSha256}'`,
    `export const SOURCE_CONTENT_MANIFEST_CHECKSUM = '${manifest.checksum}'`,
    '',
  ].join('\n')), 'utf8')
} else {
  let existing = null
  try {
    existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    errors.push('source content manifest is missing or unreadable; run questions:audit -- --write-manifest')
  }
  if (existing && (existing.schemaVersion !== manifest.schemaVersion || existing.sourceIndexSha256 !== manifest.sourceIndexSha256 || existing.checksum !== manifest.checksum)) {
    errors.push('source content manifest is stale; run questions:audit -- --write-manifest')
  }
  let identity = ''
  try {
    identity = fs.readFileSync(manifestIdentityPath, 'utf8')
  } catch {
    errors.push('source content manifest identity is missing; run questions:source-manifest')
  }
  if (identity && (!identity.includes(`SOURCE_INDEX_SHA256 = '${manifest.sourceIndexSha256}'`) || !identity.includes(`SOURCE_CONTENT_MANIFEST_CHECKSUM = '${manifest.checksum}'`))) {
    errors.push('source content manifest identity is stale; run questions:source-manifest')
  }
}

if (writeReport) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify({
    schemaVersion: SOURCE_CONTENT_AUDIT_SCHEMA_VERSION,
    sourceIndexSha256: manifest.sourceIndexSha256,
    items: sourceContentItems,
  }, null, 2)}\n`, 'utf8')
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  const indexQuarantined = index.bindings.filter((binding) => binding.verificationStatus === 'quarantined').length
  const sourceAdditionalQuarantined = index.questions.filter((question) => {
    const binding = bindings.get(question.questionId)
    return binding?.verificationStatus !== 'quarantined' && !sourceContentItems[sourceQuestionId(question)]?.fileComplete
  }).length
  const fileGateEffectiveQuarantined = indexQuarantined + sourceAdditionalQuarantined
  const fileGateEffectiveAvailable = index.questions.length - fileGateEffectiveQuarantined
  const semanticCoverage = Object.values(sourceContentItems).reduce((result, item) => ({
    ...result,
    [item.semanticStatus]: (result[item.semanticStatus] || 0) + 1,
  }), {})
  const effectiveQuarantined = Object.values(sourceContentItems).filter((item) => !item.complete).length
  const effectiveAvailable = Object.values(sourceContentItems).filter((item) => item.complete).length
  const structuralCandidates = index.questions.flatMap((question) => {
    const item = sourceContentItems[sourceQuestionId(question)]
    return item?.structuralIssues?.length ? [{ questionId: question.questionId, reasons: item.structuralIssues }] : []
  })
  const fileQuarantineReasons = Object.values(sourceContentItems)
    .filter((item) => !item.fileComplete)
    .flatMap((item) => item.fileReasons)
    .reduce((result, reason) => ({ ...result, [reason]: (result[reason] || 0) + 1 }), {})
  const ready = [...inventory.entries()].filter(([, count]) => count >= MIN_VERIFIED_GROUPS_FOR_PRACTICE).length
  const short = [...inventory.entries()].filter(([, count]) => count < MIN_VERIFIED_GROUPS_FOR_PRACTICE).length
  console.log(JSON.stringify({
    schemaVersion: index.schemaVersion,
    questions: index.questions.length,
    answers: index.answers.length,
    bindings: index.bindings.length,
    fileGate: {
      indexQuarantined,
      sourceAdditionalQuarantined,
      effectiveQuarantined: fileGateEffectiveQuarantined,
      effectiveAvailable: fileGateEffectiveAvailable,
      fileCompleteItems: Object.values(sourceContentItems).filter((item) => item.fileComplete).length,
    },
    semanticVerificationCoverage: Object.fromEntries(Object.entries(semanticCoverage).sort(([left], [right]) => left.localeCompare(right))),
    structuralConsistencyCandidates: structuralCandidates,
    highPrioritySourceRangeReviewCandidates: highPriorityRangeCandidates,
    resolvedNonContentPageGapCandidates: resolvedNonContentRangeCandidates,
    pageRangeGapObservationCount: rangeGapObservations.length,
    finalQuestionSourceRangePolicy: 'manual-review-only',
    effectivePracticeGate: {
      effectiveQuarantined,
      effectiveAvailable,
    },
    fileQuarantineReasons: Object.fromEntries(Object.entries(fileQuarantineReasons).sort(([left], [right]) => left.localeCompare(right))),
    sourceContentManifest: path.relative(root, manifestPath).replaceAll('\\', '/'),
    sourceContentManifestUpdated: writeManifest,
    sourceContentReport: writeReport ? path.relative(root, reportPath).replaceAll('\\', '/') : null,
    drillReadyTopics: ready,
    topicsNeedingMoreIndexedItems: short,
    inventoryTopicMembershipPolicy: 'reviewed-primary-and-explicit-secondary',
    inventory: Object.fromEntries([...inventory.entries()].sort()),
  }, null, 2))
}
