import dns from 'node:dns'
import https from 'node:https'
import { boundedAdmissionsOperation } from './admissionsResearchDeadline.js'
import { createPinnedAddressLookup, validateAdmissionsPublicUrl } from './admissionsResearch.js'

const MAX_HTML_BYTES = 512 * 1024
const MAX_CSS_BYTES = 96 * 1024
const MAX_IMAGE_BYTES = 256 * 1024
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024
const MAX_STYLESHEETS = 4
const MAX_IMAGES = 8

function previewError(code, message) {
  return Object.assign(new Error(message), { code })
}

function rootDomain(hostname) {
  const labels = String(hostname || '').toLowerCase().replace(/^www\./, '').split('.')
  const suffix = labels.slice(-2).join('.')
  const three = new Set(['ac.uk', 'edu.au', 'edu.hk', 'edu.sg', 'ac.nz', 'ac.jp', 'edu.cn'])
  return three.has(suffix) ? labels.slice(-3).join('.') : labels.slice(-2).join('.')
}

function sameDomain(url, source) {
  return rootDomain(url.hostname) === rootDomain(source.hostname)
}

function boundedUrl(raw, base, source) {
  try {
    const url = new URL(raw, base)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !sameDomain(url, source)) return null
    url.hash = ''
    url.search = ''
    return url
  } catch { return null }
}

function requestBytes({ url, address, family, signal, maxBytes, accept }) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:', hostname: url.hostname, servername: url.hostname, port: 443,
      method: 'GET', path: `${url.pathname}${url.search}`,
      headers: { Accept: accept, 'Accept-Encoding': 'identity', 'User-Agent': 'STEMist-Admissions-Preview/1.0' },
      lookup: createPinnedAddressLookup(address, family), signal,
    }, response => {
      const chunks = []
      let bytes = 0
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > maxBytes) request.destroy(previewError('ADMISSIONS_PREVIEW_RESOURCE_TOO_LARGE', 'Preview resource exceeds its bound.'))
        else chunks.push(chunk)
      })
      response.on('end', () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

export function createAdmissionsPreviewResourceFetcher({ resolveAddresses = hostname => dns.promises.lookup(hostname, { all: true, verbatim: true }), requestResource = requestBytes } = {}) {
  return async function fetchResource(rawUrl, { deadlineAt = Date.now() + 6_000, maxBytes = MAX_HTML_BYTES, accept = 'text/html' } = {}) {
    const original = new URL(rawUrl)
    const allowedDomains = new Set([rootDomain(original.hostname)])
    let current = original
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      current.search = ''
      const safe = await validateAdmissionsPublicUrl(current.href, { allowedDomains, resolveAddresses, deadlineAt, timeoutMs: 2_000 })
      const response = await boundedAdmissionsOperation(signal => requestResource({ ...safe, signal, maxBytes, accept }), {
        deadlineAt, timeoutMs: 5_000, code: 'ADMISSIONS_PREVIEW_FETCH_TIMEOUT',
      })
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        if (redirect === 3 || !response.headers.location) throw previewError('ADMISSIONS_PREVIEW_REDIRECT_BLOCKED', 'Preview redirect is invalid.')
        const next = boundedUrl(response.headers.location, safe.url, original)
        if (!next) throw previewError('ADMISSIONS_PREVIEW_REDIRECT_BLOCKED', 'Preview redirect leaves the official domain.')
        current = next
        continue
      }
      if (response.statusCode < 200 || response.statusCode >= 300) throw previewError('ADMISSIONS_PREVIEW_SOURCE_HTTP', `Preview source returned HTTP ${response.statusCode || 'error'}.`)
      const encoding = String(response.headers['content-encoding'] || '').trim().toLowerCase()
      if (encoding && encoding !== 'identity') throw previewError('ADMISSIONS_PREVIEW_ENCODING_BLOCKED', 'Compressed preview resources are not accepted.')
      const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
      return { url: safe.url.href, contentType, body: response.body }
    }
    throw previewError('ADMISSIONS_PREVIEW_REDIRECT_BLOCKED', 'Preview redirect limit exceeded.')
  }
}

function stripCss(value) {
  return String(value || '')
    .replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])\s*;?/giu, '')
    .replace(/url\([^)]*\)/giu, 'none')
    .replace(/expression\s*\([^)]*\)/giu, '')
    .replace(/behavior\s*:/giu, 'blocked:')
    .slice(0, MAX_CSS_BYTES)
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu'))
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}

function safeText(value) {
  return String(value || '').replace(/[<>]/g, '')
}

