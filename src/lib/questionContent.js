import sourceContentManifest from '../data/sourceContentManifest.json' with { type: 'json' }
import { SOURCE_CONTENT_MANIFEST_CHECKSUM, SOURCE_INDEX_SHA256 } from '../data/sourceContentIdentity.js'
import {
  SOURCE_CONTENT_AUDIT_SCHEMA_VERSION,
  sourceBindingStatus,
  sourceQuestionId,
  sourcePageFromAssetUrl,
  trustedSourceAssetUrls,
} from './sourceContentContract.js'

const VISUAL_PLACEHOLDER = /\[(?:graph|diagram|figure|image|table|chart|map)\s*:[^\]]*\]/gi
const REVIEWED_SOURCE_FOCUS_SAFETY_VERSION = 'reviewed-display-bounds-v1'

// These crop bounds were visually checked against the checksum-bound official
// QP pages. They leave an intentional paper margin around the reviewed source
// evidence without crossing into a neighbouring question. Questions without
// this explicit evidence remain on the complete official page by default.
const REVIEWED_SOURCE_FOCUS_SAFE_BOUNDS = Object.freeze({
  'cie-0580-0580_m25_qp_12:q5': Object.freeze({
    4: Object.freeze({
      imageSize: Object.freeze([1020, 1320]),
      region: Object.freeze([80, 98, 930, 660]),
      // The old part-a selection includes a few barcode pixels above Q5.
      // This manually checked boundary starts before the visible question
      // number while deliberately excluding that non-question header.
      contentRegion: Object.freeze([110, 98, 910, 649]),
    }),
  }),
  'cie-0580-0580_m25_qp_12:q14': Object.freeze({
    8: Object.freeze({ imageSize: Object.freeze([1020, 1320]), region: Object.freeze([80, 198, 930, 930]) }),
    9: Object.freeze({ imageSize: Object.freeze([1020, 1320]), region: Object.freeze([88, 92, 930, 1030]) }),
  }),
  'cie-0580-0580_m25_qp_12:q16': Object.freeze({
    11: Object.freeze({
      imageSize: Object.freeze([1020, 1320]),
      region: Object.freeze([84, 96, 930, 670]),
      contentRegion: Object.freeze([118, 96, 900, 650]),
    }),
  }),
  'cie-0580-0580_m25_qp_12:q18': Object.freeze({
    13: Object.freeze({ imageSize: Object.freeze([1020, 1320]), region: Object.freeze([80, 92, 940, 1090]) }),
  }),
})

export { trustedSourceAssetUrls }
export { sourceBindingStatus }

const runtimeManifestTrusted = Boolean(
  sourceContentManifest?.schemaVersion === SOURCE_CONTENT_AUDIT_SCHEMA_VERSION
  && typeof sourceContentManifest?.sourceIndexSha256 === 'string'
  && sourceContentManifest.sourceIndexSha256 === SOURCE_INDEX_SHA256
  && typeof sourceContentManifest?.checksum === 'string'
  && sourceContentManifest.checksum === SOURCE_CONTENT_MANIFEST_CHECKSUM,
)

export function requiresSourceVisual(value) {
  VISUAL_PLACEHOLDER.lastIndex = 0
  return VISUAL_PLACEHOLDER.test(String(value || ''))
}

