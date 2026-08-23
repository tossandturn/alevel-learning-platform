import { SOURCE_CONTENT_MANIFEST_CHECKSUM, SOURCE_INDEX_SHA256 } from '../data/sourceContentIdentity.js'

export const SOURCE_CONTENT_AUDIT_SCHEMA_VERSION = 'source-content-audit-v3'

export const TRUSTED_SOURCE_ASSET = /^\/question-assets\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.(?:png|jpe?g|webp)$/i
export const STEM_MARKING_MANIFEST_SCHEMA_VERSION = 'stem-marking-manifest.v2'
export const STEM_SOURCE_REVIEW_SCHEMA_VERSION = 'stem-source-review.v1'
export const STEM_AI_SOURCE_BINDING_SCHEMA_VERSION = 'stem-ai-source-binding.v1'
export const STEM_AI_COORDINATE_SOURCE_BINDING_SCHEMA_VERSION = 'stem-ai-coordinate-source-binding.v1'
const SOURCE_PAGE_ASSET = /\/qp-(\d+)\.(?:png|jpe?g|webp)$/i
const DOCUMENT_PAGE_ASSET = /\/(?:qp|ms)-(\d+)\.(?:png|jpe?g|webp)$/i

export function canonicalSourceQuestionId(value) {
  const candidate = typeof value === 'object' && value !== null
    ? value.sourceQuestionId || value.questionId || value.bankId || value.questionGroupId || ''
    : value
  const normalized = String(candidate || '').trim()
  return normalized && !normalized.includes('@') && !/\s/.test(normalized) ? normalized : ''
}

export function sourceQuestionId(question = {}) {
  return canonicalSourceQuestionId(question)
}

export function sourcePageFromAssetUrl(url) {
  const match = String(url || '').match(SOURCE_PAGE_ASSET)
  return match ? Number(match[1]) : null
}

export function documentPageFromAssetUrl(url) {
  const match = String(url || '').match(DOCUMENT_PAGE_ASSET)
  return match ? Number(match[1]) : null
}

export function trustedSourceAssetUrls(sourceRef = {}) {
  return [...new Set((sourceRef.assetUrls || [])
    .map((url) => String(url || '').trim())
    .filter((url) => TRUSTED_SOURCE_ASSET.test(url)))]
    .toSorted((left, right) => (sourcePageFromAssetUrl(left) || 0) - (sourcePageFromAssetUrl(right) || 0) || left.localeCompare(right))
}

export function trustedDocumentAssetUrls(documentRef = {}) {
  return [...new Set((documentRef.assetUrls || [])
    .map((url) => String(url || '').trim())
    .filter((url) => TRUSTED_SOURCE_ASSET.test(url)))]
    .toSorted((left, right) => (documentPageFromAssetUrl(left) || 0) - (documentPageFromAssetUrl(right) || 0) || left.localeCompare(right))
}

function validPage(value) {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : null
}

export function sourcePageRange(sourceRef = {}) {
  const start = validPage(sourceRef.pageStart ?? sourceRef.page)
  const end = validPage(sourceRef.pageEnd ?? sourceRef.pageStart ?? sourceRef.page)
  if (!start || !end || end < start) return Object.freeze({ start, end, pages: Object.freeze([]), valid: false })
  return Object.freeze({
    start,
    end,
    pages: Object.freeze(Array.from({ length: end - start + 1 }, (_value, index) => start + index)),
    valid: true,
  })
}

export function sourcePartPages(question = {}) {
  return (question.parts || question.answerParts || []).map((part) => ({
    partId: String(part?.partId || part?.id || part?.label || ''),
    page: validPage(part?.sourcePage ?? part?.page),
  }))
}

function validSha256(value) {
  const checksum = String(value || '').trim().toLowerCase()
  return /^[a-f0-9]{64}$/.test(checksum) ? checksum : ''
}

function partIdForEvidence(part = {}, fallback = '') {
  return String(part?.partId || part?.questionPartId || part?.id || fallback || '')
}

