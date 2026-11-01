import { ADMISSIONS_PREVIEW_PATH, ADMISSIONS_PREVIEW_TTL_MS } from './admissionsPreviewContract.js'
import { boundedAdmissionsOperation } from './admissionsResearchDeadline.js'

const MAX_REQUEST_BYTES = 16 * 1024
const MAX_CACHE_ENTRIES = 48
const MAX_CACHE_BYTES = 32 * 1024 * 1024
const MAX_INFLIGHT = 4
const FALLBACK_CACHE_MS = 20_000

function serviceError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code })
}

function sendJson(response, statusCode, value) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(value))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    request.on('data', chunk => {
      bytes += chunk.length
      if (bytes > MAX_REQUEST_BYTES) {
        reject(serviceError(413, 'admissions_preview_request_too_large', 'Preview request is too large.'))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(serviceError(400, 'admissions_preview_request_invalid', 'Preview request must be valid JSON.')) }
    })
    request.on('error', reject)
  })
}

function identifier(value, label) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9._:-]{8,220}$/.test(text)) throw serviceError(400, 'admissions_preview_request_invalid', `${label} is invalid.`)
  return text
}

function xml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function wrappedLines(value, width = 52, limit = 12) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ')
  const lines = []
  let current = ''
  for (const word of words) {
    if (lines.length >= limit) break
    if (!current || `${current} ${word}`.length <= width) current = current ? `${current} ${word}` : word
    else { lines.push(current); current = word }
  }
  if (current && lines.length < limit) lines.push(current)
  return lines
}