export async function createAdmissionsStaticPageBundle(sourceUrl, { fetchResource = null, deadlineAt = Date.now() + 8_000 } = {}) {
  const source = new URL(sourceUrl)
  const fetcher = fetchResource || createAdmissionsPreviewResourceFetcher()
  const fetchBounded = (url, options) => boundedAdmissionsOperation(() => fetcher(url, { deadlineAt, ...options }), {
    deadlineAt, timeoutMs: 5_000, code: 'ADMISSIONS_PREVIEW_FETCH_TIMEOUT',
  })
  const htmlResource = await fetchBounded(source.href, { maxBytes: MAX_HTML_BYTES, accept: 'text/html' })
  if (!String(htmlResource.contentType).startsWith('text/html')) throw previewError('ADMISSIONS_PREVIEW_HTML_INVALID', 'Preview source is not HTML.')
  if (htmlResource.body.byteLength > MAX_HTML_BYTES) throw previewError('ADMISSIONS_PREVIEW_HTML_TOO_LARGE', 'Preview HTML exceeds its bound.')
  let html = htmlResource.body.toString('utf8')
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|noscript|iframe|frame|object|embed|form|input|button|textarea|select|video|audio|canvas|svg|picture)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
    .replace(/<(script|iframe|frame|object|embed|input|meta|base|source)\b[^>]*\/?\s*>/giu, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '')
    .replace(/\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '')
    .replace(/style\s*=\s*("[^"]*"|'[^']*')/giu, match => match.replace(/url\([^)]*\)/giu, 'none'))
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu, (_match, css) => `<style>${stripCss(css)}</style>`)

  const stylesheetTags = [...html.matchAll(/<link\b[^>]*>/giu)].map(match => match[0])
    .filter(tag => /\brel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet)/iu.test(tag)).slice(0, MAX_STYLESHEETS)
  for (const tag of stylesheetTags) {
    const url = boundedUrl(attribute(tag, 'href'), source, source)
    let replacement = ''
    if (url) {
      try {
        const resource = await fetchBounded(url.href, { maxBytes: MAX_CSS_BYTES, accept: 'text/css' })
        if (resource.contentType === 'text/css') replacement = `<style data-static-source="stylesheet">${stripCss(resource.body.toString('utf8'))}</style>`
      } catch { /* A stylesheet failure must not block an excerpt fallback or screenshot. */ }
    }
    html = html.replace(tag, replacement)
  }
  html = html.replace(/<link\b[^>]*>/giu, '')
  html = html.replace(/\s+href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, ' href="#"')

  const imageTags = [...html.matchAll(/<img\b[^>]*>/giu)].map(match => match[0]).slice(0, MAX_IMAGES)
  for (const tag of imageTags) {
    const url = boundedUrl(attribute(tag, 'src'), source, source)
    let replacement = `<span data-static-image-omitted="true">${safeText(attribute(tag, 'alt'))}</span>`
    if (url) {
      try {
        const resource = await fetchBounded(url.href, { maxBytes: MAX_IMAGE_BYTES, accept: 'image/png,image/jpeg,image/webp,image/gif' })
        if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(resource.contentType)) {
          replacement = `<img data-static-inline="true" alt="${safeText(attribute(tag, 'alt'))}" src="data:${resource.contentType};base64,${resource.body.toString('base64')}">`
        }
      } catch { /* The screenshot remains truthful with an omitted-image marker. */ }
    }
    html = html.replace(tag, replacement)
  }
  html = html.replace(/<img\b[^>]*>/giu, tag => /\bdata-static-inline="true"/u.test(tag) ? tag : `<span data-static-image-omitted="true">${safeText(attribute(tag, 'alt'))}</span>`)
  html = html.replace(/<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1\s*>/giu, (match, tag, attributes, body) => {
    const label = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return /entry requirements?|admission requirements?|qualifications required|english language requirements?|testing requirements?|application requirements?|入学要求|申请要求|语言要求/iu.test(label)
      ? `<${tag}${attributes} data-admissions-preview-focus="true">${body}</${tag}>`
      : match
  })
  html = html.replace(/https?:\/\/[^\s<>"')]+/giu, '')
  const staticStyle = '<style>html,body{width:390px;max-width:390px;margin:0;padding:0;overflow-x:hidden;background:#fff;color:#111;font-family:Arial,sans-serif}*{box-sizing:border-box;max-width:100%}body{padding:14px}img{height:auto}[data-admissions-preview-focus=true]{scroll-margin-top:12px}</style>'
  html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">${staticStyle}</head><body>${html}</body></html>`
  if (/https?:\/\//iu.test(html) || /<(?:script|iframe|object|embed)\b|\son[a-z]+\s*=/iu.test(html)) throw previewError('ADMISSIONS_PREVIEW_BUNDLE_UNSAFE', 'Preview bundle contains active or remote content.')
  if (Buffer.byteLength(html) > MAX_BUNDLE_BYTES) throw previewError('ADMISSIONS_PREVIEW_BUNDLE_TOO_LARGE', 'Preview bundle exceeds its bound.')
  return { html, sourceUrl: source.href, width: 390, height: 900 }
}