function sourceEvidencePage(entry, fallbackPage) {
  return validPage(entry?.page ?? entry?.sourcePage) || validPage(fallbackPage)
}

function sourceAssetUrlForPage(sourceRef = {}, page) {
  return trustedSourceAssetUrls(sourceRef).find((url) => sourcePageFromAssetUrl(url) === Number(page)) || ''
}

/**
 * Both sourceEvidence and sourceRegion are legacy reviewer formats. Return
 * one normalized, checksum-bound record for every distinct required QP asset.
 */
export function requiredSourceAssetEvidence(part = {}) {
  const fallbackPage = validPage(part?.sourcePage ?? part?.page)
  const entries = []
  for (const evidence of Array.isArray(part?.sourceEvidence) ? part.sourceEvidence : []) {
    const page = sourceEvidencePage(evidence, fallbackPage)
    const assetSha256 = validSha256(evidence?.assetSha256)
    if (page && assetSha256) entries.push({
      page,
      assetUrl: String(evidence?.assetUrl || ''),
      assetSha256,
      documentSha256: validSha256(evidence?.documentSha256),
    })
  }
  const regionSha256 = validSha256(part?.sourceRegion?.assetSha256)
  if (fallbackPage && regionSha256) {
    entries.push({
      page: fallbackPage,
      assetUrl: '',
      assetSha256: regionSha256,
      documentSha256: '',
    })
  }
  return Object.freeze([...new Map(entries
    .map((entry) => [`${entry.page}\u0000${entry.assetSha256}\u0000${entry.assetUrl}`, Object.freeze(entry)]))
    .values()]
    .toSorted((left, right) => left.page - right.page || left.assetSha256.localeCompare(right.assetSha256)))
}

/**
 * Mark-scheme evidence uses the same two formats as QP evidence. It is kept
 * separate so a visually valid question page cannot stand in for a missing
 * reviewed mark-scheme image.
 */
export function requiredMarkSchemeAssetEvidence(part = {}) {
  const fallbackPage = validPage(part?.answerSourcePage ?? part?.sourcePage ?? part?.page)
  const entries = []
  for (const evidence of Array.isArray(part?.markSchemeEvidence) ? part.markSchemeEvidence : []) {
    const page = sourceEvidencePage(evidence, fallbackPage)
    const assetSha256 = validSha256(evidence?.assetSha256)
    if (page && assetSha256) entries.push({
      page,
      assetUrl: String(evidence?.assetUrl || ''),
      assetSha256,
      documentSha256: validSha256(evidence?.documentSha256),
    })
  }
  return Object.freeze([...new Map(entries
    .map((entry) => [`${entry.page}\u0000${entry.assetSha256}\u0000${entry.assetUrl}`, Object.freeze(entry)]))
    .values()]
    .toSorted((left, right) => left.page - right.page || left.assetSha256.localeCompare(right.assetSha256)))
}

function answerPartById(question = {}) {
  return new Map((question.answerParts || []).map((part) => [partIdForEvidence(part), part]))
}

function evidenceSignatureEntries(question = {}) {
  const answers = answerPartById(question)
  return (question.parts || []).map((part, index) => {
    const partId = partIdForEvidence(part, `part-${index + 1}`)
    const answerPart = answers.get(partId) || part
    return [
      partId,
      requiredSourceAssetEvidence(part).map((entry) => [entry.page, entry.assetUrl, entry.assetSha256, entry.documentSha256]),
      requiredMarkSchemeAssetEvidence(answerPart).map((entry) => [entry.page, entry.assetUrl, entry.assetSha256, entry.documentSha256]),
    ]
  }).toSorted((left, right) => left[0].localeCompare(right[0]))
}