export function excerptCard(source, { status = 'fallback', reason = 'renderer_unavailable', capturedAt = new Date().toISOString() } = {}) {
  const width = 720
  const lines = wrappedLines(source.excerpt || 'Official source excerpt is unavailable.')
  const height = Math.max(300, 190 + lines.length * 34)
  const body = lines.map((line, index) => `<text x="42" y="${150 + index * 34}" font-size="22" fill="#243247">${xml(line)}</text>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f7f9fc"/><rect x="20" y="20" width="680" height="${height - 40}" rx="8" fill="#fff" stroke="#cbd5e1"/><text x="42" y="65" font-size="17" fill="#64748b">官网原文摘录 / Official source excerpt</text><text x="42" y="105" font-size="26" font-weight="700" fill="#0f172a">${xml(source.title || 'Admissions source')}</text>${body}<text x="42" y="${height - 45}" font-size="14" fill="#64748b">Static excerpt card · ${xml(source.url || '')}</text></svg>`
  return {
    kind: 'excerpt-card', mimeType: 'image/svg+xml', base64: Buffer.from(svg).toString('base64'),
    path: ADMISSIONS_PREVIEW_PATH, width, height, sourceUrl: source.url,
    capturedAt, status, reason,
  }
}

function screenshotResult(source, value, capturedAt) {
  if (!value || value.mimeType !== 'image/png' || typeof value.base64 !== 'string') throw serviceError(502, 'ADMISSIONS_PREVIEW_RENDER_INVALID', 'Preview renderer returned invalid output.')
  const bytes = Buffer.from(value.base64, 'base64')
  if (bytes.length < 8 || bytes.length > 2 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw serviceError(502, 'ADMISSIONS_PREVIEW_RENDER_INVALID', 'Preview image is not a bounded PNG.')
  const width = Number(value.width)
  const height = Number(value.height)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 100 || width > 1600 || height < 100 || height > 2400) throw serviceError(502, 'ADMISSIONS_PREVIEW_RENDER_INVALID', 'Preview dimensions are invalid.')
  return {
    kind: 'static-webpage-screenshot', mimeType: 'image/png', base64: value.base64,
    path: ADMISSIONS_PREVIEW_PATH, width, height, sourceUrl: source.url,
    capturedAt, status: 'ready', reason: value.focus === 'requirements-section'
      ? 'requirements_section_static_javascript_disabled_assets_may_be_omitted'
      : 'page_first_screen_static_javascript_disabled_assets_may_be_omitted',
  }
}

function reasonFor(error) {
  const code = String(error?.code || '')
  if (code.includes('RENDERER_UNAVAILABLE')) return 'renderer_unavailable'
  if (code.includes('RENDER_BUSY')) return 'renderer_busy'
  if (code.includes('TIMEOUT')) return 'capture_timeout'
  if (code.includes('SOURCE') || code.includes('FETCH') || code.includes('HTTP')) return 'source_unavailable'
  return 'capture_failed'
}

export function createAdmissionsPreviewService({ authenticateRequest, resolveSource, captureSource = null, now = Date.now, captureTimeoutMs = 20_000 } = {}) {
  if (typeof authenticateRequest !== 'function' || typeof resolveSource !== 'function') throw new Error('Admissions preview service requires authentication and persistent source resolution.')
  const cache = new Map()
  const inflight = new Map()
  const inflightOwners = new Map()
  let cacheBytes = 0
  const put = (key, preview, expiresAt) => {
    const bytes = Buffer.byteLength(preview.base64 || '', 'base64')
    const previous = cache.get(key)
    if (previous) cacheBytes -= previous.bytes
    cache.delete(key)
    cache.set(key, { preview, expiresAt, bytes })
    cacheBytes += bytes
    while (cache.size > MAX_CACHE_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value
      const removed = cache.get(oldest)
      cache.delete(oldest)
      cacheBytes -= removed?.bytes || 0
    }
  }
  async function handle(request, response, url) {
    if (url.pathname !== ADMISSIONS_PREVIEW_PATH) return false
    if ([...url.searchParams.keys()].length) { sendJson(response, 400, { code: 'admissions_preview_request_invalid', error: 'Preview route does not accept query parameters.' }); return true }
    if (request.method !== 'POST') { sendJson(response, 405, { code: 'admissions_preview_method', error: 'Preview route requires POST.' }); return true }
    const ownerId = authenticateRequest(request)
    if (!ownerId) { sendJson(response, 401, { code: 'coach_auth_required', error: 'Sign in to view an admissions source preview.' }); return true }
    const payload = await readBody(request)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['conversationId', 'turnId', 'sourceId'].includes(key))) {
      throw serviceError(400, 'admissions_preview_request_invalid', 'Preview request fields are invalid.')
    }
    const conversationId = identifier(payload.conversationId, 'conversationId')
    const turnId = identifier(payload.turnId, 'turnId')
    const sourceId = identifier(payload.sourceId, 'sourceId')
    const source = await resolveSource({ ownerId, conversationId, turnId, sourceId })
    if (!source) { sendJson(response, 404, { code: 'admissions_preview_not_found', error: 'Source preview is not available.' }); return true }
    const clock = Number(now())
    const expiresAt = Date.parse(source.preview?.expiresAt || '')
    if (!Number.isFinite(expiresAt) || expiresAt <= clock) {
      sendJson(response, 200, { excerpt: source.excerpt, preview: excerptCard(source, { status: 'expired', reason: 'preview_expired', capturedAt: new Date(clock).toISOString() }) })
      return true
    }
    const key = `${ownerId}\u0000${source.preview.previewId}`
    const existing = cache.get(key)
    if (existing && existing.expiresAt > clock) { sendJson(response, 200, { excerpt: source.excerpt, preview: existing.preview }); return true }
    let task = inflight.get(key)
    if (!task) {
      if (inflight.size >= MAX_INFLIGHT || (inflightOwners.get(ownerId) || 0) >= 1) {
        const busy = excerptCard(source, { reason: 'renderer_busy', capturedAt: new Date(Number(now())).toISOString() })
        put(key, busy, Math.min(expiresAt, Number(now()) + FALLBACK_CACHE_MS))
        sendJson(response, 200, { excerpt: source.excerpt, preview: busy })
        return true
      }
      inflightOwners.set(ownerId, (inflightOwners.get(ownerId) || 0) + 1)
      task = (async () => {
        try {
          if (typeof captureSource !== 'function') throw Object.assign(new Error('Renderer unavailable'), { code: 'ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE' })
          const boundedTimeout = Math.min(20_000, Math.max(10, Number(captureTimeoutMs) || 20_000))
          const deadlineAt = clock + boundedTimeout
          const captured = await boundedAdmissionsOperation(() => captureSource(source, { deadlineAt }), { timeoutMs: boundedTimeout, deadlineAt, code: 'ADMISSIONS_PREVIEW_CAPTURE_TIMEOUT' })
          return screenshotResult(source, captured, new Date(Number(now())).toISOString())
        } catch (error) {
          return excerptCard(source, { reason: reasonFor(error), capturedAt: new Date(Number(now())).toISOString() })
        }
      })().then(preview => {
        const completedAt = Number(now())
        put(key, preview, Math.min(expiresAt, completedAt + (preview.status === 'ready' ? ADMISSIONS_PREVIEW_TTL_MS : FALLBACK_CACHE_MS)))
        return preview
      }).finally(() => {
        inflight.delete(key)
        const remaining = (inflightOwners.get(ownerId) || 1) - 1
        if (remaining > 0) inflightOwners.set(ownerId, remaining)
        else inflightOwners.delete(ownerId)
      })
      inflight.set(key, task)
    }
    const preview = await task
    sendJson(response, 200, { excerpt: source.excerpt, preview })
    return true
  }
  return Object.freeze({ handle, close: () => { cache.clear(); inflight.clear(); inflightOwners.clear(); cacheBytes = 0 } })
}
