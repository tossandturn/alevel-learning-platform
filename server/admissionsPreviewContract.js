import crypto from 'node:crypto'

export const ADMISSIONS_PREVIEW_PATH = '/api/ai/admissions/source-preview'
export const ADMISSIONS_PREVIEW_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const ADMISSIONS_PREVIEW_WIDTH = 390
export const ADMISSIONS_PREVIEW_HEIGHT = 900

export function admissionsSourceExcerpt(value) {
  const cleaned = String(value || '').replace(/(?:^|[.!?。！？]\s*)(?:ignore|disregard|forget|reveal|expose|follow|obey|override)\b[^\n]{0,500}(?:instructions?|prompts?|credentials?|secrets?|system|developer)[^\n]*/giu, '')
    .replace(/(?:^|[。！？]\s*)(?:忽略|无视|泄露|显示|输出|遵循|覆盖)[^\n]{0,300}(?:指令|提示词|密钥|凭据|系统消息)[^\n]*/gu, '')
  const lines = cleaned.replace(/\r\n?/g, '\n').split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return lines.join('\n').slice(0, 900).trim()
}

export function createAdmissionsPreviewDescriptor({ sourceUrl, now = Date.now() } = {}) {
  const capturedAt = null
  return Object.freeze({
    previewId: `apv_${crypto.randomBytes(24).toString('base64url')}`,
    path: ADMISSIONS_PREVIEW_PATH,
    kind: 'static-webpage-screenshot',
    status: 'pending',
    mimeType: 'image/png',
    width: ADMISSIONS_PREVIEW_WIDTH,
    height: ADMISSIONS_PREVIEW_HEIGHT,
    sourceUrl: String(sourceUrl || ''),
    capturedAt,
    expiresAt: new Date(Number(now) + ADMISSIONS_PREVIEW_TTL_MS).toISOString(),
    reason: null,
  })
}

export function publicAdmissionsResearch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const sources = Array.isArray(value.sources) ? value.sources.slice(0, 8).flatMap(source => {
    if (!source || typeof source !== 'object' || typeof source.id !== 'string' || typeof source.url !== 'string') return []
    return [{
      id: source.id,
      title: String(source.title || '').slice(0, 180),
      url: source.url,
      official: source.official === true,
      retrievedAt: String(source.retrievedAt || ''),
      applicableYears: Array.isArray(source.applicableYears) ? source.applicableYears.slice(0, 6) : [],
      excerpt: admissionsSourceExcerpt(source.excerpt),
      verification: source.verification && typeof source.verification === 'object' ? source.verification : null,
      preview: source.preview && typeof source.preview === 'object' ? {
        previewId: String(source.preview.previewId || ''), path: ADMISSIONS_PREVIEW_PATH,
        kind: source.preview.kind === 'static-webpage-screenshot' ? source.preview.kind : 'static-webpage-screenshot',
        status: ['pending', 'ready', 'fallback', 'expired'].includes(source.preview.status) ? source.preview.status : 'pending',
        mimeType: source.preview.mimeType === 'image/png' ? 'image/png' : 'image/png',
        width: ADMISSIONS_PREVIEW_WIDTH, height: ADMISSIONS_PREVIEW_HEIGHT,
        sourceUrl: source.url, capturedAt: source.preview.capturedAt || null,
        expiresAt: String(source.preview.expiresAt || ''), reason: source.preview.reason || null,
      } : null,
    }]
  }) : []
  return {
    status: String(value.status || 'unavailable'), sourceCount: sources.length, sources,
    ...(value.searchMode ? { searchMode: String(value.searchMode) } : {}),
    ...(value.scope && typeof value.scope === 'object' ? { scope: value.scope } : {}),
    ...(value.code ? { code: String(value.code) } : {}),
    ...(Array.isArray(value.missingFields) ? { missingFields: value.missingFields.slice(0, 4) } : {}),
  }
}