function coordinateEvidenceSignatureEntries(question = {}) {
  return (question.parts || []).map((part, index) => {
    const partId = partIdForEvidence(part, `part-${index + 1}`)
    const sourceEvidence = (Array.isArray(part.sourceEvidence) ? part.sourceEvidence : [])
      .filter((entry) => entry?.coordinateSpace === 'normalized-xyxy')
      .map((entry) => [
        validPage(entry?.page),
        validSha256(entry?.documentSha256),
        validSha256(entry?.pageImageSha256),
        Array.isArray(entry?.region) ? entry.region.map(Number) : [],
        Array.isArray(entry?.imageSize) ? entry.imageSize.map(Number) : [],
      ])
    const markSchemeEvidence = sourceEvidence.length
      ? (Array.isArray(part.markSchemeEvidence) ? part.markSchemeEvidence : [])
        .map((entry) => [validPage(entry?.page), validSha256(entry?.pageImageSha256)])
      : []
    return [partId, sourceEvidence, markSchemeEvidence]
  }).toSorted((left, right) => left[0].localeCompare(right[0]))
}

export function sourceBindingSignature(question = {}) {
  const sourceRef = question.sourceRef || {}
  const answerRef = question.answerRef || {}
  const pageRange = sourcePageRange(sourceRef)
  const binding = question.answerBinding || question.binding || {}
  const reviewEvidence = binding.reviewEvidence || {}
  const coordinateEvidence = coordinateEvidenceSignatureEntries(question)
  const hasCoordinateEvidence = coordinateEvidence.some(([, sourceEvidence, markSchemeEvidence]) => sourceEvidence.length || markSchemeEvidence.length)
  const payload = JSON.stringify({
    questionId: sourceQuestionId(question),
    paperId: String(sourceRef.paperId || ''),
    sha256: String(sourceRef.sha256 || ''),
    answerDocumentId: String(answerRef.documentId || ''),
    answerSha256: String(answerRef.sha256 || ''),
    pageStart: pageRange.start,
    pageEnd: pageRange.end,
    assetUrls: trustedSourceAssetUrls(sourceRef),
    partPages: sourcePartPages(question).map((part) => [part.partId, part.page]),
    requiredAssetEvidence: evidenceSignatureEntries(question),
    ...(hasCoordinateEvidence ? { coordinateEvidence } : {}),
    semanticReview: {
      verificationStatus: String(binding.verificationStatus || ''),
      questionDocumentSha256: String(binding.questionDocumentSha256 || ''),
      answerDocumentSha256: String(binding.answerDocumentSha256 || ''),
      reviewedAt: String(binding.reviewedAt || ''),
      reviewedBy: String(binding.reviewedBy || ''),
      method: String(reviewEvidence.method || ''),
      questionSha256: String(reviewEvidence.questionPaper?.sha256 || ''),
      markSchemeSha256: String(reviewEvidence.markScheme?.sha256 || ''),
      partAllocations: (reviewEvidence.partAllocations || []).map((allocation) => [
        String(allocation?.partId || ''),
        Number(allocation?.marks) || 0,
        Number(allocation?.questionPage) || 0,
        Number(allocation?.markSchemePage) || 0,
        Array.isArray(allocation?.questionRegion) ? allocation.questionRegion : [],
        Array.isArray(allocation?.markSchemeEvidence) ? allocation.markSchemeEvidence : [],
      ]),
    },
  })
  // A compact deterministic fingerprint keeps the browser gate small. It is
  // an integrity/staleness signal, not an authorization or security token.
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= BigInt(payload.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

/**
 * The client never authorizes marking from its own flags or mark points. This
 * compact tuple is rebuilt from the reviewed source binding and must match the
 * trusted IELTSist manifest entry for the exact QuestionPart.
 */
export function canonicalSourceMarkingProvenance(question = {}, part = {}) {
  const sourceRef = part.sourceRef || question.sourceRef || {}
  const answerRef = part.answerRef || question.answerRef || {}
  const sourceQuestion = sourceQuestionId(question)
  const questionPartId = String(part.questionPartId || part.partId || part.id || '')
  const questionPage = validPage(part.sourcePage ?? sourceRef.page ?? sourceRef.pageStart)
  const answerPage = validPage(part.answerSourcePage ?? answerRef.page ?? answerRef.pageStart)
  const sourceAsset = requiredSourceAssetEvidence(part).find((entry) => entry.page === questionPage)
  const sourceAssetUrl = sourceAssetUrlForPage(sourceRef, questionPage)
  const signature = sourceBindingSignature(question)
  if (!sourceQuestion || !questionPartId || !sourceRef.paperId || !sourceRef.sha256 || !answerRef.sha256 || !questionPage || !answerPage || !sourceAsset?.assetSha256 || !sourceAssetUrl) return null

  return Object.freeze({
    manifestSchemaVersion: STEM_MARKING_MANIFEST_SCHEMA_VERSION,
    sourceQuestionId: sourceQuestion,
    questionPartId,
    bindingSignature: signature,
    reviewSchemaVersion: STEM_SOURCE_REVIEW_SCHEMA_VERSION,
    reviewVersion: signature,
    sourceDocumentSha256: String(sourceRef.sha256),
    answerDocumentSha256: String(answerRef.sha256),
    sourceIndexSha256: SOURCE_INDEX_SHA256,
    sourceManifestChecksum: SOURCE_CONTENT_MANIFEST_CHECKSUM,
    sourceEvidence: Object.freeze({
      assetId: `${sourceRef.paperId}:page-${questionPage}`,
      page: questionPage,
      assetUrl: sourceAssetUrl,
      assetSha256: sourceAsset.assetSha256,
      quote: `${String(sourceRef.question || 'Question').trim()}${part.label ? `(${part.label})` : ''}`,
    }),
  })
}

function canonicalAuditedAssetEvidence(question = {}, key, documentRef = {}) {
  const audit = question.sourceContent?.audit
  const signature = sourceBindingSignature(question)
  const range = sourcePageRange(documentRef)
  const declaredUrls = trustedDocumentAssetUrls(documentRef)
  if (!audit || audit.bindingSignature !== signature || question.sourceContent?.fileComplete !== true || !range.valid || !declaredUrls.length) return Object.freeze([])

  const declaredByPage = new Map(declaredUrls.map((assetUrl) => [documentPageFromAssetUrl(assetUrl), assetUrl]))
  if (declaredByPage.size !== declaredUrls.length || range.pages.some((page) => !declaredByPage.has(page))) return Object.freeze([])
  const audited = Array.isArray(audit[key]) ? audit[key] : []
  const byPage = new Map()
  for (const item of audited) {
    const page = validPage(item?.page)
    const assetUrl = String(item?.assetUrl || '')
    const assetSha256 = validSha256(item?.assetSha256)
    if (!page || !assetSha256 || declaredByPage.get(page) !== assetUrl || byPage.has(page)) return Object.freeze([])
    byPage.set(page, Object.freeze({ page, assetUrl, assetSha256 }))
  }
  if (byPage.size !== range.pages.length || range.pages.some((page) => !byPage.has(page))) return Object.freeze([])
  return Object.freeze(range.pages.map((page) => byPage.get(page)))
}

export function auditedQuestionAssetEvidence(question = {}) {
  return canonicalAuditedAssetEvidence(question, 'questionAssets', question.sourceRef || {})
}

export function auditedMarkSchemeAssetEvidence(question = {}) {
  return canonicalAuditedAssetEvidence(question, 'markSchemeAssets', question.answerRef || {})
}

export function canonicalMachineIndexedMarkingProvenance(question = {}, part = {}) {
  const sourceRef = part.sourceRef || question.sourceRef || {}
  const answerRef = part.answerRef || question.answerRef || {}
  const binding = question.answerBinding || {}
  const sourceQuestion = sourceQuestionId(question)
  const questionPartId = String(part.questionPartId || part.partId || part.id || '')
  const questionPage = validPage(part.sourcePage ?? sourceRef.page ?? sourceRef.pageStart)
  const answerPage = validPage(part.answerSourcePage)
  const questionAssets = auditedQuestionAssetEvidence(question)
  const markSchemeAssets = auditedMarkSchemeAssetEvidence(question)
  const sourceAsset = questionAssets.find((entry) => entry.page === questionPage)
  const signature = sourceBindingSignature(question)
  if (
    binding.verificationStatus !== 'machine-indexed'
    || question.sourceContent?.semanticStatus !== 'unreviewed'
    || question.questionGroupStatus === 'quarantined'
    || binding.questionDocumentSha256 !== sourceRef.sha256
    || binding.answerDocumentSha256 !== answerRef.sha256
    || !sourceQuestion
    || !questionPartId
    || !sourceRef.paperId
    || !validSha256(sourceRef.sha256)
    || !validSha256(answerRef.sha256)
    || !questionPage
    || !Number.isFinite(Number(part.marks))
    || Number(part.marks) <= 0
    || !sourceAsset
    || !markSchemeAssets.length
    || (answerPage && !markSchemeAssets.some((entry) => entry.page === answerPage))
  ) return null

  return Object.freeze({
    manifestSchemaVersion: STEM_MARKING_MANIFEST_SCHEMA_VERSION,
    sourceQuestionId: sourceQuestion,
    questionPartId,
    bindingSignature: signature,
    reviewSchemaVersion: STEM_AI_SOURCE_BINDING_SCHEMA_VERSION,
    reviewVersion: signature,
    sourceDocumentSha256: String(sourceRef.sha256),
    answerDocumentSha256: String(answerRef.sha256),
    sourceIndexSha256: SOURCE_INDEX_SHA256,
    sourceManifestChecksum: SOURCE_CONTENT_MANIFEST_CHECKSUM,
    sourceEvidence: Object.freeze({
      assetId: `${sourceRef.paperId}:page-${questionPage}`,
      page: questionPage,
      assetUrl: sourceAsset.assetUrl,
      assetSha256: sourceAsset.assetSha256,
      quote: `${String(sourceRef.question || 'Question').trim()}${part.label ? `(${part.label})` : ''}`,
    }),
  })
}

function normalizedCoordinateRegion(value) {
  if (!Array.isArray(value) || value.length !== 4) return null
  const [x0, y0, x1, y1] = value.map(Number)
  if (![x0, y0, x1, y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1 || x0 >= x1 || y0 >= y1) return null
  return Object.freeze([x0, y0, x1, y1])
}

function coordinateSourceEvidence(question = {}, part = {}) {
  const sourceRef = part.sourceRef || question.sourceRef || {}
  const answerRef = part.answerRef || question.answerRef || {}
  const questionPage = validPage(part.sourcePage ?? sourceRef.page ?? sourceRef.pageStart)
  const answerPage = validPage(part.answerSourcePage ?? answerRef.page ?? answerRef.pageStart)
  const sourceEvidence = (Array.isArray(part.sourceEvidence) ? part.sourceEvidence : []).find((entry) => (
    validPage(entry?.page) === questionPage
    && entry?.coordinateSpace === 'normalized-xyxy'
    && validSha256(entry?.documentSha256) === validSha256(sourceRef.sha256)
    && validSha256(entry?.pageImageSha256)
    && normalizedCoordinateRegion(entry?.region)
  ))
  const markSchemeEvidence = (Array.isArray(part.markSchemeEvidence) ? part.markSchemeEvidence : []).find((entry) => (
    validPage(entry?.page) === answerPage
    && validSha256(entry?.pageImageSha256)
  ))
  if (!sourceEvidence || !markSchemeEvidence || !questionPage || !answerPage) return null
  return Object.freeze({
    questionPage,
    answerPage,
    questionRegion: normalizedCoordinateRegion(sourceEvidence.region),
    questionPageImageSha256: validSha256(sourceEvidence.pageImageSha256),
    markSchemePageImageSha256: validSha256(markSchemeEvidence.pageImageSha256),
  })
}

export function canonicalAiVerifiedCoordinateMarkingProvenance(question = {}, part = {}) {
  const sourceRef = part.sourceRef || question.sourceRef || {}
  const answerRef = part.answerRef || question.answerRef || {}
  const binding = question.answerBinding || {}
  const sourceQuestion = sourceQuestionId(question)
  const questionPartId = String(part.questionPartId || part.partId || part.id || '')
  const evidence = coordinateSourceEvidence(question, part)
  const signature = sourceBindingSignature(question)
  if (
    binding.verificationStatus !== 'ai-verified'
    || question.sourceContent?.schemaVersion !== 'ai-verified-coordinate-source-v1'
    || question.sourceContent?.semanticStatus !== 'ai-verified'
    || question.questionGroupStatus === 'quarantined'
    || binding.questionDocumentSha256 !== sourceRef.sha256
    || binding.answerDocumentSha256 !== answerRef.sha256
    || !sourceQuestion
    || !questionPartId
    || !sourceRef.paperId
    || !validSha256(sourceRef.sha256)
    || !validSha256(answerRef.sha256)
    || !Number.isFinite(Number(part.marks))
    || Number(part.marks) <= 0
    || !evidence
  ) return null

  return Object.freeze({
    manifestSchemaVersion: STEM_MARKING_MANIFEST_SCHEMA_VERSION,
    sourceQuestionId: sourceQuestion,
    questionPartId,
    bindingSignature: signature,
    reviewSchemaVersion: STEM_AI_COORDINATE_SOURCE_BINDING_SCHEMA_VERSION,
    reviewVersion: signature,
    sourceDocumentSha256: String(sourceRef.sha256),
    answerDocumentSha256: String(answerRef.sha256),
    sourceIndexSha256: SOURCE_INDEX_SHA256,
    sourceManifestChecksum: SOURCE_CONTENT_MANIFEST_CHECKSUM,
    sourceEvidence: Object.freeze({
      assetId: `${sourceRef.paperId}:coordinate-page-${evidence.questionPage}`,
      page: evidence.questionPage,
      assetUrl: `${String(sourceRef.localUrl || '').replace(/#.*$/, '')}#page=${evidence.questionPage}`,
      assetSha256: evidence.questionPageImageSha256,
      quote: `${String(sourceRef.question || 'Question').trim()}${part.label ? `(${part.label})` : ''}`,
      coordinateSpace: 'normalized-xyxy',
      region: evidence.questionRegion,
      markSchemePage: evidence.answerPage,
      markSchemePageImageSha256: evidence.markSchemePageImageSha256,
    }),
  })
}

export function canonicalAiMarkingProvenance(question = {}, part = {}) {
  return canonicalSourceMarkingProvenance(question, part)
    || canonicalMachineIndexedMarkingProvenance(question, part)
    || canonicalAiVerifiedCoordinateMarkingProvenance(question, part)
}

/**
 * A source-practice binding freezes the QP/MS document identities used to
 * restore a practice attempt. AI authority is issued separately from the
 * current reviewed or audited marking provenance.
 */
export function canonicalSourcePracticeProvenance(question = {}, part = {}) {
  const sourceRef = part.sourceRef || question.sourceRef || {}
  const answerRef = part.answerRef || question.answerRef || {}
  const sourceQuestion = sourceQuestionId(question)
  const questionPartId = String(part.questionPartId || part.partId || part.id || '')
  const questionPage = validPage(part.sourcePage ?? sourceRef.page ?? sourceRef.pageStart)
  const sourceAssetUrl = sourceAssetUrlForPage(sourceRef, questionPage)
  const signature = sourceBindingSignature(question)
  if (!sourceQuestion || !questionPartId || !sourceRef.paperId || !sourceRef.sha256 || !answerRef.sha256 || !questionPage || !sourceAssetUrl) {
    const coordinate = canonicalAiVerifiedCoordinateMarkingProvenance(question, part)
    if (!coordinate) return null
    return Object.freeze({
      schemaVersion: 'stem-source-practice-binding.v1',
      sourceQuestionId: coordinate.sourceQuestionId,
      questionPartId: coordinate.questionPartId,
      bindingSignature: coordinate.bindingSignature,
      reviewVersion: coordinate.reviewVersion,
      sourceDocumentSha256: coordinate.sourceDocumentSha256,
      answerDocumentSha256: coordinate.answerDocumentSha256,
      sourceIndexSha256: coordinate.sourceIndexSha256,
      sourceManifestChecksum: coordinate.sourceManifestChecksum,
      sourceEvidence: coordinate.sourceEvidence,
    })
  }

  return Object.freeze({
    schemaVersion: 'stem-source-practice-binding.v1',
    sourceQuestionId: sourceQuestion,
    questionPartId,
    bindingSignature: signature,
    reviewVersion: signature,
    sourceDocumentSha256: String(sourceRef.sha256),
    answerDocumentSha256: String(answerRef.sha256),
    sourceIndexSha256: SOURCE_INDEX_SHA256,
    sourceManifestChecksum: SOURCE_CONTENT_MANIFEST_CHECKSUM,
    sourceEvidence: Object.freeze({
      assetId: `${sourceRef.paperId}:page-${questionPage}`,
      page: questionPage,
      assetUrl: sourceAssetUrl,
      quote: `${String(sourceRef.question || 'Question').trim()}${part.label ? `(${part.label})` : ''}`,
    }),
  })
}

/**
 * Checks only the source declaration. File existence and image decoding are
 * supplied by the generated source-content audit manifest at runtime.
 */
export function sourceBindingStatus(question = {}) {
  const sourceRef = question.sourceRef || {}
  const declaredAssets = Array.isArray(sourceRef.assetUrls)
    ? sourceRef.assetUrls.map((url) => String(url || '').trim()).filter(Boolean)
    : []
  const trustedAssets = trustedSourceAssetUrls(sourceRef)
  const expectedPrefix = sourceRef.paperId ? `/question-assets/${encodeURIComponent(String(sourceRef.paperId))}/` : ''
  const pageRange = sourcePageRange(sourceRef)
  const partPages = sourcePartPages(question)
  const assetPages = new Set(trustedAssets.map(sourcePageFromAssetUrl).filter(Number.isFinite))
  const reasons = []

  if (!declaredAssets.length) reasons.push('missing-source-assets')
  if (declaredAssets.length !== trustedAssets.length) reasons.push('untrusted-source-asset')
  if (new Set(declaredAssets).size !== declaredAssets.length) reasons.push('duplicate-source-asset')
  if (!sourceRef.paperId) reasons.push('missing-source-paper')
  if (expectedPrefix && trustedAssets.some((url) => !url.startsWith(expectedPrefix))) reasons.push('asset-paper-mismatch')
  if (!pageRange.valid) reasons.push('invalid-source-page-range')
  if (trustedAssets.some((url) => sourcePageFromAssetUrl(url) == null)) reasons.push('asset-page-unreadable')
  if (!partPages.length) reasons.push('missing-question-parts')

  for (const part of partPages) {
    if (!part.page) {
      reasons.push(`missing-part-source-page:${part.partId || 'unknown'}`)
      continue
    }
    if (pageRange.valid && (part.page < pageRange.start || part.page > pageRange.end)) {
      reasons.push(`part-source-page-outside-range:${part.partId || 'unknown'}:${part.page}`)
    }
    if (!assetPages.has(part.page)) reasons.push(`missing-part-page-asset:${part.partId || 'unknown'}:${part.page}`)
  }

  if (pageRange.valid) {
    for (const page of pageRange.pages) {
      if (!assetPages.has(page)) reasons.push(`missing-page-asset:${page}`)
    }
    for (const page of assetPages) {
      if (page < pageRange.start || page > pageRange.end) reasons.push(`asset-page-outside-range:${page}`)
    }
  }

  return Object.freeze({
    complete: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
    sourcePages: pageRange.pages,
    sourcePageStart: pageRange.start,
    sourcePageEnd: pageRange.end,
    partPages: Object.freeze(partPages),
    assetUrls: Object.freeze(trustedAssets),
    assetPages: Object.freeze([...assetPages].toSorted((left, right) => left - right)),
    bindingSignature: sourceBindingSignature(question),
  })
}