export function stripSourceVisualPlaceholders(value) {
  VISUAL_PLACEHOLDER.lastIndex = 0
  return String(value || '')
    .replace(VISUAL_PLACEHOLDER, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function imageSize(value) {
  if (!Array.isArray(value) || value.length !== 2) return null
  const width = Number(value[0])
  const height = Number(value[1])
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? Object.freeze([width, height])
    : null
}

function pixelRegion(value, size) {
  if (!Array.isArray(value) || value.length !== 4 || !size) return null
  const [left, top, right, bottom] = value.map(Number)
  if (![left, top, right, bottom].every(Number.isInteger)) return null
  if (left < 0 || top < 0 || right <= left || bottom <= top || right > size[0] || bottom > size[1]) return null
  return Object.freeze([left, top, right, bottom])
}

function sameRegion(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === 4 && right.length === 4
    && left.every((value, index) => Number(value) === Number(right[index]))
}

function normalizedRegion(value) {
  if (!Array.isArray(value) || value.length !== 4) return null
  const region = value.map(Number)
  if (!region.every(Number.isFinite)) return null
  const [left, top, right, bottom] = region
  if (left < 0 || top < 0 || right <= left || bottom <= top || right > 1 || bottom > 1) return null
  return Object.freeze(region)
}

function sameNormalizedRegion(left, right) {
  const a = normalizedRegion(left)
  const b = normalizedRegion(right)
  return Boolean(a && b && a.every((value, index) => Math.abs(value - b[index]) <= 0.001))
}

function normalizedPixelRegion(region, size) {
  const validRegion = pixelRegion(region, size)
  if (!validRegion || !size) return null
  return Object.freeze([
    validRegion[0] / size[0],
    validRegion[1] / size[1],
    validRegion[2] / size[0],
    validRegion[3] / size[1],
  ])
}

function regionContains(container, content) {
  return Array.isArray(container) && Array.isArray(content)
    && container.length === 4 && content.length === 4
    && container[0] <= content[0]
    && container[1] <= content[1]
    && container[2] >= content[2]
    && container[3] >= content[3]
}

function reviewedSafeFocusBounds(questionId, page, rawRegion, imageSizeValue, safetyMargin, safetyStatus) {
  const configured = REVIEWED_SOURCE_FOCUS_SAFE_BOUNDS[questionId]?.[page]
  const size = imageSize(configured?.imageSize)
  const region = pixelRegion(configured?.region, size)
  const requiredRegion = pixelRegion(configured?.contentRegion || rawRegion, size)
  if (configured && size && region && requiredRegion && regionContains(region, requiredRegion)) {
    return Object.freeze({
      imageSize: size,
      region,
      safetyMargin: Object.freeze([
        requiredRegion[0] - region[0],
        requiredRegion[1] - region[1],
        region[2] - requiredRegion[2],
        region[3] - requiredRegion[3],
      ]),
    })
  }

  // New reviewed batches carry their own checksum-bound display bounds. This
  // keeps the crop evidence beside the question while still requiring an
  // explicit reviewer safety status and measurable margin.
  const measuredSize = imageSize(imageSizeValue)
  const measuredRegion = pixelRegion(rawRegion, measuredSize)
  const margin = Array.isArray(safetyMargin) ? safetyMargin.map(Number) : []
  if (
    !measuredSize
    || !measuredRegion
    || safetyStatus !== REVIEWED_SOURCE_FOCUS_SAFETY_VERSION
    || margin.length !== 4
    || !margin.every((value) => Number.isFinite(value) && value >= 12)
  ) return null
  return Object.freeze({
    imageSize: measuredSize,
    region: measuredRegion,
    safetyMargin: Object.freeze(margin),
  })
}

function rawSourceEvidenceForPart(part, allocation, sourceRef, sourceAssets) {
  const sourcePage = Number(allocation?.questionPage)
  const candidates = Array.isArray(part?.sourceEvidence) ? part.sourceEvidence : []
  const rawEvidence = candidates.find((evidence) => {
    const assetUrl = String(evidence?.assetUrl || '')
    const size = imageSize(evidence?.imageSize)
    const region = pixelRegion(evidence?.region, size)
    return evidence?.coordinateSpace === 'pixel-xyxy'
      && evidence?.documentSha256 === sourceRef.sha256
      && Number(evidence?.page) === sourcePage
      && sourceAssets.includes(assetUrl)
      && sourcePageFromAssetUrl(assetUrl) === sourcePage
      && Boolean(size && region)
      && sameRegion(region, allocation?.questionRegion)
  })
  if (rawEvidence) {
    const size = imageSize(rawEvidence.imageSize)
    const region = pixelRegion(rawEvidence.region, size)
    return Object.freeze({
      assetUrl: String(rawEvidence.assetUrl),
      imageSize: size,
      region,
      normalizedRegion: normalizedPixelRegion(region, size),
      safetyMargin: rawEvidence.safetyMargin,
      safetyStatus: rawEvidence.safetyStatus,
      provenance: 'raw-pixel-evidence',
    })
  }

  // Some reviewed 0580 fragments recorded the same reviewer-measured crop in
  // both pixel and normalized coordinates before the sourceEvidence field was
  // introduced. It is safe to use only when the paired allocation agrees with
  // that stored normalized region and the declared page asset is checksum-bound.
  const sourceRegion = part?.sourceRegion || {}
  const region = Array.isArray(sourceRegion.pixelBounds)
    ? sourceRegion.pixelBounds.map(Number)
    : null
  const normalized = normalizedRegion(sourceRegion.normalizedBounds)
  const assetUrl = sourceAssets.find((url) => sourcePageFromAssetUrl(url) === sourcePage) || ''
  if (
    sourceRef.sha256
    && Number(part?.sourcePage) === sourcePage
    && sourceRegion.assetSha256
    && assetUrl
    && Array.isArray(region)
    && region.length === 4
    && region.every(Number.isInteger)
    && normalized
    && sameNormalizedRegion(normalized, allocation?.questionRegion)
  ) {
    return Object.freeze({
      assetUrl,
      imageSize: null,
      region: Object.freeze(region),
      normalizedRegion: normalized,
      provenance: 'reviewed-dual-coordinate-evidence',
    })
  }

  return null
}

/**
 * Returns a display crop only when a human-reviewed QP/MS allocation and the
 * raw source-image evidence agree exactly. Any missing or malformed evidence
 * falls back to the complete original page in the UI.
 */
export function reviewedSourceFocusBinding(question = {}) {
  const sourceRef = question.sourceRef || {}
  const binding = question.answerBinding || question.binding || {}
  const review = binding.reviewEvidence || {}
  const parts = Array.isArray(question.parts) ? question.parts : []
  const sourceAssets = trustedSourceAssetUrls(sourceRef)
  const reasons = []

  if (binding.verificationStatus !== 'reviewed') reasons.push('source-focus-not-reviewed')
  if (review.method !== 'paired-qp-ms-page-review') reasons.push('source-focus-unsupported-review-method')
  if (review.coordinateSpace && !['pixel-xyxy', 'normalized-xyxy'].includes(review.coordinateSpace)) reasons.push('source-focus-coordinate-space-unverified')
  if (review.questionPaper?.sha256 !== sourceRef.sha256) reasons.push('source-focus-question-checksum-mismatch')
  if (!parts.length) reasons.push('source-focus-missing-parts')

  const allocations = new Map((review.partAllocations || []).map((allocation) => [String(allocation?.partId || ''), allocation]))
  const pageEntries = new Map()
  const partPages = []

  for (const part of parts) {
    const partId = String(part?.partId || part?.id || '')
    const allocation = allocations.get(partId)
    if (!partId || !allocation) {
      reasons.push(`source-focus-missing-allocation:${partId || 'unknown'}`)
      continue
    }
    const evidence = rawSourceEvidenceForPart(part, allocation, sourceRef, sourceAssets)
    const size = imageSize(evidence?.imageSize)
    const region = Array.isArray(evidence?.region) ? evidence.region : null
    const normalized = normalizedRegion(evidence?.normalizedRegion)
    const page = Number(allocation.questionPage)
    const assetUrl = String(evidence?.assetUrl || '')
    if (!evidence || !region || !normalized || !Number.isInteger(page) || page < 1 || !assetUrl) {
      reasons.push(`source-focus-unverified-region:${partId}`)
      continue
    }
    const existing = pageEntries.get(page)
    if (existing && (
      existing.assetUrl !== assetUrl
      || (size && existing.imageSize && (existing.imageSize[0] !== size[0] || existing.imageSize[1] !== size[1]))
      || (existing.safetyStatus || '') !== (evidence.safetyStatus || '')
      || JSON.stringify(existing.safetyMargin || []) !== JSON.stringify(evidence.safetyMargin || [])
    )) {
      reasons.push(`source-focus-page-asset-mismatch:${partId}`)
      continue
    }
    const entry = existing || {
      page,
      assetUrl,
      imageSize: size,
      safetyMargin: evidence.safetyMargin,
      safetyStatus: evidence.safetyStatus,
      regions: [],
      normalizedRegions: [],
      partIds: [],
    }
    entry.regions.push(region)
    entry.normalizedRegions.push(normalized)
    entry.partIds.push(partId)
    pageEntries.set(page, entry)
    partPages.push({ partId, page })
  }

  if (allocations.size !== parts.length) reasons.push('source-focus-allocation-count-mismatch')
  if (reasons.length) return Object.freeze({ complete: false, reasons: Object.freeze([...new Set(reasons)]), parts: Object.freeze({}) })

  const pages = [...pageEntries.values()]
    .map((entry) => {
      const rawRegion = Object.freeze([
        Math.min(...entry.regions.map((candidate) => candidate[0])),
        Math.min(...entry.regions.map((candidate) => candidate[1])),
        Math.max(...entry.regions.map((candidate) => candidate[2])),
        Math.max(...entry.regions.map((candidate) => candidate[3])),
      ])
      const safeBounds = reviewedSafeFocusBounds(
        sourceQuestionId(question),
        entry.page,
        rawRegion,
        entry.imageSize,
        entry.safetyMargin,
        entry.safetyStatus,
      )
      if (!safeBounds) {
        reasons.push(`source-focus-display-bounds-unreviewed:${entry.page}`)
        return null
      }
      if (entry.imageSize && (entry.imageSize[0] !== safeBounds.imageSize[0] || entry.imageSize[1] !== safeBounds.imageSize[1])) {
        reasons.push(`source-focus-display-size-mismatch:${entry.page}`)
        return null
      }
      const region = safeBounds.region
      const normalized = normalizedPixelRegion(region, safeBounds.imageSize)
      return Object.freeze({
        page: entry.page,
        assetUrl: entry.assetUrl,
        imageSize: safeBounds.imageSize,
        region,
        normalizedRegion: normalized,
        rawRegion,
        safetyMargin: safeBounds.safetyMargin,
        safetyStatus: REVIEWED_SOURCE_FOCUS_SAFETY_VERSION,
        partIds: Object.freeze([...entry.partIds]),
      })
    })
    .filter(Boolean)
    .toSorted((left, right) => left.page - right.page)
  if (reasons.length || pages.length !== pageEntries.size) return Object.freeze({ complete: false, reasons: Object.freeze([...new Set(reasons)]), parts: Object.freeze({}) })
  const pageByNumber = new Map(pages.map((entry) => [entry.page, entry]))
  const focusParts = Object.fromEntries(partPages.map(({ partId, page }) => [partId, Object.freeze({
    focusPage: page,
    pages: Object.freeze(pages),
  })]))

  return Object.freeze({
    complete: true,
    reasons: Object.freeze([]),
    pages: Object.freeze(pages),
    parts: Object.freeze(focusParts),
    pageByNumber,
  })
}

function auditRecordForQuestion(question) {
  const item = sourceContentManifest?.items?.[sourceQuestionId(question)]
  if (!item || !runtimeManifestTrusted) return null
  return item
}

/**
 * A Topic item can use compact structured text only as an aid. Bound source
 * page images remain the complete student-visible record. An item is complete
 * only when both its declaration and a local file/decode audit agree.
 */
export function sourceContentStatus(question = {}) {
  const declared = sourceBindingStatus(question)
  const audit = auditRecordForQuestion(question)
  const reasons = [...declared.reasons]

  if (!runtimeManifestTrusted) {
    reasons.push('source-manifest-integrity-mismatch')
  } else if (!audit) {
    reasons.push('source-assets-not-audited')
  } else if (audit.bindingSignature !== declared.bindingSignature) {
    reasons.push('source-audit-stale')
  } else if (audit.complete !== true) {
    const declaredReasons = new Set(declared.reasons)
    reasons.push(...(audit.reasons || [])
      .filter((reason) => !declaredReasons.has(reason))
      .map((reason) => `source-audit:${reason}`))
  }

  return Object.freeze({
    complete: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
    sourcePages: declared.sourcePages,
    sourcePageStart: declared.sourcePageStart,
    sourcePageEnd: declared.sourcePageEnd,
    partPages: declared.partPages,
    assetUrls: declared.assetUrls,
    assetPages: declared.assetPages,
    audit,
    fileComplete: audit?.fileComplete === true,
    semanticStatus: audit?.semanticStatus || 'unreviewed',
    bindingSignature: declared.bindingSignature,
  })
}

export function hasCompleteSourceContent(question = {}) {
  return sourceContentStatus(question).complete
}

export function hasRequiredSourceVisual(question = {}) {
  const prompt = question.prompt || (question.parts || []).map((part) => part.promptFragment).join('\n')
  return !requiresSourceVisual(prompt) || trustedSourceAssetUrls(question.sourceRef).length > 0
}
