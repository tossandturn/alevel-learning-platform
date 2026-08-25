export const SOURCE_RENDER_MANIFEST_SCHEMA_VERSION = 'source-render-manifest-v1'
import { stableSorted } from './arrayOrder.js'

const SHA256 = /^[a-f0-9]{64}$/i
const REVIEWED_DISPLAY_BOUNDS = 'reviewed-display-bounds-v1'
const LOCAL_PDF_URL = /^\/local-pdf\/[a-z0-9-]+\/[a-z0-9._-]+\.pdf$/i
const QUESTION_ASSET_URL = /^\/question-assets\/[a-z0-9._-]+\/qp-(\d+)\.(?:png|jpe?g|webp)$/i

function validPage(value) {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : null
}

function validImageSize(value) {
  if (!Array.isArray(value) || value.length !== 2) return null
  const size = value.map(Number)
  return size.every((item) => Number.isInteger(item) && item > 0) ? size : null
}

function validNormalizedRegion(value) {
  if (!Array.isArray(value) || value.length !== 4) return null
  const region = value.map(Number)
  if (!region.every(Number.isFinite)) return null
  const [left, top, right, bottom] = region
  if (left < 0 || top < 0 || right > 1 || bottom > 1 || right <= left || bottom <= top) return null
  return region
}

function normalizedFromPixelRegion(region, imageSize) {
  if (!Array.isArray(region) || region.length !== 4 || !imageSize) return null
  const pixels = region.map(Number)
  if (!pixels.every(Number.isFinite)) return null
  const [left, top, right, bottom] = pixels
  if (left < 0 || top < 0 || right > imageSize[0] || bottom > imageSize[1] || right <= left || bottom <= top) return null
  return validNormalizedRegion([
    left / imageSize[0],
    top / imageSize[1],
    right / imageSize[0],
    bottom / imageSize[1],
  ])
}

function trimAdjacentQuestionBleed(region, imageSize, safetyMargin, safetyStatus) {
  if (safetyStatus !== REVIEWED_DISPLAY_BOUNDS || !imageSize || !Array.isArray(safetyMargin) || safetyMargin.length !== 4) return region
  const margin = safetyMargin.map(Number)
  if (!margin.every((value) => Number.isFinite(value) && value >= 0)) return region
  // PDF text placement can differ by a few pixels from the reviewed raster.
  // Keep half of the audited bottom whitespace and discard the outer half,
  // where the next printed question can otherwise bleed into this crop.
  const bottom = region[3] - ((margin[3] / imageSize[1]) * 0.5)
  return validNormalizedRegion([region[0], region[1], region[2], bottom]) || region
}

function sourceHashMatches(value, expected) {
  const hash = String(value || '').trim()
  const sourceHash = String(expected || '').trim()
  return !hash || !sourceHash || !SHA256.test(hash) || !SHA256.test(sourceHash) ? false : hash.toLowerCase() === sourceHash.toLowerCase()
}

function pageAssetUrl(sourceRef, page) {
  return (sourceRef?.assetUrls || []).find((url) => {
    const match = String(url || '').match(QUESTION_ASSET_URL)
    return match && Number(match[1]) === page
  }) || ''
}

function regionFromEvidence(evidence, sourceRef) {
  const page = validPage(evidence?.page ?? evidence?.sourcePage)
  if (!page || !sourceHashMatches(evidence?.documentSha256, sourceRef?.sha256)) return null
  const coordinateSpace = String(evidence?.coordinateSpace || '').toLowerCase()
  const imageSize = validImageSize(evidence?.imageSize)
  const normalized = coordinateSpace === 'normalized-xyxy'
    ? validNormalizedRegion(evidence?.region || evidence?.normalizedRegion)
    : normalizedFromPixelRegion(evidence?.region, imageSize)
  if (!normalized) return null
  return {
    page,
    normalizedRegion: trimAdjacentQuestionBleed(normalized, imageSize, evidence?.safetyMargin, evidence?.safetyStatus),
    exactRegion: true,
    source: 'sourceEvidence',
  }
}

function regionFromLegacySourceRegion(sourceRegion, part) {
  if (!sourceRegion || typeof sourceRegion !== 'object' || Array.isArray(sourceRegion)) return null
  if (!SHA256.test(String(sourceRegion.assetSha256 || '').trim())) return null
  const page = validPage(part?.sourcePage ?? part?.page)
  if (!page) return null
  const normalized = validNormalizedRegion(sourceRegion.normalizedBounds || sourceRegion.normalizedRegion)
    || normalizedFromPixelRegion(sourceRegion.pixelBounds || sourceRegion.region, validImageSize(sourceRegion.imageSize) || validImageSize(part?.imageSize))
  return normalized ? { page, normalizedRegion: normalized, exactRegion: true, source: 'sourceRegion' } : null
}

