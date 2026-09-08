import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const compress = promisify(gzip)
const MIN_GZIP_BYTES = 1024

// RFC 9110 section 12.5.3: an explicit gzip exclusion wins over '*'.
// Missing/invalid declarations retain the legacy identity response.
function acceptsGzip(value) {
  if (typeof value !== 'string') return false
  const weights = new Map()
  for (const item of value.split(',')) {
    const [name, ...parameters] = item.trim().toLowerCase().split(';')
    if (!['gzip', '*', 'identity'].includes(name.trim())) continue
    let quality = 1
    for (const parameter of parameters) {
      const match = parameter.trim().match(/^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/)
      if (!match) { quality = 0; break }
      quality = Number(match[1])
    }
    const key = name.trim()
    // Conflicting duplicates must not override a client's explicit refusal.
    weights.set(key, Math.min(weights.get(key) ?? 1, quality))
  }
  const gzipQuality = weights.get('gzip') ?? weights.get('*') ?? 0
  return gzipQuality > 0 && gzipQuality >= (weights.get('identity') ?? 0)
}

function varyByEncoding(response) {
  const value = response.getHeader?.('Vary')
  const fields = (Array.isArray(value) ? value.join(',') : String(value || '')).split(',').map(s => s.trim()).filter(Boolean)
  if (fields.some(s => s === '*' || s.toLowerCase() === 'accept-encoding')) return
  response.setHeader('Vary', [...fields, 'Accept-Encoding'].join(', '))
}

// Explicit opt-in for public source catalogs/guest-generated sets only. Do
// not use this for sessions, marking capabilities, private work or SSE. In
// particular, never mix reflected input and user secrets in a compressed body.
export async function sendPublicCatalogJson(request, response, statusCode, body) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8')
  let bytes = raw
  let compressed = false
  const publicResponse = statusCode >= 200 && statusCode < 300
    && !request.headers?.authorization && !request.headers?.cookie
    && !response.getHeader?.('Set-Cookie') && !response.getHeader?.('Content-Encoding')
  if (publicResponse) {
    varyByEncoding(response)
    if (raw.length >= MIN_GZIP_BYTES && acceptsGzip(request.headers?.['accept-encoding'])) {
      // Async zlib keeps compression off the event loop. Lightweight level 1
      // avoids spending server CPU on repetitive provenance/diagram metadata.
      try {
        const candidate = await compress(raw, { level: 1 })
        if (candidate.length < raw.length) { bytes = candidate; compressed = true }
      } catch {
        // Compression is optional; a compressor failure cannot lose the set.
      }
    }
  }
  if (response.destroyed || response.writableEnded) return
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Length', bytes.length)
  if (compressed) response.setHeader('Content-Encoding', 'gzip')
  response.end(bytes)
}