function regionFromFocus(focus, sourceRef) {
  const pages = Array.isArray(focus?.pages) ? focus.pages : []
  return pages.flatMap((entry) => {
    const page = validPage(entry?.page)
    const normalized = validNormalizedRegion(entry?.normalizedRegion)
    if (!page || !normalized) return []
    const assetUrl = String(entry?.assetUrl || '')
    if (assetUrl && pageAssetUrl(sourceRef, page) && assetUrl !== pageAssetUrl(sourceRef, page)) return []
    return [{
      page,
      normalizedRegion: trimAdjacentQuestionBleed(normalized, validImageSize(entry?.imageSize), entry?.safetyMargin, entry?.safetyStatus),
      exactRegion: true,
      source: 'sourceFocus',
    }]
  })
}

function unionRegion(left, right) {
  return [
    Math.min(left[0], right[0]),
    Math.min(left[1], right[1]),
    Math.max(left[2], right[2]),
    Math.max(left[3], right[3]),
  ]
}

function fullPageRegion(page, partId) {
  return { page, partId, normalizedRegion: [0, 0, 1, 1], exactRegion: false, source: 'full-page-fallback' }
}

export function buildSourceRenderManifest(question = {}) {
  const sourceRef = question?.sourceRef || {}
  const sourcePdfUrl = String(sourceRef.localUrl || '').trim()
  const sourcePdfSha256 = String(sourceRef.sha256 || '').trim().toLowerCase()
  const sourceDocumentId = String(sourceRef.documentId || sourceRef.paperId || sourceRef.paper || '').trim()
  if (!LOCAL_PDF_URL.test(sourcePdfUrl) || !sourceDocumentId || !SHA256.test(sourcePdfSha256)) return null

  const parts = Array.isArray(question.parts) ? question.parts : []
  const partEntries = []
  for (const part of parts) {
    const partId = String(part?.partId || part?.id || part?.label || '').trim()
    const evidence = (Array.isArray(part?.sourceEvidence) ? part.sourceEvidence : [])
      .map((entry) => regionFromEvidence(entry, sourceRef))
      .filter(Boolean)
    const legacy = regionFromLegacySourceRegion(part?.sourceRegion, part)
    const focus = regionFromFocus(part?.sourceFocus, sourceRef)
    const regions = focus.length ? focus : [...evidence, ...(legacy ? [legacy] : [])]
    const page = validPage(part?.sourcePage ?? part?.page)
    const usable = regions.length ? regions : (page ? [fullPageRegion(page, partId)] : [])
    for (const region of usable) partEntries.push({ ...region, partId })
  }

  if (!partEntries.length) {
    const start = validPage(sourceRef.pageStart)
    const end = validPage(sourceRef.pageEnd ?? sourceRef.pageStart)
    if (start && end && end >= start) {
      for (let page = start; page <= end; page += 1) partEntries.push(fullPageRegion(page, ''))
    }
  }
  if (!partEntries.length) return null

  const pageMap = new Map()
  for (const entry of partEntries) {
    const current = pageMap.get(entry.page)
    if (!current) {
      pageMap.set(entry.page, {
        page: entry.page,
        normalizedRegion: [...entry.normalizedRegion],
        exactRegion: entry.exactRegion,
        sources: new Set([entry.source]),
        partIds: new Set(entry.partId ? [entry.partId] : []),
      })
      continue
    }
    current.normalizedRegion = unionRegion(current.normalizedRegion, entry.normalizedRegion)
    current.exactRegion = current.exactRegion && entry.exactRegion
    current.sources.add(entry.source)
    if (entry.partId) current.partIds.add(entry.partId)
  }

  return Object.freeze({
    schemaVersion: SOURCE_RENDER_MANIFEST_SCHEMA_VERSION,
    sourceDocumentId,
    sourcePdfUrl,
    sourcePdfSha256,
    fallbackAssetUrls: Object.freeze((sourceRef.assetUrls || []).map(String).filter((url) => QUESTION_ASSET_URL.test(url))),
    parts: Object.freeze(partEntries.map((entry) => Object.freeze({
      partId: entry.partId,
      page: entry.page,
      normalizedRegion: Object.freeze([...entry.normalizedRegion]),
      exactRegion: entry.exactRegion,
      source: entry.source,
    }))),
    pages: Object.freeze(stableSorted([...pageMap.values()], (left, right) => left.page - right.page).map((entry) => Object.freeze({
      page: entry.page,
      normalizedRegion: Object.freeze([...entry.normalizedRegion]),
      exactRegion: entry.exactRegion,
      sources: Object.freeze(stableSorted([...entry.sources])),
      partIds: Object.freeze(stableSorted([...entry.partIds])),
    }))),
  })
}
